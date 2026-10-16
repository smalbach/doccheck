/**
 * Checks a query the model wrote before it runs (docs/ANALYTICS.md, "Data Q&A"). It is the first of
 * three walls, so it is strict rather than clever: a single SELECT (or WITH ... SELECT) over the
 * allow-listed views, calling only allow-listed functions, without comments, parameters, dollar
 * quotes, schema names, catalog names or casts to reg* types. The query then runs in a read-only
 * transaction with a statement timeout, as a role that can read only those views, which show only
 * the active organization's rows (migration 049). Anything the guard is unsure about is refused.
 */

export class SqlRejected extends Error {}

/** The views a question can read; each one only has the active organization's rows. */
export const QA_VIEWS = ['shipments', 'invoices', 'invoice_lines', 'packing_lists', 'bills_of_lading', 'containers', 'isf', 'parties', 'products', 'findings', 'mail_requests'] as const;

/** Functions a query may call. Nothing that reads settings, files, the catalog, or sleeps. */
const FUNCTIONS = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'string_agg', 'array_agg', 'bool_or', 'bool_and', 'every', 'percentile_cont', 'percentile_disc', 'mode', 'stddev', 'variance',
  'round', 'trunc', 'abs', 'ceil', 'ceiling', 'floor', 'greatest', 'least', 'coalesce', 'nullif', 'cast',
  'lower', 'upper', 'initcap', 'trim', 'btrim', 'ltrim', 'rtrim', 'length', 'char_length', 'substring', 'substr', 'position', 'strpos', 'left', 'right', 'replace', 'concat', 'concat_ws', 'split_part', 'starts_with', 'lpad', 'rpad',
  'date_trunc', 'date_part', 'extract', 'to_char', 'to_date', 'now', 'age', 'make_date', 'array_length', 'cardinality', 'unnest',
  'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead', 'first_value', 'last_value',
]);
/** Calls whose arguments may contain FROM (extract(month from d), substring(s from 1 for 2)). */
const FROM_INSIDE = new Set(['extract', 'substring', 'trim', 'btrim', 'position', 'overlay']);

/** Words that are followed by "(" without being a function call. */
const PAREN_KEYWORDS = new Set(['in', 'exists', 'any', 'all', 'some', 'over', 'filter', 'as', 'from', 'join', 'lateral', 'on', 'using', 'where', 'and', 'or', 'not', 'select', 'when', 'then', 'else', 'group', 'having', 'values', 'by', 'distinct', 'between', 'like', 'ilike', 'is', 'case', 'with', 'union', 'intersect', 'except', 'limit', 'offset', 'materialized']);

/** Never allowed, in any position: statements other than SELECT, locking, session state, catalog access. */
const FORBIDDEN = new Set([
  'insert', 'update', 'delete', 'merge', 'upsert', 'drop', 'alter', 'create', 'grant', 'revoke', 'truncate', 'copy', 'call', 'do', 'execute', 'prepare', 'deallocate',
  'listen', 'notify', 'unlisten', 'vacuum', 'analyze', 'explain', 'set', 'reset', 'show', 'lock', 'into', 'table', 'comment', 'security', 'begin', 'commit', 'rollback', 'savepoint',
  'release', 'discard', 'load', 'refresh', 'reindex', 'cluster', 'checkpoint', 'import', 'returning', 'share', 'nowait', 'skip', 'tablesample',
  'current_user', 'session_user', 'current_role', 'user', 'current_schema', 'current_catalog', 'current_database', 'information_schema',
  'regclass', 'regproc', 'regprocedure', 'regoper', 'regoperator', 'regtype', 'regrole', 'regnamespace', 'regconfig', 'regdictionary', 'regcollation', 'oid', 'xid', 'tid', 'cid',
]);

/** Keywords that end a FROM list at the same depth. */
const END_FROM = new Set(['where', 'group', 'having', 'window', 'order', 'limit', 'offset', 'fetch', 'union', 'intersect', 'except', 'for', 'select', 'returning']);
const JOINS = new Set(['join']);

export const MAX_SQL_LENGTH = 4000;

type Token =
  | { t: 'word'; v: string; quoted: boolean; at: number }
  | { t: 'string'; at: number }
  | { t: 'number'; at: number }
  | { t: 'punct'; v: string; at: number };

const PUNCT = new Set(['(', ')', ',', '.', '+', '-', '*', '/', '%', '<', '>', '=', '!', '|', ':', '[', ']', '~']);

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ((c === '-' && sql[i + 1] === '-') || (c === '/' && sql[i + 1] === '*')) throw new SqlRejected('Comments are not allowed');
    if (c === "'") {
      const at = i++;
      for (;;) {
        if (i >= sql.length) throw new SqlRejected('Unterminated string');
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") i += 2;
          else break;
        } else if (sql[i] === '\\') throw new SqlRejected('Backslashes are not allowed in strings');
        else i++;
      }
      i++;
      // E'..', U&'..', B'..' and X'..' prefixes are words before the quote: refuse them.
      const prev = tokens.at(-1);
      if (prev?.t === 'word' && !prev.quoted && prev.at + prev.v.length === at) throw new SqlRejected('Prefixed strings are not allowed');
      tokens.push({ t: 'string', at });
      continue;
    }
    if (c === '"') {
      const at = i++;
      let v = '';
      for (;;) {
        if (i >= sql.length) throw new SqlRejected('Unterminated quoted name');
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            v += '"';
            i += 2;
          } else break;
        } else v += sql[i++];
      }
      i++;
      tokens.push({ t: 'word', v, quoted: true, at });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const at = i;
      while (i < sql.length && /[0-9.eE]/.test(sql[i])) {
        if ((sql[i] === 'e' || sql[i] === 'E') && /[+-]/.test(sql[i + 1] ?? '')) i++;
        i++;
      }
      if (/[a-z_]/i.test(sql[i] ?? '')) throw new SqlRejected('Unexpected text after a number');
      tokens.push({ t: 'number', at });
      continue;
    }
    if (/[a-z_]/i.test(c)) {
      const at = i;
      while (i < sql.length && /[a-z0-9_]/i.test(sql[i])) i++;
      tokens.push({ t: 'word', v: sql.slice(at, i).toLowerCase(), quoted: false, at });
      continue;
    }
    if (PUNCT.has(c)) {
      tokens.push({ t: 'punct', v: c, at: i++ });
      continue;
    }
    if (c === ';') throw new SqlRejected('Only one statement is allowed');
    throw new SqlRejected(`Character "${c}" is not allowed`);
  }
  return tokens;
}

const isWord = (tok: Token | undefined, v?: string): tok is Extract<Token, { t: 'word' }> => tok?.t === 'word' && (v === undefined || (!tok.quoted && tok.v === v));
const isPunct = (tok: Token | undefined, v: string) => tok?.t === 'punct' && tok.v === v;

export interface CheckedSql {
  /** The query without a trailing semicolon, ready to wrap. */
  sql: string;
  /** Views it reads. */
  views: string[];
}

/**
 * Accepts the query or throws SqlRejected saying why. `views` defaults to QA_VIEWS; the names
 * must be bare (the runner puts the views' schema on the search path).
 */
export function checkSql(input: string, views: readonly string[] = QA_VIEWS): CheckedSql {
  const sql = input.trim().replace(/;\s*$/, '').trim();
  if (!sql) throw new SqlRejected('The query is empty');
  if (sql.length > MAX_SQL_LENGTH) throw new SqlRejected(`The query is longer than ${MAX_SQL_LENGTH} characters`);
  const tokens = tokenize(sql);
  const first = tokens[0];
  if (!isWord(first, 'select') && !isWord(first, 'with')) throw new SqlRejected('Only SELECT queries are allowed');

  const allowed = new Set(views);
  // Names the query defines with WITH: "name AS (" or "name (cols) AS (".
  const ctes = new Set<string>();
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (!isWord(tok)) continue;
    const next = tokens[k + 1];
    if (isWord(next, 'as') && (isPunct(tokens[k + 2], '(') || isWord(tokens[k + 2], 'materialized') || isWord(tokens[k + 2], 'not'))) ctes.add(tok.v);
    if (isPunct(next, '(')) {
      // name (a, b) AS (
      let d = 0;
      let m = k + 1;
      for (; m < tokens.length; m++) {
        if (isPunct(tokens[m], '(')) d++;
        else if (isPunct(tokens[m], ')') && --d === 0) break;
      }
      if (isWord(tokens[m + 1], 'as') && isPunct(tokens[m + 2], '(') && (isWord(tokens[k - 1], 'with') || isPunct(tokens[k - 1], ',') || isWord(tokens[k - 1], 'recursive'))) ctes.add(tok.v);
    }
  }

  const used = new Set<string>();
  // Parenthesis stack: a function call's arguments, or a group (subquery, expression, list).
  const stack: { kind: 'call' | 'group'; fn?: string }[] = [];
  // Depths at which a FROM list is open, and whether a relation is expected next.
  const from = new Map<number, { expect: boolean }>();
  let selects = 0;

  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    const depth = stack.length;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];

    if (tok.t === 'punct') {
      if (tok.v === '(') {
        if (isWord(prev) && !(prev.quoted === false && PAREN_KEYWORDS.has(prev.v)) && !ctes.has(prev.v)) {
          if (isPunct(tokens[k - 2], '.')) throw new SqlRejected('Qualified function names are not allowed');
          if (prev.quoted || !FUNCTIONS.has(prev.v)) throw new SqlRejected(`Function "${prev.v}" is not allowed`);
          stack.push({ kind: 'call', fn: prev.v });
        } else stack.push({ kind: 'group' });
        const f = from.get(depth);
        if (f?.expect) f.expect = false; // a subquery in the FROM list
        continue;
      }
      if (tok.v === ')') {
        if (!stack.length) throw new SqlRejected('Unbalanced parentheses');
        from.delete(depth);
        stack.pop();
        continue;
      }
      if (tok.v === ',') {
        const f = from.get(depth);
        if (f) f.expect = true;
        continue;
      }
      if (tok.v === ':' && isPunct(next, ':')) {
        const type = tokens[k + 2];
        if (!isWord(type) || type.quoted || !CAST_TYPES.has(type.v)) throw new SqlRejected(`Cast to "${isWord(type) ? type.v : '?'}" is not allowed`);
        k += 2;
        continue;
      }
      continue;
    }
    if (tok.t !== 'word') {
      const f = from.get(depth);
      if (f?.expect) throw new SqlRejected('Expected a view name after FROM');
      continue;
    }

    const w = tok.v;
    if (!tok.quoted) {
      if (FORBIDDEN.has(w)) throw new SqlRejected(`"${w.toUpperCase()}" is not allowed`);
      if (w.startsWith('pg_')) throw new SqlRejected('System catalogs are not allowed');
      if (w === 'select') selects++;
    } else if (w.toLowerCase().startsWith('pg_')) throw new SqlRejected('System catalogs are not allowed');

    // Inside extract(... from ...) FROM is part of the call, not a relation list.
    const top = stack.at(-1);
    const insideFromCall = top?.kind === 'call' && FROM_INSIDE.has(top.fn ?? '');
    if (!tok.quoted && (w === 'from' || JOINS.has(w)) && !insideFromCall) {
      from.set(depth, { expect: true });
      continue;
    }
    const f = from.get(depth);
    if (f) {
      if (!tok.quoted && END_FROM.has(w)) {
        from.delete(depth);
        continue;
      }
      if (f.expect) {
        if (!tok.quoted && (w === 'lateral' || w === 'only')) {
          if (w === 'only') throw new SqlRejected('"ONLY" is not allowed');
          continue;
        }
        if (isPunct(next, '.')) throw new SqlRejected('Schema-qualified names are not allowed');
        if (isPunct(next, '(')) throw new SqlRejected('Functions in FROM are not allowed');
        if (!allowed.has(w) && !ctes.has(w)) throw new SqlRejected(`"${w}" is not one of the views a question can read (${[...allowed].join(', ')})`);
        if (allowed.has(w) && !ctes.has(w)) used.add(w);
        f.expect = false;
        continue;
      }
      // Joined relations: "a join b", "a left join b", "a cross join b", "a natural join b".
    }
    // A dotted reference "x.y": x must be a view, a CTE or an alias; aliases cannot be told apart here,
    // so only catalog-looking qualifiers are refused (above). Columns of other relations are unreachable:
    // a relation only enters the query through FROM or JOIN, which are checked.
  }
  if (stack.length) throw new SqlRejected('Unbalanced parentheses');
  if (selects === 0) throw new SqlRejected('Only SELECT queries are allowed');
  return { sql, views: [...used].sort() };
}

/** Types a query may cast to with "::". */
const CAST_TYPES = new Set(['text', 'varchar', 'numeric', 'decimal', 'int', 'integer', 'bigint', 'smallint', 'date', 'timestamp', 'timestamptz', 'boolean', 'bool', 'interval']);

/** The query as the runner sends it: wrapped so at most `limit` rows come back whatever it says. */
export const wrapWithLimit = (sql: string, limit: number) => `select * from (\n${sql}\n) as answer limit ${Math.max(1, Math.floor(limit))}`;

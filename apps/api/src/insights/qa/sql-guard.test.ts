import { describe, expect, it } from 'vitest';
import { checkSql, SqlRejected, wrapWithLimit } from './sql-guard';

const ok = (sql: string) => checkSql(sql);
const refused = (sql: string, why?: RegExp) => {
  expect(() => checkSql(sql), sql).toThrow(SqlRejected);
  if (why) expect(() => checkSql(sql)).toThrow(why);
};

describe('checkSql accepts', () => {
  it('plain SELECTs over the views, with joins, grouping and a trailing semicolon', () => {
    expect(ok('select count(*) from shipments;').views).toEqual(['shipments']);
    expect(
      ok(`select s.reference, count(*) as n from shipments s join findings f on f.shipment_id = s.id
          left join invoices i on i.shipment_id = s.id where f.rule_id in ('X3', 'X4') group by s.reference order by n desc limit 10`).views,
    ).toEqual(['findings', 'invoices', 'shipments']);
    expect(ok('select * from shipments a, invoices b where a.id = b.shipment_id').views).toEqual(['invoices', 'shipments']);
  });

  it('CTEs, subqueries, window functions, casts and extract(... from ...)', () => {
    const q = ok(`with recent as (select * from findings where validated_at >= date_trunc('month', now()))
      select r.rule_id, extract(month from r.validated_at)::int as m, rank() over (order by count(*) desc)
      from recent r where r.shipment_id in (select shipment_id from invoice_lines where hs2 = '61' and country_of_origin = 'CN')
      group by 1, 2`);
    expect(q.views).toEqual(['findings', 'invoice_lines']);
    expect(ok("select substring(description from 1 for 10), cast(unit_price as numeric) from invoice_lines where invoice_date > date '2026-01-01'").views).toEqual(['invoice_lines']);
    expect(ok('select * from (select seller_name, sum(invoice_total) t from invoices group by 1) x where t > 10').views).toEqual(['invoices']);
    expect(ok('with a (n) as (select 1) select n from a').views).toEqual([]);
    expect(ok('select "reference" from "shipments"').views).toEqual(['shipments']);
  });

  it('strings that contain SQL keywords or semicolons', () => {
    expect(ok("select * from findings where message ilike '%delete; drop table x%'").views).toEqual(['findings']);
    expect(ok("select 'it''s' as x from shipments").views).toEqual(['shipments']);
  });
});

describe('checkSql refuses', () => {
  it('anything but a single SELECT', () => {
    refused('', /empty/);
    refused('delete from shipments', /Only SELECT/);
    refused('update shipments set reference = 1', /Only SELECT/);
    refused('select 1; drop table shipments', /one statement/);
    refused('select 1; select 2', /one statement/);
    refused('with x as (delete from shipments returning *) select * from x', /DELETE/);
    refused('select * into copy_of from shipments', /INTO/);
    refused('explain select * from shipments', /Only SELECT/);
    refused('set role postgres', /Only SELECT/);
    refused('values (1)', /Only SELECT/);
    refused('table shipments', /Only SELECT/);
    refused('select * from shipments for update', /UPDATE/);
    refused('select * from shipments for share', /SHARE/);
  });

  it('tables that are not allow-listed views, schemas and the catalog', () => {
    refused('select * from users', /not one of the views/);
    refused('select * from public.shipments', /Schema-qualified/);
    refused('select * from qa.shipments', /Schema-qualified/);
    refused('select * from pg_user', /catalog/);
    refused('select * from pg_catalog.pg_authid', /catalog/);
    refused('select * from "pg_shadow"', /catalog/);
    refused('select * from information_schema.tables', /INFORMATION_SCHEMA/);
    refused('select * from shipments where id in (select id from sessions)', /not one of the views/);
    refused('select (select password_hash from users limit 1) from shipments', /not one of the views/);
    refused('select * from shipments join extractions e on true', /not one of the views/);
    refused('select * from shipments s, users u', /not one of the views/);
    refused('select * from shipments union select email, null from users', /not one of the views/);
    refused('select * from only shipments', /ONLY/);
    refused('select * from generate_series(1, 10)', /Functions? .*not allowed/);
    refused('select * from shipments tablesample system (10)', /TABLESAMPLE/);
  });

  it('functions that read settings or files, change the account, or sleep', () => {
    refused("select set_config('doccheck.qa_user', '00000000-0000-0000-0000-000000000000', true), * from shipments", /set_config/);
    refused("select current_setting('doccheck.qa_user')", /current_setting/);
    refused('select pg_sleep(10)', /catalog/);
    refused("select pg_read_file('/etc/passwd')", /catalog/);
    refused("select lo_import('/etc/passwd')", /lo_import/);
    refused('select dblink_exec(1)', /dblink_exec/);
    refused('select pg_catalog.lower(reference) from shipments', /catalog/);
    refused('select public.dc_norm(reference) from shipments', /Qualified function/);
    refused('select "lower"(reference) from shipments', /not allowed/);
    refused('select dc_qa_user()', /dc_qa_user/);
    refused('select array(select email from users)', /array/);
    refused('select current_user', /CURRENT_USER/);
    refused('select user', /USER/);
    refused('select operator(pg_catalog.+)(1, 2)', /operator/);
  });

  it('comments, parameters, dollar quotes, escapes and reg* casts', () => {
    refused('select * from shipments -- where user_id = x', /Comments/);
    refused('select * from shipments /* x */', /Comments/);
    refused('select $1', /not allowed/);
    refused('select $$a$$', /not allowed/);
    refused("select E'\\x41'", /Backslashes|Prefixed/);
    refused("select U&'\\0041'", /not allowed|Backslashes/);
    refused("select 'pg_authid'::regclass", /regclass/);
    refused("select cast('pg_authid' as regclass)", /REGCLASS/);
    refused("select 'x'::oid", /oid/);
    refused('select 1 from shipments where (', /Unbalanced/);
    refused("select 'unterminated", /Unterminated/);
    refused(`select * from shipments where reference = '${'x'.repeat(5000)}'`, /longer/);
  });
});

describe('wrapWithLimit', () => {
  it('caps the rows whatever the query says', () => {
    expect(wrapWithLimit('select * from shipments limit 100000', 201)).toBe('select * from (\nselect * from shipments limit 100000\n) as answer limit 201');
  });
});

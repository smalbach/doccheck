import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { Disclosure } from '../../components/ui/Disclosure';
import { PageHeader } from '../../components/ui/PageHeader';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { integrationsApi, type OpenApiDocument, type OpenApiOperation } from './integrationsApi';
import { CodeBlock } from './shared';

type Schema = Record<string, unknown>;

/** A JSON Schema written as a short type: "Shipment", "string[]", "\"CA\" | \"US\"". */
export function typeOf(s: Schema | undefined): string {
  if (!s) return 'any';
  if (typeof s.$ref === 'string') return s.$ref.split('/').at(-1)!;
  if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  if ('const' in s) return JSON.stringify(s.const);
  for (const k of ['anyOf', 'oneOf'] as const) if (Array.isArray(s[k])) return (s[k] as Schema[]).map(typeOf).join(' | ');
  if (s.type === 'array') return Array.isArray(s.prefixItems) ? `[${(s.prefixItems as Schema[]).map(typeOf).join(', ')}]` : `${typeOf(s.items as Schema)}[]`;
  if (s.type === 'object' && !s.properties) return 'object';
  if (typeof s.type === 'string') return s.format ? `${s.type} (${String(s.format)})` : s.type;
  if (Array.isArray(s.type)) return s.type.join(' | ');
  return 'object';
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function Properties({ schema, caption }: { schema: Schema; caption: string }) {
  const { t } = useI18n();
  const props = Object.entries((schema.properties ?? {}) as Record<string, Schema>);
  const required = new Set((schema.required ?? []) as string[]);
  if (!props.length) return <p className="mono small">{typeOf(schema)}</p>;
  return (
    <DataTable
      compact
      caption={caption}
      rows={props}
      rowKey={([name]) => name}
      columns={[
        { key: 'name', header: t('integrations.docs.field'), cell: ([name]) => <code className="mono">{name}{required.has(name) ? '' : '?'}</code> },
        { key: 'type', header: t('integrations.docs.type'), cell: ([, s]) => <code className="mono break">{typeOf(s)}</code> },
        { key: 'about', header: t('integrations.docs.about'), secondary: true, cell: ([, s]) => <span className="small" lang="en">{typeof s.description === 'string' ? s.description : ''}</span> },
      ]}
    />
  );
}

function Operation({ method, path, op }: { method: string; path: string; op: OpenApiOperation }) {
  const { t } = useI18n();
  const body = op.requestBody?.content;
  return (
    <article className="api-op" id={op.operationId}>
      <h3 className="api-op-title">
        <span className={`api-method api-method-${method}`}>{method.toUpperCase()}</span> <code className="mono break">{path}</code>
      </h3>
      {op.summary && <p className="api-op-summary" lang="en">{op.summary}</p>}
      {op.description && <p className="muted small" lang="en">{op.description}</p>}
      {op.parameters && op.parameters.length > 0 && (
        <>
          <h4 className="field-label">{t('integrations.docs.parameters')}</h4>
          <DataTable
            compact
            caption={`${op.operationId} ${t('integrations.docs.parameters')}`}
            rows={op.parameters}
            rowKey={(p) => `${p.in}-${p.name}`}
            columns={[
              { key: 'name', header: t('integrations.docs.name'), cell: (p) => <code className="mono">{p.name}</code> },
              { key: 'in', header: t('integrations.docs.location'), cell: (p) => p.in },
              { key: 'type', header: t('integrations.docs.type'), cell: (p) => <code className="mono break">{typeOf(p.schema)}{p.required ? ` · ${t('integrations.docs.required')}` : ''}</code> },
              { key: 'about', header: t('integrations.docs.about'), secondary: true, cell: (p) => <span className="small" lang="en">{p.description}</span> },
            ]}
          />
        </>
      )}
      {body && (
        <p className="small">
          <span className="field-label">{t('integrations.docs.body')}: </span>
          {Object.entries(body).map(([type, c]) => (
            <code key={type} className="mono">
              {type} {typeOf(c.schema)}
            </code>
          ))}
        </p>
      )}
      <h4 className="field-label">{t('integrations.docs.responses')}</h4>
      <ul className="plain-list small">
        {Object.entries(op.responses ?? {}).map(([code, r]) => {
          const schema = Object.values(r.content ?? {})[0]?.schema;
          return (
            <li key={code}>
              <code className="mono">{code}</code> <span lang="en">{r.description}</span>
              {schema && <code className="mono"> → {typeOf(schema)}</code>}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/** The public API, read from its OpenAPI document. */
export function ApiDocsPage() {
  const { t } = useI18n();
  const { data: spec, error } = useQuery<OpenApiDocument>('openapi', () => integrationsApi.openapi());
  if (!spec) return <LoadingCard error={error} />;
  const ops = Object.entries(spec.paths).flatMap(([path, item]) => METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m]! })));
  const tags = [...new Set(ops.flatMap((o) => o.op.tags ?? ['API']))];
  return (
    <div className="page page-narrow">
      <PageHeader
        title={t('integrations.docs.title')}
        description={t('integrations.docs.description')}
        actions={
          <>
            <Button asChild>
              <a href="/api/v1/openapi.json" download="doccheck-openapi.json">
                {t('integrations.docs.download')}
              </a>
            </Button>
            <Button asChild variant="primary">
              <a href="#/app/integrations">{t('integrations.docs.keysLink')}</a>
            </Button>
          </>
        }
      />
      <Card title={t('integrations.docs.basics')}>
        <p className="muted small">
          {spec.info.title} {spec.info.version} · OpenAPI {spec.openapi}
        </p>
        <ul className="plain-list">
          <li>{t('integrations.docs.auth')}</li>
          <li>{t('integrations.docs.limits')}</li>
          <li>{t('integrations.docs.idempotency')}</li>
          <li>{t('integrations.docs.errors')}</li>
          <li>{t('integrations.docs.postman')}</li>
        </ul>
        <CodeBlock>{`curl -H "Authorization: Bearer $DOCCHECK_API_KEY" \\
  -H "Idempotency-Key: po-4411" -H "content-type: application/json" \\
  -d '{"reference":"PO-4411","destination":"CA"}' \\
  ${window.location.origin}/api/v1/shipments`}</CodeBlock>
      </Card>
      {tags.map((tag) => (
        <Card key={tag} title={tag}>
          {ops.filter((o) => (o.op.tags ?? ['API']).includes(tag)).map((o) => <Operation key={`${o.method} ${o.path}`} {...o} />)}
        </Card>
      ))}
      {spec.webhooks && (
        <Card title={t('integrations.docs.webhooks')}>
          <p className="muted">{t('integrations.docs.webhooksText')}</p>
          <ul className="plain-list">
            {Object.keys(spec.webhooks).map((name) => (
              <li key={name}>
                <code className="mono">{name}</code>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={t('integrations.docs.schemas')}>
        {Object.entries(spec.components.schemas).map(([name, schema]) => (
          <Disclosure key={name} summary={<code className="mono">{name}</code>}>
            <Properties schema={schema} caption={name} />
          </Disclosure>
        ))}
      </Card>
    </div>
  );
}

import type { PartyAddress } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { RoleTags } from './RoleTags';

/** Each address, tax ID and contact a company's documents give, with the roles and how often. */
export function AddressList({ addresses }: { addresses: readonly PartyAddress[] }) {
  const { t } = useI18n();
  return (
    <ul className="address-list">
      {addresses.map((a, i) => (
        <li key={i}>
          <strong>{a.name}</strong>
          <address>
            {[...a.lines, [a.postalCode, a.city, a.region].filter(Boolean).join(' '), a.country].filter(Boolean).map((line, j) => (
              <span key={j} className="block">
                {line}
              </span>
            ))}
          </address>
          {a.taxId && (
            <span className="small block">
              {t('insights.parties.detail.taxId')}: <span className="mono">{a.taxId}</span>
            </span>
          )}
          {a.contact && (
            <span className="small block">
              {t('insights.company.contact')}: {[a.contact.name, a.contact.email, a.contact.phone].filter(Boolean).join(' · ')}
            </span>
          )}
          <span className="address-meta">
            <RoleTags roles={a.roles} />
            <span className="muted small">{t('insights.company.documents', { count: a.documents })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

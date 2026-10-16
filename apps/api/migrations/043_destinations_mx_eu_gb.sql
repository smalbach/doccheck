-- Mexico (MX), the European Union (EU) and the United Kingdom (GB) join Canada and the US as
-- destinations. The checks were created inline, so they carry Postgres' default names.

alter table shipments drop constraint shipments_destination_check;
alter table shipments add constraint shipments_destination_check check (destination in ('CA', 'US', 'MX', 'EU', 'GB'));

alter table validations drop constraint validations_destination_check;
alter table validations add constraint validations_destination_check check (destination in ('CA', 'US', 'MX', 'EU', 'GB'));

-- Records retention for the new destinations, per organization, with each one's legal minimum as the
-- default: Mexico 5 years (Código Fiscal de la Federación, art. 30), the EU at least 3 years (Union
-- Customs Code, art. 51(1)), the UK 4 years (HMRC, "Archiving your trade documents").
alter table organizations
  add column retention_mx_years int not null default 5 check (retention_mx_years between 1 and 50),
  add column retention_eu_years int not null default 3 check (retention_eu_years between 1 and 50),
  add column retention_gb_years int not null default 4 check (retention_gb_years between 1 and 50);

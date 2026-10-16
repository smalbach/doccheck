-- Mexico (MX), the European Union (EU) and the United Kingdom (GB) join Canada and the US as
-- destinations. The checks were created inline, so they carry Postgres' default names.

alter table shipments drop constraint shipments_destination_check;
alter table shipments add constraint shipments_destination_check check (destination in ('CA', 'US', 'MX', 'EU', 'GB'));

alter table validations drop constraint validations_destination_check;
alter table validations add constraint validations_destination_check check (destination in ('CA', 'US', 'MX', 'EU', 'GB'));

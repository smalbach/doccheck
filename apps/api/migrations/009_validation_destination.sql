-- The destination each validation ran against: a shipment's destination can now be edited, and its
-- earlier runs (kept as history) must still say which country's rules they applied.

alter table validations add column destination text check (destination in ('CA', 'US'));
update validations v set destination = s.destination from shipments s where s.id = v.shipment_id;

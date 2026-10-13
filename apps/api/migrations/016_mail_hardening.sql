-- What the receiving server said about a received message's sender (Authentication-Results):
-- fail when DMARC, DKIM or SPF failed, so the app can warn that the From may be forged.
alter table mail_messages add column sender_check text check (sender_check in ('pass', 'fail', 'none'));

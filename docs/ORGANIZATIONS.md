# Organizations and teamwork

DocCheck works for teams: shipments, companies, products, conversations with suppliers and live progress belong to an **organization**, and every member sees them with what their role allows. Migration `040_organizations.sql` gives every existing account a personal organization (the account is its owner) holding what it had, so nobody's view changes on upgrade. Shipments from before accounts existed still belong to nobody and stay hidden.

## Organizations

- The sidebar's switcher shows the organization the session works in, lists the others and makes new ones (the creator is owner). Switching is per session (`sessions.org_id`) and remembered for new sessions and for documents sent by email (`users.last_org_id`).
- **Members** (`#/app/team`): owners and admins invite by email (a link valid 7 days, for that address only; the invitee signs in or signs up with it), change roles and remove members; anyone can leave. The last owner cannot step down or leave, and cannot delete their account, until there is another owner.
- **Settings**: name, two-step approval, the due date lead time and records retention. Owners delete a team organization with its shipments and PDFs; a personal one goes with its account.
- Deleting an account deletes the organizations only that account belonged to.

## Roles

One table decides every permission: `PERMISSIONS` in [`apps/api/src/orgs/permissions.ts`](../apps/api/src/orgs/permissions.ts). Routes name a permission with `@Permission()`; the global `OrgGuard` checks it against the member's role in the active organization. A route that names none needs `data.read` to read and `shipment.write` to change anything, so a new route is closed to viewers and clients until it says otherwise. `@NoOrg()` marks per-user routes (account, sign-in, server administration).

| Permission | Owner | Admin | Analyst | Reviewer | Viewer | Client |
| --- | --- | --- | --- | --- | --- | --- |
| `shipment.read`: open a shipment | ✓ | ✓ | ✓ | ✓ | ✓ | shared ones |
| `data.read`: all shipments, dashboard, data pages, inbox, comments | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `shipment.write`: create, upload, edit, validate, correct, write to suppliers, due dates | ✓ | ✓ | ✓ | | | |
| `finding.decide`: open, waiting for supplier, accepted risk, false positive | ✓ | ✓ | ✓ | ✓ | | |
| `finding.approve`: approve someone else's accepted risk or false positive | ✓ | ✓ | | ✓ | | |
| `comment.write`, `assign` | ✓ | ✓ | ✓ | ✓ | | |
| `members.manage`: invite, roles, remove, share with clients | ✓ | ✓ | | | | |
| `org.settings`, `audit.read` | ✓ | ✓ | | | | |
| `billing.manage`: buy and manage the plan (docs/BILLING.md) | ✓ | ✓ | | | | |
| `org.delete` | ✓ | | | | | |

Only an owner makes or unmakes owners. A **client** sees only the shipments shared with them (shipment page, Team card: "Shared with clients"), read-only, without the team's comments or approval queue.

Every route with a shipment `:id` goes through `ShipmentOwnerGuard`, which answers 404 unless the shipment is in the active organization (and shared, for a client): the same answer as for a shipment that does not exist. `test/orgs.test.mjs` calls every shipment route as a member of another organization and expects 404, and checks lists, data pages, alerts, progress labels and mail.

## Teamwork on a shipment

- **Assignment**: a shipment and each finding (by fingerprint, so it follows the finding across runs) can be assigned to an owner, admin, analyst or reviewer. The shipments list filters "Assigned to me".
- **Comments** on the shipment, a document or a finding, with **@mentions** (picked from the members; only members who can read the shipment are kept). The author edits; the author, an owner or an admin removes (the text goes, a placeholder stays).
- **Notifications** for mentions, assignments, approval requests and decisions: in the app (`#/app/notifications`, count in the sidebar) and by email through the server's SMTP, in the member's language. Each member chooses per kind in Account, Notifications. Nobody is notified of their own action.
- **Two-step approval** (organization setting): an accepted risk or false positive becomes a request (`review_requests`); owners, admins and reviewers are notified, and one who did not ask approves (the decision is recorded in the requester's name with `approved_by`) or rejects with a reason. Choosing open or waiting for supplier withdraws what was pending. The queue is at `#/app/approvals`.
- **Due dates** (view `shipment_due`): set by hand, else for a US ocean shipment the ISF deadline, 24 hours before lading (19 CFR 149.2; the B/L's shipped-on-board date stands for lading), else the ETA minus the organization's lead time (48 hours by default). The dashboard counts overdue shipments; the list filters overdue and due within 48 hours and shows the due date and assignee.

## Audit log

`audit_log` holds every write: who (user and email), which organization, the action, the entity, the values before and after, and the client address. The global `AuditInterceptor` logs every request that changes something once it succeeds; services describe their changes with `AuditService.note({ action, entity, entityId, before, after })` (shipment create, update, delete, finding decisions and approvals, assignments, due dates, comments, members, settings, SSO, sign-in). A write that notes nothing is logged as `http.<method>` with its route, ids and body. Keys that look like secrets (`password`, `secret`, `token`, `code`, `ticket`) are replaced by `[redacted]`.

The table is **append-only**: triggers refuse `UPDATE`, `DELETE` and `TRUNCATE`. Each row stores the SHA-256 of its content and of the previous row's hash in the same organization (`prev_hash`, `hash`, computed in the insert trigger under an advisory lock), so editing or removing a row with the triggers disabled breaks the chain. `GET /audit/verify` (the page's "Check integrity") recomputes it and names the first broken row. The page `#/app/audit` filters by action, dates and text and exports CSV (`GET /audit/log.csv`). The log has no foreign keys: it outlives the users and organizations it names.

## Records retention

Per organization: CBSA asks importers to keep records 6 years (Customs Act s. 40, Memorandum D17-1-21), CBP 5 years (19 CFR 163.4); both are the defaults, between 1 and 50 years. `RetentionJob` runs a minute after start and then daily (`RETENTION_INTERVAL_MS`, off with `RETENTION_JOB=off` and in the read-only demo). It deletes shipments created longer ago than their destination's period (the longer of both while the destination is unset), with their PDFs, and nothing else; a shipment still extracting waits for the next run. Each deletion is a `retention.delete` row in the audit log with the reference, destination, creation date and document count. Settings shows how many shipments are past their period and can run it at once.

## Sign-in

- **Sessions**: Account lists every signed-in device (browser, address, method, last activity; `last_seen_at` is written at most every 5 minutes) and signs any of them out.
- **Two-factor (TOTP, RFC 6238)**: Account, Two-factor sign-in. The secret is sealed with the settings key (AES-256-GCM, like the mail password); a code is accepted once (the last time step is stored) within one step of drift; ten single-use recovery codes are stored as SHA-256 and shown once. Sign-in with a right password returns `{ mfaRequired, ticket }`; the code goes to `POST /auth/mfa` (5 tries, 5 minutes). There is no QR code library in the web app: the setup shows an `otpauth://` link and the key.
- **Single sign-on (OpenID Connect)**: Organization settings, any provider (issuer URL, client id and secret; the secret sealed). The sign-in page's "Sign in with SSO" finds the organization by the email's domain and sends the browser to the provider (authorization code flow with PKCE, `state` and `nonce`); the callback `GET /auth/sso/callback` (register `APP_URL` + `/auth/sso/callback` at the provider) checks the ID token's signature against the provider's keys (RS256/384/512, PS256, ES256/384; never `none` or HMAC), issuer, audience, expiry and nonce, and requires a verified email in the organization's domains. A new person gets an account (without a usable password) and joins with the default role; **an existing account must already be a member** (invited), so a provider cannot take over accounts. A domain belongs to one organization's SSO at a time. The provider's own MFA applies; DocCheck's TOTP is for password sign-in. Implemented on `node:crypto` (no dependency); the unit tests cover forged, re-signed, expired, wrong-audience and wrong-nonce tokens.
- **SAML** is not included: no maintained Node SAML library fit without pulling in XML signature handling we would have to vouch for; OIDC covers the same providers.

## Data model (migration 040)

| Table | What |
| --- | --- |
| `organizations` | name, personal, retention years per destination, `require_approval`, `sla_eta_lead_hours` |
| `org_members` | (org, user) → role |
| `org_invites` | emailed invitations (SHA-256 of the token), 7 days, used once |
| `shipment_shares` | shipments shared with clients |
| `finding_assignments`, `shipments.assignee_id` | who works what |
| `comments`, `notifications`, `users.notification_prefs` | teamwork |
| `review_requests`, `finding_reviews.approved_by` | two-step decisions |
| `shipments.eta`, `shipments.due_at`, view `shipment_due` | due dates |
| `audit_log` | append-only, hash-chained |
| `sessions.id/org_id/ip/user_agent/method/last_seen_at`, `mfa_recovery_codes`, `mfa_challenges`, `users.mfa_*` | sessions and TOTP |
| `org_sso`, `sso_states` | OpenID Connect |

`org_id` was added to `shipments`, `parties`, `products`, every table of [DATA-MODEL.md](DATA-MODEL.md) (filled from the shipment by a `BEFORE INSERT` trigger, `dc_org_from_shipment`), `progress_events`, `mail_threads`, `mail_contacts` and `mail_intakes`. Companies and products are one record per organization (`unique (org_id, key)`). `user_id` columns stay and mean "created by"; a creator who leaves no longer deletes the team's shipments.

## Tests

`npm run test:e2e -w @doccheck/api` runs `test/orgs.test.mjs` beside the existing suite, on its own database and port: isolation between organizations, invitations, each role, clients and shares, assignments with notifications and email preferences, comments and mentions, two-step approval, due dates and filters, the audit log (redaction, CSV, append-only, a tampered row found by the chain check), retention, TOTP (with replay and recovery codes), sessions, OIDC against a provider started by the test, and the migration of existing accounts. `test/teams-units.test.mjs` checks TOTP against the RFC 6238 vectors, ID token verification, PKCE, the role table and redaction. `npm run a11y` visits the team pages, the invitation page and the new account cards.

# ArenaGrade — Production Readiness Report

Branch: `security/production-readiness` · Prepared: 2026-10-18 · Scope: full repository audit, fixes and automated QA.

## A. Executive decision: **NOT READY** (today)

The code on this branch fixes every launch-blocking problem found in the
repository, and 127 automated tests (including genuinely concurrent database
tests) pass. But the fixes have **not yet been applied to or verified against the
real Supabase database**, and **PayHere has never been exercised** (no
credentials yet). The live site today still runs the old code, where anyone
signed in can book a court for free with the "Simulate Payment" button.

It becomes **READY FOR CONTROLLED LAUNCH** once the steps in section J are done:
schema discovery reviewed, migrations applied to a staging copy and then
production, environment variables set, and the PayHere sandbox checklist (E)
passed.

**Urgent interim step (no code needed):** until this branch is deployed, take
online booking offline or keep the site private, because the current production
code lets anyone confirm bookings without paying.

### What was verified, and how

| Category | Status |
|---|---|
| Code reviewed | All 45 source files, every browser→Supabase call, both API routes |
| Code modified | See section I (database migrations, 10 server routes, 9 pages) |
| Tests executed | 136 (unit 39 · database 76 · route-level 21) — **all passed** |
| Test-quality check | Suite run against a deliberately broken hold function: **13 tests fail**, proving the concurrency tests detect double booking |
| Build | `npm run build` passes (Next.js 16.3.8), build-time guard passes |
| Types | `tsc --noEmit` clean |
| Lint | 44 errors / 20 warnings — same per-file errors as before the work (pre-existing UI debt, not new) |
| Dependencies | `npm audit --omit=dev`: **0** vulnerabilities (was 1 critical, 4 high) |
| Client bundles | No secret names or server-only functions present |
| Schema & policies | **Verified** from production discovery output (2026-10-18); test fixture mirrors it, including the original policies |
| Pending external checks | Migration apply on staging/production, PayHere sandbox, Text.lk/Resend delivery, Vercel env, Supabase backups |

---

## B. Architecture and database

```
Browser (Next.js pages, Supabase anon key)
  ├─ reads public data directly (courts, slots, own bookings) — RLS limited
  ├─ rpc hold_slot / release_hold                  ──► Postgres (checks auth.uid())
  ├─ rpc admin_block_slot / admin_unblock_slot /
  │      admin_generate_recurring_slots            ──► Postgres (checks super_admin)
  └─ POST /api/* with Bearer access token          ──► Vercel route handlers
                                                         │ verify token (Supabase Auth)
                                                         ├─ customer actions: rpc as the user
                                                         ├─ OTP / payments / report: rpc as service_role
                                                         ├─ Text.lk (SMS)   Resend (email)
                                                         └─ PayHere checkout signing
PayHere ──server-to-server──► /api/payments/payhere/notify ──► payment_apply_notification()
Vercel Cron (+ optional Supabase pg_cron) ──► /api/cron/daily-report
```

**Verified booking model:** fixed slot rows — one row per court, date, start/end
time and `court_type` (`full_court`, `half_a`, `half_b`). Half-court rows are only
generated for hours starting before `courts.half_court_cutoff`.

**Schema status:** verified on 2026-10-18 from the read-only discovery queries
(PostgreSQL 17.6, no enums, varchar status columns with CHECK constraints).
`supabase/tests/fixtures/01_production_base_schema.sql` mirrors it, including
the original RLS policies, `handle_new_user` and `is_super_admin`. The schema is
still not in Git: commit a `supabase db dump --schema-only`. Adjustments made
after verification: the slot natural key ignores production's *partial*
`idx_slots_active`; `bookings.idempotency_key` is already unique; legacy
`payment_audit` inserts use `ON CONFLICT DO NOTHING`; public catalogue reads keep
`is_active = true`; storage policies (already correct) are left alone; the
existing `handle_new_user` is hardened. The existing pg_cron job
`release-expired-locks` is compatible and can stay. New objects added by the
migrations:

| Object | Purpose |
|---|---|
| `slots_no_conflicting_active` (EXCLUDE constraint) | No overlapping locked/booked slots on the same court part |
| `bookings_one_live_per_slot`, `bookings_idempotency_key_uniq` | One live booking per slot / per payment order |
| `payment_attempts`, `payment_events` | Payment history separate from bookings; deduplicated provider events |
| `refunds` | Manual refund lifecycle (pending → initiated → completed / cancelled) |
| `phone_otp_challenges` | Hashed OTPs with attempts, expiry, supersession |
| `audit_log`, `app_events`, `notification_log`, `job_runs`, `rate_limits` | Audit trail, incidents, message log, scheduled-job idempotency, shared rate limits |
| Functions | `hold_slot`, `release_hold`, `expire_stale_holds`, `admin_block_slot`, `admin_unblock_slot`, `admin_generate_recurring_slots`, `otp_issue_challenge`, `otp_verify_challenge`, `payment_create_attempt`, `payment_apply_notification`, `request_booking_cancellation`, `admin_decide_cancellation`, `admin_update_refund`, `report_daily`, job/notification helpers |

All SECURITY DEFINER functions pin `search_path = ''`; execute rights are
granted only to the intended role (tested: `anon` can execute none; the browser
role can execute only the 9 intended entry points).

**RLS (migration 0700):** catalogue public-read/admin-write; customers read only
their own bookings, payment attempts, refunds and profile; customers write
nothing booking-related directly; operational tables admin-read; OTP tables
server-only; storage `images` bucket admin-write. **This migration drops the
existing policies on these tables** — review the discovery output first.

---

## C. Booking integrity

**How conflicts are prevented**

1. **Database constraint (authoritative):**
   `EXCLUDE USING gist (court_id WITH =, court_part WITH &&, time_range WITH &&) WHERE status IN ('locked','booked')`,
   where `court_part` is `[1,2)` for half A, `[2,3)` for half B, `[1,3)` for full
   court, and `time_range` handles slots crossing midnight. Two incompatible
   active slots physically cannot coexist, whatever code path writes them.
2. **`hold_slot()`**: locks every slot that could conflict, in a fixed order
   (no deadlocks), releases expired holds in that set, then refuses if the slot
   is not available, overlaps a booking/hold/practice block, has started
   (Asia/Colombo), is a half court at/after the cut-off, has no valid price, or
   the customer already holds 3 slots. The expiry is set by the database clock
   (`now() + 10 minutes`); a retry returns the same hold and never extends it.
3. **Payment confirmation** happens only if the verified payment matches the
   exact hold (same customer, same expiry, still in the future).

**Club rules applied (owner decisions, 2026-10-17):** full court bookable all
day; half courts only when the slot *starts* before the cut-off; blocks never
override bookings or active holds; a payment that succeeds after the hold ended
is recorded but **not** confirmed and goes to refund.

**Concurrency test results** (separate PostgreSQL sessions fired simultaneously):

| Scenario | Result |
|---|---|
| 2 customers, same slot | exactly 1 wins |
| 15 customers, same slot | exactly 1 wins, 0 conflicting pairs |
| Same customer, 2 tabs | 1 hold, second call reuses it |
| 40 rounds × 12 customers racing full / half A / half B | never an incompatible pair; both outcome types observed |
| Admin practice block racing a customer hold (15 rounds) | never both |
| Payment confirmation racing a conflicting half-court hold (10 rounds) | never both |
| 6 duplicate PayHere notifications at once | 1 booking, 5 recorded as duplicates |
| Hold expiring while another customer reserves | newcomer gets it cleanly |
| Expired hold, no cleanup job | no longer blocks anything |
| Partially overlapping slots / midnight-crossing slots | conflict detected |
| Constraint with the function bypassed | write rejected by the database |

Not covered by automated tests: multiple Vercel instances (the guarantees are
in PostgreSQL, so they do not depend on instance count, but this was not run on
Vercel).

---

## D. Security findings

| # | Sev | Where | What could happen | Fix | Verified by |
|---|---|---|---|---|---|
| 0 | P0 | production policy `customers_update_own_profile` (no column limit) | **Any customer can make themselves super_admin** (and self-verify their phone) with one API call | Trigger blocks browser changes to role/phone/phone_verified; policies replaced | `production-exploits.test.ts`: works before, fails after |
| 1 | P0 | `payment/page.tsx` `completePayment` | Anyone signed in books any slot without paying ("Simulate Payment" live) | Removed; simulator only server-side, 404 unless `PAYMENT_SIMULATION=enabled` and not production; build fails if enabled in production | route tests, predeploy tests |
| 2 | P0 | payment page inserts `bookings` / updates `slots` from browser | Confirmed bookings at any price; slots marked booked directly | Bookings created only by `payment_apply_notification` after PayHere signature + amount + hold checks; RLS/grants remove browser writes | DB + RLS + route tests |
| 3 | P0 | `verify/page.tsx` | OTP generated with `Math.random` in browser, readable from DB, profile `phone_verified` set by browser | Server CSPRNG, HMAC-stored, attempts/expiry/one-time in DB; trigger blocks browser changes to role/phone/phone_verified | DB + route tests |
| 4 | P0 | slot locking (`booking/[slotId]`) | Full court and a half court held/booked at the same time; customer page ignored practice blocks | EXCLUDE constraint + `hold_slot()` | concurrency tests + mutation run |
| 5 | P0 | booking page expiry/release | Any user could free or overwrite holds by slot id | `release_hold` checks owner; direct slot writes removed | DB + RLS tests |
| 6 | P0 | `admin/recurring` upsert | Recurring generation overwrote a customer's booked slot with "blocked" | `admin_generate_recurring_slots()` skips and reports clashes | DB test |
| 7 | P1 | `/api/send-sms` | Unauthenticated: send any text to any number at your cost, as ArenaGrade | Endpoint deleted; SMS only from trusted server events | route test |
| 8 | P1 | `/api/send-email` | Open email relay to any address, HTML injection | Endpoint deleted; templates escape all input | route + unit tests |
| 9 | P1 | `send-sms` `sendSMS` | Text.lk "error" in a 200 response counted as sent | Requires `status: "success"`; records provider uid as *accepted* | route test |
| 10 | P1 | success page | SMS + email re-sent on every refresh; page claimed "Confirmed" | Page only reads server-verified status and polls; notifications sent once by notify handler | build + route tests |
| 11 | P1 | `my-bookings`, `admin/bookings` | 24-hour rule, ownership and admin decisions in browser; no refund tracking | `request_booking_cancellation`, `admin_decide_cancellation`, `refunds` | DB + route tests |
| 12 | P1 | `admin/layout.tsx` | Admin check only in the browser | Admin checks inside every admin function + RLS | DB + RLS tests |
| 13 | P1 | — | Daily report never scheduled; no failure alerting | Cron + idempotent job + SMS alerts | route tests |
| 14 | P1 | `package.json` | Next.js 16.2.11 with critical advisories | Next.js 16.3.8 | `npm audit` |
| 15 | P2 | `auth/callback`, `auth/page` | Open redirect via `?redirect=https://evil…` | `safeRedirectPath` | unit tests |
| 16 | P2 | 24h check, recurring dates, timers | Used the visitor's device timezone/clock | Asia/Colombo in the database; server clock for holds | DB tests |
| 17 | P2 | slot generator | Slots with price 0 (no pricing tier) bookable for free | `hold_slot` refuses price ≤ 0 | DB test |
| 18 | P2 | court page | Already-started slots bookable | Refused server-side; shown as N/A | DB test |
| 19 | P2 | `next.config.ts` | No security headers | HSTS, nosniff, frame-ancestors none, referrer and permissions policies | build |
| 20 | P2 | `otp_verifications` | Plaintext codes readable by browsers | Access revoked (purge recommended, needs approval) | RLS test |
| 21 | P3 | `slots` | `internal_reason` (company names) and `locked_by` publicly readable | **Not fixed** — needs a public view; low risk | — |
| 22 | P3 | `admin/page.tsx` dashboard | Revenue sums all bookings, including old simulated ones | **Not changed**; daily report uses verified live payments only | — |
| 23 | P3 | UI lint | 44 pre-existing lint errors | **Not addressed** (unrelated to findings) | — |
| 24 | P3 | dev tooling | High advisories in eslint's dev-only dependencies | Not shipped to users; update eslint later | `npm audit` |

---

## E. PayHere readiness

**Implemented (per the official Checkout API docs):** server-side hash
`UPPER(md5(merchant_id+order_id+amount+currency+UPPER(md5(secret))))`, two-decimal
amounts, sandbox/live URLs (live with `www`), notify verification
`md5sig = UPPER(md5(merchant_id+order_id+payhere_amount+payhere_currency+status_code+UPPER(md5(secret))))`
with constant-time compare and merchant check, status codes 2/0/-1/-2/-3, card
details never stored, return page never trusted.

**Tested with mocks only** (signatures computed exactly as documented, reference
values cross-checked with Python): valid success, duplicates, forged signature,
wrong merchant, tampered amount, late success, malformed body, out-of-order
failure→success and success→failure, chargeback.

**Not yet tested against the real PayHere sandbox.** Needed from you: sandbox
merchant ID/secret, the preview domain registered in the sandbox merchant
account (PayHere checks the domain), and a public preview URL (notify cannot
reach localhost).

**Sandbox checklist** (run on a Vercel Preview with `PAYHERE_MODE=sandbox`):

- [ ] Successful payment → booking confirmed, one SMS, one email
- [ ] Failed payment (sandbox failure card) → no booking, retry possible within hold
- [ ] Cancel on PayHere page → back on payment page with notice, hold intact
- [ ] Invalid notification (POST with a wrong md5sig) → 400, nothing changes
- [ ] Duplicate notification (re-send same body) → 200, no second booking/SMS
- [ ] Delayed notification beyond the 10 minutes → "payment received, not confirmed", refund row pending, owner alert SMS
- [ ] Repeated "Pay" clicks → same order_id reused
- [ ] Close the browser right after paying → booking still confirmed by notify
- [ ] Database unavailable during notify (pause the staging DB briefly) → 500 returned, critical alert, confirmed after PayHere retries or manual reconciliation
- [ ] Amount tampering in the browser form → signature mismatch at PayHere

---

## F. Failure notifications

Immediate alerts go by **SMS** to `CRITICAL_ALERT_PHONES` — a different channel
from email, so an email outage is still reported. Alerts are throttled to one per
event type per hour. Every event is stored in `app_events` with a correlation id
(order id, report day or request id) and appears in the next daily report until
resolved.

| Failure | Detection | Severity / alert | Retry & idempotency | Recovery |
|---|---|---|---|---|
| Paid but booking not confirmed | `payment_apply_notification` → `paid_without_booking` | critical, SMS now | unique order + refund row per attempt | refund manually; mark refund completed with bank ref |
| Unknown order / amount mismatch / provider mismatch / chargeback | notify processing | critical, SMS now | events deduplicated by key | investigate in PayHere dashboard |
| Notify processing DB error | notify route catch | critical, SMS now; 500 to PayHere | event not stored, so a retry is processed | check PayHere dashboard, re-send notification |
| Invalid notify signature | notify route | warning (report) | stored once | none unless repeated (possible attack) |
| Booking integrity violation | daily report integrity section | action item | — | investigate immediately |
| OTP SMS failure / timeout | OTP route | error / warning (report) | challenge marked failed; user can resend | check Text.lk balance/status |
| OTP daily spend cap reached | `otp_issue_challenge` | critical, SMS now | — | raise `SMS_OTP_DAILY_CAP` or investigate abuse |
| Notification SMS/email failure | `notification_log` | report | claim allows one retry per key | resend manually |
| Daily report failure | cron route | critical, SMS now | `job_runs` per day; rerun with `?period=&force=1` | fix cause, rerun |
| PayHere not configured but customers try to pay | initiate route | error (report) | — | set credentials |
| Scheduled job missed | next run catches up the previous day | — | job claim per day | automatic |
| Database down | `/api/health` returns 503 | **needs an external uptime monitor (not configured)** | — | Supabase status |
| Failed deployments | Vercel email notifications | **configure in Vercel** | instant rollback | Vercel dashboard |
| Unauthorized admin attempts | functions raise `forbidden` (logged) | not alerted | — | review logs |

Logs are structured JSON; keys that can contain OTPs, tokens, secrets, phones or
emails are redacted. OTP values are never logged.

---

## G. Daily report

- **Endpoint:** `GET /api/cron/daily-report`, protected by `Authorization: Bearer $CRON_SECRET` (constant-time compare).
- **Schedule:** Vercel Cron `0 17 * * *` UTC (on Hobby this fires 22:30–23:29 Colombo, always after the period closes). For exactly 22:00, enable `supabase/optional/daily_report_pg_cron.sql` (pg_cron at 16:30 UTC). Both can run: each day is sent once.
- **Timezone:** Asia/Colombo. Report day D covers 22:00 on D-1 to 22:00 on D.
- **Recipients:** `REPORT_RECIPIENTS` (your Gmail and the admin's Gmail).
- **Subject:** `ArenaGrade Daily Operations Report — YYYY-MM-DD`.
- **Contents:** action-required section first; verified live payments (gross, refunds completed, net), attempts by status, unreconciled payments, duplicate notifications, test/sandbox activity kept separate; bookings, holds, cancellations; refunds awaiting action; court operations; integrity checks (must be 0); SMS/email failures; unresolved incidents; admin actions. Explicitly says when nothing happened. No names, phones or emails.
- **Duplicates:** `job_runs` claim per day (handles Vercel's duplicate or overlapping calls) + Resend `Idempotency-Key`.
- **Delivery monitoring:** "accepted" means Resend accepted the message, not that it was delivered. Failures mark the job failed and send an SMS alert.
- **Tested:** unauthorized calls rejected; repeated calls send once; forced rerun resends; Resend failure recorded, SMS alert sent, then recovered on rerun; totals deduplicated (unit + DB tests).
- **Verify the first report:** set the env vars, deploy, then call `/api/cron/daily-report?period=<yesterday>` once with the secret (for example `curl -H "Authorization: Bearer $CRON_SECRET" https://arenagrade.lk/api/cron/daily-report?period=2026-10-18`) using a test inbox in `REPORT_RECIPIENTS`, and check the Vercel Cron Jobs page the next evening.

---

## H. QA evidence

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` (predeploy guard + `next build`) | pass |
| `npm run test` | **136 passed, 0 failed, 0 skipped** (7 files, ~12 s) |
| `PGTEST_MUTATION=naive_hold npm run test:db -- tests/db/booking-integrity.test.ts` | 13 failed (expected — proves the tests catch double booking) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npx eslint .` | 44 errors, 20 warnings (pre-existing; unchanged per file) |

The database tests start a real PostgreSQL 17 (`embedded-postgres`) with a
Supabase-like shim (roles, `auth.uid()`, default grants). Route tests call the
real route handlers against the real SQL functions; Text.lk and Resend are
mocked at `fetch`.

**Not tested:** browser end-to-end (no Playwright yet — UI changes are covered
by type-check, build and the manual checklist in K), PayHere sandbox, real
Text.lk/Resend delivery, real Supabase RLS/Auth, Vercel cron delivery, mobile
layout, accessibility, performance.

---

## I. Files changed

**Database (new):** `supabase/migrations/20261018000100…0700_*.sql` (7 files),
`supabase/optional/daily_report_pg_cron.sql`, `supabase/discovery/*`.

**Server (new):** `app/api/otp/{send,verify}`, `app/api/payments/{initiate,payhere/notify,simulate}`,
`app/api/bookings/[id]/cancel`, `app/api/admin/bookings/[id]/decision`, `app/api/admin/refunds/[id]`,
`app/api/cron/daily-report`, `app/api/health`; `lib/server/{env,db,http,log,otp,payhere,payments,alerts,reportPeriod}.ts`,
`lib/server/notify/{sms,email,templates}.ts`.

**Shared/browser (new):** `lib/apiClient.ts`, `lib/userMessages.ts`, `lib/phone.ts`, `lib/safeRedirect.ts`.

**Removed:** `app/api/send-sms`, `app/api/send-email`, `lib/sms.ts`, `lib/email.ts`, `lib/rateLimitHelper.ts`.

**Modified pages:** booking, verify, payment, payment success, my-bookings,
court detail, auth, auth callback, admin bookings, admin slots, admin recurring,
privacy (Text.lk wording).

**Config:** `next.config.ts` (headers), `vercel.json` (cron), `package.json`
(Next 16.3.8, scripts, test deps), `scripts/predeploy-check.mjs`, `.env.example`,
`.gitignore`, `vitest.config.ts`.

**Tests:** `tests/unit/*`, `tests/db/*`, `tests/api/*`, `supabase/tests/fixtures/*`.

**Environment variables:** see `.env.example`. New required in production:
`APP_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OTP_HASH_SECRET`, `CRON_SECRET`,
`TEXT_LK_API_KEY`, `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET`,
`PAYHERE_MODE=live`, `RESEND_API_KEY`, `REPORT_RECIPIENTS`, `ADMIN_ALERT_PHONE`,
`REFUND_WHATSAPP_NUMBER`, `CRITICAL_ALERT_PHONES`.

---

## J. Manual actions required from you

1. **Now:** keep online booking unavailable on the live site until this branch is deployed (the old simulate button is live).
2. **Check the 3 `super_admin` accounts are all yours** — any customer could have promoted themselves through the role hole. Demote anything unexpected.
3. **Decide about the 7 existing confirmed bookings.** `payment_audit` has 0 rows (the old code's audit insert was silently blocked), so none has a recorded online payment — they came from the simulate button.
3a. Resolve the one existing clash: a **blocked** slot overlapping a **booked** one (slots `28e73225-2746-44a5-a23b-9b103614545e` / `40c2fb9f-4354-4376-a7b3-a09f906f0f76`).
3b. Commit a `supabase db dump --schema-only` so the schema lives in Git.
4. Create a staging Supabase project (or branch), load the schema, apply `supabase/migrations` in order, run `02_integrity_checks.sql`.
5. Confirm the Supabase plan's backups/PITR, and take a manual backup before the production migration.
6. Vercel: set the environment variables (Production and Preview separately; sandbox PayHere in Preview only).
7. PayHere: complete merchant registration; sandbox credentials first; register the domains.
8. Text.lk: approve the "ArenaGrade" sender ID (needs the BR number); top up balance.
9. Resend: create the account, verify `arenagrade.lk` for sending, set `EMAIL_FROM`.
10. Optional: enable **pg_net** (pg_cron is already installed) and the Vault secret for an exact-22:00 report.
11. Add an external uptime monitor on `https://arenagrade.lk/api/health` (for example UptimeRobot, free).
12. Enable Vercel deployment-failure notifications.
13. Review: one phone number may currently verify several accounts — allow or restrict?
14. Approve purging plaintext codes in the legacy `otp_verifications` table.
15. Install the Claude GitHub App on your account (GitHub is linked, but pushes are refused without the app), or push the patch yourself.

---

## K. Go-live checklist

**Security**
- [ ] Migration 0700 reviewed against the discovery policies, applied
- [ ] `select has_function_privilege('anon', oid, 'execute')` check from `tests/db/rls.test.ts` returns nothing on production
- [ ] Build log shows `[predeploy-check] OK (production)` with no simulation/test-mode
- [ ] `/api/send-sms` and `/api/send-email` return 404 on production

**Booking concurrency**
- [ ] Constraint `slots_no_conflicting_active` present (`\d public.slots`)
- [ ] Two phones try the same slot at once → one gets "just reserved"

**Payment verification**
- [ ] Sandbox checklist (E) passed on Preview
- [ ] Production: one real low-value payment end-to-end, then refund it

**SMS and OTP**
- [ ] OTP arrives with the approved sender ID; wrong code ×5 locks; resend cooldown works

**Email and daily reports**
- [ ] First report received at the test inbox, then switch to real recipients

**Database constraints**
- [ ] `02_integrity_checks.sql` shows 0 active overlaps before and after migration

**Monitoring**
- [ ] Critical alert SMS reaches the alert phone (trigger with a forced report failure on Preview)
- [ ] Uptime monitor on `/api/health`

**Backups**
- [ ] Backup confirmed and a restore rehearsed into a test project (never into production)

**Deployment**
- [ ] Deploy in a quiet hour; smoke test booking, OTP, payment, cancellation, admin
- [ ] Know the rollback: Vercel instant rollback for code; migrations are additive except the policy replacement (keep the discovery output to restore old policies)

**Post-launch observation (first 2 weeks)**
- [ ] Read every daily report; zero integrity issues; zero paid-unconfirmed left unresolved
- [ ] Check PayHere settlements against the report's verified payment totals weekly

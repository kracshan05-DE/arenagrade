# ArenaGrade — Production Readiness Report

Target public launch: **1 November 2026** · Report updated: 18 October 2026

Status labels used throughout:
**Implemented** (code written) · **Locally tested** (automated tests on a local PostgreSQL 17 with your production schema and policies) · **Staging-verified** · **Production-verified**. Nothing in this report is staging- or production-verified yet.

---

## 1. Executive summary and readiness decision

**Decision: NOT READY for public booking (today).**

All code work is implemented and locally tested: 165 automated tests pass, the production build passes, and a headless-browser audit shows 0 accessibility violations and 0 horizontal overflow. Four attacks that work on your live database today are proven to fail after the migrations.

None of this is live yet. The live site still runs the old code and old database policies, under which any signed-in customer can make themselves admin, book a court for free, or create a confirmed booking at any price.

It becomes **ready for public launch** once the migrations and scripts are applied (staging first), PayHere sandbox passes, Text.lk, Resend and the daily report are configured and tested, and the checklist in section 17 is complete.

**Recommended now (no code change, needs your approval):** take online booking offline until the fixes are deployed. Options, safest first:
1. In Supabase, set every court to inactive (`update public.courts set is_active = false;`). Courts disappear from search, and no slot can be held.
2. Or protect the Vercel deployment with a password (Deployment Protection), or point the domain to a "coming soon" page.

Option 1 is reversible in one statement and doesn't touch bookings.

---

## 2. Repository branch and commits

- **Branch:** `security/production-readiness`, based on `main` @ `799ca6d` (unchanged on GitHub since work began).
- **Commits:**
  1. `f0d5df0` Production readiness: server-side booking, OTP and payments; RLS; tests
  2. `1fc2ee2` Align migrations with the verified production schema; prove exploits closed
  3. `5da1e49` Two courts, two-hour Solo Court reservations, data scripts, UI/UX pass
  4. This report.
- **Push status: blocked.** GitHub is linked and the repository is readable, but pushes return HTTP 403 ("Claude doesn't have GitHub access … install the Claude GitHub App"). Install it at https://github.com/apps/claude/installations/select_target for `arenagrade`, or apply the patch (section 16). Nothing was merged to `main` or deployed.

---

## 3. Files changed

| Area | Files |
|---|---|
| Database migrations | `supabase/migrations/20261018000100…0800_*.sql` (8 files) |
| Owner-run data scripts | `supabase/data/01_court_setup.sql`, `02_cleanup_test_bookings.sql`, `03_admin_accounts.sql` |
| Read-only discovery | `supabase/discovery/01…04_*.sql` |
| Server routes (new) | `app/api/otp/{send,verify}`, `app/api/payments/{initiate,payhere/notify,simulate}`, `app/api/bookings/[id]/cancel`, `app/api/admin/bookings/[id]/decision`, `app/api/admin/refunds/[id]`, `app/api/cron/daily-report`, `app/api/health` |
| Server libraries (new) | `lib/server/*` (env, db seam, http, log, otp, payhere, payments, alerts, report period, notify/sms, notify/email, notify/templates) |
| Shared (new) | `lib/apiClient.ts`, `lib/userMessages.ts`, `lib/phone.ts`, `lib/safeRedirect.ts`, `lib/courtInfo.ts` |
| Removed | `app/api/send-sms`, `app/api/send-email`, `lib/sms.ts`, `lib/email.ts`, `lib/rateLimitHelper.ts` |
| Pages changed | home, court detail, booking, verify, payment, success, my-bookings, auth, auth callback, privacy, admin bookings, admin slots, admin recurring, admin courts, layout, `globals.css` |
| Config | `next.config.ts` (security headers), `vercel.json` (cron), `package.json` (Next 16.3.8, scripts), `scripts/predeploy-check.mjs`, `.env.example`, `.gitignore`, `vitest.config.ts` |
| Tests | `tests/unit/*`, `tests/db/*`, `tests/api/*`, `supabase/tests/fixtures/*` |

---

## 4. Database migrations and exact execution order

Apply in this order (staging first), each file as one unit, stopping at the first error:

| # | File | What it does |
|---|---|---|
| 1 | `20261018000100_foundation.sql` | btree_gist; hardened `is_super_admin`; time/court-part helpers; `audit_log`, `app_events`, `rate_limits`; hardens existing `handle_new_user` |
| 2 | `…0200_booking_integrity.sql` | Releases expired holds; full natural key on slots; **EXCLUDE constraint** against conflicting holds/bookings; one live booking per slot; `hold_slot`, `release_hold`, admin block/unblock, safe recurring generation |
| 3 | `…0300_phone_otp.sql` | Hashed OTP challenges, issue/verify functions, closes `otp_verifications`; **trigger blocking browser changes to role/phone/phone_verified** |
| 4 | `…0400_payments.sql` | `payment_attempts`, `payment_events`, `refunds`; payment creation and notification processing |
| 5 | `…0500_cancellations_refunds.sql` | Cancellation request/decision and refund state machine |
| 6 | `…0600_ops_reporting.sql` | `notification_log`, `job_runs`, daily report data, housekeeping |
| 7 | `…0700_rls_policies.sql` | **Replaces the policies on ArenaGrade tables**; leaves cities/districts/orders and storage untouched |
| 8 | `…0800_multi_slot_courts.sql` | Two-court support, two-hour reservations, hourly pricing, idempotent generator, report by court |

Then, in order: `supabase/data/03_admin_accounts.sql` (Part A, read-only) → `02_cleanup_test_bookings.sql` → `01_court_setup.sql`.

**Rollback limits:**
- Migrations 1–6 and 8 are additive (new tables, functions, columns). Revert them by dropping the new objects. Old data is untouched, except that expired holds are released and the existing `handle_new_user` gets a pinned `search_path`.
- Migration 7 replaces policies. To roll back, recreate the old policies from the discovery output, but **that reintroduces the vulnerabilities**.
- Data scripts keep backup tables (cleanup) or restore from the inventory values (prices).

---

## 5. Security findings and verified fixes

| # | Sev | Finding (verified against the real policies) | Fix | Status |
|---|---|---|---|---|
| 1 | P0 | Any customer can set their own `role = super_admin` (policy `customers_update_own_profile`) | Trigger blocks browser changes to role/phone/phone_verified; policies replaced | Locally tested: attack succeeds before, fails after |
| 2 | P0 | Any signed-in user can change any available slot (`authenticated_users_can_lock_slots`) — free bookings, price changes | Direct slot writes removed; holds only via `hold_slots` | Locally tested |
| 3 | P0 | Customers can insert/update bookings at any price (`customers_insert_own_bookings`, `customers_update_own_bookings`) | Bookings created only by verified payment processing | Locally tested |
| 4 | P0 | OTP generated in the browser, readable and self-approvable (`otp_verifications` policies) | Server CSPRNG, HMAC storage, limits, one-time use | Locally tested |
| 5 | P0 | "Simulate Payment" live in production | Removed; simulator only in non-production; build fails if enabled in production | Locally tested |
| 6 | P0 | Full/half conflicts enforced only in the browser | EXCLUDE constraint + locked hold functions | Locally tested (concurrency + mutation run) |
| 7 | P0 | Recurring generation could overwrite a booked slot | Server function skips and reports clashes | Locally tested |
| 8 | P1 | `/api/send-sms` and `/api/send-email` open to anyone | Deleted; messages only from trusted server events | Locally tested |
| 9 | P1 | Text.lk "error" responses with HTTP 200 counted as sent | Requires `status: "success"` | Locally tested |
| 10 | P1 | Success page re-sent SMS/email on refresh and showed "Confirmed" without verification | Reads verified status only; notifications sent once | Locally tested |
| 11 | P1 | Cancellation rules, admin decisions and refunds in the browser | Database functions + `refunds` table | Locally tested |
| 12 | P1 | Next.js 16.2.11 with critical advisories | 16.3.8; `npm audit --omit=dev`: 0 | Verified |
| 13 | P1 | `handle_new_user` SECURITY DEFINER without fixed search_path, executable by API roles | Pinned search_path, execute revoked | Locally tested |
| 14 | P2 | Open redirect after login | Same-site paths only | Locally tested |
| 15 | P2 | Device timezone used for 24-hour rule, recurring dates, court date default | Asia/Colombo in database and pages | Locally tested |
| 16 | P2 | Zero-priced slots bookable; started slots bookable | Refused server-side; generator refuses missing prices | Locally tested |
| 17 | P2 | "Peak/Off-peak" label shown though prices are flat | Removed | Browser-checked |
| 18 | P2 | No security headers | HSTS, nosniff, frame-ancestors none, referrer and permissions policies | Build |
| 19 | P3 | `slots.internal_reason` (company names) publicly readable | Not fixed (needs a public view) | Open |
| 20 | P3 | Admin dashboard revenue counts unpaid test bookings | Removed by cleanup; daily report uses verified payments only | Open until cleanup |
| 21 | P3 | 41 pre-existing UI lint errors (was 44) | Not addressed further | Open |

Storage policies on the `images` bucket were verified correct and left unchanged.

---

## 6. Test-data cleanup

- **Status: script ready, NOT executed.** I have no database write access.
- **Script:** `supabase/data/02_cleanup_test_bookings.sql`. It runs as one transaction and works on the listed 7 booking IDs only. It refuses to run if the count isn't exactly 7, if any booking isn't confirmed, or if any has a payment attempt or refund record. It backs up the affected rows to `cleanup_20261018_*` tables, resets a slot only when it is booked and has no other live booking, keeps blocked slots, and includes rollback steps.
- **Locally tested:** a successful run, refusal on a wrong count, refusal when a real payment exists, and a run on the pre-migration schema.
- **Needed:** the 7 IDs from `04_data_inventory.sql` (sent to you). Then you run it and send the final SELECT output.

---

## 7. Administrator-account verification

`supabase/data/03_admin_accounts.sql` Part A (read-only) lists each `super_admin` with ID, masked email, created date, last sign-in and last profile change. A recent profile change on an account you don't recognise suggests self-promotion through finding 1.

Part B is a guarded revocation:
- It refuses if the two IDs are the same, if your own account isn't admin, or if no admin would remain.
- Afterwards, sign the user out in Supabase Authentication.
- Nothing is changed automatically.

---

## 8. St. Mary's Basketball Court: pricing and conflict rules

- **Prices (per hour):** full court LKR 6,000; half court A or B LKR 3,000. A slot's price is the hourly price × slot length. If St. Mary's uses 2-hour slots, a full-court slot is LKR 12,000.
- **Conflicts:**
  - Full court conflicts with both halves.
  - A half conflicts with the full court and with the same half.
  - Half A and half B can be booked by different customers at the same time.
  - Practice blocks and active holds also conflict.
  - Partially overlapping slots and midnight-crossing slots are handled.
- **Cut-off kept unchanged** (your earlier decision): half courts only when the slot starts before `half_court_cutoff` (default 2:00 PM); full court bookable all day.
- **Open:** the slot length actually used for St. Mary's will be confirmed from the inventory. The setup script keeps the existing length.

---

## 9. The Solo Court

- **Configuration** (set by `01_court_setup.sql` on the existing record; never creates a duplicate):
  - Name "The Solo Court", active, no half courts.
  - Open 5:00 AM–10:00 PM, 1-hour slots, up to 2 consecutive hours.
  - LKR 2,500 per hour.
- **Schedule:** exactly **17** one-hour slots per day (5–6 AM … 9–10 PM). Generation is idempotent: re-running adds only missing slots. Locally tested: 17 slots per day, 0 duplicates on re-run, LKR 2,500 each.
- **Independence:** conflicts are scoped by court. St. Mary's cut-off never applies. Tested: a St. Mary's hold at 8 PM doesn't affect a Solo Court 8–10 PM hold.

**Two-hour design.** Each hour stays one slot row, so the existing database constraint protects every physical hour. `hold_slots` holds 1–2 consecutive hours atomically, with **one shared 10-minute expiry**. A payment attempt covers all its hours, with the amount being the sum of their prices (LKR 5,000). On verified success, all hours are booked under **one booking**, linked through `booking_slots`. If any hour is no longer held by that customer, nothing is booked and the payment goes to refund.

Releasing, expiring (including your existing `pg_cron` job, verified compatible) and cancelling always act on both hours together.

**Locally tested:**
- One-hour and two-hour bookings.
- Non-consecutive selections, 3 hours, and 2 hours at St. Mary's are all rejected.
- Partial availability leaves neither hour held.
- A practice block inside the range blocks the reservation.
- An admin cannot block an hour inside an active hold.
- 25 rounds of simultaneous overlapping 9–11 vs 10–12 attempts: never both, and no leftover partial holds.
- Late payment books nothing.
- Losing one hour books nothing.
- Paying the one-hour price for two hours is refused.
- Cancellation releases both hours and refunds LKR 5,000.

---

## 10. PayHere integration and sandbox results

- **Implemented:**
  - Checkout hash and notification `md5sig` verification exactly as documented by PayHere, with a merchant-ID check and constant-time comparison.
  - Server-side amount from slot prices.
  - Order IDs bound to the exact hold.
  - Idempotent processing, with duplicates counted rather than re-applied.
  - Out-of-order events can't downgrade a success.
  - Card details are never stored.
  - The return page is never trusted.
- **Late success** is recorded as `succeeded_unconfirmed`, with a pending refund row, an immediate SMS alert to the admin, and an SMS to the customer. A slot taken by another customer is never touched.
- **Locally tested with mocks:** valid, forged, wrong merchant, tampered amount or currency, duplicate (6 at once), late, partially lost hold, malformed, failure→success, success→failure, chargeback, and a two-hour flow through the API.
- **Sandbox: NOT run.** It needs your sandbox merchant ID and secret, the preview domain registered with PayHere, and a public preview URL. The checklist is in section 17.

---

## 11. SMS, OTP, Resend and the daily report

- **OTP:**
  - Server-generated, stored only as an HMAC, valid 10 minutes, 5 attempts.
  - 60-second resend cooldown; at most 3 codes per number per 10 minutes, 6 per account per hour, 10 per network per hour; daily spend cap.
  - One-time use, and bound to the user and phone.
  - The response never contains the code (except in non-production test mode).
- **SMS (Text.lk):** server-only. Every message is logged with a masked recipient and deduplicated by key. "Accepted" means Text.lk took the message, not that it was delivered.
- **Email (Resend):** server-only, `Idempotency-Key` header, all user text HTML-escaped, no arbitrary recipients.
- **Alerts:** critical events (late payment, unknown or tampered payment, chargeback, notification processing failure, report failure, OTP cap) go out by SMS to `CRITICAL_ALERT_PHONES`. Each type is throttled to one per hour, with timestamps and references and no OTPs or secrets.
- **Daily report:** subject "ArenaGrade Daily Operations Report — YYYY-MM-DD". Each report covers 10 PM to 10 PM Asia/Colombo. Contents:
  - Action items first.
  - Verified live payments: gross, refunds and net.
  - **Bookings by court and duration.**
  - Holds and cancellations.
  - Refunds awaiting action.
  - Integrity checks.
  - SMS/email failures and incidents.
  - Admin actions.
- **Report reliability:**
  - Each day is claimed once, so duplicate or overlapping runs send nothing extra.
  - A missed day is caught up on the next run.
  - A failure triggers an SMS alert.
- **Scheduling on Vercel Hobby:** the cron is `0 17 * * *` UTC, which fires at some point between **10:30 and 11:29 PM** Colombo time. Exact-minute timing is not possible on Hobby.
- **Exact 10:00 PM option:** `supabase/optional/daily_report_pg_cron.sql`. **pg_cron is installed; pg_net is NOT installed** (verified from your extensions list). Enable pg_net and add the Vault secret first.
- **Status:** locally tested with mocked providers. Not yet sent to a real inbox. Test with a designated inbox first (`REPORT_RECIPIENTS`).

---

## 12. UI/UX changes and responsive and accessibility results

**Changes:**
- Court cards show real hourly prices, opening hours and what can be booked.
- The court page explains prices and half-court rules in plain English and shows times in 12-hour Sri Lanka time.
- The misleading Peak/Off-peak label is removed.
- **The Solo Court has a 1-hour / 2-hour selector.** Start times are offered only when the following hour is also free, with a reason shown otherwise. A summary bar fixed to the bottom shows the exact range and total (for example "8:00 AM – 10:00 AM · 2 hours · LKR 5,000").
- Booking, payment, success and My Bookings pages show the full range for two-hour bookings.
- The success page never says "Confirmed" before PayHere's verified notification.
- Honest refund wording: approval creates a pending bank-transfer refund.
- Clear "Not available" labels replace "N/A".
- Admin:
  - Server-side slot generation, safe to re-run, with clear messages.
  - "Longest booking" setting per court.
  - "Price per hour" stated on the pricing form.
  - Refund actions require a bank reference.
- Design tokens; skip link; visible keyboard focus; 44px tap targets; reduced-motion support; no sideways scrolling; labelled date picker; screen-reader labels on slot buttons; live region for the selection summary.

**Browser-verified** (headless Chromium, built app, test data for both courts):

| View | Width | Horizontal overflow | axe-core WCAG 2.0–2.2 A/AA violations |
|---|---|---|---|
| Home | 1280 / 390 | 0 / 0 | 0 / 0 (7 contrast failures fixed) |
| St. Mary's | 1280 / 390 | 0 / 0 | 0 / 0 (6 fixed) |
| The Solo Court, 2-hour selected | 390 | 0 | 0 |
| The Solo Court, 1-hour | 1280 | 0 | 0 |

Visual review of the screenshots led to two further fixes: the summary bar no longer covers start times, and St. Mary's options fit one row on phones, making that page about 23% shorter.

**Not browser-tested:** pages that need a signed-in session (booking, OTP, payment, success, My Bookings, admin) were type-checked and built, but not rendered. Automated checks don't replace a manual screen-reader pass.

---

## 13. Tests actually executed

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run test` | **165 passed, 0 failed, 0 skipped** (9 files) |
| Mutation run: `PGTEST_MUTATION=naive_hold npm run test:db -- tests/db/booking-integrity.test.ts` | 13 failed, as expected; proves the tests detect double booking |
| `npm run build` (build guard + Next.js 16.3.8) | Pass |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npx eslint .` | 41 errors, 22 warnings, all in pre-existing UI code (baseline 44) |
| Browser audit (Chromium 153, axe-core) | 6 views: 0 violations, 0 overflow |
| Client bundle scan | No secrets or server-only functions |

Coverage includes:
- Security: role escalation, direct slot and booking writes, arbitrary prices, OTP bypass and replay, unauthorised SMS/email, RLS, admin permissions, open redirect, function privileges.
- Booking: the St. Mary's conflict matrix, Solo Court 1h/2h, partial availability, concurrency, expiry, blocks, recurring generation, idempotent generation.
- Payments: valid, invalid, amount/currency, duplicates, late, reallocated slot.
- Pricing: 6,000, 3,000, 2,500, 5,000; the 17-slot day.
- Cancellation, the daily report, and the data scripts.

---

## 14. Outstanding issues and external dependencies

- Migrations and scripts not applied to staging or production.
- Inventory results pending: court IDs, St. Mary's slot length, the 7 booking IDs, admin accounts, and the overlap records.
- **Reported overlap** (`28e73225…` blocked vs `40c2fb9f…` booked): pending the inventory. A block on the full court at the same time as a booked half is a real clash. Decide which applies before changing anything, and the cleanup may resolve it if the booking is one of your tests.
- PayHere merchant approval and sandbox credentials.
- Text.lk "ArenaGrade" sender ID approval and account balance.
- Resend account and domain verification.
- pg_net, if you want the exact 10 PM report.
- Claude GitHub App installation, if you want me to push.
- An external uptime monitor and Vercel deploy-failure notifications.
- Signed-in page rendering and a manual accessibility pass.

---

## 15. Manual actions required from you

1. Approve and apply the temporary booking shutdown (section 1).
2. Run `supabase/discovery/04_data_inventory.sql` and send the JSON.
3. Check the `super_admin` accounts (section 7).
4. Confirm St. Mary's slot length (1 or 2 hours) if the inventory is ambiguous.
5. Install the Claude GitHub App, or apply the patch yourself.
6. Create a staging Supabase project (or branch) and confirm backups/PITR on production.
7. Set Vercel environment variables (`.env.example`), keeping Preview (sandbox) and Production separate.
8. Get PayHere sandbox credentials and register the preview and live domains.
9. Text.lk: approve the sender ID and top up the balance. Resend: create the account and verify the domain.
10. Choose the report test inbox, then the real recipients.
11. Optional: enable pg_net and add the Vault secret for the exact 10 PM report.

---

## 16. Backup and rollback

- **Before anything:**
  - Confirm Supabase backups for your plan (Dashboard → Database → Backups).
  - Take a manual backup: `pg_dump` of the database, or a schema-only plus data export.
  - Save the discovery JSON, which you already have.
- **Apply the patch yourself:**
  ```
  git fetch origin && git checkout -b security/production-readiness origin/main
  git am arenagrade-production-readiness.patch
  git push -u origin security/production-readiness
  ```
  Do not merge to `main` until staging passes. Vercel deploys `main` to production.
- **Code rollback:** Vercel Instant Rollback.
- **Database rollback:** see section 4 (policy rollback reintroduces the vulnerabilities). Data scripts: cleanup backup tables plus the documented rollback; court prices restored from the inventory values.
- **Restore rehearsal:** never against production. Restore into a fresh test project.

---

## 17. Prioritised launch checklist (1 November 2026)

**By 20 Oct — P0**
- [ ] Booking temporarily disabled on the live site
- [ ] Inventory sent; admin accounts verified
- [ ] Branch pushed; staging project created; backups confirmed

**By 24 Oct — P0 on staging**
- [ ] Migrations 1–8 applied to staging without errors
- [ ] Attack checks fail on staging: role change, slot update, booking insert, phone self-verify
- [ ] Cleanup + court setup scripts run on staging; 17 Solo slots per day; prices 6,000 / 3,000 / 2,500
- [ ] Preview deployment on staging with `PAYMENT_SIMULATION=enabled`: full flows for St. Mary's (full + half) and The Solo Court (1h + 2h)

**By 28 Oct — P1**
- [ ] PayHere sandbox checklist: success, failure, cancel, invalid signature, duplicate, late (after 10 min), repeated Pay, browser closed after paying
- [ ] OTP with real Text.lk: delivery, wrong code ×5 lock, resend cooldown
- [ ] Daily report to the test inbox; forced failure triggers the SMS alert
- [ ] Two phones racing the same slot: one gets "just reserved"

**29–30 Oct — Production**
- [ ] Manual backup taken
- [ ] Migrations applied → data scripts run → verification SELECTs reviewed
- [ ] Production env vars set (`PAYHERE_MODE=live`, no simulation or test mode); build log shows `[predeploy-check] OK (production)`
- [ ] Merge and deploy; `/api/send-sms` and `/api/send-email` return 404; `/api/health` OK
- [ ] One real low-value booking end to end, then refunded

**31 Oct**
- [ ] Courts re-activated; uptime monitor on; real report recipients set

**After launch (2 weeks)**
- [ ] Read every daily report: integrity counts 0, no unresolved paid-but-unconfirmed payments
- [ ] Weekly: PayHere settlements match the report's verified totals

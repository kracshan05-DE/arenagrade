# Supabase schema discovery

The database schema was never committed to Git. Before any migration in
`supabase/migrations/` is applied, the real schema must be captured and compared
with what the code assumes (see `supabase/tests/fixtures/inferred_base_schema.sql`).

All three queries are **read-only** and return **metadata and counts only** —
no names, phone numbers, emails or OTP codes.

| File | What it returns |
|---|---|
| `01_schema_metadata.sql` | Tables, columns, types, enums, constraints, indexes, triggers, RLS flags, policies (incl. storage), grants, functions with definitions, extensions, storage buckets |
| `02_integrity_checks.sql` | Status counts and conflict pre-checks (overlapping active slots, orphan bookings, expired locks, simulated payments) |
| `03_scheduled_jobs.sql` | pg_cron jobs, if pg_cron is installed |

## How to run

1. Supabase dashboard → SQL Editor → New query.
2. Paste one file, run it, copy the single JSON cell.
3. Save as `supabase/discovery/output/<same name>.json`, or attach it in chat.

## Better: a full schema dump into the repo

On your own machine (the database password is typed locally, never shared):

```bash
npx supabase login
npx supabase link --project-ref jspzzjdammadsjkpctus
npx supabase db dump --schema-only -f supabase/schema_baseline.sql
```

Commit `supabase/schema_baseline.sql`. It contains DDL, functions and policies,
and no row data. From then on, every database change goes through
`supabase/migrations/` so the repository is the source of truth.

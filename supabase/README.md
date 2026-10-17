# Database changes

`migrations/` holds the production-readiness changes, applied in filename order.
They were checked against the production schema and policies captured with
`discovery/` on 2026-10-18 (mirrored in `tests/fixtures/01_production_base_schema.sql`).

## Before applying

1. If the database changed since 2026-10-18, re-run the read-only queries in
   `discovery/` and compare with `tests/fixtures/01_production_base_schema.sql`.
2. `20261018000700_rls_policies.sql` drops and replaces the policies on the
   ArenaGrade tables. Keep the discovery output so the old policies can be
   restored if needed.
3. Apply to a **staging** project first, then run the app (Vercel Preview)
   against it with PayHere sandbox.

## Applying

Supabase CLI (after `supabase link`): copy the files into the project's
`supabase/migrations` and run `supabase db push`, or paste each file, in order,
into the SQL editor. Each file is a single unit; stop at the first error.

## Testing locally

`npm run test:db` starts a local PostgreSQL 17, loads `tests/fixtures/` (a
Supabase-like shim plus the inferred base schema) and every migration, and runs
the database and route tests against it. No Supabase account is needed.

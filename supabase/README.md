# Database changes

`migrations/` holds the production-readiness changes, applied in filename order.
They assume the existing ArenaGrade tables (see `discovery/README.md`), and were
written against a schema **inferred from the application code**.

## Before applying

1. Run the read-only queries in `discovery/` and compare with
   `tests/fixtures/01_inferred_base_schema.sql`. Adjust column names/types in the
   migrations wherever the real schema differs.
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

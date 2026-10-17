-- OPTIONAL: trigger the daily report at exactly 22:00 Asia/Colombo from Supabase.
--
-- Why: on the Vercel Hobby plan a cron runs at an unpredictable minute within
-- its hour. vercel.json schedules "0 17 * * *" UTC (fires 22:30-23:29 Colombo,
-- always after the report period closes) as the backstop. This pg_cron job
-- calls the same endpoint at 16:30 UTC = 22:00:00 Colombo. Both may fire: the
-- endpoint claims each report day once (job_runs), so only one email goes out.
--
-- Prerequisites (Supabase dashboard):
--   1. Database -> Extensions: enable pg_cron and pg_net.
--   2. Project Settings -> Vault: create a secret named 'arenagrade_cron_secret'
--      with the SAME value as the CRON_SECRET environment variable in Vercel.
--   3. Replace https://arenagrade.lk below if the production URL differs.

select cron.schedule(
  'arenagrade-daily-report',
  '30 16 * * *',  -- pg_cron schedules are in UTC: 16:30 UTC = 22:00 Asia/Colombo
  $$
  select net.http_get(
    url := 'https://arenagrade.lk/api/cron/daily-report',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'arenagrade_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);

-- Optional extra housekeeping every 5 minutes (correctness never depends on it):
-- select cron.schedule('arenagrade-expire-holds', '*/5 * * * *', $$ select public.expire_stale_holds(); $$);

-- To remove:  select cron.unschedule('arenagrade-daily-report');

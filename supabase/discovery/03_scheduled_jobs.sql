-- ArenaGrade scheduled jobs — READ ONLY.
-- Run ONLY if 01_schema_metadata shows the "pg_cron" extension installed;
-- otherwise this query errors with "relation cron.job does not exist", which
-- itself confirms there is no database-side lock-expiry job.
select jsonb_pretty(coalesce(jsonb_agg(jsonb_build_object(
  'jobid', jobid, 'name', jobname, 'schedule', schedule, 'command', command, 'active', active
)), '[]'::jsonb)) as cron_jobs
from cron.job;

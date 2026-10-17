-- MUTATION (test-quality check only): remove the constraint and replace
-- hold_slot with a naive check-then-update, widened with a tiny sleep.
alter table public.slots drop constraint slots_no_conflicting_active;
create or replace function public.hold_slot(p_slot_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_slot public.slots%rowtype;
begin
  select * into v_slot from public.slots s where s.id = p_slot_id;
  if v_slot.status <> 'available' then raise exception 'slot_unavailable'; end if;
  if public._slot_has_conflict(v_slot.id, v_slot.court_id, v_slot.slot_date, v_slot.start_time, v_slot.end_time, v_slot.court_type, array['locked','booked','blocked']) then
    raise exception 'slot_conflict'; end if;
  perform pg_sleep(0.02);
  update public.slots s set status='locked', locked_by=v_uid, lock_expires_at=now()+interval '10 minutes' where s.id = v_slot.id;
  return jsonb_build_object('slot_id', v_slot.id, 'seconds_left', 600, 'reused', false);
end $$;

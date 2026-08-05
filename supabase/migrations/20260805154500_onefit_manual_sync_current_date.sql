begin;

drop policy if exists "Staff request OneFit sync" on public.onefit_sync_runs;
create policy "Staff request OneFit sync"
  on public.onefit_sync_runs for insert
  with check (
    public.is_admin()
    and trigger_type = 'manual'
    and status = 'queued'
    and source_date = (now() at time zone 'Asia/Almaty')::date
  );

commit;

-- Run in the dedicated Supabase Auth project, not the BADEM manufacturing database.
begin;

create schema if not exists badem_beta_private;
revoke all on schema badem_beta_private from public, anon, authenticated;

create table if not exists badem_beta_private.discovery_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  discoveries smallint not null check (discoveries between 1 and 3),
  primary key (user_id, usage_day)
);
alter table badem_beta_private.discovery_usage enable row level security;
revoke all on table badem_beta_private.discovery_usage from public, anon, authenticated;

create or replace function public.consume_badem_discovery(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'User identity is required';
  end if;
  -- The conflict update locks the same user/day row across all Vercel instances.
  insert into badem_beta_private.discovery_usage as usage (user_id, usage_day, discoveries)
  values (p_user_id, (now() at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_day) do update
    set discoveries = usage.discoveries + 1
    where usage.discoveries < 3;
  return found;
end;
$$;

revoke all on function public.consume_badem_discovery(uuid) from public, anon, authenticated;
grant execute on function public.consume_badem_discovery(uuid) to service_role;

notify pgrst, 'reload schema';
commit;

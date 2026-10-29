create table if not exists public.lynkbay_sync_config (
  id text primary key default 'main',
  sync_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lynkbay_state (
  id text primary key default 'main',
  payload jsonb,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lynkbay_sync_config enable row level security;
alter table public.lynkbay_state enable row level security;

insert into public.lynkbay_sync_config (id, sync_secret)
values ('main', 'ce525d8dac5ff11f7e7f49bf12babc7ba5350bb10c6bf7a2968893eadc4f2168')
on conflict (id) do update
set sync_secret = excluded.sync_secret,
    updated_at = now();

insert into public.lynkbay_state (id, payload, revision)
values ('main', null, 0)
on conflict (id) do nothing;

create or replace function public.lynkbay_check_secret(p_sync_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.lynkbay_sync_config
    where id = 'main'
      and sync_secret = p_sync_secret
  ) then
    raise exception 'LYNKBAY_INVALID_SYNC_SECRET';
  end if;
end;
$$;

create or replace function public.lynkbay_get_state(p_sync_secret text)
returns table(payload jsonb, revision bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lynkbay_check_secret(p_sync_secret);

  return query
  select s.payload, s.revision
  from public.lynkbay_state s
  where s.id = 'main';
end;
$$;

create or replace function public.lynkbay_save_state(
  p_sync_secret text,
  p_expected_revision bigint,
  p_payload jsonb
)
returns table(payload jsonb, revision bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_revision bigint;
begin
  perform public.lynkbay_check_secret(p_sync_secret);

  select s.revision
  into current_revision
  from public.lynkbay_state s
  where s.id = 'main'
  for update;

  if current_revision is null then
    current_revision := 0;
    insert into public.lynkbay_state (id, payload, revision)
    values ('main', null, 0)
    on conflict (id) do nothing;
  end if;

  if current_revision <> p_expected_revision then
    raise exception 'LYNKBAY_REVISION_CONFLICT';
  end if;

  update public.lynkbay_state
  set payload = p_payload,
      revision = current_revision + 1,
      updated_at = now()
  where id = 'main';

  return query
  select s.payload, s.revision
  from public.lynkbay_state s
  where s.id = 'main';
end;
$$;

grant execute on function public.lynkbay_get_state(text) to anon;
grant execute on function public.lynkbay_save_state(text, bigint, jsonb) to anon;

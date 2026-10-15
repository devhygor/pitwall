-- Pitwall · banco na nuvem (Supabase) com login (Google)
-- Já aplicado no projeto "pitwall". Para recriar em outro projeto:
-- SQL Editor → New query → cole tudo → Run.
--
-- Cada piloto entra com a conta Google. Equipes: quem cria vira dono e ganha um
-- código de convite; quem entra pelo convite vira membro. Cada piloto envia só as
-- PRÓPRIAS voltas (o recorde de cada carro/pista) e enxerga as voltas de quem está
-- em alguma equipe com ele. Setups nunca vão para a nuvem.

-- perfis -------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name',
                   split_part(new.email, '@', 1)),
          new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- equipes -------------------------------------------------------------------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 60),
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  owner       uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id   uuid not null references public.teams (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user on public.team_members (user_id);

-- voltas --------------------------------------------------------------------
create table if not exists public.laps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  game        text not null default 'acc',
  car         text not null,
  track       text not null,
  lap_time_ms integer not null check (lap_time_ms > 0),
  s1_ms       integer,
  s2_ms       integer,
  s3_ms       integer,
  air_temp    real,
  road_temp   real,
  recorded_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now(),
  telemetry   text not null,             -- telemetria da volta (JSON comprimido, base64)
  unique (user_id, game, car, track)
);
create index if not exists laps_combo on public.laps (game, car, track, lap_time_ms);

-- funções auxiliares (security definer evita recursão nas políticas) ---------
create or replace function public.is_team_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.team_id = t and m.user_id = auth.uid())
$$;

create or replace function public.is_teammate(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select other = auth.uid() or exists (
    select 1 from public.team_members a join public.team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = other)
$$;

-- RLS -----------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.laps enable row level security;

create policy "perfil: eu e companheiros veem" on public.profiles
  for select to authenticated using (public.is_teammate(id));
create policy "perfil: edito o meu" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "equipe: membros veem" on public.teams
  for select to authenticated using (public.is_team_member(id));
create policy "equipe: dono edita" on public.teams
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "equipe: dono apaga" on public.teams
  for delete to authenticated using (owner = auth.uid());

create policy "membros: membros veem" on public.team_members
  for select to authenticated using (public.is_team_member(team_id));
create policy "membros: sair ou dono remove" on public.team_members
  for delete to authenticated using (
    user_id = auth.uid() or exists (select 1 from public.teams t where t.id = team_id and t.owner = auth.uid()));

create policy "voltas: eu e companheiros veem" on public.laps
  for select to authenticated using (public.is_teammate(user_id));
create policy "voltas: envio as minhas" on public.laps
  for insert to authenticated with check (user_id = auth.uid());
create policy "voltas: atualizo as minhas" on public.laps
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "voltas: apago as minhas" on public.laps
  for delete to authenticated using (user_id = auth.uid());

-- ações (RPC) ---------------------------------------------------------------
create or replace function public.create_team(team_name text) returns public.teams
language plpgsql security definer set search_path = '' as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'faça login primeiro'; end if;
  insert into public.teams (name, owner) values (trim(team_name), auth.uid()) returning * into t;
  insert into public.team_members (team_id, user_id, role) values (t.id, auth.uid(), 'owner');
  return t;
end $$;

create or replace function public.join_team(code text) returns public.teams
language plpgsql security definer set search_path = '' as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'faça login primeiro'; end if;
  select * into t from public.teams where invite_code = upper(trim(code));
  if t.id is null then raise exception 'convite inválido'; end if;
  insert into public.team_members (team_id, user_id) values (t.id, auth.uid()) on conflict do nothing;
  return t;
end $$;

create or replace function public.new_invite_code(t uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
begin
  update public.teams set invite_code = c where id = t and owner = auth.uid();
  if not found then raise exception 'só o dono da equipe pode trocar o convite'; end if;
  return c;
end $$;

-- ranking de uma equipe: recorde de cada membro em cada carro/pista
create or replace function public.team_leaderboard(t uuid)
returns table (id uuid, user_id uuid, driver text, avatar_url text, game text, car text, track text,
               lap_time_ms integer, s1_ms integer, s2_ms integer, s3_ms integer,
               air_temp real, road_temp real, recorded_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select l.id, l.user_id, p.name, p.avatar_url, l.game, l.car, l.track, l.lap_time_ms, l.s1_ms, l.s2_ms,
         l.s3_ms, l.air_temp, l.road_temp, l.recorded_at
  from public.laps l
  join public.team_members m on m.user_id = l.user_id and m.team_id = t
  join public.profiles p on p.id = l.user_id
  where public.is_team_member(t)
  order by l.track, l.car, l.lap_time_ms
$$;

revoke all on function public.create_team(text), public.join_team(text), public.new_invite_code(uuid),
  public.team_leaderboard(uuid), public.is_team_member(uuid), public.is_teammate(uuid) from anon, public;
grant execute on function public.create_team(text), public.join_team(text), public.new_invite_code(uuid),
  public.team_leaderboard(uuid), public.is_team_member(uuid), public.is_teammate(uuid) to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update, delete on public.teams to authenticated;
grant select, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.laps to authenticated;
revoke all on public.profiles, public.teams, public.team_members, public.laps from anon;
revoke execute on function public.handle_new_user() from authenticated;
-- Observação: o Supabase avisa que create_team/join_team/new_invite_code/team_leaderboard e as
-- funções is_* podem ser chamadas por quem está logado. É de propósito: são as ações do app,
-- e cada uma confere o usuário (auth.uid()) por dentro.

-- v2: setup e clipe junto com a volta, logo da equipe, ranking da comunidade ------------
alter table public.laps add column if not exists setup_name text;
alter table public.laps add column if not exists setup_json text;
alter table public.laps add column if not exists clip_path text;
alter table public.teams add column if not exists logo_url text;
create policy "voltas: comunidade vê" on public.laps for select to authenticated using (true);
create policy "perfil: comunidade vê" on public.profiles for select to authenticated using (true);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', true, 62914560, array['video/mp4']),
       ('team-logos', 'team-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;
create policy "clipes: leitura" on storage.objects for select to authenticated using (bucket_id = 'clips');
create policy "clipes: envio do dono" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "clipes: troca do dono" on storage.objects for update to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "clipes: apaga do dono" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "logos: leitura" on storage.objects for select to authenticated using (bucket_id = 'team-logos');
create policy "logos: envio do dono da equipe" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-logos' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.owner = auth.uid()));
create policy "logos: troca do dono da equipe" on storage.objects for update to authenticated
  using (bucket_id = 'team-logos' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.owner = auth.uid()))
  with check (bucket_id = 'team-logos' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.owner = auth.uid()));
create policy "logos: apaga do dono da equipe" on storage.objects for delete to authenticated
  using (bucket_id = 'team-logos' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.owner = auth.uid()));
create or replace function public.team_board(t uuid)
returns table (id uuid, user_id uuid, driver text, avatar_url text, game text, car text, track text,
               lap_time_ms integer, s1_ms integer, s2_ms integer, s3_ms integer,
               air_temp real, road_temp real, recorded_at timestamptz, setup_name text, clip_path text)
language sql stable security invoker set search_path = '' as $$
  select l.id, l.user_id, p.name, p.avatar_url, l.game, l.car, l.track, l.lap_time_ms, l.s1_ms, l.s2_ms,
         l.s3_ms, l.air_temp, l.road_temp, l.recorded_at, l.setup_name, l.clip_path
  from public.laps l
  join public.team_members m on m.user_id = l.user_id and m.team_id = t
  join public.profiles p on p.id = l.user_id
  where public.is_team_member(t)
  order by l.track, l.car, l.lap_time_ms
$$;
grant execute on function public.team_board(uuid) to authenticated;

-- v3: problemas da volta (travadas, rodadas, limite de pista) para a Análise no site
alter table public.laps add column if not exists events jsonb not null default '[]'::jsonb;

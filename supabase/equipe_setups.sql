-- Pitwall · biblioteca de setups da equipe (recurso do plano Equipe).
-- Reúne (1) os setups usados nos melhores tempos dos companheiros (vêm da tabela laps) e (2) os setups que alguém compartilha de propósito.
-- Só funciona para equipes cujo DONO tem o plano Equipe ativo (assinatura ou cortesia). Todo o acesso é por funções (RPC).
-- Depende de schema.sql, equipe_v4.sql e chaves_equipe.sql (usa _team_end).

create table if not exists public.team_setups (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  game        text not null default 'acc',
  car         text not null,
  track       text not null,
  name        text not null check (char_length(name) between 1 and 140),
  content     text not null,
  sha         text not null,
  best_lap_ms integer,
  air_temp    real,
  road_temp   real,
  note        text,
  created_at  timestamptz not null default now(),
  unique (team_id, sha)
);
create index if not exists team_setups_team_idx on public.team_setups (team_id, car, track);
alter table public.team_setups enable row level security;

-- a equipe tem o plano Equipe? (o dono da equipe tem assinatura ou cortesia Equipe ativa)
create or replace function public._team_has_plan(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public._team_end(u.email) is not null from public.teams t join auth.users u on u.id = t.owner where t.id = p_team), false);
$$;
create or replace function public._is_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where team_id = p_team and user_id = auth.uid());
$$;

create or replace function public.team_setup_library(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  if not public._is_member(p_team) then return jsonb_build_object('ok', false, 'error', 'membro'); end if;
  if not public._team_has_plan(p_team) then return jsonb_build_object('ok', false, 'error', 'plano'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(x order by (x->>'best_lap_ms')::int nulls last) from (
      select jsonb_build_object('kind', 'compartilhado', 'id', s.id, 'who', coalesce(p.name, ''), 'mine', s.user_id = auth.uid(), 'game', s.game, 'car', s.car, 'track', s.track,
               'name', s.name, 'best_lap_ms', s.best_lap_ms, 'air_temp', s.air_temp, 'road_temp', s.road_temp, 'note', s.note, 'at', s.created_at) as x
        from public.team_setups s left join public.profiles p on p.id = s.user_id where s.team_id = p_team
      union all
      select jsonb_build_object('kind', 'volta', 'id', l.id, 'who', coalesce(p.name, ''), 'mine', l.user_id = auth.uid(), 'game', l.game, 'car', l.car, 'track', l.track,
               'name', l.setup_name, 'best_lap_ms', l.lap_time_ms, 'air_temp', l.air_temp, 'road_temp', l.road_temp, 'note', null, 'at', l.recorded_at)
        from public.laps l join public.team_members tm on tm.user_id = l.user_id and tm.team_id = p_team
        left join public.profiles p on p.id = l.user_id
       where l.setup_json is not null and l.setup_name is not null
         and not exists (select 1 from public.team_setups s2 where s2.team_id = p_team and s2.user_id = l.user_id and s2.car = l.car and s2.track = l.track and s2.name = l.setup_name)
    ) q), '[]'::jsonb));
end $$;

create or replace function public.team_setup_get(p_team uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null or not public._is_member(p_team) then return jsonb_build_object('ok', false, 'error', 'membro'); end if;
  if not public._team_has_plan(p_team) then return jsonb_build_object('ok', false, 'error', 'plano'); end if;
  if p_kind = 'compartilhado' then
    select s.car, s.track, s.name, s.content, p.name as who into r from public.team_setups s left join public.profiles p on p.id = s.user_id where s.id = p_id and s.team_id = p_team;
  else
    select l.car, l.track, l.setup_name as name, l.setup_json as content, p.name as who into r
      from public.laps l join public.team_members tm on tm.user_id = l.user_id and tm.team_id = p_team left join public.profiles p on p.id = l.user_id where l.id = p_id;
  end if;
  if r.car is null then return jsonb_build_object('ok', false, 'error', 'nao_achou'); end if;
  return jsonb_build_object('ok', true, 'car', r.car, 'track', r.track, 'name', r.name, 'content', r.content, 'who', r.who);
end $$;

create or replace function public.share_team_setup(p_team uuid, p_game text, p_car text, p_track text, p_name text, p_content text,
  p_lap_ms int default null, p_air real default null, p_road real default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh text := md5(coalesce(p_content, ''));
begin
  if auth.uid() is null or not public._is_member(p_team) then return jsonb_build_object('ok', false, 'error', 'membro'); end if;
  if not public._team_has_plan(p_team) then return jsonb_build_object('ok', false, 'error', 'plano'); end if;
  if p_content is null or length(p_content) < 2 or length(p_content) > 400000 then return jsonb_build_object('ok', false, 'error', 'conteudo'); end if;
  insert into public.team_setups (team_id, user_id, game, car, track, name, content, sha, best_lap_ms, air_temp, road_temp, note)
  values (p_team, auth.uid(), coalesce(p_game, 'acc'), p_car, p_track, left(p_name, 140), p_content, sh, p_lap_ms, p_air, p_road, left(p_note, 300))
  on conflict (team_id, sha) do update set name = excluded.name, best_lap_ms = coalesce(excluded.best_lap_ms, public.team_setups.best_lap_ms),
    note = coalesce(excluded.note, public.team_setups.note);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.delete_team_setup(p_team uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from public.team_setups s where s.id = p_id and s.team_id = p_team
    and (s.user_id = auth.uid() or exists (select 1 from public.teams t where t.id = p_team and t.owner = auth.uid()));
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public._team_has_plan(uuid) from public, anon, authenticated;
revoke all on function public._is_member(uuid) from public, anon, authenticated;
revoke all on function public.team_setup_library(uuid) from public, anon;
revoke all on function public.team_setup_get(uuid, text, uuid) from public, anon;
revoke all on function public.share_team_setup(uuid, text, text, text, text, text, int, real, real, text) from public, anon;
revoke all on function public.delete_team_setup(uuid, uuid) from public, anon;
grant execute on function public.team_setup_library(uuid), public.team_setup_get(uuid, text, uuid),
  public.share_team_setup(uuid, text, text, text, text, text, int, real, real, text), public.delete_team_setup(uuid, uuid) to authenticated;

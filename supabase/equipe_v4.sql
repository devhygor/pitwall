-- Pitwall · v4: cargos, entrada aberta / por aprovação, convite por e-mail, logo e comunidade
-- Pode rodar quantas vezes quiser (tudo é "se não existir" / recria). Rode UMA vez no
-- Supabase: SQL Editor → New query → cole tudo → Run.
-- Também reaplica, de forma segura, as regras da v2 (comunidade, logo da equipe, buckets).

-- 0) perfis de todo mundo que já entrou (o ranking da comunidade precisa do nome) ------
insert into public.profiles (id, name, avatar_url)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1)),
       u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
on conflict (id) do nothing;

-- 1) colunas e cargos --------------------------------------------------------------------
alter table public.teams add column if not exists logo_url text;
alter table public.teams add column if not exists description text;
alter table public.teams add column if not exists join_mode text not null default 'invite';
alter table public.teams drop constraint if exists teams_join_mode_check;
alter table public.teams add constraint teams_join_mode_check check (join_mode in ('invite', 'request', 'open'));
-- invite  = só por convite (link, código ou e-mail); não aparece na lista
-- request = aparece na lista; quem pede entrar fica aguardando um líder aprovar
-- open    = aparece na lista; qualquer um entra com um clique

alter table public.team_members drop constraint if exists team_members_role_check;
alter table public.team_members add constraint team_members_role_check check (role in ('owner', 'admin', 'member'));
-- owner = dono · admin = líder (convida, aprova, remove, edita a equipe) · member = piloto

alter table public.laps add column if not exists setup_name text;
alter table public.laps add column if not exists setup_json text;
alter table public.laps add column if not exists clip_path text;
alter table public.laps add column if not exists events jsonb not null default '[]'::jsonb;

-- 2) pedidos de entrada e convites por e-mail --------------------------------------------
create table if not exists public.team_requests (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create table if not exists public.team_invites (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  email      text not null,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, email)
);
alter table public.team_requests enable row level security;
alter table public.team_invites enable row level security;

-- 3) funções auxiliares --------------------------------------------------------------------
create or replace function public.team_role(t uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.team_members where team_id = t and user_id = auth.uid()
$$;
create or replace function public.can_manage(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.team_role(t) in ('owner', 'admin'), false)
$$;
create or replace function public.can_manage_folder(path_part text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.can_manage(path_part::uuid);
exception when others then
  return false;
end $$;

-- 4) regras de acesso (RLS) ----------------------------------------------------------------
-- laps / profiles: o ranking da comunidade enxerga todo mundo
drop policy if exists "voltas: comunidade vê" on public.laps;
create policy "voltas: comunidade vê" on public.laps for select to authenticated using (true);
drop policy if exists "perfil: comunidade vê" on public.profiles;
create policy "perfil: comunidade vê" on public.profiles for select to authenticated using (true);

-- equipe: líderes editam (só nome, logo, descrição e modo de entrada); dono apaga
drop policy if exists "equipe: dono edita" on public.teams;
drop policy if exists "equipe: líder edita" on public.teams;
create policy "equipe: líder edita" on public.teams
  for update to authenticated using (public.can_manage(id)) with check (public.can_manage(id));
revoke update on public.teams from authenticated;
grant update (name, logo_url, description, join_mode) on public.teams to authenticated;

-- membros: só sair pela função leave_team; remover pela função remove_member
drop policy if exists "membros: sair ou dono remove" on public.team_members;
revoke delete on public.team_members from authenticated;

drop policy if exists "pedidos: líder e o próprio veem" on public.team_requests;
create policy "pedidos: líder e o próprio veem" on public.team_requests
  for select to authenticated using (user_id = auth.uid() or public.can_manage(team_id));
drop policy if exists "pedidos: apago o meu" on public.team_requests;
create policy "pedidos: apago o meu" on public.team_requests
  for delete to authenticated using (user_id = auth.uid());
drop policy if exists "convites: líder vê" on public.team_invites;
create policy "convites: líder vê" on public.team_invites
  for select to authenticated using (public.can_manage(team_id));
grant select on public.team_requests, public.team_invites to authenticated;
grant delete on public.team_requests to authenticated;
revoke all on public.team_requests, public.team_invites from anon;

-- 5) armazenamento: clipes e logos ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', true, 62914560, array['video/mp4']),
       ('team-logos', 'team-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "clipes: leitura" on storage.objects;
create policy "clipes: leitura" on storage.objects for select to authenticated using (bucket_id = 'clips');
drop policy if exists "clipes: envio do dono" on storage.objects;
create policy "clipes: envio do dono" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "clipes: troca do dono" on storage.objects;
create policy "clipes: troca do dono" on storage.objects for update to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "clipes: apaga do dono" on storage.objects;
create policy "clipes: apaga do dono" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "logos: leitura" on storage.objects;
create policy "logos: leitura" on storage.objects for select to authenticated, anon using (bucket_id = 'team-logos');
drop policy if exists "logos: envio do dono da equipe" on storage.objects;
drop policy if exists "logos: envio do líder" on storage.objects;
create policy "logos: envio do líder" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-logos' and public.can_manage_folder((storage.foldername(name))[1]));
drop policy if exists "logos: troca do dono da equipe" on storage.objects;
drop policy if exists "logos: troca do líder" on storage.objects;
create policy "logos: troca do líder" on storage.objects for update to authenticated
  using (bucket_id = 'team-logos' and public.can_manage_folder((storage.foldername(name))[1]))
  with check (bucket_id = 'team-logos' and public.can_manage_folder((storage.foldername(name))[1]));
drop policy if exists "logos: apaga do dono da equipe" on storage.objects;
drop policy if exists "logos: apaga do líder" on storage.objects;
create policy "logos: apaga do líder" on storage.objects for delete to authenticated
  using (bucket_id = 'team-logos' and public.can_manage_folder((storage.foldername(name))[1]));

-- 6) ações (RPC) -----------------------------------------------------------------------------
-- entrar com código/link de convite: entra direto (quem tem o link foi convidado)
create or replace function public.join_with_code(code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'faça login primeiro'; end if;
  select * into t from public.teams where invite_code = upper(trim(code));
  if t.id is null then raise exception 'convite inválido'; end if;
  insert into public.team_members (team_id, user_id) values (t.id, auth.uid()) on conflict do nothing;
  delete from public.team_requests where team_id = t.id and user_id = auth.uid();
  delete from public.team_invites i using auth.users u
    where i.team_id = t.id and u.id = auth.uid() and lower(i.email) = lower(u.email);
  return jsonb_build_object('status', 'joined', 'team', to_jsonb(t));
end $$;

-- compatibilidade com versões antigas do app
create or replace function public.join_team(code text) returns public.teams
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r := public.join_with_code(code);
  return jsonb_populate_record(null::public.teams, r -> 'team');
end $$;

-- lista de equipes abertas / por aprovação
create or replace function public.discover_teams() returns table (
  id uuid, name text, logo_url text, description text, join_mode text, members bigint, my_status text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.logo_url, t.description, t.join_mode,
         (select count(*) from public.team_members m where m.team_id = t.id),
         case when exists (select 1 from public.team_members m where m.team_id = t.id and m.user_id = auth.uid()) then 'member'
              when exists (select 1 from public.team_requests r where r.team_id = t.id and r.user_id = auth.uid()) then 'pending'
              else 'none' end
  from public.teams t
  where t.join_mode in ('open', 'request') and auth.uid() is not null
  order by 6 desc, t.name
$$;

-- entrar numa equipe da lista: aberta = entra; por aprovação = vira pedido
create or replace function public.join_listed(t uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tt public.teams;
begin
  if auth.uid() is null then raise exception 'faça login primeiro'; end if;
  select * into tt from public.teams where id = t;
  if tt.id is null then raise exception 'equipe não encontrada'; end if;
  if exists (select 1 from public.team_members where team_id = t and user_id = auth.uid()) then
    return jsonb_build_object('status', 'joined', 'team', to_jsonb(tt));
  end if;
  if tt.join_mode = 'open' then
    insert into public.team_members (team_id, user_id) values (t, auth.uid()) on conflict do nothing;
    return jsonb_build_object('status', 'joined', 'team', to_jsonb(tt));
  elsif tt.join_mode = 'request' then
    insert into public.team_requests (team_id, user_id) values (t, auth.uid()) on conflict do nothing;
    return jsonb_build_object('status', 'pending', 'team', to_jsonb(tt));
  end if;
  raise exception 'essa equipe só aceita por convite';
end $$;

create or replace function public.cancel_request(t uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.team_requests where team_id = t and user_id = auth.uid()
$$;

create or replace function public.answer_request(t uuid, u uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage(t) then raise exception 'só dono e líderes podem responder pedidos'; end if;
  if accept then
    insert into public.team_members (team_id, user_id) values (t, u) on conflict do nothing;
  end if;
  delete from public.team_requests where team_id = t and user_id = u;
end $$;

create or replace function public.invite_by_email(t uuid, mail text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text := lower(trim(mail));
begin
  if not public.can_manage(t) then raise exception 'só dono e líderes podem convidar'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  if exists (select 1 from public.team_members m join auth.users u on u.id = m.user_id
             where m.team_id = t and lower(u.email) = e) then
    raise exception 'essa pessoa já está na equipe';
  end if;
  insert into public.team_invites (team_id, email, invited_by) values (t, e, auth.uid())
    on conflict (team_id, email) do nothing;
  return jsonb_build_object('email', e, 'already_has_account',
         exists (select 1 from auth.users u where lower(u.email) = e));
end $$;

create or replace function public.cancel_invite(i uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare tt uuid;
begin
  select team_id into tt from public.team_invites where id = i;
  if tt is null or not public.can_manage(tt) then raise exception 'sem permissão'; end if;
  delete from public.team_invites where id = i;
end $$;

-- convites que chegaram para o meu e-mail
create or replace function public.my_invites() returns table (
  id uuid, team_id uuid, team_name text, logo_url text, invited_by text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.team_id, t.name, t.logo_url, p.name, i.created_at
  from public.team_invites i
  join public.teams t on t.id = i.team_id
  left join public.profiles p on p.id = i.invited_by
  where auth.uid() is not null
    and lower(i.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
  order by i.created_at desc
$$;

create or replace function public.answer_invite(i uuid, accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv public.team_invites; tt public.teams;
begin
  select iv.* into inv from public.team_invites iv
    join auth.users u on u.id = auth.uid() and lower(u.email) = lower(iv.email)
    where iv.id = i;
  if inv.id is null then raise exception 'convite não encontrado'; end if;
  select * into tt from public.teams where id = inv.team_id;
  if accept then
    insert into public.team_members (team_id, user_id) values (inv.team_id, auth.uid()) on conflict do nothing;
  end if;
  delete from public.team_invites where id = i;
  return jsonb_build_object('status', case when accept then 'joined' else 'declined' end, 'team', to_jsonb(tt));
end $$;

create or replace function public.set_member_role(t uuid, u uuid, new_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.team_role(t) <> 'owner' then raise exception 'só o dono da equipe muda cargos'; end if;
  if new_role not in ('admin', 'member') then raise exception 'cargo inválido'; end if;
  update public.team_members set role = new_role where team_id = t and user_id = u and role <> 'owner';
end $$;

create or replace function public.remove_member(t uuid, u uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target text;
begin
  select role into target from public.team_members where team_id = t and user_id = u;
  if target is null then return; end if;
  if target = 'owner' then raise exception 'o dono não pode ser removido'; end if;
  if not public.can_manage(t) then raise exception 'só dono e líderes podem remover'; end if;
  if target = 'admin' and public.team_role(t) <> 'owner' then raise exception 'só o dono remove um líder'; end if;
  delete from public.team_members where team_id = t and user_id = u;
end $$;

create or replace function public.leave_team(t uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.team_role(t) = 'owner' then
    raise exception 'o dono não pode sair: passe o cargo de dono para outra pessoa ou apague a equipe';
  end if;
  delete from public.team_members where team_id = t and user_id = auth.uid();
end $$;

create or replace function public.transfer_ownership(t uuid, u uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.team_role(t) <> 'owner' then raise exception 'só o dono pode passar a equipe'; end if;
  if not exists (select 1 from public.team_members where team_id = t and user_id = u) then
    raise exception 'essa pessoa não está na equipe';
  end if;
  update public.team_members set role = 'admin' where team_id = t and user_id = auth.uid();
  update public.team_members set role = 'owner' where team_id = t and user_id = u;
  update public.teams set owner = u where id = t;
end $$;

-- líderes também podem gerar um novo link de convite
create or replace function public.new_invite_code(t uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
begin
  if not public.can_manage(t) then raise exception 'só dono e líderes podem trocar o convite'; end if;
  update public.teams set invite_code = c where id = t;
  return c;
end $$;

revoke all on function
  public.team_role(uuid), public.can_manage(uuid), public.can_manage_folder(text),
  public.join_with_code(text), public.join_team(text), public.discover_teams(), public.join_listed(uuid),
  public.cancel_request(uuid), public.answer_request(uuid, uuid, boolean), public.invite_by_email(uuid, text),
  public.cancel_invite(uuid), public.my_invites(), public.answer_invite(uuid, boolean),
  public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid), public.leave_team(uuid),
  public.transfer_ownership(uuid, uuid), public.new_invite_code(uuid)
  from anon, public;
grant execute on function
  public.team_role(uuid), public.can_manage(uuid), public.can_manage_folder(text),
  public.join_with_code(text), public.join_team(text), public.discover_teams(), public.join_listed(uuid),
  public.cancel_request(uuid), public.answer_request(uuid, uuid, boolean), public.invite_by_email(uuid, text),
  public.cancel_invite(uuid), public.my_invites(), public.answer_invite(uuid, boolean),
  public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid), public.leave_team(uuid),
  public.transfer_ownership(uuid, uuid), public.new_invite_code(uuid)
  to authenticated;

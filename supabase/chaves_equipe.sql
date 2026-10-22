-- Pitwall · plano Equipe com chaves para dividir (até 10). Cada chave libera o Pro para uma pessoa, com o MESMO prazo do plano do dono:
-- ativar tarde não dá dias a mais. O dono pode revogar uma chave e passar para outra pessoa.
-- Substitui o "Pro automático para quem entra na equipe" (resolve_entitlement agora usa as chaves). Depende de licencas_v1.sql e afiliados_v1.sql.

create table if not exists public.seat_keys (
  id             uuid primary key default gen_random_uuid(),
  owner_email    text not null,
  code           text not null unique,
  redeemed_email text,
  redeemed_at    timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists seat_keys_owner_idx on public.seat_keys (lower(owner_email));
create index if not exists seat_keys_red_idx on public.seat_keys (lower(redeemed_email));
alter table public.seat_keys enable row level security;
drop policy if exists "chaves equipe: so admin" on public.seat_keys;
create policy "chaves equipe: so admin" on public.seat_keys for select to authenticated using (public.is_admin());

-- até quando o plano Equipe do dono vale (assinatura ou cortesia; o teste grátis não dá chaves)
create or replace function public._team_end(p_email text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(e) from (
    select s.current_period_end + interval '3 days' as e from public.subscriptions s
     where lower(s.email) = lower(p_email) and s.plan_code = 'team' and s.status in ('active', 'past_due')
       and s.current_period_end is not null and s.current_period_end + interval '3 days' > now()
    union all
    select coalesce(g.expires_at, now() + interval '100 years') from public.grants g
     where lower(g.email) = lower(p_email) and g.plan_code = 'team' and g.revoked_at is null and g.starts_at <= now()
       and (g.expires_at is null or g.expires_at > now())
  ) q;
$$;

create or replace function public.resolve_entitlement(p_email text)
returns table (plan_code text, source text, ends_at timestamptz, features jsonb, max_devices int, team_seats int)
language sql stable security definer set search_path = public as $$
  with cand as (
    select s.plan_code, 'subscription'::text as source, s.current_period_end + interval '3 days' as ends_at
      from public.subscriptions s
     where lower(s.email) = lower(p_email) and s.status in ('active', 'past_due')
       and s.current_period_end is not null and s.current_period_end + interval '3 days' > now()
    union all
    select g.plan_code, 'grant', coalesce(g.expires_at, now() + interval '100 years')
      from public.grants g
     where lower(g.email) = lower(p_email) and g.revoked_at is null and g.starts_at <= now()
       and (g.expires_at is null or g.expires_at > now())
    union all
    select t.plan_code, 'trial', t.ends_at from public.trials t
     where lower(t.email) = lower(p_email) and t.ends_at > now()
    union all
    -- Pro por chave da equipe: vale até o fim do plano Equipe do dono
    select 'pro'::text, 'team'::text, public._team_end(k.owner_email)
      from public.seat_keys k
     where lower(k.redeemed_email) = lower(p_email) and k.revoked_at is null and public._team_end(k.owner_email) is not null
  )
  select p.code, c.source, c.ends_at, p.features, p.max_devices, p.team_seats
    from (select * from cand union all select 'free', 'free', now() + interval '100 years') c
    join public.plans p on p.code = c.plan_code
   order by p.sort desc, c.ends_at desc
   limit 1;
$$;

create or replace function public.my_seats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mail text := lower(coalesce(auth.email(), '')); ends timestamptz; cap int; keys jsonb; holder record;
begin
  if mail = '' then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  ends := public._team_end(mail);
  if ends is null then
    select k.owner_email, public._team_end(k.owner_email) as e into holder from public.seat_keys k
     where lower(k.redeemed_email) = mail and k.revoked_at is null limit 1;
    return jsonb_build_object('ok', true, 'is_owner', false,
      'holder', case when holder.owner_email is null then null else jsonb_build_object('owner', regexp_replace(holder.owner_email, '^(.{2}).*(@.*)$', '\1***\2'), 'ends_at', holder.e) end);
  end if;
  select coalesce(team_seats, 10) into cap from public.plans where code = 'team';
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'redeemed_email', redeemed_email, 'redeemed_at', redeemed_at, 'created_at', created_at) order by created_at), '[]')
    into keys from public.seat_keys where lower(owner_email) = mail and revoked_at is null;
  return jsonb_build_object('ok', true, 'is_owner', true, 'capacity', cap, 'ends_at', ends, 'keys', keys);
end $$;

create or replace function public.create_seat_key() returns jsonb
language plpgsql security definer set search_path = public as $$
declare mail text := lower(coalesce(auth.email(), '')); cap int; used int; cd text;
begin
  if mail = '' then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  if public._team_end(mail) is null then return jsonb_build_object('ok', false, 'error', 'sem_plano'); end if;
  select coalesce(team_seats, 10) into cap from public.plans where code = 'team';
  select count(*) into used from public.seat_keys where lower(owner_email) = mail and revoked_at is null;
  if used >= cap then return jsonb_build_object('ok', false, 'error', 'limite'); end if;
  loop
    cd := 'PWT-' || substr(public.new_code(), 4);
    begin
      insert into public.seat_keys (owner_email, code) values (mail, cd);
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'code', cd);
end $$;

create or replace function public.revoke_seat_key(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mail text := lower(coalesce(auth.email(), ''));
begin
  update public.seat_keys set revoked_at = now() where id = p_id and lower(owner_email) = mail and revoked_at is null;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.redeem_seat_key(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mail text := lower(coalesce(auth.email(), '')); k public.seat_keys; e record; ends timestamptz;
begin
  if auth.uid() is null or mail = '' then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  select * into k from public.seat_keys where code = upper(trim(p_code)) for update;
  if k.id is null or k.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'invalido'); end if;
  if k.redeemed_email is not null then return jsonb_build_object('ok', false, 'error', 'esgotado'); end if;
  ends := public._team_end(k.owner_email);
  if ends is null then return jsonb_build_object('ok', false, 'error', 'expirado'); end if;
  if lower(k.owner_email) = mail then return jsonb_build_object('ok', false, 'error', 'proprio'); end if;
  if exists (select 1 from public.seat_keys where lower(redeemed_email) = mail and revoked_at is null) then
    return jsonb_build_object('ok', false, 'error', 'ja_tem_chave');
  end if;
  select * into e from public.resolve_entitlement(mail);
  if e.plan_code <> 'free' and e.source in ('subscription', 'grant') then return jsonb_build_object('ok', false, 'error', 'ja_pago'); end if;
  update public.seat_keys set redeemed_email = mail, redeemed_at = now() where id = k.id;
  perform public.ensure_license(mail, auth.uid());
  return jsonb_build_object('ok', true, 'plan', 'pro', 'ends_at', ends, 'seat', true);
end $$;

-- o campo de código do site e do app aceita as chaves da equipe (PWT-...)
do $$ declare d text; begin
  select pg_get_functiondef('public.redeem_code(text)'::regprocedure) into d;
  if position('redeem_seat_key' in d) = 0 then
    d := replace(d, 'begin' || E'\n' || '  if auth.uid() is null', 'begin' || E'\n' || '  if upper(trim(p_code)) like ''PWT-%'' then return public.redeem_seat_key(p_code); end if;' || E'\n' || '  if auth.uid() is null');
    execute d;
  end if;
end $$;

revoke all on function public._team_end(text) from public, anon, authenticated;
revoke all on function public.my_seats() from public, anon;
revoke all on function public.create_seat_key() from public, anon;
revoke all on function public.revoke_seat_key(uuid) from public, anon;
revoke all on function public.redeem_seat_key(text) from public, anon;
grant execute on function public.my_seats(), public.create_seat_key(), public.revoke_seat_key(uuid), public.redeem_seat_key(text) to authenticated;
update public.plans set features = (select jsonb_agg(distinct f) from jsonb_array_elements_text(features || '["seat_keys"]'::jsonb) f) where code = 'team';

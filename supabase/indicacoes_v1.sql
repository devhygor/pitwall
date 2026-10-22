-- Pitwall · "Indique e ganhe": todo usuário tem um link de indicação.
--  * Quem entra pelo link ganha 5% no primeiro pagamento (cupom automático do link).
--  * Quem indica ganha 1% de desconto na PRÓXIMA assinatura a cada 2 indicados confirmados, até 50% (100 indicados).
--    "Confirmado" = o indicado já usou o Pitwall (computador registrado) ou começou teste/assinatura; isso evita contas falsas.
--  * O desconto acumulado é usado no próximo checkout e zera; o total de indicados da vida toda continua contando.
-- Depende de licencas_v1.sql e afiliados_v1.sql. Pode rodar de novo.

create table if not exists public.referral_links (
  user_id    uuid primary key references auth.users on delete cascade,
  email      text not null,
  code       text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.referrals (
  id             uuid primary key default gen_random_uuid(),
  referrer_id    uuid not null references auth.users on delete cascade,
  referred_id    uuid not null unique references auth.users on delete cascade,
  referred_email text not null,
  code           text not null,
  created_at     timestamptz not null default now(),
  consumed_at    timestamptz,
  consumed_sub   uuid references public.subscriptions(id) on delete set null
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);
alter table public.referral_links enable row level security;
alter table public.referrals      enable row level security;
drop policy if exists "indicacao: meu link" on public.referral_links;
create policy "indicacao: meu link" on public.referral_links for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "indicacoes: minhas" on public.referrals;
create policy "indicacoes: minhas" on public.referrals for select to authenticated using (referrer_id = auth.uid() or public.is_admin());

create or replace function public.new_ref_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := gen_random_bytes(6); r text := ''; i int;
begin
  for i in 0..5 loop r := r || substr(alpha, (get_byte(b, i) % 32) + 1, 1); end loop;
  return 'PW' || r;
end $$;

-- o indicado "confirmou" quando já usou o Pitwall de verdade
create or replace function public._ref_confirmed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.devices where lower(email) = lower(p_email))
      or exists (select 1 from public.trials where lower(email) = lower(p_email))
      or exists (select 1 from public.subscriptions where lower(email) = lower(p_email));
$$;

-- o meu link, os números e o desconto já acumulado
create or replace function public.my_referral() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mail text := lower(auth.email()); l public.referral_links; cd text;
        total int; conf int; avail int; used int; pct int; need int; lst jsonb;
begin
  if uid is null or mail is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  select * into l from public.referral_links where user_id = uid;
  if l.code is null then
    loop
      cd := public.new_ref_code();
      begin
        insert into public.referral_links (user_id, email, code) values (uid, mail, cd) returning * into l;
        insert into public.coupons (code, kind, percent_off, duration, batch, note) values (cd, 'discount', 5, 'once', 'indicacao', 'indicação de ' || mail);
        exit;
      exception when unique_violation then
        select * into l from public.referral_links where user_id = uid;
        exit when l.code is not null;
      end;
    end loop;
  end if;
  select count(*), count(*) filter (where public._ref_confirmed(referred_email)),
         count(*) filter (where consumed_at is null and public._ref_confirmed(referred_email)),
         count(*) filter (where consumed_at is not null)
    into total, conf, avail, used from public.referrals where referrer_id = uid;
  pct := least(50, avail / 2);
  need := case when pct >= 50 then 0 else (pct + 1) * 2 - avail end;
  select coalesce(jsonb_agg(jsonb_build_object('who', regexp_replace(r.referred_email, '^(.{2}).*(@.*)$', '\1***\2'), 'at', r.created_at,
           'status', case when r.consumed_at is not null then 'usado' when public._ref_confirmed(r.referred_email) then 'confirmado' else 'pendente' end)
         order by r.created_at desc), '[]') into lst
    from (select * from public.referrals where referrer_id = uid order by created_at desc limit 30) r;
  return jsonb_build_object('ok', true, 'code', l.code, 'total', total, 'confirmed', conf, 'available', avail, 'used', used,
    'pct', pct, 'need_next', need, 'max_pct', 50, 'invite_pct', 5, 'list', lst);
end $$;

-- quem entrou pelo link: registra a indicação (só contas novas, uma vez, nunca a própria)
create or replace function public.claim_referral(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mail text := lower(auth.email()); l public.referral_links; created timestamptz;
begin
  if uid is null or mail is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  select * into l from public.referral_links where code = upper(trim(p_code));
  if l.code is null then return jsonb_build_object('ok', false, 'error', 'invalido'); end if;
  if l.user_id = uid or lower(l.email) = mail then return jsonb_build_object('ok', false, 'error', 'proprio'); end if;
  if exists (select 1 from public.referrals where referred_id = uid) then return jsonb_build_object('ok', false, 'error', 'ja'); end if;
  select created_at into created from auth.users where id = uid;
  if created < now() - interval '3 days' then return jsonb_build_object('ok', false, 'error', 'conta_antiga'); end if;
  insert into public.referrals (referrer_id, referred_id, referred_email, code) values (l.user_id, uid, mail, l.code);
  return jsonb_build_object('ok', true);
end $$;

-- desconto acumulado de quem indicou (só a função de borda "checkout" usa): devolve o % e os ids que serão gastos
create or replace function public.referral_reward(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ids uuid[]; pct int;
begin
  select coalesce(array_agg(id order by created_at), '{}') into ids from public.referrals
   where referrer_id = p_user and consumed_at is null and public._ref_confirmed(referred_email);
  pct := least(50, coalesce(array_length(ids, 1), 0) / 2);
  return jsonb_build_object('pct', pct, 'ids', to_jsonb(ids[1:pct * 2]));
end $$;
create or replace function public.referral_consume(p_ids uuid[], p_sub uuid) returns void
language sql security definer set search_path = public as $$
  update public.referrals set consumed_at = now(), consumed_sub = p_sub where id = any(p_ids) and consumed_at is null;
$$;
create or replace function public.referral_release(p_subs uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.referrals set consumed_at = null, consumed_sub = null where consumed_sub = any(p_subs);
$$;

-- cupom de indicação: vale só para quem nunca assinou, e não para o dono do link
create or replace function public.check_coupon(p_code text, p_plan text default 'pro') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.coupons; a public.affiliates;
begin
  select * into c from public.coupons where code = upper(trim(p_code));
  if c.code is null or not c.active then return jsonb_build_object('ok', false, 'error', 'invalido'); end if;
  if c.expires_at is not null and c.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'expirado'); end if;
  if c.max_uses is not null and c.uses >= c.max_uses then return jsonb_build_object('ok', false, 'error', 'esgotado'); end if;
  if c.kind = 'grant' then
    return jsonb_build_object('ok', true, 'kind', 'grant', 'plan', c.plan_code, 'days', c.grant_days);
  end if;
  if c.plan_code is not null and p_plan is not null and c.plan_code <> p_plan then
    return jsonb_build_object('ok', false, 'error', 'plano_diferente');
  end if;
  if c.batch = 'indicacao' then
    if exists (select 1 from public.referral_links where code = c.code and user_id = auth.uid()) then
      return jsonb_build_object('ok', false, 'error', 'proprio');
    end if;
    if exists (select 1 from public.subscriptions where lower(email) = lower(coalesce(auth.email(), '')) and status not in ('canceled', 'pending')) then
      return jsonb_build_object('ok', false, 'error', 'so_novos');
    end if;
  end if;
  if c.affiliate_id is not null then
    select * into a from public.affiliates where id = c.affiliate_id;
    if a.id is null or not a.active then return jsonb_build_object('ok', false, 'error', 'invalido'); end if;
    if a.email is not null and lower(a.email) = lower(coalesce(auth.email(), '')) then
      return jsonb_build_object('ok', false, 'error', 'proprio');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'kind', 'discount', 'percent_off', c.percent_off, 'duration', c.duration);
end $$;

revoke all on function public.new_ref_code() from public, anon, authenticated;
revoke all on function public._ref_confirmed(text) from public, anon, authenticated;
revoke all on function public.my_referral() from public, anon;
revoke all on function public.claim_referral(text) from public, anon;
revoke all on function public.referral_reward(uuid) from public, anon, authenticated;
revoke all on function public.referral_consume(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.referral_release(uuid[]) from public, anon, authenticated;
grant execute on function public.my_referral(), public.claim_referral(text) to authenticated;
grant execute on function public.referral_reward(uuid), public.referral_consume(uuid[], uuid), public.referral_release(uuid[]) to service_role;

-- o painel de cupons não lista os cupons automáticos de indicação (um por usuário)
do $$ declare d text; begin
  select pg_get_functiondef('public.admin_affiliates()'::regprocedure) into d;
  d := replace(d, 'where affiliate_id is null order by created_at desc limit 500', $q$where affiliate_id is null and batch is distinct from 'indicacao' order by created_at desc limit 500$q$);
  execute d;
end $$;

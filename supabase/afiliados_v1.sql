-- Pitwall · afiliados, cupons de desconto, códigos de presente (sorteios) e comissões.
-- Só cria coisas novas; pode rodar de novo. Depende de licencas_v1.sql.
--
-- * Código de AFILIADO (reutilizável): dá desconto no checkout e gera comissão para o afiliado.
-- * Código de PRESENTE (uso único ou limitado): quem resgata ganha o plano por N dias, sem pagar.
-- * Cupom de desconto avulso: igual ao do afiliado, mas sem comissão.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.affiliates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text,
  code            text not null unique,                  -- sempre em MAIÚSCULAS
  discount_pct    int  not null default 10 check (discount_pct between 0 and 100),
  discount_duration text not null default 'once' check (discount_duration in ('once', 'forever')),
  commission_pct  int  not null default 20 check (commission_pct between 0 and 100),
  commission_mode text not null default 'recurring' check (commission_mode in ('recurring', 'first')),
  pix_key         text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists public.coupons (
  code         text primary key,                         -- sempre em MAIÚSCULAS
  kind         text not null check (kind in ('discount', 'grant')),
  percent_off  int check (percent_off between 1 and 100),
  duration     text not null default 'once' check (duration in ('once', 'forever')),
  plan_code    text references public.plans(code),       -- discount: vale só para esse plano (vazio = todos); grant: plano dado
  grant_days   int check (grant_days > 0),
  max_uses     int,
  uses         int not null default 0,
  expires_at   timestamptz,
  active       boolean not null default true,
  affiliate_id uuid references public.affiliates(id) on delete set null,
  batch        text,
  note         text,
  created_at   timestamptz not null default now()
);

create table if not exists public.coupon_redemptions (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  email           text not null,
  user_id         uuid references auth.users on delete set null,
  kind            text not null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  grant_id        uuid references public.grants(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists coupon_redemptions_code_idx on public.coupon_redemptions (code, lower(email));

alter table public.subscriptions
  add column if not exists coupon_code text,
  add column if not exists affiliate_id uuid references public.affiliates(id) on delete set null,
  add column if not exists discount_pct int not null default 0,
  add column if not exists discount_duration text,
  add column if not exists full_price_cents int,
  add column if not exists full_restored boolean not null default false;

create table if not exists public.commissions (
  id              uuid primary key default gen_random_uuid(),
  affiliate_id    uuid not null references public.affiliates(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  payment_id      uuid unique references public.payments(id) on delete cascade,
  base_cents      int  not null,
  pct             int  not null,
  amount_cents    int  not null,
  status          text not null default 'pending' check (status in ('pending', 'paid', 'canceled')),
  approve_at      timestamptz not null default now() + interval '7 days',   -- depois disso conta como "aprovada"
  paid_at         timestamptz,
  note            text,
  created_at      timestamptz not null default now()
);

alter table public.affiliates         enable row level security;
alter table public.coupons            enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.commissions        enable row level security;

drop policy if exists "afiliados: so admin" on public.affiliates;
create policy "afiliados: so admin" on public.affiliates for select to authenticated using (public.is_admin());
drop policy if exists "cupons: so admin" on public.coupons;
create policy "cupons: so admin" on public.coupons for select to authenticated using (public.is_admin());
drop policy if exists "resgates: meus ou admin" on public.coupon_redemptions;
create policy "resgates: meus ou admin" on public.coupon_redemptions for select to authenticated
  using (public.is_admin() or lower(email) = lower(auth.email()));
drop policy if exists "comissoes: so admin" on public.commissions;
create policy "comissoes: so admin" on public.commissions for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- gerar código legível (sem 0/O/1/I)
create or replace function public.new_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := gen_random_bytes(8); r text := ''; i int;
begin
  for i in 0..7 loop r := r || substr(alpha, (get_byte(b, i) % 32) + 1, 1); end loop;
  return 'PW-' || r;
end $$;

-- ---------------------------------------------------------------- validar um código (checkout e telas)
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
  if c.affiliate_id is not null then
    select * into a from public.affiliates where id = c.affiliate_id;
    if a.id is null or not a.active then return jsonb_build_object('ok', false, 'error', 'invalido'); end if;
    if a.email is not null and lower(a.email) = lower(coalesce(auth.email(), '')) then
      return jsonb_build_object('ok', false, 'error', 'proprio');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'kind', 'discount', 'percent_off', c.percent_off, 'duration', c.duration);
end $$;

-- ---------------------------------------------------------------- resgatar código de presente
create or replace function public.redeem_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.coupons; mail text := lower(auth.email()); gid uuid; ends timestamptz;
begin
  if auth.uid() is null or mail is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  select * into c from public.coupons where code = upper(trim(p_code)) for update;
  if c.code is null or not c.active then return jsonb_build_object('ok', false, 'error', 'invalido'); end if;
  if c.expires_at is not null and c.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'expirado'); end if;
  if c.max_uses is not null and c.uses >= c.max_uses then return jsonb_build_object('ok', false, 'error', 'esgotado'); end if;
  if c.kind <> 'grant' then return jsonb_build_object('ok', false, 'error', 'use_no_checkout'); end if;
  if exists (select 1 from public.coupon_redemptions where code = c.code and lower(email) = mail) then
    return jsonb_build_object('ok', false, 'error', 'ja_usado');
  end if;
  ends := now() + make_interval(days => c.grant_days);
  insert into public.grants (email, plan_code, expires_at, reason) values (mail, c.plan_code, ends, 'código ' || c.code) returning id into gid;
  insert into public.coupon_redemptions (code, email, user_id, kind, grant_id) values (c.code, mail, auth.uid(), 'grant', gid);
  update public.coupons set uses = uses + 1 where code = c.code;
  perform public.ensure_license(mail, auth.uid());
  return jsonb_build_object('ok', true, 'plan', c.plan_code, 'days', c.grant_days, 'ends_at', ends);
end $$;

-- ---------------------------------------------------------------- administração
create or replace function public.admin_create_affiliate(p_name text, p_email text, p_code text, p_discount_pct int, p_discount_duration text,
  p_commission_pct int, p_commission_mode text, p_pix text default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid; cd text := upper(regexp_replace(trim(p_code), '\s+', '', 'g'));
begin
  perform public._admin_check();
  if length(cd) < 3 then raise exception 'código curto demais'; end if;
  insert into public.affiliates (name, email, code, discount_pct, discount_duration, commission_pct, commission_mode, pix_key, notes)
  values (trim(p_name), nullif(lower(trim(p_email)), ''), cd, p_discount_pct, p_discount_duration, p_commission_pct, p_commission_mode, nullif(trim(p_pix), ''), p_notes)
  returning id into aid;
  insert into public.coupons (code, kind, percent_off, duration, plan_code, affiliate_id, note)
  values (cd, 'discount', greatest(1, p_discount_pct), p_discount_duration, null, aid, 'afiliado ' || trim(p_name));
  perform public._admin_log('create_affiliate', cd, jsonb_build_object('name', p_name));
  return aid;
end $$;

create or replace function public.admin_update_affiliate(p_id uuid, p_active boolean, p_discount_pct int, p_discount_duration text,
  p_commission_pct int, p_commission_mode text, p_pix text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cd text;
begin
  perform public._admin_check();
  update public.affiliates set active = p_active, discount_pct = p_discount_pct, discount_duration = p_discount_duration,
    commission_pct = p_commission_pct, commission_mode = p_commission_mode, pix_key = nullif(trim(coalesce(p_pix, '')), '') where id = p_id
    returning code into cd;
  update public.coupons set active = p_active, percent_off = greatest(1, p_discount_pct), duration = p_discount_duration where affiliate_id = p_id;
  perform public._admin_log('update_affiliate', cd, null);
end $$;

create or replace function public.admin_create_coupon(p_code text, p_kind text, p_percent_off int, p_duration text, p_plan text,
  p_grant_days int, p_max_uses int, p_valid_days int, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare cd text := upper(regexp_replace(trim(p_code), '\s+', '', 'g'));
begin
  perform public._admin_check();
  if cd = '' then cd := public.new_code(); end if;
  insert into public.coupons (code, kind, percent_off, duration, plan_code, grant_days, max_uses, expires_at, note)
  values (cd, p_kind, case when p_kind = 'discount' then p_percent_off end, coalesce(p_duration, 'once'), nullif(p_plan, ''),
          case when p_kind = 'grant' then p_grant_days end, p_max_uses,
          case when p_valid_days is null then null else now() + make_interval(days => p_valid_days) end, p_note);
  perform public._admin_log('create_coupon', cd, jsonb_build_object('kind', p_kind));
  return cd;
end $$;

create or replace function public.admin_generate_codes(p_count int, p_plan text, p_grant_days int, p_valid_days int, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i int := 0; cd text; out jsonb := '[]'; batch text := to_char(now(), 'YYYYMMDD-HH24MISS');
begin
  perform public._admin_check();
  if p_count < 1 or p_count > 500 then raise exception 'quantidade entre 1 e 500'; end if;
  while i < p_count loop
    cd := public.new_code();
    begin
      insert into public.coupons (code, kind, plan_code, grant_days, max_uses, expires_at, batch, note)
      values (cd, 'grant', p_plan, p_grant_days, 1, now() + make_interval(days => p_valid_days), batch, p_note);
      out := out || to_jsonb(cd);
      i := i + 1;
    exception when unique_violation then null;
    end;
  end loop;
  perform public._admin_log('generate_codes', batch, jsonb_build_object('count', p_count, 'plan', p_plan, 'days', p_grant_days));
  return out;
end $$;

create or replace function public.admin_set_coupon_active(p_code text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.coupons set active = p_active where code = p_code;
  perform public._admin_log('set_coupon_active', p_code, jsonb_build_object('active', p_active));
end $$;

create or replace function public.admin_set_commission(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.commissions set status = p_status, paid_at = case when p_status = 'paid' then now() else null end,
    note = coalesce(p_note, note) where id = p_id;
  perform public._admin_log('set_commission', p_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_affiliates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public._admin_check();
  select jsonb_build_object(
    'affiliates', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]') from (
        select a.*,
          (select count(*) from public.subscriptions s where s.affiliate_id = a.id) as clients_total,
          (select count(*) from public.subscriptions s where s.affiliate_id = a.id and s.status in ('active', 'past_due')) as clients_active,
          coalesce((select sum(c.amount_cents) from public.commissions c where c.affiliate_id = a.id and c.status = 'pending' and c.approve_at > now()), 0) as cents_pending,
          coalesce((select sum(c.amount_cents) from public.commissions c where c.affiliate_id = a.id and c.status = 'pending' and c.approve_at <= now()), 0) as cents_approved,
          coalesce((select sum(c.amount_cents) from public.commissions c where c.affiliate_id = a.id and c.status = 'paid'), 0) as cents_paid
        from public.affiliates a) x),
    'coupons', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]') from
        (select * from public.coupons where affiliate_id is null order by created_at desc limit 500) c),
    'commissions', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]') from
        (select c.*, a.name as affiliate_name, a.code as affiliate_code, a.pix_key, s.email as client_email,
                (c.status = 'pending' and c.approve_at <= now()) as approved
           from public.commissions c join public.affiliates a on a.id = c.affiliate_id
           left join public.subscriptions s on s.id = c.subscription_id order by c.created_at desc limit 500) m),
    'redemptions', (select coalesce(jsonb_agg(to_jsonb(rd) order by rd.created_at desc), '[]') from
        (select * from public.coupon_redemptions order by created_at desc limit 300) rd)
  ) into r;
  return r;
end $$;

revoke all on function public.new_code() from public, anon, authenticated;
revoke all on function public.check_coupon(text, text) from public, anon;
revoke all on function public.redeem_code(text) from public, anon;
revoke all on function public.admin_create_affiliate(text, text, text, int, text, int, text, text, text) from public, anon;
revoke all on function public.admin_update_affiliate(uuid, boolean, int, text, int, text, text) from public, anon;
revoke all on function public.admin_create_coupon(text, text, int, text, text, int, int, int, text) from public, anon;
revoke all on function public.admin_generate_codes(int, text, int, int, text) from public, anon;
revoke all on function public.admin_set_coupon_active(text, boolean) from public, anon;
revoke all on function public.admin_set_commission(uuid, text, text) from public, anon;
revoke all on function public.admin_affiliates() from public, anon;
grant execute on function public.check_coupon(text, text), public.redeem_code(text),
  public.admin_create_affiliate(text, text, text, int, text, int, text, text, text),
  public.admin_update_affiliate(uuid, boolean, int, text, int, text, text),
  public.admin_create_coupon(text, text, int, text, text, int, int, int, text),
  public.admin_generate_codes(int, text, int, int, text), public.admin_set_coupon_active(text, boolean),
  public.admin_set_commission(uuid, text, text), public.admin_affiliates() to authenticated;

-- Pitwall · planos, assinaturas, licenças, cortesias e testes grátis.
-- Só cria coisas novas (nada do que existe é alterado). Pode rodar de novo sem problema.
--
-- Ideia: tudo é ligado ao E-MAIL de quem paga/recebe. O app descobre o plano de duas formas:
--   1) o usuário entra com o Google (mesmo e-mail do pagamento) -> libera sozinho;
--   2) ou cola a CHAVE de licença (para quem pagou com outro e-mail).
-- Quem assina o token de licença é a função de borda "license" (a chave privada fica só lá).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- planos e preços
create table if not exists public.plans (
  code        text primary key,
  name        text not null,
  description text not null default '',
  features    jsonb not null default '[]',
  max_devices int  not null default 1,
  team_seats  int  not null default 0,
  sort        int  not null default 0,
  active      boolean not null default true
);

create table if not exists public.prices (
  id           uuid primary key default gen_random_uuid(),
  plan_code    text not null references public.plans(code),
  period       text not null check (period in ('month', 'year')),
  amount_cents int  not null check (amount_cents >= 0),
  label        text not null default '',
  active       boolean not null default true,
  starts_at    timestamptz,
  ends_at      timestamptz,
  max_uses     int,
  provider_ref text,
  created_at   timestamptz not null default now()
);

insert into public.plans (code, name, description, features, max_devices, team_seats, sort) values
  ('free', 'Grátis', 'Gravar, analisar e comparar voltas, overlays básicos e avisos básicos do engenheiro.',
     '["voice_basic"]', 1, 0, 0),
  ('pro', 'Pro', 'Engenheiro de voz completo (voz online, personalidade, observador), vídeo e setups sem limite, sem anúncios.',
     '["voice_basic","voice_full","voice_online","voice_personality","spotter","video_unlimited","setups_unlimited","team_multi","no_ads"]', 2, 0, 10),
  ('team', 'Equipe', 'Tudo do Pro para até 10 pilotos, com painel do dono.',
     '["voice_basic","voice_full","voice_online","voice_personality","spotter","video_unlimited","setups_unlimited","team_multi","no_ads","team_admin"]', 3, 10, 20)
on conflict (code) do nothing;

insert into public.prices (plan_code, period, amount_cents, label)
select * from (values
  ('pro',  'month',  1490, ''),
  ('pro',  'year',  11900, ''),
  ('pro',  'month',   990, 'Fundador'),
  ('team', 'month',  3990, ''),
  ('team', 'year',  34900, '')
) v(plan_code, period, amount_cents, label)
where not exists (select 1 from public.prices);

-- ---------------------------------------------------------------- administradores
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- o dono do projeto
insert into public.admins (user_id)
select id from auth.users where lower(email) = 'hygor.k92@gmail.com'
on conflict do nothing;

-- ---------------------------------------------------------------- assinaturas, pagamentos, cortesias, testes
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  email                    text not null,
  user_id                  uuid references auth.users on delete set null,
  name                     text,
  doc                      text,                    -- CPF/CNPJ (só números), vem do pagamento
  plan_code                text not null references public.plans(code),
  period                   text not null default 'month' check (period in ('month', 'year')),
  provider                 text not null default 'asaas',
  provider_customer_id     text,
  provider_subscription_id text,
  status                   text not null default 'pending'
                             check (status in ('pending', 'active', 'past_due', 'canceled', 'expired')),
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists subscriptions_email_idx on public.subscriptions (lower(email));
create unique index if not exists subscriptions_provider_uidx
  on public.subscriptions (provider, provider_subscription_id) where provider_subscription_id is not null;

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  subscription_id     uuid references public.subscriptions on delete cascade,
  email               text,
  provider            text not null default 'asaas',
  provider_payment_id text,
  amount_cents        int  not null default 0,
  status              text not null default 'pending'
                        check (status in ('pending', 'paid', 'overdue', 'refunded', 'failed')),
  method              text,
  due_date            date,
  paid_at             timestamptz,
  invoice_url         text,
  raw                 jsonb,
  created_at          timestamptz not null default now()
);
create unique index if not exists payments_provider_uidx
  on public.payments (provider, provider_payment_id) where provider_payment_id is not null;

create table if not exists public.grants (                -- cortesias dadas à mão (amigos etc.)
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  plan_code  text not null references public.plans(code),
  starts_at  timestamptz not null default now(),
  expires_at timestamptz,                               -- vazio = sem data para acabar
  reason     text,
  created_by uuid references auth.users on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists grants_email_idx on public.grants (lower(email));

create table if not exists public.trials (                -- teste grátis de 10 dias, uma vez por pessoa
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete set null,
  email       text not null,
  plan_code   text not null default 'pro' references public.plans(code),
  device_hash text,
  started_at  timestamptz not null default now(),
  ends_at     timestamptz not null
);
create unique index if not exists trials_email_uidx on public.trials (lower(email));
create index if not exists trials_device_idx on public.trials (device_hash);

create table if not exists public.licenses (              -- chave de licença de cada e-mail
  key        text primary key,
  email      text not null,
  user_id    uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists licenses_email_uidx on public.licenses (lower(email)) where revoked_at is null;

create table if not exists public.devices (               -- computadores que já usaram a licença
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  device_hash text not null,
  label       text,
  app_version text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (email, device_hash)
);

create table if not exists public.webhook_events (        -- evita processar o mesmo aviso de pagamento duas vezes
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  event_type   text,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  unique (provider, event_id)
);

create table if not exists public.admin_log (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid,
  action     text not null,
  target     text,
  data       jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- segurança (RLS)
alter table public.plans          enable row level security;
alter table public.prices         enable row level security;
alter table public.admins         enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.payments       enable row level security;
alter table public.grants         enable row level security;
alter table public.trials         enable row level security;
alter table public.licenses       enable row level security;
alter table public.devices        enable row level security;
alter table public.webhook_events enable row level security;
alter table public.admin_log      enable row level security;

drop policy if exists "planos: todos veem" on public.plans;
create policy "planos: todos veem" on public.plans for select to anon, authenticated using (active or public.is_admin());
drop policy if exists "precos: todos veem" on public.prices;
create policy "precos: todos veem" on public.prices for select to anon, authenticated using (active or public.is_admin());
drop policy if exists "admins: so admin" on public.admins;
create policy "admins: so admin" on public.admins for select to authenticated using (public.is_admin());

drop policy if exists "assinaturas: minhas ou admin" on public.subscriptions;
create policy "assinaturas: minhas ou admin" on public.subscriptions for select to authenticated
  using (public.is_admin() or lower(email) = lower(auth.email()));
drop policy if exists "pagamentos: meus ou admin" on public.payments;
create policy "pagamentos: meus ou admin" on public.payments for select to authenticated
  using (public.is_admin() or lower(coalesce(email, '')) = lower(auth.email()));
drop policy if exists "cortesias: minhas ou admin" on public.grants;
create policy "cortesias: minhas ou admin" on public.grants for select to authenticated
  using (public.is_admin() or lower(email) = lower(auth.email()));
drop policy if exists "testes: meus ou admin" on public.trials;
create policy "testes: meus ou admin" on public.trials for select to authenticated
  using (public.is_admin() or lower(email) = lower(auth.email()));
drop policy if exists "licencas: minhas ou admin" on public.licenses;
create policy "licencas: minhas ou admin" on public.licenses for select to authenticated
  using (public.is_admin() or lower(email) = lower(auth.email()));
drop policy if exists "dispositivos: meus ou admin" on public.devices;
create policy "dispositivos: meus ou admin" on public.devices for select to authenticated
  using (public.is_admin() or lower(email) = lower(auth.email()));
drop policy if exists "avisos: so admin" on public.webhook_events;
create policy "avisos: so admin" on public.webhook_events for select to authenticated using (public.is_admin());
drop policy if exists "log: so admin" on public.admin_log;
create policy "log: so admin" on public.admin_log for select to authenticated using (public.is_admin());
-- escrita: nenhuma policy de insert/update/delete. Só as funções abaixo e a função de borda (service role) escrevem.

-- ---------------------------------------------------------------- chave de licença
create or replace function public.new_license_key() returns text
language sql volatile set search_path = public, extensions as $$
  select 'PW-' || string_agg(g, '-') from (
    select upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 4)) as g from generate_series(1, 4)
  ) s;
$$;

create or replace function public.ensure_license(p_email text, p_user uuid default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  select key into k from public.licenses where lower(email) = lower(p_email) and revoked_at is null;
  if k is null then
    insert into public.licenses (key, email, user_id) values (public.new_license_key(), lower(p_email), p_user)
    returning key into k;
  end if;
  return k;
end $$;

-- ---------------------------------------------------------------- qual plano vale agora para um e-mail
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
  )
  select p.code, c.source, c.ends_at, p.features, p.max_devices, p.team_seats
    from (select * from cand
           union all select 'free', 'free', now() + interval '100 years') c
    join public.plans p on p.code = c.plan_code
   order by p.sort desc, c.ends_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------- teste grátis (10 dias, uma vez)
create or replace function public.start_trial(p_device text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mail text := lower(auth.email()); e record; t record;
begin
  if auth.uid() is null or mail is null then
    return jsonb_build_object('ok', false, 'error', 'login');
  end if;
  select * into e from public.resolve_entitlement(mail);
  if e.plan_code <> 'free' then
    return jsonb_build_object('ok', false, 'error', 'already_paid');
  end if;
  if exists (select 1 from public.trials where lower(email) = mail)
     or (p_device is not null and exists (select 1 from public.trials where device_hash = p_device)) then
    return jsonb_build_object('ok', false, 'error', 'trial_used');
  end if;
  insert into public.trials (user_id, email, device_hash, ends_at)
  values (auth.uid(), mail, p_device, now() + interval '10 days') returning * into t;
  perform public.ensure_license(mail, auth.uid());
  return jsonb_build_object('ok', true, 'ends_at', t.ends_at);
end $$;

-- ---------------------------------------------------------------- minha conta (para o site e o app)
create or replace function public.my_account() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mail text := lower(auth.email()); e record; k text; subs jsonb; devs jsonb; tr jsonb;
begin
  if mail is null then return jsonb_build_object('email', null, 'plan', 'free'); end if;
  select * into e from public.resolve_entitlement(mail);
  select key into k from public.licenses where lower(email) = mail and revoked_at is null;
  select coalesce(jsonb_agg(to_jsonb(s) - 'doc' - 'notes' order by s.created_at desc), '[]') into subs
    from public.subscriptions s where lower(s.email) = mail;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'last_seen', d.last_seen,
                  'app_version', d.app_version) order by d.last_seen desc), '[]') into devs
    from public.devices d where lower(d.email) = mail and d.revoked_at is null;
  select to_jsonb(t) into tr from public.trials t where lower(t.email) = mail;
  return jsonb_build_object('email', mail, 'plan', e.plan_code, 'source', e.source, 'ends_at', e.ends_at,
    'features', e.features, 'max_devices', e.max_devices, 'license_key', k, 'subscriptions', subs,
    'devices', devs, 'trial', tr);
end $$;

create or replace function public.revoke_my_device(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.devices set revoked_at = now() where id = p_id and lower(email) = lower(auth.email());
$$;

-- ---------------------------------------------------------------- painel do administrador
create or replace function public._admin_check() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;

create or replace function public._admin_log(a text, t text, d jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.admin_log (admin_id, action, target, data) values (auth.uid(), a, t, d);
$$;

create or replace function public.admin_grant(p_email text, p_plan text, p_days int default null, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  perform public._admin_check();
  insert into public.grants (email, plan_code, expires_at, reason, created_by)
  values (lower(trim(p_email)), p_plan, case when p_days is null then null else now() + make_interval(days => p_days) end, p_reason, auth.uid())
  returning id into gid;
  perform public.ensure_license(lower(trim(p_email)));
  perform public._admin_log('grant', lower(trim(p_email)), jsonb_build_object('plan', p_plan, 'days', p_days, 'reason', p_reason));
  return gid;
end $$;

create or replace function public.admin_revoke_grant(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.grants set revoked_at = now() where id = p_id;
  perform public._admin_log('revoke_grant', p_id::text, null);
end $$;

create or replace function public.admin_set_subscription(p_id uuid, p_status text, p_period_end timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.subscriptions set status = p_status, current_period_end = coalesce(p_period_end, current_period_end), updated_at = now()
   where id = p_id;
  perform public._admin_log('set_subscription', p_id::text, jsonb_build_object('status', p_status, 'period_end', p_period_end));
end $$;

create or replace function public.admin_extend_trial(p_email text, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.trials set ends_at = greatest(ends_at, now()) + make_interval(days => p_days) where lower(email) = lower(p_email);
  perform public._admin_log('extend_trial', lower(p_email), jsonb_build_object('days', p_days));
end $$;

create or replace function public.admin_revoke_device(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.devices set revoked_at = now() where id = p_id;
  perform public._admin_log('revoke_device', p_id::text, null);
end $$;

create or replace function public.admin_revoke_license(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.licenses set revoked_at = now() where key = p_key;
  perform public._admin_log('revoke_license', p_key, null);
end $$;

create or replace function public.admin_set_price(p_id uuid, p_amount_cents int, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.prices set amount_cents = p_amount_cents, active = p_active where id = p_id;
  perform public._admin_log('set_price', p_id::text, jsonb_build_object('amount', p_amount_cents, 'active', p_active));
end $$;

-- visão geral: assinantes, pagamentos, cortesias, testes, quem vence logo
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public._admin_check();
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'active',   (select count(*) from public.subscriptions where status = 'active'),
      'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
      'grants',   (select count(*) from public.grants where revoked_at is null and (expires_at is null or expires_at > now())),
      'trials',   (select count(*) from public.trials where ends_at > now()),
      'users',    (select count(*) from auth.users)),
    'mrr_cents', (select coalesce(sum(case s.period when 'year' then pr.amount_cents / 12 else pr.amount_cents end), 0)
                    from public.subscriptions s
                    join lateral (select amount_cents from public.prices p
                                   where p.plan_code = s.plan_code and p.period = s.period and p.active
                                   order by p.amount_cents desc limit 1) pr on true
                   where s.status = 'active'),
    'subscriptions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]') from
        (select s.*, (select key from public.licenses l where lower(l.email) = lower(s.email) and l.revoked_at is null limit 1) as license_key
           from public.subscriptions s order by s.created_at desc limit 300) x),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) - 'raw' order by p.created_at desc), '[]') from
        (select * from public.payments order by created_at desc limit 300) p),
    'grants', (select coalesce(jsonb_agg(to_jsonb(g) order by g.created_at desc), '[]') from
        (select * from public.grants order by created_at desc limit 300) g),
    'trials', (select coalesce(jsonb_agg(to_jsonb(t) order by t.started_at desc), '[]') from
        (select * from public.trials order by started_at desc limit 300) t),
    'licenses', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]') from
        (select * from public.licenses order by created_at desc limit 300) l),
    'devices', (select coalesce(jsonb_agg(to_jsonb(d) order by d.last_seen desc), '[]') from
        (select * from public.devices order by last_seen desc limit 300) d),
    'prices', (select coalesce(jsonb_agg(to_jsonb(p) order by p.plan_code, p.period, p.amount_cents), '[]') from public.prices p),
    'log', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]') from
        (select * from public.admin_log order by created_at desc limit 100) a)
  ) into r;
  return r;
end $$;

-- permissões das funções: só quem está logado chama (as de admin conferem is_admin por dentro)
revoke all on function public.ensure_license(text, uuid) from public, anon, authenticated;
revoke all on function public.new_license_key() from public, anon, authenticated;
revoke all on function public._admin_check() from public, anon, authenticated;
revoke all on function public._admin_log(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.resolve_entitlement(text) from public, anon, authenticated;
revoke all on function public.start_trial(text) from public, anon;
revoke all on function public.my_account() from public, anon;
revoke all on function public.revoke_my_device(uuid) from public, anon;
revoke all on function public.admin_grant(text, text, int, text) from public, anon;
revoke all on function public.admin_revoke_grant(uuid) from public, anon;
revoke all on function public.admin_set_subscription(uuid, text, timestamptz) from public, anon;
revoke all on function public.admin_extend_trial(text, int) from public, anon;
revoke all on function public.admin_revoke_device(uuid) from public, anon;
revoke all on function public.admin_revoke_license(text) from public, anon;
revoke all on function public.admin_set_price(uuid, int, boolean) from public, anon;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.start_trial(text), public.my_account(), public.revoke_my_device(uuid),
  public.admin_grant(text, text, int, text), public.admin_revoke_grant(uuid),
  public.admin_set_subscription(uuid, text, timestamptz), public.admin_extend_trial(text, int),
  public.admin_revoke_device(uuid), public.admin_revoke_license(text), public.admin_set_price(uuid, int, boolean),
  public.admin_overview(), public.is_admin() to authenticated;

grant execute on function public.is_admin() to anon;

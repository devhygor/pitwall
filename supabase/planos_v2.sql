-- Planos v2 (já aplicado no projeto, migração "planos_v2_equipe_e_estilos"):
--  * Pro e Equipe ganham os modelos extras de overlay; Equipe ganha os modelos de transmissão e Pro para até 10 integrantes.
--  * Quem está numa equipe cujo dono tem o plano Equipe recebe o Pro (fonte "team"), até 10 pilotos, na ordem de entrada.
update public.plans set features = '["voice_basic","voice_full","voice_online","voice_personality","spotter","video_unlimited","setups_unlimited","team_multi","no_ads","overlay_styles"]'::jsonb where code = 'pro';
update public.plans set features = '["voice_basic","voice_full","voice_online","voice_personality","spotter","video_unlimited","setups_unlimited","team_multi","no_ads","overlay_styles","overlay_styles_team","team_admin","team_seats"]'::jsonb where code = 'team';

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
    select 'pro'::text, 'team'::text, o.ends_at
      from public.team_members tm
      join auth.users me on me.id = tm.user_id and lower(me.email) = lower(p_email)
      join public.teams tt on tt.id = tm.team_id
      join auth.users ou on ou.id = tt.owner
      join lateral (
        select max(e) as ends_at from (
          select s.current_period_end + interval '3 days' as e from public.subscriptions s
           where lower(s.email) = lower(ou.email) and s.plan_code = 'team' and s.status in ('active', 'past_due')
             and s.current_period_end is not null and s.current_period_end + interval '3 days' > now()
          union all
          select coalesce(g.expires_at, now() + interval '100 years') from public.grants g
           where lower(g.email) = lower(ou.email) and g.plan_code = 'team' and g.revoked_at is null
             and (g.expires_at is null or g.expires_at > now())
        ) q
      ) o on o.ends_at is not null
     where (select count(*) from public.team_members tm2 where tm2.team_id = tm.team_id and tm2.joined_at <= tm.joined_at) <= 10
  )
  select p.code, c.source, c.ends_at, p.features, p.max_devices, p.team_seats
    from (select * from cand union all select 'free', 'free', now() + interval '100 years') c
    join public.plans p on p.code = c.plan_code
   order by p.sort desc, c.ends_at desc
   limit 1;
$$;

-- Teste grátis de 10 dias também do plano Equipe (migração "start_trial_plano"): um teste por e-mail, Pro ou Equipe.
drop function if exists public.start_trial(text);
create or replace function public.start_trial(p_device text default null, p_plan text default 'pro')
returns jsonb language plpgsql security definer set search_path = public as $$
declare mail text := lower(auth.email()); e record; t record; pl text := case when p_plan = 'team' then 'team' else 'pro' end;
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
  insert into public.trials (user_id, email, plan_code, device_hash, ends_at)
  values (auth.uid(), mail, pl, p_device, now() + interval '10 days') returning * into t;
  perform public.ensure_license(mail, auth.uid());
  return jsonb_build_object('ok', true, 'ends_at', t.ends_at, 'plan', pl);
end $$;
grant execute on function public.start_trial(text, text) to authenticated;

-- Duração do teste grátis configurável (migração "trial_days_config"): tabela app_config + trial_days() + admin_set_trial_days();
-- start_trial passa a usar make_interval(days => trial_days()). Detalhes na migração aplicada no projeto.

-- Preços atuais (22/10/2026), aplicados pelo painel/SQL (a tabela prices manda; este bloco só documenta):
--   Pro mensal 19,90 · Fundador mensal 9,90 · Pro anual 179,90 (≈ 9 meses pagos)
--   Equipe (Pro para 10 pessoas) mensal 99,90 · anual 899,90 (≈ metade de 10 Pros avulsos)
update public.prices set amount_cents = 1990 where plan_code = 'pro' and period = 'month' and label = '';
update public.prices set amount_cents = 990 where plan_code = 'pro' and period = 'month' and label = 'Fundador';
update public.prices set amount_cents = 17990 where plan_code = 'pro' and period = 'year' and label = '';
update public.prices set amount_cents = 9990 where plan_code = 'team' and period = 'month' and label = '';
update public.prices set amount_cents = 89990 where plan_code = 'team' and period = 'year' and label = '';

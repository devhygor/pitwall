-- Pitwall · painel do próprio afiliado (comissão em dinheiro): ele entra com o Google no e-mail cadastrado e acompanha tudo.
create or replace function public.my_affiliate() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.affiliates; mail text := lower(coalesce(auth.email(), '')); pend int; appr int; paid int; cl jsonb; cm jsonb;
begin
  if mail = '' then return null; end if;
  select * into a from public.affiliates where lower(email) = mail and active order by created_at limit 1;
  if a.id is null then return null; end if;
  select coalesce(sum(amount_cents) filter (where status = 'pending' and approve_at > now()), 0),
         coalesce(sum(amount_cents) filter (where status = 'pending' and approve_at <= now()), 0),
         coalesce(sum(amount_cents) filter (where status = 'paid'), 0)
    into pend, appr, paid from public.commissions where affiliate_id = a.id;
  select coalesce(jsonb_agg(jsonb_build_object('who', regexp_replace(s.email, '^(.{2}).*(@.*)$', '\1***\2'), 'plan', s.plan_code,
           'period', s.period, 'status', s.status, 'at', s.created_at) order by s.created_at desc), '[]') into cl
    from (select * from public.subscriptions where affiliate_id = a.id and status <> 'pending' order by created_at desc limit 50) s;
  select coalesce(jsonb_agg(jsonb_build_object('at', m.created_at, 'amount_cents', m.amount_cents, 'base_cents', m.base_cents, 'pct', m.pct,
           'status', case when m.status = 'pending' and m.approve_at <= now() then 'approved' else m.status end, 'approve_at', m.approve_at,
           'who', regexp_replace(coalesce(s.email, ''), '^(.{2}).*(@.*)$', '\1***\2')) order by m.created_at desc), '[]') into cm
    from (select * from public.commissions where affiliate_id = a.id order by created_at desc limit 50) m
    left join public.subscriptions s on s.id = m.subscription_id;
  return jsonb_build_object('name', a.name, 'code', a.code, 'discount_pct', a.discount_pct, 'discount_duration', a.discount_duration,
    'commission_pct', a.commission_pct, 'commission_mode', a.commission_mode, 'pix_key', a.pix_key,
    'clients_total', (select count(*) from public.subscriptions where affiliate_id = a.id and status <> 'pending'),
    'clients_active', (select count(*) from public.subscriptions where affiliate_id = a.id and status in ('active', 'past_due')),
    'cents_pending', pend, 'cents_approved', appr, 'cents_paid', paid, 'clients', cl, 'commissions', cm);
end $$;

create or replace function public.set_my_affiliate_pix(p_pix text) returns void
language sql security definer set search_path = public as $$
  update public.affiliates set pix_key = nullif(trim(p_pix), '') where lower(email) = lower(coalesce(auth.email(), '')) and active;
$$;

revoke all on function public.my_affiliate() from public, anon;
revoke all on function public.set_my_affiliate_pix(text) from public, anon;
grant execute on function public.my_affiliate(), public.set_my_affiliate_pix(text) to authenticated;

-- Pitwall · aplica um aviso (webhook) do Asaas: registra o pagamento, estende a assinatura e cria a chave.
-- Só o service role (função de borda "payments-webhook") chama. É idempotente: o mesmo aviso não conta duas vezes.

create or replace function public.apply_asaas_event(p_event_id text, p_event text, p_payload jsonb, p_customer jsonb default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ev_id uuid; done timestamptz;
  pay jsonb := p_payload -> 'payment';
  sub jsonb := p_payload -> 'subscription';
  sub_ref text; ext text; s public.subscriptions; v_plan text; v_period text;
  new_status text; old_status text; value_cents int; per text; mail text;
  pid uuid;
begin
  insert into public.webhook_events (provider, event_id, event_type, payload)
  values ('asaas', p_event_id, p_event, p_payload)
  on conflict (provider, event_id) do nothing returning id into ev_id;
  if ev_id is null then
    select id, processed_at into ev_id, done from public.webhook_events where provider = 'asaas' and event_id = p_event_id;
    if done is not null then return 'duplicate'; end if;
  end if;

  sub_ref := coalesce(pay ->> 'subscription', sub ->> 'id');
  ext := coalesce(pay ->> 'externalReference', sub ->> 'externalReference');

  -- acha a assinatura (pelo id do Asaas ou pela nossa referência)
  select * into s from public.subscriptions where provider = 'asaas' and provider_subscription_id = sub_ref and sub_ref is not null;
  if s.id is null and ext ~* '^[0-9a-f-]{36}$' then
    select * into s from public.subscriptions where id = ext::uuid;
  end if;

  -- não conhecemos: precisa dos dados do cliente (a função de borda busca no Asaas e chama de novo)
  if s.id is null then
    if p_customer is null then return 'needs_customer'; end if;
    mail := lower(trim(p_customer ->> 'email'));
    if mail is null or mail = '' then
      update public.webhook_events set error = 'cliente sem e-mail', processed_at = now() where id = ev_id;
      return 'error';
    end if;
    value_cents := round(coalesce((coalesce(pay, sub) ->> 'value')::numeric, 0) * 100);
    select plan_code, period into v_plan, v_period from public.prices where amount_cents = value_cents order by (period = 'month') desc, created_at limit 1;
    insert into public.subscriptions (email, name, doc, plan_code, period, provider, provider_customer_id, provider_subscription_id, status)
    values (mail, p_customer ->> 'name', regexp_replace(coalesce(p_customer ->> 'cpfCnpj', ''), '\D', '', 'g'),
            coalesce(v_plan, 'pro'), coalesce(v_period, 'month'), 'asaas', coalesce(pay ->> 'customer', sub ->> 'customer'), sub_ref, 'pending')
    returning * into s;
  end if;

  -- completa os dados da assinatura
  update public.subscriptions set
    provider_subscription_id = coalesce(provider_subscription_id, sub_ref),
    provider_customer_id = coalesce(provider_customer_id, pay ->> 'customer', sub ->> 'customer'),
    name = coalesce(name, p_customer ->> 'name'),
    doc = coalesce(nullif(doc, ''), nullif(regexp_replace(coalesce(p_customer ->> 'cpfCnpj', ''), '\D', '', 'g'), '')),
    updated_at = now()
  where id = s.id returning * into s;

  if p_event like 'SUBSCRIPTION_%' then
    if p_event in ('SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED') then
      update public.subscriptions set cancel_at_period_end = true, updated_at = now() where id = s.id;   -- segue valendo até o fim do que já foi pago
    end if;
    update public.webhook_events set processed_at = now() where id = ev_id;
    return 'ok';
  end if;

  select status into old_status from public.payments where provider = 'asaas' and provider_payment_id = pay ->> 'id';
  new_status := case
    when p_event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') then 'paid'
    when p_event = 'PAYMENT_OVERDUE' then 'overdue'
    when p_event in ('PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED') then 'refunded'
    -- reembolso parcial: se devolveu metade ou mais do valor, conta como reembolso (o Asaas só devolve o que há de saldo)
    when p_event = 'PAYMENT_PARTIALLY_REFUNDED' then
      case when coalesce((select sum((r ->> 'value')::numeric) from jsonb_array_elements(coalesce(pay -> 'refunds', '[]'::jsonb)) r
                           where r ->> 'status' in ('DONE', 'PENDING')), 0) >= 0.5 * coalesce((pay ->> 'value')::numeric, 0)
           then 'refunded' else coalesce(old_status, 'pending') end
    when p_event = 'PAYMENT_DELETED' then 'failed'
    else 'pending' end;

  insert into public.payments (subscription_id, email, provider, provider_payment_id, amount_cents, status, method, due_date, paid_at, invoice_url, raw)
  values (s.id, s.email, 'asaas', pay ->> 'id', round(coalesce((pay ->> 'value')::numeric, 0) * 100), new_status,
          pay ->> 'billingType', nullif(pay ->> 'dueDate', '')::date,
          case when new_status = 'paid' then coalesce(nullif(pay ->> 'paymentDate', '')::timestamptz, now()) end,
          pay ->> 'invoiceUrl', p_payload)
  on conflict (provider, provider_payment_id) where provider_payment_id is not null do update set
    status = case when public.payments.status in ('paid', 'refunded') and excluded.status in ('pending', 'overdue', 'failed') then public.payments.status else excluded.status end,
    method = coalesce(excluded.method, public.payments.method),
    paid_at = coalesce(public.payments.paid_at, excluded.paid_at),
    invoice_url = coalesce(excluded.invoice_url, public.payments.invoice_url),
    raw = excluded.raw;

  if new_status = 'paid' and coalesce(old_status, '') <> 'paid' then
    update public.subscriptions set
      status = 'active',
      current_period_end = greatest(coalesce(current_period_end, now()), now())
                           + case period when 'year' then interval '1 year' else interval '1 month' end,
      updated_at = now()
    where id = s.id;
    perform public.ensure_license(s.email);
  elsif new_status = 'overdue' and s.status = 'active' then
    update public.subscriptions set status = 'past_due', updated_at = now() where id = s.id;
  elsif new_status = 'refunded' and coalesce(old_status, '') = 'paid' then
    update public.subscriptions set status = 'canceled', current_period_end = least(coalesce(current_period_end, now()), now()), updated_at = now() where id = s.id;
  end if;

  -- comissão do afiliado (e cancelamento dela se houver reembolso)
  select id into pid from public.payments where provider = 'asaas' and provider_payment_id = pay ->> 'id';
  if new_status = 'paid' and coalesce(old_status, '') <> 'paid' and s.affiliate_id is not null then
    select * into aff from public.affiliates where id = s.affiliate_id;
    if aff.id is not null and aff.active and (aff.email is null or lower(aff.email) <> lower(s.email))
       and (aff.commission_mode = 'recurring' or not exists (select 1 from public.commissions where subscription_id = s.id)) then
      paid_cents := round(coalesce((pay ->> 'value')::numeric, 0) * 100);
      insert into public.commissions (affiliate_id, subscription_id, payment_id, base_cents, pct, amount_cents)
      values (aff.id, s.id, pid, paid_cents, aff.commission_pct, round(paid_cents * aff.commission_pct / 100.0))
      on conflict (payment_id) do nothing;
    end if;
  elsif new_status = 'refunded' and coalesce(old_status, '') = 'paid' then
    update public.commissions set status = 'canceled', note = coalesce(note || ' · ', '') || 'reembolso' where payment_id = pid and status = 'pending';
    update public.commissions set note = coalesce(note || ' · ', '') || 'reembolso depois de paga a comissão' where payment_id = pid and status = 'paid';
  end if;

  update public.webhook_events set processed_at = now() where id = ev_id;
  return 'ok';
end $$;

revoke all on function public.apply_asaas_event(text, text, jsonb, jsonb) from public, anon, authenticated;

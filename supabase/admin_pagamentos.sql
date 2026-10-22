-- Pitwall · admin apaga/estorna pagamento (já aplicado). "Apagar" esconde a linha (hidden_at) em vez de excluir,
-- porque o webhook do Asaas (PAYMENT_DELETED) reinseriria a cobrança como 'failed'. A função de borda admin-payments
-- chama o Asaas (DELETE /payments/{id} ou POST /payments/{id}/refund) e depois estas RPCs.
alter table public.payments add column if not exists hidden_at timestamptz;
-- admin_overview passou a listar só payments com hidden_at is null; a policy de leitura do cliente também esconde as apagadas.
-- RPCs: admin_hide_payment(p_id, p_action), admin_mark_payment(p_id, p_status) (só admin, registram no admin_log).

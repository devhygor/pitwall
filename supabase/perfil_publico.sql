-- Pitwall · perfil público (já aplicado). profiles ganha bio, lfm (resumo do LFM publicado pelo app) e lfm_at.
-- Bucket público 'avatars' (pasta = id do usuário). RPCs: plan_tiers(uuid[]) (selo Pro/Equipe; teste grátis não conta),
-- public_profile(uuid) (dados + estatísticas + recordes por carro/pista), set_my_profile(nome, bio), set_my_lfm(jsonb).
-- O app publica o LFM sozinho (pitwall/server.py _publish_lfm, no máx. a cada 30 min) e o site mostra em #/perfil/<id>.

-- Progresso no perfil (já aplicado): profiles.show_progress (padrão true), tabela progress_sessions (uma linha por sessão e combinação:
-- data, melhor, média das limpas, nº de voltas, rating/ritmo/consistência/limpeza; sem telemetria), RLS: o dono ou todos se show_progress,
-- RPCs upsert_progress(jsonb) e set_my_progress_visibility(bool). public_profile devolve progress_hidden e show_progress.
-- O app envia o resumo no ciclo de sincronização (Team.upload_progress) e só quando algo mudou.

-- =============================================================================
-- Migration v7 - Indices das queries de leitura mais quentes
-- Aplicar apos migration-v6-launch-tickets.sql.
--
-- Estas tabelas so tinham chave primaria e as chaves implicitas das foreign
-- keys. Com poucas linhas isso nao aparece; com o servidor rodando de verdade,
-- toda leitura vira varredura de tabela inteira.
--
-- As tabelas de governanca e barracas ja vieram bem indexadas nas migrations
-- v3/v4 — o buraco esta nas tabelas mais antigas (schema.sql) e nas que o
-- painel web consulta.
--
-- Todos os indices sao aditivos: nenhuma coluna, tipo ou constraint muda, e
-- rodar duas vezes e inofensivo (IF NOT EXISTS).
-- =============================================================================
USE `skymp_rp`;

-- ── audit_logs ───────────────────────────────────────────────────────────────
-- Consultada por `GET /api/audit` (ORDER BY created_at DESC LIMIT 200) e pelo
-- dashboard. E a tabela que mais cresce no projeto: toda acao de staff, toda
-- morte, todo inicio de combate e toda aprovacao de whitelist escrevem aqui.
ALTER TABLE `audit_logs`
  ADD INDEX IF NOT EXISTS `idx_audit_created` (`created_at`),
  ADD INDEX IF NOT EXISTS `idx_audit_action_created` (`action`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_audit_target` (`target_account_id`, `created_at`);

-- ── character_inventory ──────────────────────────────────────────────────────
-- Lida no spawn de todo jogador (inventory-service.syncInventoryToClient) e em
-- toda transacao de item. O indice unico em (character_id, base_id) tambem
-- protege contra duas linhas para o mesmo item no mesmo personagem, que e o
-- estado que o `FOR UPDATE` do transaction-service assume nao existir.
ALTER TABLE `character_inventory`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_char_inventory_item` (`character_id`, `base_id`);

-- ── characters ───────────────────────────────────────────────────────────────
-- `whitelist.js` roda esta query em todo login:
--   SELECT * FROM characters WHERE account_id = ? AND status = 'approved'
--   ORDER BY id DESC LIMIT 1
ALTER TABLE `characters`
  ADD INDEX IF NOT EXISTS `idx_characters_account_status` (`account_id`, `status`);

-- ── whitelist_applications ───────────────────────────────────────────────────
-- Consultada no login (checagem de aprovacao) e no painel (fila de revisao,
-- ordenada por pendentes primeiro).
ALTER TABLE `whitelist_applications`
  ADD INDEX IF NOT EXISTS `idx_whitelist_account_status` (`account_id`, `status`),
  ADD INDEX IF NOT EXISTS `idx_whitelist_status_created` (`status`, `created_at`);

-- ── discord_identities ───────────────────────────────────────────────────────
-- A PK e `discord_id`, mas quase todo JOIN do painel entra por `account_id`.
ALTER TABLE `discord_identities`
  ADD INDEX IF NOT EXISTS `idx_discord_account` (`account_id`);

-- ── criminal_records / prison_records ────────────────────────────────────────
-- Ambas consultadas por status no painel de staff e pela governanca.
ALTER TABLE `criminal_records`
  ADD INDEX IF NOT EXISTS `idx_criminal_resolved_created` (`resolved`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_criminal_character` (`character_id`, `resolved`);

ALTER TABLE `prison_records`
  ADD INDEX IF NOT EXISTS `idx_prison_status_arrested` (`status`, `arrested_at`),
  ADD INDEX IF NOT EXISTS `idx_prison_character_status` (`character_id`, `status`);

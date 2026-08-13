-- =============================================================================
-- Migration v14 - Inventory Framework: dono genérico no ledger
--
-- Aplicar depois de migration-v13-market-stall-idempotency.sql.
--
-- Motivação: docs/research/INVENTORY_TRADE_CRAFTING_AUDIT.md §2 e §8.
--
-- O ledger `inventory_transactions` só sabia falar de personagem
-- (`character_id INT NOT NULL` com FK). Item que ia para container, barraca ou
-- receita gravava só a perna do personagem — a outra ponta não tinha como ser
-- nomeada, e a soma dos deltas do servidor não batia com nada.
--
-- Esta migração NÃO move dado de inventário. `character_inventory` e
-- `container_inventory` continuam onde estão, com a mesma forma. O que muda é
-- (a) o ledger passa a nomear os dois lados de cada movimento e (b) as duas
-- tabelas de estoque ganham a chave única que declara o invariante que o
-- código já assumia.
--
-- ⚠️ `MODIFY COLUMN` não é reconhecido por scripts/check-schema-drift.js — ele
-- entende CREATE TABLE, ADD COLUMN, ADD INDEX e CREATE INDEX. A mudança de
-- nulabilidade de `character_id` abaixo NÃO aparece como drift se alguém
-- esquecer de aplicar esta migração; o sintoma será um INSERT de ledger com
-- `character_id = NULL` falhando em runtime. Conferir à mão:
--     SHOW COLUMNS FROM inventory_transactions LIKE 'character_id';
-- =============================================================================
USE `skymp_rp`;

-- -----------------------------------------------------------------------------
-- 1. Consolida duplicatas antes de declarar a chave única
--
-- ⚠️ Só `container_inventory`. `character_inventory` **já tem** a chave única
-- `uq_char_inventory_item` (`character_id`, `base_id`) desde a
-- migration-v7-indexes.sql, com o comentário certo pelo motivo certo: ela
-- "protege contra duas linhas para o mesmo item no mesmo personagem, que e o
-- estado que o `FOR UPDATE` do transaction-service assume nao existir".
--
-- O baú ficou de fora daquela rodada porque `container_inventory` não tinha
-- caminho de escrita ativo — e continua não tendo, mas passou a ter API.
--
-- Se o invariante sempre valeu, este bloco não toca em nada. Se alguma linha
-- duplicada existir (import manual, escrita por fora do transaction-service), a
-- consolidação SOMA as contagens em vez de escolher uma — perder estoque de
-- jogador numa migração é pior que a duplicata que estamos consertando.
-- -----------------------------------------------------------------------------
CREATE TEMPORARY TABLE `_coi_dupes` AS
  SELECT MIN(`id`) AS `keep_id`, `container_id`, `base_id`, SUM(`count`) AS `total`
    FROM `container_inventory`
   GROUP BY `container_id`, `base_id`
  HAVING COUNT(*) > 1;

UPDATE `container_inventory` coi
  JOIN `_coi_dupes` d ON coi.`id` = d.`keep_id`
   SET coi.`count` = d.`total`;

DELETE coi FROM `container_inventory` coi
  JOIN `_coi_dupes` d
    ON d.`container_id` = coi.`container_id`
   AND d.`base_id` = coi.`base_id`
   AND coi.`id` <> d.`keep_id`;

DROP TEMPORARY TABLE `_coi_dupes`;

-- -----------------------------------------------------------------------------
-- 2. O invariante vira regra do banco — para o baú também
--
-- Auditoria §8: com a UNIQUE, uma segunda linha para o mesmo (dono, item) é um
-- erro de INSERT em vez de estoque invisível — `applyStackDelta` leria
-- `rows[0]` e ignoraria o resto.
-- -----------------------------------------------------------------------------
ALTER TABLE `container_inventory`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_container_inventory_owner_item` (`container_id`, `base_id`);

-- -----------------------------------------------------------------------------
-- 3. O ledger passa a nomear os dois lados
--
-- `owner_type` / `owner_ref` : de quem é esta perna do movimento.
-- `counterparty_*`           : para onde foi (ou de onde veio) a outra perna.
-- `transfer_id`              : as duas pernas de uma transferência compartilham
--                              este UUID. É o que permite reconstruir "este item
--                              saiu de X e entrou em Y" com uma query só.
--
-- `character_id` continua preenchido quando o dono é personagem — nenhuma query
-- existente muda de comportamento, e `idx_inv_tx_char_date` continua servindo o
-- extrato do jogador. Ele fica NULL quando o dono é container, barraca ou o
-- sistema, que é a razão de a coluna deixar de ser NOT NULL.
-- -----------------------------------------------------------------------------
ALTER TABLE `inventory_transactions`
  MODIFY COLUMN `character_id` INT NULL
    COMMENT 'Preenchido quando owner_type = character; NULL para os demais donos';

ALTER TABLE `inventory_transactions`
  ADD COLUMN IF NOT EXISTS `owner_type` VARCHAR(16) NOT NULL DEFAULT 'character'
    COMMENT 'character, container, property, faction, corpse, market, system'
    AFTER `character_id`,
  ADD COLUMN IF NOT EXISTS `owner_ref` VARCHAR(64) NOT NULL DEFAULT '0'
    COMMENT 'Identificador do dono dentro do tipo (ex: characters.id, containers.id)'
    AFTER `owner_type`,
  ADD COLUMN IF NOT EXISTS `counterparty_type` VARCHAR(16) DEFAULT NULL
    COMMENT 'Tipo do dono do outro lado da transferencia'
    AFTER `owner_ref`,
  ADD COLUMN IF NOT EXISTS `counterparty_ref` VARCHAR(64) DEFAULT NULL
    COMMENT 'Identificador do dono do outro lado'
    AFTER `counterparty_type`,
  ADD COLUMN IF NOT EXISTS `transfer_id` CHAR(36) DEFAULT NULL
    COMMENT 'UUID compartilhado pelas duas pernas da mesma transferencia'
    AFTER `counterparty_ref`,
  ADD INDEX IF NOT EXISTS `idx_inv_tx_owner_date` (`owner_type`, `owner_ref`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_inv_tx_transfer` (`transfer_id`);

-- -----------------------------------------------------------------------------
-- 4. Backfill dos movimentos já gravados
--
-- Tudo que existe hoje foi gravado por um caminho que só sabia falar de
-- personagem, então `owner_type = 'character'` e `owner_ref = character_id` é a
-- leitura correta do passado — não uma suposição. `counterparty_*` fica NULL de
-- propósito: aquela informação nunca foi registrada, e inventá-la agora seria
-- pior que a ausência.
-- -----------------------------------------------------------------------------
UPDATE `inventory_transactions`
   SET `owner_ref` = CAST(`character_id` AS CHAR)
 WHERE `owner_type` = 'character'
   AND `owner_ref` = '0'
   AND `character_id` IS NOT NULL;

-- =============================================================================
-- FIM DA MIGRATION v14
-- =============================================================================

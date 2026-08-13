-- =============================================================================
-- Migration v15 - Economy Framework: contraparte no ledger de ouro, escrow,
--                 contratos e dívida
--
-- Aplicar depois de migration-v14-inventory-framework.sql.
--
-- Decisão: docs/technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md
-- Evidência: docs/research/ECONOMY_FRAMEWORK_AUDIT.md
--
-- O que esta migration faz, em uma frase: dá ao ledger de OURO exatamente o
-- desenho que a v14 deu ao ledger de ITEM, e cria as três tabelas que escrow,
-- contrato e dívida precisam para existir.
--
-- O que ela NÃO faz: não move saldo, não cria tabela `accounts` com `balance`,
-- não toca em `characters.gold` nem nas colunas `treasury`. Conta continua
-- sendo uma REFERÊNCIA `(owner_type, owner_ref)` que o `core/economy-service.js`
-- resolve — ver ADR 004 §2.1 e a alternativa rejeitada §4.1.
--
-- ⚠️ `MODIFY COLUMN` não é reconhecido por scripts/check-schema-drift.js (o
-- mesmo aviso da v14). A mudança de nulabilidade de `gold_transactions.
-- character_id` abaixo NÃO aparece como drift se alguém esquecer de aplicar
-- esta migração; o sintoma será um INSERT de ledger de tesouro falhando em
-- runtime com "Column 'character_id' cannot be null". Conferir à mão:
--     SHOW COLUMNS FROM gold_transactions LIKE 'character_id';
--
-- ⚠️ Segunda armadilha do mesmo checador, descoberta ao escrever esta migration:
-- ele delimita o corpo de um `ALTER TABLE` no PRIMEIRO `;` do texto, sem saber
-- que strings existem. Um `;` dentro de um `COMMENT '...'` corta o resto da
-- instrucao, e as clausulas `ADD INDEX` que vierem depois somem da declaracao
-- esperada — silenciosamente, porque o comando continua saindo com codigo 0.
-- Por isso nenhum COMMENT deste arquivo usa ponto e virgula. Se voce acrescentar
-- um e os indices sumirem do `npm run check:schema:list`, a causa e essa.
-- =============================================================================
USE `skymp_rp`;

-- -----------------------------------------------------------------------------
-- 1. O ledger de ouro passa a nomear os dois lados
--
-- Achado 1 da auditoria: uma compra de barraca grava `-100` no comprador e
-- `+95` no vendedor, e NADA liga as duas linhas. Reconstruir "quem pagou quem"
-- exigia adivinhar por `reason` + proximidade de `created_at`, ou percorrer o
-- prefixo da `idempotency_key`, que é convenção de string e não relação.
--
-- As colunas são as mesmas da v14, com os mesmos nomes e a mesma semântica, de
-- propósito: quem aprendeu a ler `inventory_transactions` já sabe ler esta.
--
-- `character_id` continua preenchido quando o titular é personagem — nenhuma
-- query existente muda de comportamento, e `idx_gold_tx_char_date` continua
-- servindo o extrato do jogador. Ele fica NULL quando o titular é cidade,
-- Hold, facção, escrow ou `system`.
-- -----------------------------------------------------------------------------
ALTER TABLE `gold_transactions`
  MODIFY COLUMN `character_id` INT NULL
    COMMENT 'Preenchido quando owner_type = character. NULL para os demais titulares';

ALTER TABLE `gold_transactions`
  ADD COLUMN IF NOT EXISTS `owner_type` VARCHAR(16) NOT NULL DEFAULT 'character'
    COMMENT 'character, city, hold, faction, realm, escrow, system'
    AFTER `character_id`,
  ADD COLUMN IF NOT EXISTS `owner_ref` VARCHAR(64) NOT NULL DEFAULT '0'
    COMMENT 'Identificador do titular dentro do tipo (characters.id, cities.id, escrow_id, rotulo do system)'
    AFTER `owner_type`,
  ADD COLUMN IF NOT EXISTS `counterparty_type` VARCHAR(16) DEFAULT NULL
    COMMENT 'Tipo do titular do outro lado da transferencia'
    AFTER `owner_ref`,
  ADD COLUMN IF NOT EXISTS `counterparty_ref` VARCHAR(64) DEFAULT NULL
    COMMENT 'Identificador do titular do outro lado'
    AFTER `counterparty_type`,
  ADD COLUMN IF NOT EXISTS `transfer_id` CHAR(36) DEFAULT NULL
    COMMENT 'UUID compartilhado pelas duas pernas da mesma transferencia',
  -- Quem PEDIU o movimento, que nem sempre e o titular: a guarda que multou, a
  -- staff que ajustou, o comprador que acionou a barraca do vendedor. Era o
  -- campo `actor` do briefing §5, e sem ele "quem mandou tirar esse ouro" so
  -- existe no `audit_logs`, que e outro banco de dados conceitual.
  ADD COLUMN IF NOT EXISTS `actor_character_id` INT DEFAULT NULL
    COMMENT 'Personagem que originou o movimento. NULL quando foi o servidor',
  ADD INDEX IF NOT EXISTS `idx_gold_tx_owner_date` (`owner_type`, `owner_ref`, `created_at`),
  ADD INDEX IF NOT EXISTS `idx_gold_tx_transfer` (`transfer_id`),
  ADD INDEX IF NOT EXISTS `idx_gold_tx_actor_date` (`actor_character_id`, `created_at`);

-- Backfill: tudo que existe hoje foi gravado por um caminho que só sabia falar
-- de personagem, então `owner_type = 'character'` e `owner_ref = character_id`
-- é leitura correta do passado, não suposição. `counterparty_*` fica NULL de
-- propósito: aquela informação nunca foi registrada, e inventá-la agora seria
-- pior que a ausência. Mesmo raciocínio da v14 §4.
UPDATE `gold_transactions`
   SET `owner_ref` = CAST(`character_id` AS CHAR)
 WHERE `owner_type` = 'character'
   AND `owner_ref` = '0'
   AND `character_id` IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Escrow — o titular que faltava
--
-- Achado 11: ouro só sabia existir em personagem ou em tesouro, e nenhum dos
-- dois pode SEGURAR valor de terceiro. Sem isso, "recompensa travada na
-- criação do contrato" (briefing §8) não tem onde morar.
--
-- Escrow é genérico de propósito e nasce antes de contrato: caução de aluguel,
-- leilão e aposta precisam do mesmo mecanismo. Amarrá-lo ao contrato seria
-- repetir o Achado 2 com outro nome (ADR 004 §4.3).
--
-- `balance` é o que ainda está travado. Ele vai a zero quando o escrow é
-- liberado ou devolvido, e a soma dos deltas de `gold_transactions` para
-- (`escrow`, escrow_id) tem que bater com ele.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `economy_escrow` (
  `escrow_id` CHAR(36) NOT NULL PRIMARY KEY COMMENT 'UUID v4. E o owner_ref quando owner_type = escrow',
  `purpose` VARCHAR(32) NOT NULL COMMENT 'contract, auction, rent_deposit, wager',
  `funder_type` VARCHAR(16) NOT NULL COMMENT 'Quem depositou (normalmente character)',
  `funder_ref` VARCHAR(64) NOT NULL,
  `balance` INT NOT NULL DEFAULT 0 COMMENT 'Septims ainda travados. Nunca negativo.',
  `status` VARCHAR(16) NOT NULL DEFAULT 'held' COMMENT 'held, released, refunded',
  `idempotency_key` VARCHAR(128) DEFAULT NULL COMMENT 'Chave da criacao. Impede escrow duplicado no mesmo pedido',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_economy_escrow_idempotency` (`idempotency_key`),
  KEY `idx_economy_escrow_funder` (`funder_type`, `funder_ref`, `status`),
  KEY `idx_economy_escrow_status` (`status`, `created_at`),
  CONSTRAINT `ck_economy_escrow_balance` CHECK (`balance` >= 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 3. Contratos
--
-- Máquina de sete estados. `open` só existe com escrow financiado — o valor
-- trava no POST, não na entrega (ADR 004 §2.7). Uma falha na criação produz
-- SEM CONTRATO, nunca contrato impagável.
--
-- A FK do escrow é RESTRICT: apagar um escrow com contrato apontando para ele
-- é o caminho que vaza saldo travado.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `contracts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `creator_character_id` INT NOT NULL,
  `accepted_by_character_id` INT DEFAULT NULL,
  `title` VARCHAR(96) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `category` VARCHAR(32) NOT NULL DEFAULT 'generic'
    COMMENT 'mercenary, caravan, delivery, bodyguard, crafting, mining, harvest, hunt, arcane, investigation, generic',
  `reward` INT NOT NULL COMMENT 'Septims travados no escrow na criacao',
  `escrow_id` CHAR(36) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'open'
    COMMENT 'open, accepted, delivered, settled, cancelled, expired, disputed',
  `review_until` TIMESTAMP NULL DEFAULT NULL COMMENT 'Fim da janela de revisao apos delivered; settle automatico depois',
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `accepted_at` TIMESTAMP NULL DEFAULT NULL,
  `delivered_at` TIMESTAMP NULL DEFAULT NULL,
  `closed_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'settled, cancelled ou expired',
  UNIQUE KEY `uq_contracts_escrow` (`escrow_id`),
  KEY `idx_contracts_status_created` (`status`, `created_at`),
  KEY `idx_contracts_creator` (`creator_character_id`, `status`),
  KEY `idx_contracts_worker` (`accepted_by_character_id`, `status`),
  KEY `idx_contracts_expiry_sweep` (`status`, `expires_at`),
  CONSTRAINT `fk_contract_creator` FOREIGN KEY (`creator_character_id`) REFERENCES `characters` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_contract_worker` FOREIGN KEY (`accepted_by_character_id`) REFERENCES `characters` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_contract_escrow` FOREIGN KEY (`escrow_id`) REFERENCES `economy_escrow` (`escrow_id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_contracts_reward` CHECK (`reward` > 0)
) ENGINE=InnoDB;

-- Transições, append-only. Nunca se apaga linha daqui; um contrato que voltou
-- de estado (não acontece hoje) apareceria como duas linhas, não como correção.
CREATE TABLE IF NOT EXISTS `contract_events` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `contract_id` INT NOT NULL,
  `from_status` VARCHAR(16) DEFAULT NULL COMMENT 'NULL quando e a criacao do contrato',
  `to_status` VARCHAR(16) NOT NULL,
  `actor_character_id` INT DEFAULT NULL COMMENT 'NULL quando quem agiu foi a varredura do servidor, nao um jogador',
  `reason` VARCHAR(255) DEFAULT NULL,
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_contract_events_idempotency` (`idempotency_key`),
  KEY `idx_contract_events_contract` (`contract_id`, `created_at`),
  CONSTRAINT `fk_contract_event_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contract_event_actor` FOREIGN KEY (`actor_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 4. Dívida
--
-- Registro selado e legível, NUNCA dedução automática (ADR 004 §4.4). O
-- servidor não vira agiota: cobrar é papel de jogador, e é isso que transforma
-- inadimplência em material de RP em vez de trabalho de moderação.
--
-- `creditor_type`/`creditor_ref` usam o mesmo vocabulário de titular do ledger,
-- porque credor pode ser personagem, cidade (multa), facção (guilda) ou Hold.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `debts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `debtor_character_id` INT NOT NULL,
  `creditor_type` VARCHAR(16) NOT NULL COMMENT 'character, city, hold, faction, realm',
  `creditor_ref` VARCHAR(64) NOT NULL,
  `principal` INT NOT NULL COMMENT 'Valor original. Nunca muda.',
  `remaining` INT NOT NULL COMMENT 'Saldo devedor. Amortizado por debt_payments.',
  `reason` VARCHAR(255) NOT NULL,
  `origin_type` VARCHAR(32) NOT NULL DEFAULT 'manual' COMMENT 'fine, contract, rent, tax, manual',
  `origin_ref` VARCHAR(64) DEFAULT NULL COMMENT 'fines.id, contracts.id, ...',
  `status` VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active, paid, defaulted, forgiven',
  `idempotency_key` VARCHAR(128) DEFAULT NULL COMMENT 'Impede que o mesmo evento origine duas dividas',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `closed_at` TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY `uq_debts_idempotency` (`idempotency_key`),
  KEY `idx_debts_debtor_status` (`debtor_character_id`, `status`),
  KEY `idx_debts_creditor_status` (`creditor_type`, `creditor_ref`, `status`),
  KEY `idx_debts_origin` (`origin_type`, `origin_ref`),
  CONSTRAINT `fk_debt_debtor` FOREIGN KEY (`debtor_character_id`) REFERENCES `characters` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_debts_principal` CHECK (`principal` > 0),
  CONSTRAINT `ck_debts_remaining` CHECK (`remaining` >= 0 AND `remaining` <= `principal`)
) ENGINE=InnoDB;

-- Amortização. `transfer_id` amarra o pagamento às duas pernas no ledger de
-- ouro — é o que permite provar que a dívida caiu porque septim mudou de dono,
-- e não porque alguém editou `remaining`.
CREATE TABLE IF NOT EXISTS `debt_payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `debt_id` INT NOT NULL,
  `amount` INT NOT NULL,
  `transfer_id` CHAR(36) DEFAULT NULL COMMENT 'NULL quando o abatimento foi perdao em vez de pagamento',
  `kind` VARCHAR(16) NOT NULL DEFAULT 'payment' COMMENT 'payment, forgiveness',
  `actor_character_id` INT DEFAULT NULL,
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_debt_payments_idempotency` (`idempotency_key`),
  KEY `idx_debt_payments_debt` (`debt_id`, `created_at`),
  KEY `idx_debt_payments_transfer` (`transfer_id`),
  CONSTRAINT `fk_debt_payment_debt` FOREIGN KEY (`debt_id`) REFERENCES `debts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_debt_payment_actor` FOREIGN KEY (`actor_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_debt_payments_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB;

-- =============================================================================
-- FIM DA MIGRATION v15
-- =============================================================================

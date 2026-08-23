-- v20 — Depot Service: armazenamento regional de itens
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Por que "regional" reaproveita `holds`, e não cria `regions`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `holds` já existe (`schema.sql`) com `id VARCHAR(32)` cobrindo exatamente as
-- cidades que este recurso precisa (whiterun, solitude, riften...). Um
-- `region_id` solto duplicaria um catálogo que já é autoridade em
-- `core/economy-service.js` (titular `hold`, treasury) e em `market_prices`.
-- `character_depots.hold_id` é FK para lá — não existe uma segunda lista de
-- "quais regiões existem" neste banco.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Por que NÃO existe coluna de ouro aqui
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O brief original pedia "ouro bancário global" no Depot. `characters.gold`
-- já é global por natureza (não existe conceito de "ouro na mão" vs "ouro no
-- banco" neste projeto — ver `core/economy-service.js`). Criar uma segunda
-- coluna de saldo aqui duplicaria a única fonte de verdade que
-- `ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md` existe para evitar. O Depot só
-- EXIBE o saldo existente; não guarda o próprio.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `depot_terminals` — por que é uma tabela separada de `character_depots`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `character_depots` é por (personagem, hold) — o armazém de alguém.
-- `depot_terminals` é por (objeto físico do mundo) — o baú que a staff coloca
-- numa cidade. Várias cidades podem ter baús diferentes (ou uma cidade pode
-- ter mais de um), mas todos os baús de Whiterun resolvem para o MESMO
-- `hold_id` = 'whiterun'. Sem essa tabela, o `DEPOT_CHEST` do Interaction
-- Framework não teria como traduzir "o jogador interagiu com ESTE
-- `MpObjectReference`" em "qual hold é esse".
--
-- ═══════════════════════════════════════════════════════════════════════════
-- COLLATE explicito nas tres tabelas (22/08/2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `holds.id` (schema.sql) nao declara COLLATE proprio: herda
-- `utf8mb4_unicode_ci` do `CREATE DATABASE ... COLLATE utf8mb4_unicode_ci`
-- (schema.sql linha 3). Mas `DEFAULT CHARSET=utf8mb4` SEM `COLLATE` explicito
-- numa CREATE TABLE nao herda o collate do banco — usa o collate PADRAO DO
-- SERVIDOR para aquele charset. Em instalacoes de MariaDB onde o default de
-- `utf8mb4` mudou (ex: `utf8mb4_uca1400_ai_ci` em versoes 10.10+/11.x, no
-- lugar do antigo `utf8mb4_general_ci`), `hold_id VARCHAR(32)` nascia com um
-- collate diferente do `holds.id` que ele referencia — e a FK falhava na
-- criacao da tabela. Migration nunca testada contra uma instalacao de MariaDB
-- com esse default; achado ajudando um fork externo a rodar isto pela
-- primeira vez.
-- ═══════════════════════════════════════════════════════════════════════════

USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `character_depots` (
  `id`             INT AUTO_INCREMENT PRIMARY KEY,
  `character_id`   INT NOT NULL,

  -- FK para `holds.id` — ver a nota acima. Sem catálogo próprio.
  `hold_id`        VARCHAR(32) NOT NULL,

  `capacity`       INT NOT NULL COMMENT 'Teto de itens somados neste deposito; ver server-options depot.defaultCapacity',
  `created_at`     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Um depósito por personagem por região — itens de Whiterun não têm como
  -- aparecer em Solitude porque são LINHAS diferentes, não um filtro.
  UNIQUE KEY `uk_depot_character_hold` (`character_id`, `hold_id`),

  CONSTRAINT `fk_depot_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_depot_hold`      FOREIGN KEY (`hold_id`)      REFERENCES `holds` (`id`)      ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `depot_inventory` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `depot_id`   INT NOT NULL,
  `base_id`    INT NOT NULL COMMENT 'FormID nativo do Skyrim (decimal)',
  `count`      INT NOT NULL DEFAULT 1,

  -- Pedido explícito do brief: `container_inventory`/`character_inventory`
  -- não têm essa UNIQUE (contam só com o `FOR UPDATE` de
  -- `transaction-service.tx.applyStackDelta` para não fragmentar). Aqui entra
  -- como defesa em profundidade a mais, sem mudar o comportamento das outras
  -- duas tabelas de pilha.
  UNIQUE KEY `uk_depot_inventory_item` (`depot_id`, `base_id`),

  CONSTRAINT `fk_depot_inventory_depot` FOREIGN KEY (`depot_id`) REFERENCES `character_depots` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `depot_terminals` (
  -- FormDesc do MpObjectReference no mundo — hex SEM prefixo `0x`, dois-pontos,
  -- nome do plugin (`"162e2:Skyrim.esm"`), mesmo formato de `containers.object_id`.
  `object_id`  VARCHAR(64) PRIMARY KEY,
  `hold_id`    VARCHAR(32) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT `fk_depot_terminal_hold` FOREIGN KEY (`hold_id`) REFERENCES `holds` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `character_depots`
  ADD INDEX IF NOT EXISTS `idx_depot_character` (`character_id`),
  ADD INDEX IF NOT EXISTS `idx_depot_hold`      (`hold_id`);

ALTER TABLE `depot_inventory`
  ADD INDEX IF NOT EXISTS `idx_depot_inventory_depot` (`depot_id`);

ALTER TABLE `depot_terminals`
  ADD INDEX IF NOT EXISTS `idx_depot_terminal_hold` (`hold_id`);

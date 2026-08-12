-- =============================================================================
-- v11 - Ledger de transferencias entre tesouros institucionais
-- =============================================================================
-- Ouro de Hold e de faccao nao passa por gold_transactions, que representa
-- patrimonio de personagem. Esta tabela e gravada na mesma transacao do debito
-- e credito, e idempotency_key impede replay de uma requisicao de UI.

USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `institutional_treasury_transactions` (
  `transfer_id` CHAR(36) NOT NULL PRIMARY KEY,
  `idempotency_key` VARCHAR(64) NOT NULL,
  `actor_character_id` INT NOT NULL,
  `hold_id` VARCHAR(32) NOT NULL,
  `faction_id` INT NOT NULL,
  `amount` INT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_institutional_treasury_idempotency` (`idempotency_key`),
  KEY `idx_institutional_treasury_hold_date` (`hold_id`, `created_at`),
  KEY `idx_institutional_treasury_faction_date` (`faction_id`, `created_at`),
  CONSTRAINT `fk_institutional_treasury_actor`
    FOREIGN KEY (`actor_character_id`) REFERENCES `characters` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_institutional_treasury_hold`
    FOREIGN KEY (`hold_id`) REFERENCES `holds` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_institutional_treasury_faction`
    FOREIGN KEY (`faction_id`) REFERENCES `factions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

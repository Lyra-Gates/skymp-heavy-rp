-- v12 - Operacoes atomicas do mercado regional NPC
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `regional_market_transactions` (
  `transaction_id` CHAR(36) NOT NULL PRIMARY KEY,
  `idempotency_key` VARCHAR(64) NOT NULL,
  `actor_character_id` INT NOT NULL,
  `hold_id` VARCHAR(32) NOT NULL,
  `direction` ENUM('buy', 'sell') NOT NULL,
  `base_id` INT NOT NULL,
  `count` INT NOT NULL,
  `unit_price` INT NOT NULL,
  `gross_amount` INT NOT NULL,
  `tax_amount` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_regional_market_idempotency` (`idempotency_key`),
  KEY `idx_regional_market_hold_date` (`hold_id`, `created_at`),
  KEY `idx_regional_market_character_date` (`actor_character_id`, `created_at`),
  CONSTRAINT `fk_regional_market_character` FOREIGN KEY (`actor_character_id`) REFERENCES `characters` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_regional_market_hold` FOREIGN KEY (`hold_id`) REFERENCES `holds` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

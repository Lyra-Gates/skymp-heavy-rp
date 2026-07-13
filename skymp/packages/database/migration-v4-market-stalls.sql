-- =============================================================================
-- Migration v4 - Barraquinhas de venda de jogadores
-- Aplicar apos migration-v3-governance.sql.
-- =============================================================================
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `market_stalls` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `owner_character_id` INT NOT NULL,
  `city_id` VARCHAR(64) DEFAULT NULL,
  `realm_id` VARCHAR(64) DEFAULT NULL,
  `name` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active, packed, suspended, confiscated, expired',
  `pos_x` FLOAT NOT NULL,
  `pos_y` FLOAT NOT NULL,
  `pos_z` FLOAT NOT NULL,
  `cell_id` VARCHAR(96) NOT NULL,
  `heading` FLOAT NOT NULL DEFAULT 0,
  `visual_ref_id` INT DEFAULT NULL COMMENT 'MpObjectReference criado para representar a barraca no mundo',
  `tax_rate` FLOAT NOT NULL DEFAULT 0.05,
  `rent_paid_until` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_market_stalls_owner_status` (`owner_character_id`, `status`),
  INDEX `idx_market_stalls_city_status` (`city_id`, `status`),
  INDEX `idx_market_stalls_cell` (`cell_id`),
  CONSTRAINT `fk_stall_owner` FOREIGN KEY (`owner_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stall_city` FOREIGN KEY (`city_id`) REFERENCES `cities` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_stall_realm` FOREIGN KEY (`realm_id`) REFERENCES `realms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE `market_stalls`
  ADD COLUMN IF NOT EXISTS `visual_ref_id` INT DEFAULT NULL
    COMMENT 'MpObjectReference criado para representar a barraca no mundo'
    AFTER `heading`;

CREATE TABLE IF NOT EXISTS `market_stall_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `stall_id` INT NOT NULL,
  `base_id` INT NOT NULL,
  `count` INT NOT NULL DEFAULT 1,
  `price` INT NOT NULL,
  `label` VARCHAR(128) DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'listed' COMMENT 'listed, sold, removed, confiscated',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_stall_items_stall_status` (`stall_id`, `status`),
  CONSTRAINT `fk_stall_item_stall` FOREIGN KEY (`stall_id`) REFERENCES `market_stalls` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `market_stall_sales` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `stall_id` INT NOT NULL,
  `seller_character_id` INT NOT NULL,
  `buyer_character_id` INT NOT NULL,
  `base_id` INT NOT NULL,
  `count` INT NOT NULL,
  `unit_price` INT NOT NULL,
  `tax_amount` INT NOT NULL DEFAULT 0,
  `city_id` VARCHAR(64) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_stall_sales_stall` (`stall_id`, `created_at`),
  CONSTRAINT `fk_stall_sale_stall` FOREIGN KEY (`stall_id`) REFERENCES `market_stalls` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stall_sale_seller` FOREIGN KEY (`seller_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stall_sale_buyer` FOREIGN KEY (`buyer_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stall_sale_city` FOREIGN KEY (`city_id`) REFERENCES `cities` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `market_stall_licenses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `city_id` VARCHAR(64) NOT NULL,
  `license_type` VARCHAR(64) NOT NULL DEFAULT 'street_vendor',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active, suspended, revoked, expired',
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `issued_by_character_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_stall_license_char_city` (`character_id`, `city_id`, `status`),
  CONSTRAINT `fk_stall_license_char` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stall_license_city` FOREIGN KEY (`city_id`) REFERENCES `cities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stall_license_issuer` FOREIGN KEY (`issued_by_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `market_stall_audit` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `stall_id` INT DEFAULT NULL,
  `actor_character_id` INT DEFAULT NULL,
  `action` VARCHAR(96) NOT NULL,
  `details` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_stall_audit_stall` (`stall_id`, `created_at`),
  CONSTRAINT `fk_stall_audit_stall` FOREIGN KEY (`stall_id`) REFERENCES `market_stalls` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_stall_audit_actor` FOREIGN KEY (`actor_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =============================================================================
-- Colunas de posicao na tabela cities (para lookup espacial de barracas)
-- =============================================================================
ALTER TABLE `cities`
  ADD COLUMN IF NOT EXISTS `pos_x` FLOAT DEFAULT NULL COMMENT 'Centro X da cidade'
    AFTER `tax_rate`,
  ADD COLUMN IF NOT EXISTS `pos_y` FLOAT DEFAULT NULL COMMENT 'Centro Y da cidade'
    AFTER `pos_x`,
  ADD COLUMN IF NOT EXISTS `pos_z` FLOAT DEFAULT NULL COMMENT 'Centro Z da cidade'
    AFTER `pos_y`,
  ADD COLUMN IF NOT EXISTS `cell_id` VARCHAR(96) DEFAULT NULL COMMENT 'Cell/Worldspace da cidade'
    AFTER `pos_z`;

-- =============================================================================
-- FIM DA MIGRATION v4
-- =============================================================================

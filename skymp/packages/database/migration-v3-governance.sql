-- =============================================================================
-- Migration v3 - Governanca, faccoes IC, cidades, guarda e eventos
-- Aplicar apos schema.sql e migration-v2.sql.
-- =============================================================================
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `realms` (
  `id` VARCHAR(64) PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `ruler_character_id` INT DEFAULT NULL,
  `treasury` INT NOT NULL DEFAULT 0,
  `tax_rate` FLOAT NOT NULL DEFAULT 0.00,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_realm_ruler` FOREIGN KEY (`ruler_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `cities` (
  `id` VARCHAR(64) PRIMARY KEY,
  `realm_id` VARCHAR(64) DEFAULT NULL,
  `hold_id` VARCHAR(32) DEFAULT NULL,
  `name` VARCHAR(128) NOT NULL,
  `governor_character_id` INT DEFAULT NULL,
  `treasury` INT NOT NULL DEFAULT 0,
  `tax_rate` FLOAT NOT NULL DEFAULT 0.05,
  `alert_level` VARCHAR(32) NOT NULL DEFAULT 'normal',
  `prison_cell_id` VARCHAR(64) DEFAULT NULL,
  `prison_pos_x` FLOAT DEFAULT NULL,
  `prison_pos_y` FLOAT DEFAULT NULL,
  `prison_pos_z` FLOAT DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_city_realm` FOREIGN KEY (`realm_id`) REFERENCES `realms` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_city_hold` FOREIGN KEY (`hold_id`) REFERENCES `holds` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_city_governor` FOREIGN KEY (`governor_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `governance_roles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `scope_type` VARCHAR(16) NOT NULL COMMENT 'realm, city, faction',
  `scope_id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `label` VARCHAR(128) NOT NULL,
  `weight` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_gov_role_scope_name` (`scope_type`, `scope_id`, `name`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `governance_role_permissions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `role_id` INT NOT NULL,
  `permission` VARCHAR(64) NOT NULL,
  UNIQUE KEY `uk_gov_role_permission` (`role_id`, `permission`),
  CONSTRAINT `fk_gov_perm_role` FOREIGN KEY (`role_id`) REFERENCES `governance_roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `governance_memberships` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `scope_type` VARCHAR(16) NOT NULL COMMENT 'realm, city, faction',
  `scope_id` VARCHAR(64) NOT NULL,
  `role_id` INT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `on_duty` TINYINT(1) NOT NULL DEFAULT 0,
  `granted_by_character_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_gov_member_scope` (`character_id`, `scope_type`, `scope_id`),
  INDEX `idx_gov_members_scope` (`scope_type`, `scope_id`),
  CONSTRAINT `fk_gov_member_char` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gov_member_role` FOREIGN KEY (`role_id`) REFERENCES `governance_roles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_gov_member_grantor` FOREIGN KEY (`granted_by_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `guard_detentions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `target_character_id` INT NOT NULL,
  `officer_character_id` INT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'stopped' COMMENT 'stopped, detained, escorted, released',
  `reason` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `released_at` TIMESTAMP NULL DEFAULT NULL,
  INDEX `idx_guard_detention_target_status` (`target_character_id`, `status`),
  CONSTRAINT `fk_detention_target` FOREIGN KEY (`target_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_detention_officer` FOREIGN KEY (`officer_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `guard_searches` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `target_character_id` INT NOT NULL,
  `officer_character_id` INT NOT NULL,
  `reason` VARCHAR(255) DEFAULT NULL,
  `forced` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending, approved, denied',
  `result_snapshot` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `responded_at` TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT `fk_search_target` FOREIGN KEY (`target_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_search_officer` FOREIGN KEY (`officer_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `warrants` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `target_character_id` INT NOT NULL,
  `issued_by_character_id` INT DEFAULT NULL,
  `severity` VARCHAR(32) NOT NULL DEFAULT 'serious',
  `reason` VARCHAR(255) NOT NULL,
  `scope_type` VARCHAR(16) NOT NULL DEFAULT 'city',
  `scope_id` VARCHAR(64) NOT NULL DEFAULT 'global',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active, served, revoked, expired',
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_warrant_target_status` (`target_character_id`, `status`),
  CONSTRAINT `fk_warrant_target` FOREIGN KEY (`target_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_warrant_issuer` FOREIGN KEY (`issued_by_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `fines` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `target_character_id` INT NOT NULL,
  `officer_character_id` INT DEFAULT NULL,
  `amount` INT NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'unpaid',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `paid_at` TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT `fk_fine_target` FOREIGN KEY (`target_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fine_officer` FOREIGN KEY (`officer_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `confiscations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `target_character_id` INT NOT NULL,
  `officer_character_id` INT DEFAULT NULL,
  `base_id` INT NOT NULL,
  `count` INT NOT NULL DEFAULT 1,
  `reason` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'evidence',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_confiscation_target` FOREIGN KEY (`target_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_confiscation_officer` FOREIGN KEY (`officer_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `custody_records` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `target_character_id` INT NOT NULL,
  `officer_character_id` INT DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'jailed',
  `sentence_minutes` INT NOT NULL DEFAULT 10,
  `crime_summary` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `released_at` TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT `fk_custody_target` FOREIGN KEY (`target_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_custody_officer` FOREIGN KEY (`officer_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `shops` (
  `id` VARCHAR(64) PRIMARY KEY,
  `city_id` VARCHAR(64) NOT NULL,
  `owner_character_id` INT DEFAULT NULL,
  `name` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active, suspended, tax_debt, confiscated, closed',
  `rent_amount` INT NOT NULL DEFAULT 0,
  `tax_debt` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_shop_city` FOREIGN KEY (`city_id`) REFERENCES `cities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_shop_owner` FOREIGN KEY (`owner_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `governance_events` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `scope_type` VARCHAR(16) NOT NULL COMMENT 'realm, city, faction',
  `scope_id` VARCHAR(64) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'scheduled',
  `starts_at` TIMESTAMP NULL DEFAULT NULL,
  `created_by_character_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gov_event_creator` FOREIGN KEY (`created_by_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =============================================================================
-- FIM DA MIGRATION v3
-- =============================================================================

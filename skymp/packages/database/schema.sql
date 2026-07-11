-- Schema de Banco de Dados para SkyMP Heavy RP (MySQL/MariaDB)

CREATE DATABASE IF NOT EXISTS `skymp_rp` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `skymp_rp`;

-- 1. Contas de Jogadores (com suporte a VIP e Monetizacao)
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active, suspended, banned',
  -- VIP / Apoiador
  `vip_level` INT NOT NULL DEFAULT 0 COMMENT '0: Padrao, 1: Apoiador, 2: VIP Gold, 3: VIP Platinum',
  `vip_expires_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Data de expiracao do VIP (NULL para permanente ou inativo)',
  `coins` INT NOT NULL DEFAULT 0 COMMENT 'Moedas da loja virtual (adquiridas por doacao)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Identidades do Discord (Login via Discord OAuth)
CREATE TABLE IF NOT EXISTS `discord_identities` (
  `discord_id` VARCHAR(64) PRIMARY KEY,
  `account_id` INT NOT NULL,
  `username` VARCHAR(128) NOT NULL,
  `avatar` VARCHAR(256) DEFAULT NULL,
  `access_token` VARCHAR(256) DEFAULT NULL,
  `refresh_token` VARCHAR(256) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_discord_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. Formulários de Whitelist
CREATE TABLE IF NOT EXISTS `whitelist_applications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `account_id` INT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending, approved, rejected',
  `reviewed_by` VARCHAR(128) DEFAULT NULL,
  `reviewer_notes` TEXT DEFAULT NULL,
  `reviewed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_whitelist_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. Fichas de Personagem do Skyrim
CREATE TABLE IF NOT EXISTS `characters` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `account_id` INT NOT NULL,
  `first_name` VARCHAR(64) NOT NULL,
  `last_name` VARCHAR(64) NOT NULL,
  `biography` TEXT DEFAULT NULL,
  -- Coordenadas de Logout (Default: The Bannered Mare Whiterun)
  `pos_x` FLOAT NOT NULL DEFAULT 35.0,
  `pos_y` FLOAT NOT NULL DEFAULT -165.0,
  `pos_z` FLOAT NOT NULL DEFAULT -189.0,
  `angle_z` FLOAT NOT NULL DEFAULT 180.0,
  `cell_id` VARCHAR(64) NOT NULL DEFAULT '0x162e2',
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending, approved, rejected',
  `racemenu_presets` TEXT DEFAULT NULL COMMENT 'JSON string contendo presets de aparencia',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_character_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Compras e Resgates da Loja de Apoiador
CREATE TABLE IF NOT EXISTS `store_purchases` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `account_id` INT NOT NULL,
  `item_type` VARCHAR(64) NOT NULL COMMENT 'cosmetic, slot, vip_subscription, custom_housing',
  `item_name` VARCHAR(128) NOT NULL,
  `cost_coins` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_store_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Logs de Auditoria e Staff
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `action` VARCHAR(128) NOT NULL,
  `actor_account_id` INT DEFAULT NULL,
  `target_account_id` INT DEFAULT NULL,
  `details` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

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
  `gold` INT NOT NULL DEFAULT 0 COMMENT 'Economia in-game (Septims)',
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending, approved, rejected',
  `racemenu_presets` TEXT DEFAULT NULL COMMENT 'JSON string contendo presets de aparencia',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_character_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4.1. Inventário Persistente do Personagem
CREATE TABLE IF NOT EXISTS `character_inventory` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `base_id` INT NOT NULL COMMENT 'FormID nativo do Skyrim (Decimal)',
  `count` INT NOT NULL DEFAULT 1,
  CONSTRAINT `fk_inventory_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Containers Persistentes (Baús controlados pelo servidor)
CREATE TABLE IF NOT EXISTS `containers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `object_id` VARCHAR(64) NOT NULL UNIQUE COMMENT 'formDesc do objeto no mundo (ex: 0x3003A:Skyrim.esm)',
  `owner_character_id` INT DEFAULT NULL COMMENT 'Personagem dono do container',
  `label` VARCHAR(128) DEFAULT NULL COMMENT 'Etiqueta customizada do baú',
  `is_locked` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_container_owner` FOREIGN KEY (`owner_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 5.1. Inventário dos Containers
CREATE TABLE IF NOT EXISTS `container_inventory` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `container_id` INT NOT NULL,
  `base_id` INT NOT NULL COMMENT 'FormID nativo do Skyrim (Decimal)',
  `count` INT NOT NULL DEFAULT 1,
  CONSTRAINT `fk_container_inv` FOREIGN KEY (`container_id`) REFERENCES `containers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Propriedades e Imóveis
CREATE TABLE IF NOT EXISTS `properties` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL COMMENT 'Nome do imóvel (ex: Casa em Whiterun 12)',
  `owner_character_id` INT DEFAULT NULL,
  `container_id` INT DEFAULT NULL COMMENT 'Container principal da propriedade',
  `door_form_desc` VARCHAR(64) DEFAULT NULL COMMENT 'formDesc da porta de entrada',
  `price_gold` INT NOT NULL DEFAULT 0 COMMENT 'Valor de aluguel/compra em Septims',
  `is_for_sale` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_property_owner` FOREIGN KEY (`owner_character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_property_container` FOREIGN KEY (`container_id`) REFERENCES `containers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 6.1. Acesso de Convidados a Propriedades
CREATE TABLE IF NOT EXISTS `property_guests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `property_id` INT NOT NULL,
  `guest_character_id` INT NOT NULL,
  `granted_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_guest_property` FOREIGN KEY (`property_id`) REFERENCES `properties` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_guest_character` FOREIGN KEY (`guest_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
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

-- 7. Fichas Criminais (Criminal Record)
CREATE TABLE IF NOT EXISTS `criminal_records` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `crime` VARCHAR(128) NOT NULL COMMENT 'Assassinato, Roubo, Agressao, Perturbacao...',
  `bounty` INT NOT NULL DEFAULT 0 COMMENT 'Valor da recompensa em Septims',
  `hold` VARCHAR(64) NOT NULL DEFAULT 'whiterun' COMMENT 'Hold onde o crime foi cometido',
  `witness_character_id` INT DEFAULT NULL COMMENT 'Guardia ou testemunha que registrou',
  `resolved` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0=Ativo, 1=Pago/Cumprido',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_crime_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8. Registro de Prisoes Ativas e Historico
CREATE TABLE IF NOT EXISTS `prison_records` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `arrested_by_character_id` INT DEFAULT NULL COMMENT 'Guardia que prendeu',
  `crime_summary` TEXT DEFAULT NULL,
  `sentence_minutes` INT NOT NULL DEFAULT 10 COMMENT 'Tempo de pena em minutos in-game',
  `time_served_minutes` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active, released, escaped',
  `cell_id` VARCHAR(64) NOT NULL DEFAULT '0x162e2' COMMENT 'Celula da prisao',
  `arrested_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `released_at` TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT `fk_prison_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8.1. Estado Atual de Algemas (Restraints)
CREATE TABLE IF NOT EXISTS `character_restraints` (
  `character_id` INT PRIMARY KEY,
  `restrained_by_character_id` INT DEFAULT NULL,
  `type` VARCHAR(32) NOT NULL DEFAULT 'handcuffs' COMMENT 'handcuffs, rope',
  `applied_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_restraint_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

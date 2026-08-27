-- v29 — Trabalho Público persistente, idempotente e com piso econômico
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `public_work_runs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `work_code` VARCHAR(32) NOT NULL,
  `origin_form_desc` VARCHAR(128) NOT NULL,
  `origin_label` VARCHAR(80) NOT NULL,
  `destination_form_desc` VARCHAR(128) NOT NULL,
  `destination_label` VARCHAR(80) NOT NULL,
  `reward_amount` INT NOT NULL,
  `cooldown_group` VARCHAR(32) NOT NULL,
  `cooldown_seconds` INT NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'assigned'
    COMMENT 'assigned, in_progress, completed, cancelled, expired',
  `cargo_token` VARCHAR(96) DEFAULT NULL,
  `assignment_request_id` VARCHAR(96) NOT NULL,
  `pickup_request_id` VARCHAR(96) DEFAULT NULL,
  `completion_request_id` VARCHAR(96) DEFAULT NULL,
  `started_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3) DEFAULT NULL,
  `cancelled_at` DATETIME(3) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_public_work_assignment_request` (`assignment_request_id`),
  UNIQUE KEY `uq_public_work_pickup_request` (`pickup_request_id`),
  UNIQUE KEY `uq_public_work_completion_request` (`completion_request_id`),
  UNIQUE KEY `uq_public_work_cargo_token` (`cargo_token`),
  KEY `idx_public_work_character_status` (`character_id`, `status`),
  KEY `idx_public_work_expiry` (`status`, `expires_at`),
  CONSTRAINT `fk_public_work_character`
    FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_public_work_reward` CHECK (`reward_amount` > 0),
  CONSTRAINT `ck_public_work_reward_limit` CHECK (`reward_amount` <= 1000000),
  CONSTRAINT `ck_public_work_cooldown` CHECK (`cooldown_seconds` > 0 AND `cooldown_seconds` <= 86400),
  CONSTRAINT `ck_public_work_status`
    CHECK (`status` IN ('assigned', 'in_progress', 'completed', 'cancelled', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A chave primária é a garantia material de uma única corrida ativa por
-- personagem. A linha nasce na mesma transação do run e some somente numa
-- transição terminal; concorrência não depende de SELECT sem lock.
CREATE TABLE IF NOT EXISTS `public_work_active_slots` (
  `character_id` INT NOT NULL PRIMARY KEY,
  `run_id` BIGINT NOT NULL,
  UNIQUE KEY `uq_public_work_active_run` (`run_id`),
  CONSTRAINT `fk_public_work_active_character`
    FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_public_work_active_run`
    FOREIGN KEY (`run_id`) REFERENCES `public_work_runs` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `public_work_cooldowns` (
  `character_id` INT NOT NULL,
  `cooldown_group` VARCHAR(32) NOT NULL,
  `available_at` DATETIME(3) NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`character_id`, `cooldown_group`),
  KEY `idx_public_work_cooldown_available` (`available_at`),
  CONSTRAINT `fk_public_work_cooldown_character`
    FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `public_work_events` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `run_id` BIGINT NOT NULL,
  `character_id` INT DEFAULT NULL,
  `from_status` VARCHAR(16) DEFAULT NULL,
  `to_status` VARCHAR(16) NOT NULL,
  `reason` VARCHAR(64) NOT NULL,
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL,
  UNIQUE KEY `uq_public_work_event_idempotency` (`idempotency_key`),
  KEY `idx_public_work_event_run` (`run_id`, `created_at`),
  KEY `idx_public_work_event_character` (`character_id`, `created_at`),
  CONSTRAINT `fk_public_work_event_run`
    FOREIGN KEY (`run_id`) REFERENCES `public_work_runs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_public_work_event_character`
    FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

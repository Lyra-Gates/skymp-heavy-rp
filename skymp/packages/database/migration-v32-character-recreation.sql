-- v32 - File transactionnelle de recréation des personnages SkyMP
--
-- Le panneau archive la fiche de jeu courante et crée une nouvelle fiche
-- approuvée sans inventaire, or, position ni apparence hérités. Le gamemode
-- consomme ensuite cette demande : il détruit l'ancien acteur persistant et le
-- Spawn officiel SkyMP ouvre le RaceMenu lors de la connexion suivante.
CREATE TABLE IF NOT EXISTS `character_recreation_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `account_id` INT NOT NULL,
  `previous_character_id` INT NOT NULL,
  `new_character_id` INT NOT NULL,
  `requested_by_account_id` INT DEFAULT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending, processing, applied',
  `target_actor_id` BIGINT UNSIGNED DEFAULT NULL,
  `requested_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processing_at` TIMESTAMP NULL DEFAULT NULL,
  `applied_at` TIMESTAMP NULL DEFAULT NULL,
  `last_error` VARCHAR(512) DEFAULT NULL,
  UNIQUE KEY `uq_character_recreation_new` (`new_character_id`),
  KEY `idx_character_recreation_account_status` (`account_id`, `status`, `id`),
  CONSTRAINT `fk_character_recreation_account`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_character_recreation_previous`
    FOREIGN KEY (`previous_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_character_recreation_new`
    FOREIGN KEY (`new_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_character_recreation_staff`
    FOREIGN KEY (`requested_by_account_id`) REFERENCES `accounts` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

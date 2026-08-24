-- =============================================================================
-- Migration v26 - Sessoes persistentes do painel web
-- Aplicar apos migration-v25-launcher-sessions.sql.
--
-- Substitui o MemoryStore do express-session. O cookie continua contendo so o
-- identificador opaco assinado; estado de autenticacao fica no MariaDB e
-- sobrevive a restart do painel ou troca de instancia.
-- =============================================================================
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `web_sessions` (
  `session_id` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `data_json` LONGTEXT NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`session_id`),
  KEY `idx_web_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

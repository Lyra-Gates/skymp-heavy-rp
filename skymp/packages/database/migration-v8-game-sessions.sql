-- =============================================================================
-- Migration v8 - Sessoes de jogo (master API)
-- Aplicar apos migration-v7-indexes.sql.
--
-- Fecha a ponta solta de identidade: ate aqui, `whitelist.js` derivava quem era
-- o jogador do `profileId` que o proprio cliente informava no
-- `skymp_config.json`. Qualquer um editava o arquivo e virava outra pessoa.
--
-- O SkyMP ja resolve isso nativamente, e nos nao sabiamos (ver
-- skymp5-server/ts/systems/login.ts). Com `offlineMode: false`, o servidor NAO
-- confia no cliente: ele pega o `gameData.session` que o cliente mandou e
-- resolve contra um "master API":
--
--   GET {master}/api/servers/{masterKey}/sessions/{session}
--     -> { user: { id: number, discordId: string } }
--
-- O `id` que volta dali vira o `profileId`. Como o `master` e so uma string no
-- `server-settings.json`, o nosso proprio painel pode ser esse master — e ele ja
-- e quem autentica o Discord e aprova a whitelist.
--
-- Esta tabela e o que o painel consulta pra responder. Diferente de
-- `launch_tickets` (uso unico, TTL de 5 min, gasto na entrada da fila), uma
-- sessao de jogo:
--   - pode ser resolvida mais de uma vez, porque o servidor consulta a cada
--     conexao e um jogador que cai por crash precisa reconectar;
--   - dura o suficiente pra uma sessao de jogo, nao pra um clique.
-- =============================================================================
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `game_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  -- SHA-256 do token, nunca o token em claro: se o banco vazar, as sessoes em
  -- voo nao viram credencial utilizavel. Mesmo criterio de `launch_tickets`.
  `token_hash` CHAR(64) NOT NULL,
  `account_id` INT NOT NULL,
  `discord_id` VARCHAR(64) NOT NULL,
  `issued_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NOT NULL,
  `last_resolved_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Ultima vez que o servidor de jogo resolveu esta sessao',
  `resolve_count` INT NOT NULL DEFAULT 0 COMMENT 'Quantas vezes foi resolvida — util pra detectar sessao compartilhada',
  `revoked_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Preenchido ao banir/expulsar sem esperar o TTL',
  UNIQUE KEY `uq_game_session_hash` (`token_hash`),
  KEY `idx_game_session_account` (`account_id`, `expires_at`),
  KEY `idx_game_session_expiry` (`expires_at`),
  CONSTRAINT `fk_game_session_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

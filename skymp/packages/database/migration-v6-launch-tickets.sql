-- =============================================================================
-- Migration v6 - Tickets de lançamento (fila do launcher)
-- Aplicar apos migration-v5-character-application.sql.
--
-- Antes desta tabela, o launcher entrava na fila mandando o proprio
-- `discordId` como se fosse prova de identidade. `discordId` e publico:
-- qualquer pessoa que soubesse o Discord de outro jogador podia entrar na
-- fila no lugar dele. Como o servico da fila (apps/game-api) ainda nao
-- existia, isso nunca chegou a rodar — a tabela existe pra que ele ja nasca
-- com autenticacao de verdade.
--
-- Fluxo:
--   1. O launcher captura o `code` do Discord e manda pro painel
--      (POST /api/launcher/oauth/exchange).
--   2. O painel — que e quem tem o client secret e portanto e o unico que
--      pode provar que aquele Discord autenticou de fato — grava um ticket
--      aqui e devolve pro launcher.
--   3. O launcher apresenta o ticket na fila (POST /api/queue/join).
--   4. O apps/game-api valida contra esta tabela, marca `consumed_at` e so
--      entao devolve um ticket de sessao pro jogo.
--
-- O ticket e de uso unico e curto de proposito: ele so precisa sobreviver do
-- clique em "Jogar" ate a entrada na fila.
-- =============================================================================
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `launch_tickets` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  -- SHA-256 do ticket, nunca o ticket em claro: se este banco vazar, os
  -- tickets que estiverem em voo nao viram credencial utilizavel.
  `token_hash` CHAR(64) NOT NULL,
  `account_id` INT NOT NULL,
  `discord_id` VARCHAR(64) NOT NULL,
  `issued_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NOT NULL,
  `consumed_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Preenchido no primeiro uso — replay falha',
  `issued_ip` VARCHAR(64) DEFAULT NULL,
  UNIQUE KEY `uq_launch_ticket_hash` (`token_hash`),
  KEY `idx_launch_ticket_expiry` (`expires_at`),
  CONSTRAINT `fk_launch_ticket_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

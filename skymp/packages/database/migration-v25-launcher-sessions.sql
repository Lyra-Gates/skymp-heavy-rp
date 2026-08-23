-- =============================================================================
-- Migration v25 - Sessoes de launcher (ticket novo sem refazer OAuth)
-- Aplicar apos migration-v24-crafted-item-signatures.sql.
--
-- Problema que isto resolve: `launch_tickets` (v6) e de uso unico de proposito
-- — sobrevive so do clique em "Jogar" ate a entrada na fila. Isso e' correto
-- pro ticket em si, mas deixou um buraco: quando a fila admite na hora
-- (`status: 'success'`), o servidor nao emite ticket de reposicao (so
-- `status: 'queued'` ganha um `pollTicket`), entao uma segunda tentativa de
-- jogar na mesma sessao do launcher reenviava o ticket ja consumido e caia em
-- `401 invalid_ticket` — o jogador so conseguia um ticket novo refazendo o
-- OAuth do Discord inteiro (popup, redirect, tudo de novo).
--
-- Esta tabela guarda uma sessao de launcher: multiuso (ao contrario do
-- launch_ticket), vive mais tempo, e serve pra UMA coisa so — pedir um
-- launch_ticket novo. Ela nao substitui a checagem de elegibilidade (whitelist,
-- ban), que continua acontecendo em apps/game-api no momento da fila; ela so
-- prova "este Discord autenticou nos ultimos 30 dias", o mesmo que
-- `launch_tickets` ja provava, so que reutilizavel.
--
-- Fluxo:
--   1. POST /api/launcher/oauth/exchange (v6) agora tambem emite um
--      `sessionToken` junto do `launchTicket`, quando a conta existe.
--   2. O launcher guarda os dois. Antes de cada tentativa de entrar na fila,
--      troca o `sessionToken` por um `launchTicket` fresco em
--      POST /api/launcher/session/refresh-ticket — sem popup, sem Discord.
--   3. POST /api/launcher/session/revoke apaga a sessao no logout, pra um
--      arquivo auth.json roubado do disco parar de valer depois que o dono
--      deslogou.
--
-- 30 dias e nao "pra sempre": o re-OAuth periodico e o unico ponto em que
-- confirmamos de novo, direto no Discord, que a conta ainda existe e nao foi
-- deletada/banida do lado de la — util o bastante pra nao abrir mao dele.
-- =============================================================================
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `launcher_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  -- SHA-256 do token, nunca o token em claro — mesmo raciocinio de
  -- `launch_tickets.token_hash`.
  `session_hash` CHAR(64) NOT NULL,
  `account_id` INT NOT NULL,
  `discord_id` VARCHAR(64) NOT NULL,
  `issued_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NOT NULL,
  `last_used_at` TIMESTAMP NULL DEFAULT NULL,
  `revoked_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Preenchido no logout ou revogacao manual',
  `issued_ip` VARCHAR(64) DEFAULT NULL,
  UNIQUE KEY `uq_launcher_session_hash` (`session_hash`),
  KEY `idx_launcher_session_expiry` (`expires_at`),
  KEY `idx_launcher_session_account` (`account_id`),
  CONSTRAINT `fk_launcher_session_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

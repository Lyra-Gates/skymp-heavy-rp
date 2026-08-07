-- =============================================================================
-- Migration v10 - Afinidade da Alma (soul-service)
-- Aplicar apos migration-v9-characters-gold.sql.
--
-- Desenho fechado em docs/design/SOUL_AFFINITY.md. As quatro tabelas abaixo sao
-- exatamente as declaradas la (III.6 marcas, III.7 sinais, III.8 arvore) mais a
-- `character_soul` da §10, e nada alem disso.
--
-- Por que a alma fica em tabela propria, e nao em colunas de `characters`
-- -----------------------------------------------------------------------------
-- A ficha aprovada (`motivations`, `weaknesses`, `social_ties`, migration v5) e
-- a FONTE da alma, nao a alma. Guardar os sete valores em `characters` misturaria
-- o que a staff revisa com o que o servidor deriva, e a segunda coisa nunca deve
-- ser editavel a mao pelo painel — e o que garante que a mesma ficha aprovada
-- produza sempre a mesma alma (§14.1, o fim do reroll-farming).
--
-- Por que a semente e persistida em vez de rederivada a cada uso
-- -----------------------------------------------------------------------------
-- Ela e derivada de `HMAC(SOUL_SECRET, characterId || ficha normalizada)`. Se a
-- staff editar a ficha de um personagem ja aprovado — o que o painel permite —,
-- rederivar trocaria a alma de alguem que ja jogou meses com ela, silenciosamente.
-- Persistir congela a alma no instante da aprovacao, que e o unico comportamento
-- compativel com "marcas sao a progressao" (§II.3).
--
-- ⚠️ `soul_seed` e material sensivel. Com ela e o codigo publico deste repositorio
-- qualquer pessoa reproduz todas as rolagens futuras daquele personagem. Nunca
-- deve sair do servidor, nunca entra em payload de `panelData` e nunca aparece em
-- endpoint do painel web. Ha teste que trava isso (soul-service.test.js).
--
-- Idempotente: `IF NOT EXISTS` em todas as criacoes.
-- =============================================================================
USE `skymp_rp`;

-- -----------------------------------------------------------------------------
-- A alma. Sete valores (quatro afinidades + tres tracos) e a semente que os gerou.
-- Um registro por personagem, criado no primeiro spawn depois da aprovacao.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `character_soul` (
  `character_id` INT NOT NULL PRIMARY KEY,
  `soul_seed` CHAR(64) NOT NULL COMMENT 'HMAC hex. SENSIVEL: nunca sai do servidor',
  `arcana` TINYINT UNSIGNED NOT NULL COMMENT '0-100. Orcamento fixo: as quatro afinidades somam 200',
  `divina` TINYINT UNSIGNED NOT NULL,
  `sombria` TINYINT UNSIGNED NOT NULL,
  `bestial` TINYINT UNSIGNED NOT NULL,
  `vontade` TINYINT UNSIGNED NOT NULL COMMENT '0-100. Orcamento fixo: os tres tracos somam 150',
  `sensibilidade` TINYINT UNSIGNED NOT NULL,
  `estabilidade` TINYINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_soul_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Sinais (III.7). O primeiro e revelado no primeiro spawn, nao por tempo de jogo:
-- e o que garante que a primeira sessao nao seja vazia (§II.1).
--
-- `sign_key` e chave de catalogo, nunca texto livre — o texto mora no codigo,
-- pelo mesmo motivo que `descriptor` em `character_marks`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `character_signs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `sign_key` VARCHAR(64) NOT NULL COMMENT 'Chave do catalogo em soul-service.js. Nunca texto do jogador',
  `source` VARCHAR(32) NOT NULL DEFAULT 'first_spawn' COMMENT 'first_spawn, event, ritual',
  `revealed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_sign_character_key` (`character_id`, `sign_key`),
  CONSTRAINT `fk_sign_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Marcas (III.6). SAO a progressao — nao ha nivel, ha o que ficou em voce.
--
-- Marca nunca e removida. No maximo e coberta, o que tambem e jogavel e caro —
-- por isso nao existe coluna `removed_at` nem status.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `character_marks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `kind` VARCHAR(16) NOT NULL COMMENT 'fisica, espiritual, social',
  `visibility` VARCHAR(16) NOT NULL COMMENT 'visivel (outros veem), sentida (so o portador), conhecida (reputacao)',
  `descriptor` VARCHAR(64) NOT NULL COMMENT 'Chave do catalogo em soul-service.js. Nunca texto do jogador',
  `origin_event_id` VARCHAR(128) DEFAULT NULL COMMENT 'Rastro ate a linha de soul:resolve em audit_logs',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_marks_character` (`character_id`),
  CONSTRAINT `fk_mark_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Arvore de Transformacao (III.8). Maquina de estados IRMA de
-- core/character-state.js, deliberadamente separada dela: aquele trata estado
-- imediato de gameplay (NORMAL/DOWNED/IMPRISONED) com ciclo de vida de segundos;
-- este e trajetoria de meses. Misturar acoplaria coisas com tempos de vida
-- incompativeis (Constituicao §13).
--
-- `consented_at` e a implementacao da condicao §14.2: no irreversivel nao avanca
-- sem consentimento registrado. NULL nele num no irreversivel e um bug de
-- processo, nao um estado valido — ha teste que trava isso.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `character_paths` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL,
  `tree` VARCHAR(16) NOT NULL COMMENT 'arcana, divina, sombria, bestial',
  `node` VARCHAR(32) NOT NULL,
  `entered_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `consented_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Obrigatorio em no irreversivel (SOUL_AFFINITY §14.2)',
  `metadata` TEXT DEFAULT NULL COMMENT 'JSON',
  UNIQUE KEY `uk_path_character_tree` (`character_id`, `tree`),
  CONSTRAINT `fk_path_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

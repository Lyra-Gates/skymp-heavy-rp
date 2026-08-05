-- =============================================================================
-- Migration v5 - Aprofunda a aplicação de personagem (rubrica Heavy RP)
-- Aplicar apos migration-v4-market-stalls.sql.
--
-- O plano de desenvolvimento (secao 8.1, "Padrao da Whitelist") exige que a
-- aplicacao teste conceito, motivacoes, fraquezas e lacos sociais do
-- personagem, e que conceitos fortes (nobres, magos poderosos, vampiros,
-- lobisomens, lideres de faccao) exijam aprovacao extra da staff. Antes desta
-- migration a aplicacao só coletava first_name/last_name/biography.
-- =============================================================================
USE `skymp_rp`;

ALTER TABLE `characters`
  ADD COLUMN IF NOT EXISTS `motivations` TEXT DEFAULT NULL
    COMMENT 'Objetivos do personagem em jogo (rubrica de whitelist Heavy RP)'
    AFTER `biography`,
  ADD COLUMN IF NOT EXISTS `weaknesses` TEXT DEFAULT NULL
    COMMENT 'Falhas/limites do personagem (rubrica de whitelist Heavy RP)'
    AFTER `motivations`,
  ADD COLUMN IF NOT EXISTS `social_ties` TEXT DEFAULT NULL
    COMMENT 'Laços sociais/relações pretendidas (rubrica de whitelist Heavy RP)'
    AFTER `weaknesses`,
  ADD COLUMN IF NOT EXISTS `needs_extra_review` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Conceito forte — exige aprovacao extra da staff antes de approved'
    AFTER `social_ties`,
  ADD COLUMN IF NOT EXISTS `extra_review_notes` TEXT DEFAULT NULL
    COMMENT 'Notas da staff sobre a revisao extra do conceito'
    AFTER `needs_extra_review`;

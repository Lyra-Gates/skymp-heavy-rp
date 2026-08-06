-- =============================================================================
-- Migration v9 - Adiciona characters.gold em bancos que vieram do schema antigo
-- Aplicar apos migration-v8-game-sessions.sql.
--
-- Por que esta migration existe
-- -----------------------------------------------------------------------------
-- `characters.gold` esta declarada no `schema.sql`, e em NENHUMA migration. Isso
-- funciona para banco novo (roda o schema.sql e pronto), e deixa um buraco em
-- banco antigo: quem criou o banco antes da coluna entrar no schema e depois
-- aplicou v2 -> v8 em ordem, como o CONTRIBUTING manda, nunca recebe a coluna.
--
-- A v2 chega a criar a tabela `gold_transactions` — o ledger da economia — sem
-- garantir a coluna de saldo que esse ledger acompanha.
--
-- O efeito nao aparece no boot. Aparece na primeira operacao de ouro, que e todo
-- o `core/transaction-service.js`:
--
--     SELECT gold FROM characters WHERE id = ? FOR UPDATE
--     UPDATE characters SET gold = gold + ? WHERE id = ?
--
-- Ou seja: compra em barraca, multa da guarda, penalidade de morte, ouro inicial
-- e `/setgold` falham todos com "Unknown column 'gold'", no meio de uma cena.
--
-- Encontrado pelo `npm run check:schema` (QA 4.1) ao preparar a Fase 0, que e
-- exatamente a classe de problema que aquele checador foi escrito para pegar:
-- "banco meio-migrado nao quebra o boot; quebra a query que toca a coluna
-- faltante, semanas depois".
--
-- Idempotente: `IF NOT EXISTS` faz esta migration ser inofensiva em banco que
-- veio do `schema.sql` completo e ja tem a coluna.
-- =============================================================================
USE `skymp_rp`;

ALTER TABLE `characters`
  ADD COLUMN IF NOT EXISTS `gold` INT NOT NULL DEFAULT 0
    COMMENT 'Economia in-game (Septims). Toda alteracao passa pelo core/transaction-service.js';

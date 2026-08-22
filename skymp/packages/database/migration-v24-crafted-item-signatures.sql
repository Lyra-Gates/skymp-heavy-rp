-- v24 — Assinatura do Artesao (docs/design/MAKERS_MARK.md)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Por que e uma tabela nova, e nao uma coluna em `item_instances`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `item_instances` (migration-v21-crime-provenance.sql) e sobre CULPA: quem
-- roubou o que, de quem. Assinatura de artesao e sobre AUTORIA: quem fez o
-- que, para quem. Misturar as duas faria uma feature de crime carregar uma
-- responsabilidade que nao e dela — ver MAKERS_MARK.md §4 e §6.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A mesma simplificacao que o crime ja aceitou (MAKERS_MARK.md §3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `character_inventory` e puramente fungivel (UNIQUE por dono+item, so
-- contagem — migration-v14-inventory-framework.sql). Uma linha aqui nao
-- rastreia UM objeto fisico especifico dentro de uma pilha de itens
-- identicos; ela diz "existe, entre os itens deste tipo que este personagem
-- tem, pelo menos um assinado por este artesao, com esta dedicatoria". E o
-- mesmo grau de fidelidade que a revista institucional de crime ja usa para
-- proveniencia — suficiente para flavor de RP, insuficiente para provar qual
-- unidade fisica exata e a assinada.

USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `crafted_item_signatures` (
  `id` CHAR(36) NOT NULL PRIMARY KEY COMMENT 'UUID v4, mesma convencao de item_instances.id',
  `base_id` INT NOT NULL COMMENT 'FormID nativo do Skyrim (decimal), mesma convencao de character_inventory.base_id',
  `recipe_id` INT NOT NULL COMMENT 'Receita que originou o item (crafting_recipes.id, migration-v23)',
  `maker_character_id` INT NOT NULL COMMENT 'Quem craftou e assinou',
  `owner_character_id` INT NOT NULL COMMENT 'Quem recebeu o item no craft. NAO e atualizado em troca/venda/deposito nesta rodada -- nenhum consumidor de inventario (trade/market-stall/depot) escreve aqui. Ver limitacao em MAKERS_MARK.md',
  `signature_text` VARCHAR(64) DEFAULT NULL COMMENT 'Dedicatoria pedida pelo comprador; NULL usa so o nome do artesao',
  `crafted_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_signature_maker` FOREIGN KEY (`maker_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_signature_owner` FOREIGN KEY (`owner_character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_signature_recipe` FOREIGN KEY (`recipe_id`) REFERENCES `crafting_recipes` (`id`) ON DELETE CASCADE,
  INDEX `idx_signature_owner_base` (`owner_character_id`, `base_id`)
) ENGINE=InnoDB;

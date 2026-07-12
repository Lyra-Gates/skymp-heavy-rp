-- seed-forging.sql
-- Receitas baseadas nos mods Ars Metallica e Cloaks & Capes

USE skymp_rp;

-- Derreter Armadura de Ferro (Gera 2 Lingotes de Ferro)
INSERT INTO crafting_recipes (id, name, station_type, result_base_id, result_count, requires_perk) 
VALUES (1001, 'Derreter: Armadura de Ferro', 'forge', 371940, 2, NULL) 
ON DUPLICATE KEY UPDATE name=name;

INSERT INTO crafting_ingredients (recipe_id, base_id, count) 
VALUES (1001, 77385, 1) -- 1x Iron Armor
ON DUPLICATE KEY UPDATE count=count;

-- Derreter Espada de Aço (Gera 1 Lingote de Aço)
INSERT INTO crafting_recipes (id, name, station_type, result_base_id, result_count, requires_perk) 
VALUES (1002, 'Derreter: Espada de Aço', 'forge', 371941, 1, NULL) 
ON DUPLICATE KEY UPDATE name=name;

INSERT INTO crafting_ingredients (recipe_id, base_id, count) 
VALUES (1002, 80265, 1) -- 1x Steel Sword
ON DUPLICATE KEY UPDATE count=count;

-- Criar Capa de Couro (Simulação Cloaks and Capes)
INSERT INTO crafting_recipes (id, name, station_type, result_base_id, result_count, requires_perk) 
VALUES (1003, 'Capa de Couro (Cloaks & Capes)', 'tanning_rack', 999999, 1, NULL) -- Substituir 999999 pelo formId real da capa gerado pelo mod
ON DUPLICATE KEY UPDATE name=name;

INSERT INTO crafting_ingredients (recipe_id, base_id, count) 
VALUES (1003, 898514, 3) -- 3x Couro (Leather)
ON DUPLICATE KEY UPDATE count=count;

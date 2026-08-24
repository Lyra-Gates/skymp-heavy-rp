-- v28 — estações físicas autoritativas de crafting
USE `skymp_rp`;

CREATE TABLE IF NOT EXISTS `crafting_stations` (
  `form_desc` VARCHAR(64) PRIMARY KEY,
  `station_type` VARCHAR(64) NOT NULL COMMENT 'forge, cooking_pot, tanning_rack, alchemy_lab, enchanting_table',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_crafting_station_type_enabled` (`station_type`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Remove o seed histórico que fabricava uma capa com FormID placeholder.
-- A ordem (ingrediente antes da receita) respeita a FK existente.
DELETE FROM `crafting_ingredients` WHERE `recipe_id` = 1003;
DELETE FROM `crafting_recipes` WHERE `id` = 1003 AND `result_base_id` = 999999;

-- v30 — Corrige descritores de celula persistidos sem o nome do plugin
USE `skymp_rp`;

UPDATE `characters`
SET `cell_id` = '162e2:Skyrim.esm'
WHERE `cell_id` IN ('0x162e2', '162e2');

ALTER TABLE `characters`
  MODIFY COLUMN `cell_id` VARCHAR(64) NOT NULL DEFAULT '162e2:Skyrim.esm';

UPDATE `prison_records`
SET `cell_id` = '162e2:Skyrim.esm'
WHERE `cell_id` IN ('0x162e2', '162e2');

ALTER TABLE `prison_records`
  MODIFY COLUMN `cell_id` VARCHAR(64) NOT NULL DEFAULT '162e2:Skyrim.esm'
  COMMENT 'Celula da prisao';
-- v31 - Remplace le point fictif par le spawn officiel SkyMP
UPDATE `characters`
SET `pos_x` = 22659,
    `pos_y` = -8697,
    `pos_z` = -3594,
    `angle_z` = 268,
    `cell_id` = '1a26f:Skyrim.esm'
WHERE `cell_id` IN ('0x162e2', '162e2', '162e2:Skyrim.esm');

ALTER TABLE `characters`
  MODIFY COLUMN `pos_x` FLOAT NOT NULL DEFAULT 22659.0,
  MODIFY COLUMN `pos_y` FLOAT NOT NULL DEFAULT -8697.0,
  MODIFY COLUMN `pos_z` FLOAT NOT NULL DEFAULT -3594.0,
  MODIFY COLUMN `angle_z` FLOAT NOT NULL DEFAULT 268.0,
  MODIFY COLUMN `cell_id` VARCHAR(64) NOT NULL DEFAULT '1a26f:Skyrim.esm';

UPDATE `prison_records`
SET `cell_id` = '1a26f:Skyrim.esm'
WHERE `cell_id` IN ('0x162e2', '162e2', '162e2:Skyrim.esm');

ALTER TABLE `prison_records`
  MODIFY COLUMN `cell_id` VARCHAR(64) NOT NULL DEFAULT '1a26f:Skyrim.esm'
  COMMENT 'Celula da prisao';

UPDATE `cities`
SET `prison_cell_id` = '1a26f:Skyrim.esm',
    `prison_pos_x` = 22659,
    `prison_pos_y` = -8697,
    `prison_pos_z` = -3594
WHERE `prison_cell_id` IN ('0x162e2', '162e2', '162e2:Skyrim.esm');

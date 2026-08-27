'use strict';

/**
 * migration-v28-crafting-stations.test.js — CARACTERIZAÇÃO
 *
 * `check-write-guards.js --all` bloqueia migration sem teste que a
 * referencie: banco meio-migrado é a falha mais cara do projeto porque tudo
 * *quase* funciona, e nada aqui garantia que v28 não mudaria por baixo sem
 * ninguém perceber. `crafting-service.test.js` já exercita o comportamento
 * de `crafting_stations` via mock — isto aqui congela o schema real que a
 * migration declara.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = fs.readFileSync(
  path.resolve(__dirname, '..', 'packages', 'database', 'migration-v28-crafting-stations.sql'), 'utf8'
);

describe('migration v28 — estações físicas de crafting', () => {
  it('cria crafting_stations com form_desc como chave primária', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS `crafting_stations`/);
    assert.match(migration, /`form_desc` VARCHAR\(64\) PRIMARY KEY/);
    assert.match(migration, /`station_type` VARCHAR\(64\) NOT NULL/);
  });

  it('indexa station_type + enabled, o par que crafting-service.js consulta', () => {
    assert.match(migration, /INDEX `idx_crafting_station_type_enabled` \(`station_type`, `enabled`\)/);
  });

  it('remove o seed histórico com FormID placeholder (recipe_id/result_base_id 999999)', () => {
    assert.match(migration, /DELETE FROM `crafting_ingredients` WHERE `recipe_id` = 1003/);
    assert.match(migration, /DELETE FROM `crafting_recipes` WHERE `id` = 1003 AND `result_base_id` = 999999/);
  });
});

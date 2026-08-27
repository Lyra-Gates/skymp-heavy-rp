'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const migration = fs.readFileSync(
  path.resolve(__dirname, '..', 'packages', 'database', 'migration-v29-public-work.sql'), 'utf8'
);
const service = fs.readFileSync(path.resolve(__dirname, 'public-work-service.js'), 'utf8');

describe('migration v29 — contratos estruturais', () => {
  it('cria runs, vaga ativa, cooldown e eventos', () => {
    for (const table of ['public_work_runs', 'public_work_active_slots', 'public_work_cooldowns', 'public_work_events']) {
      assert.match(migration, new RegExp('CREATE TABLE IF NOT EXISTS `' + table + '`'));
    }
  });

  it('garante uma corrida ativa por personagem no próprio schema', () => {
    assert.match(migration, /`character_id` INT NOT NULL PRIMARY KEY/);
    assert.match(migration, /UNIQUE KEY `uq_public_work_active_run` \(`run_id`\)/);
  });

  it('possui chaves únicas independentes para as três operações econômicas', () => {
    assert.match(migration, /uq_public_work_assignment_request/);
    assert.match(migration, /uq_public_work_pickup_request/);
    assert.match(migration, /uq_public_work_completion_request/);
    assert.match(migration, /uq_public_work_cargo_token/);
  });
});

describe('Public Work não invade Profession nem Resource Nodes', () => {
  it('não importa profession-service nem resource-node-service', () => {
    assert.doesNotMatch(service, /require\(['"]\.\/profession-service/);
    assert.doesNotMatch(service, /require\(['"]\.\/resource-node-service/);
  });

  it('não concede item ou XP e credita ouro pela primitiva transacional', () => {
    assert.doesNotMatch(service, /giveItem|addProfessionXp/);
    assert.match(service, /tx\.tx\.applyGoldDelta/);
    assert.match(service, /tx\.tx\.recordGoldLedger/);
  });
});

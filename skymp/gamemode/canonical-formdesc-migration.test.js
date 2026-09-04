'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('migration v30 corrige les cellules existantes et leurs valeurs par défaut', () => {
  const sql = read('packages', 'database', 'migration-v30-canonical-formdesc.sql');

  assert.match(sql, /UPDATE `characters`[\s\S]*'162e2:Skyrim\.esm'[\s\S]*'0x162e2'/);
  assert.match(sql, /ALTER TABLE `characters`[\s\S]*DEFAULT '162e2:Skyrim\.esm'/);
  assert.match(sql, /UPDATE `prison_records`[\s\S]*'162e2:Skyrim\.esm'[\s\S]*'0x162e2'/);
  assert.match(sql, /ALTER TABLE `prison_records`[\s\S]*DEFAULT '162e2:Skyrim\.esm'/);
});

test('le schéma et les configurations utilisent le FormDesc canonique', () => {
  const schema = read('packages', 'database', 'schema.sql');
  const local = JSON.parse(read('config', 'server-settings.local.example.json'));
  const staging = JSON.parse(read('config', 'server-settings.staging.example.json'));

  assert.doesNotMatch(schema, /DEFAULT '0x[0-9a-f]+'/i);
  assert.equal(local.startPoints[0].worldOrCell, '1a26f:Skyrim.esm');
  assert.equal(staging.startPoints[0].worldOrCell, '1a26f:Skyrim.esm');
});

test('migration v31 utilise le point officiel SkyMP', () => {
  const sql = read(
    'packages',
    'database',
    'migration-v31-verified-spawn.sql'
  );

  assert.doesNotMatch(
    sql,
    /\bUSE\s+`/i,
    'la migration doit utiliser la base s?lectionn?e par environnement'
  );
  assert.match(
    sql,
    /UPDATE `characters`[\s\S]*22659[\s\S]*-8697[\s\S]*-3594/
  );
  assert.match(sql, /'1a26f:Skyrim\.esm'/);
  assert.match(sql, /'162e2:Skyrim\.esm'/);
});

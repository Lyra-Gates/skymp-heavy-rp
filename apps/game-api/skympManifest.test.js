'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createSkympManifest } = require('./modsManifest');

const HASH = 'a'.repeat(64);

test('converte para o contrato oficial SkyMP', () => {
  const result = createSkympManifest({
    hashAlgorithm: 'sha256',
    mods: [
      { filename: 'Skyrim.esm', hash: HASH, size: 10, crc32: -123 },
      { filename: 'Update.esm', hash: HASH, size: 20, crc32: 456 }
    ],
    loadOrder: ['Skyrim.esm', 'Update.esm']
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, {
    versionMajor: 1,
    mods: [
      { filename: 'Skyrim.esm', size: 10, crc32: -123 },
      { filename: 'Update.esm', size: 20, crc32: 456 }
    ],
    loadOrder: ['Skyrim.esm', 'Update.esm']
  });
});

test('recusa manifesto sem tamanho ou CRC32', () => {
  const result = createSkympManifest({
    hashAlgorithm: 'sha256',
    mods: [{ filename: 'Skyrim.esm', hash: HASH }],
    loadOrder: ['Skyrim.esm']
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'skymp_fields_missing');
});

test('server.js declara a rota oficial SkyMP', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(source, /app\.get\('\/api\/servers\/:masterKey\/manifest\.json'/);
});
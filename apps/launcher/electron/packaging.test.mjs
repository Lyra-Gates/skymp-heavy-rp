import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcherDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(launcherDir, 'electron-builder.json'), 'utf8'));

test('o pacote inclui a UI CEF como recurso do launcher', () => {
  assert.ok(config.extraResources.some((entry) => entry.from === '../../skymp/ui' && entry.to === 'skymp-ui'));
});

test('o pacote inclui o voice-helper.exe como recurso vendor (opcional)', () => {
  const entry = config.extraResources.find((e) => e.to === 'vendor');
  assert.ok(entry, 'faltou a entrada extraResources para vendor/');
  assert.equal(entry.from, 'build-resources');
  assert.deepEqual(entry.filter, ['voice-helper.exe']);

  // O `from` precisa existir versionado, senao o electron-builder falha antes de
  // qualquer coisa — mesmo quando o exe (nao versionado) nao foi stajado.
  const stagingDir = path.join(launcherDir, entry.from);
  assert.ok(fs.existsSync(stagingDir), `${entry.from}/ tem que existir no repo`);
});

test('o build stagea o voice-helper antes de empacotar', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(launcherDir, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /stage-voice-helper\.mjs.*electron-builder/s);
});

test('o pacote não inclui recursivamente a própria pasta de saída', () => {
  assert.ok(config.files.includes('dist-electron/main.mjs'));
  assert.ok(config.files.includes('dist-electron/preload.mjs'));
  assert.ok(!config.files.includes('dist-electron/**/*'));
});

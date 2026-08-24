import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncUiBundle } from './ui-integrity.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skymp-ui-test-'));
  const sourceDir = path.join(root, 'source');
  const targetDir = path.join(root, 'target');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'index.html'), '<script src="panel.js"></script>');
  fs.writeFileSync(path.join(sourceDir, 'panel.js'), 'window.ready = true;');
  return { root, sourceDir, targetDir };
}

test('instala uma UI ausente', (t) => {
  const dirs = fixture();
  t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));

  const result = syncUiBundle(dirs);
  assert.equal(result.ok, true);
  assert.deepEqual(result.repaired, ['index.html', 'panel.js']);
  assert.equal(fs.readFileSync(path.join(dirs.targetDir, 'panel.js'), 'utf8'), 'window.ready = true;');
});

test('repara arquivo divergente e preserva arquivo extra', (t) => {
  const dirs = fixture();
  t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));
  fs.mkdirSync(dirs.targetDir);
  fs.writeFileSync(path.join(dirs.targetDir, 'index.html'), 'corrompido');
  fs.writeFileSync(path.join(dirs.targetDir, 'extra.txt'), 'preservar');

  const result = syncUiBundle(dirs);
  assert.equal(result.ok, true);
  assert.ok(result.repaired.includes('index.html'));
  assert.equal(fs.readFileSync(path.join(dirs.targetDir, 'extra.txt'), 'utf8'), 'preservar');
});

test('não reescreve arquivos que já conferem', (t) => {
  const dirs = fixture();
  t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));
  syncUiBundle(dirs);

  const result = syncUiBundle(dirs);
  assert.equal(result.ok, true);
  assert.deepEqual(result.repaired, []);
  assert.equal(result.files, 2);
});

test('falha fechado quando o bundle interno não tem index.html', (t) => {
  const dirs = fixture();
  t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));
  fs.unlinkSync(path.join(dirs.sourceDir, 'index.html'));

  const result = syncUiBundle(dirs);
  assert.equal(result.ok, false);
  assert.match(result.error, /index\.html/);
});

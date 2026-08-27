import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncVoiceHelper } from './voice-helper.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vh-sync-'));
}

test('copia o exe quando o alvo nao existe', () => {
  const dir = tmp();
  const source = path.join(dir, 'voice-helper.exe');
  const target = path.join(dir, 'game', 'Data', 'Platform', 'voice-helper.exe');
  fs.writeFileSync(source, 'BINARIO-V1');

  const r = syncVoiceHelper({ sourcePath: source, targetPath: target });
  assert.deepEqual(r, { ok: true, repaired: true });
  assert.equal(fs.readFileSync(target, 'utf8'), 'BINARIO-V1');
});

test('nao reescreve quando o hash confere', () => {
  const dir = tmp();
  const source = path.join(dir, 'voice-helper.exe');
  const target = path.join(dir, 'voice-helper.exe.copy');
  fs.writeFileSync(source, 'IGUAL');
  fs.writeFileSync(target, 'IGUAL');
  const mtimeAntes = fs.statSync(target).mtimeMs;

  const r = syncVoiceHelper({ sourcePath: source, targetPath: target });
  assert.deepEqual(r, { ok: true, repaired: false });
  assert.equal(fs.statSync(target).mtimeMs, mtimeAntes, 'nao deve ter tocado no arquivo');
});

test('repara quando o alvo diverge', () => {
  const dir = tmp();
  const source = path.join(dir, 'voice-helper.exe');
  const target = path.join(dir, 'target.exe');
  fs.writeFileSync(source, 'NOVO');
  fs.writeFileSync(target, 'VELHO');

  const r = syncVoiceHelper({ sourcePath: source, targetPath: target });
  assert.deepEqual(r, { ok: true, repaired: true });
  assert.equal(fs.readFileSync(target, 'utf8'), 'NOVO');
});

test('fail-open quando o exe nao foi empacotado: ok:true, skipped', () => {
  const dir = tmp();
  const r = syncVoiceHelper({
    sourcePath: path.join(dir, 'nao-existe.exe'),
    targetPath: path.join(dir, 'target.exe')
  });
  assert.equal(r.ok, true);
  assert.equal(r.repaired, false);
  assert.equal(r.skipped, true);
  assert.equal(fs.existsSync(path.join(dir, 'target.exe')), false);
});

test('sourcePath vazio nao explode', () => {
  const r = syncVoiceHelper({ sourcePath: '', targetPath: path.join(tmp(), 'x.exe') });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const main = fs.readFileSync(path.join(electronDir, 'main.ts'), 'utf8');
const start = main.indexOf("ipcMain.handle('launch-game'");
const handler = main.slice(start);

test('launch-game prepara e valida a conexão antes de matar ou iniciar processos', () => {
  assert.ok(start >= 0, 'handler launch-game nao encontrado');
  const prepareAt = handler.indexOf('prepararConfiguracaoConexao({');
  const killAt = handler.indexOf('await killGameProcesses()');
  const spawnAt = handler.indexOf('await iniciarProcessoJogo(');

  assert.ok(prepareAt >= 0, 'writer fail-closed nao foi chamado');
  assert.ok(killAt > prepareAt, 'processos foram encerrados antes de validar a configuracao');
  assert.ok(spawnAt > killAt, 'jogo foi iniciado antes do encerramento anterior terminar');
});

test('launch-game devolve resultado estruturado e nao inicia o SKSE por shell', () => {
  assert.match(handler, /return \{ ok: true, pid: processResult\.pid \}/);
  assert.match(handler, /return \{ ok: false, code, error: message \}/);
  assert.doesNotMatch(handler, /exec\(`?['"]?\$?\{?exePath/);
});

test('bootstrap direto usa master proprio com fallback oficial', () => {
  const writer = fs.readFileSync(path.join(electronDir, 'connection-settings.mjs'), 'utf8');
  assert.match(writer, /clientSettings\['server-info-ignore'\]\s*=\s*!masterUrl/);
  assert.match(writer, /writtenSettings\['server-info-ignore'\]\s*===\s*true/);
});

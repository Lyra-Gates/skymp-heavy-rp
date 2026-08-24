import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const homeSource = fs.readFileSync(path.join(here, '..', 'src', 'pages', 'Home.tsx'), 'utf8');
const playHandler = homeSource.match(/const handlePlay = async \(\) => \{([\s\S]*?)\n  \};/);

test('o fluxo JOGAR valida a versao antes de consumir ticket da fila', () => {
  assert.ok(playHandler, 'handlePlay não encontrado');
  const source = playHandler[1];
  const versionCheck = source.indexOf('checkClientUpdate(gamePath)');
  const modCheck = source.indexOf('verifyMods(gamePath)');
  const queueJoin = source.indexOf('joinQueue()');

  assert.ok(versionCheck >= 0, 'gate de versão ausente');
  assert.ok(versionCheck < modCheck, 'versão deve ser validada antes da paridade dos mods');
  assert.ok(versionCheck < queueJoin, 'versão deve ser validada antes de consumir o ticket da fila');
});

test('o gate falha fechado quando o manifesto está indisponível ou há atualização', () => {
  assert.ok(playHandler, 'handlePlay não encontrado');
  assert.match(playHandler[1], /if \(clientUpdate\.error\) \{[\s\S]*?return;/);
  assert.match(playHandler[1], /if \(clientUpdate\.updateAvailable\) \{[\s\S]*?return;/);
});

test('o fluxo JOGAR instala ou repara a UI antes da fila e falha fechado', () => {
  assert.ok(playHandler, 'handlePlay não encontrado');
  const source = playHandler[1];
  const uiCheck = source.indexOf('ensureSkympUi(gamePath)');
  const queueJoin = source.indexOf('joinQueue()');

  assert.ok(uiCheck >= 0, 'instalação/reparo da UI ausente');
  assert.ok(uiCheck < queueJoin, 'UI deve ser garantida antes de consumir o ticket da fila');
  assert.match(source, /if \(!ui\.ok\) \{[\s\S]*?return;/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const homeSource = fs.readFileSync(path.join(here, '..', 'src', 'pages', 'Home.tsx'), 'utf8');
const mainSource = fs.readFileSync(path.join(here, 'main.ts'), 'utf8');
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

test('o fluxo JOGAR V11 nao instala nem repara, mas normaliza e sincroniza o load order', () => {
  assert.ok(playHandler, 'handlePlay nao encontrado');
  const source = playHandler[1];

  assert.ok(
    !source.includes('ensureSkympUi('),
    'JOGAR nao deve reparar a UI'
  );

  assert.ok(
    !source.includes('ensureVoiceHelper('),
    'JOGAR nao deve instalar/reparar voice-helper'
  );

  assert.ok(
    !source.includes('ensureSkyrimIni('),
    'JOGAR nao deve modificar Skyrim.ini'
  );

  assert.ok(
    source.includes('normalizeEslPlugins(gamePath)'),
    'JOGAR deve normalizar os plugins ESL antes da verificacao'
  );

  assert.ok(
    source.includes('syncLoadorder('),
    'JOGAR deve sincronizar plugins.txt com o load order do servidor'
  );

  assert.ok(
    !source.includes('installClientUpdate('),
    'JOGAR nao deve instalar atualizacao do client'
  );

  assert.ok(
    !source.includes('installModsUpdate('),
    'JOGAR nao deve instalar mods'
  );

  assert.ok(
    !source.includes('installIsolatedGame('),
    'JOGAR nao deve iniciar a instalacao Primetoile'
  );

  assert.ok(
    source.includes('verifyMods(gamePath)'),
    'JOGAR deve verificar os mods'
  );

  assert.ok(
    source.includes('analyzePlugins('),
    'JOGAR deve verificar o load order'
  );

  assert.ok(
    source.includes('joinQueue()'),
    'JOGAR deve entrar na fila somente depois das verificacoes'
  );
});

test('httpGetJson tolera BOM UTF-8 nos manifestos JSON', () => {
  assert.ok(
    mainSource.includes("JSON.parse(data.replace(/^\\uFEFF/, ''))"),
    'httpGetJson deve remover o BOM UTF-8 antes de JSON.parse'
  );
});
test('usa canal GitHub client estavel em vez de latest', () => {
  assert.ok(
    mainSource.includes('releases/download/client/client-update.json'),
    'o manifesto client deve usar o tag estavel client'
  );

  assert.ok(
    !mainSource.includes('releases/latest/download/client-update.json'),
    'o manifesto client nao deve depender da release Latest'
  );
});
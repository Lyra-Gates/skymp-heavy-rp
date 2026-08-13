#!/usr/bin/env node
/**
 * Verificacao operacional dos sistemas de governanca/guarda e barraquinhas.
 *
 * Este script nao substitui teste em servidor com dois clientes. Ele valida se
 * as pecas locais necessarias estao alinhadas antes de ligar os modulos.
 */

const fs = require('fs');
const path = require('path');

const gamemodeDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(gamemodeDir, '..', '..');

const CHECKS = [];

function rel(...parts) {
  return path.join(repoRoot, ...parts);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function addCheck(name, fn) {
  CHECKS.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function flattenCommandNames(defs) {
  const names = [];
  for (const def of defs) {
    const commandNames = Array.isArray(def.name) ? def.name : [def.name];
    for (const name of commandNames) names.push(name);
  }
  return names;
}

function assertCommands(defs, required, label) {
  const names = flattenCommandNames(defs);
  const seen = new Set();

  for (const def of defs) {
    assert(def.description, `${label}: comando sem description`);
    assert(def.usage, `${label}: comando sem usage`);
    assert(typeof def.handler === 'function', `${label}: comando sem handler`);
  }

  for (const name of names) {
    assert(name.startsWith('/'), `${label}: comando invalido ${name}`);
    assert(!seen.has(name), `${label}: comando duplicado ${name}`);
    seen.add(name);
  }

  for (const name of required) {
    assert(seen.has(name), `${label}: comando obrigatorio ausente ${name}`);
  }
}

function assertFileContains(filePath, tokens) {
  const content = readText(filePath);
  for (const token of tokens) {
    assert(content.includes(token), `${path.relative(repoRoot, filePath)} nao contem ${token}`);
  }
}

function validateVisualConfigExample(filePath) {
  const config = JSON.parse(readText(filePath));
  const candidates = config.assetCandidates || config.candidateReferences;
  assert(config.enabled === false, 'visual example deve ficar disabled por padrao');
  assert(config.strategy === 'server_place_static', 'visual example deve usar server_place_static');
  assert(Object.prototype.hasOwnProperty.call(config, 'defaultStallBaseId'), 'visual example sem defaultStallBaseId');
  assert(Array.isArray(candidates), 'visual example sem lista de candidatos de asset');
  assert(candidates.length >= 3, 'visual example deve listar candidatos de asset');
}

function assertServiceExports(service, required, label) {
  for (const key of required) {
    assert(typeof service[key] === 'function' || service[key] !== undefined, `${label}: export ausente ${key}`);
  }
}

async function checkDatabaseSchemaIfRequested() {
  if (process.env.RUN_DB_CHECK !== '1') {
    return 'skip: RUN_DB_CHECK nao definido';
  }

  const db = require(path.join(gamemodeDir, 'database'));
  db.init();

  const requiredTables = [
    'realms',
    'cities',
    'governance_roles',
    'governance_role_permissions',
    'governance_memberships',
    'guard_detentions',
    'guard_searches',
    'warrants',
    'fines',
    'custody_records',
    'shops',
    'governance_events',
    'market_stalls',
    'market_stall_items',
    'market_stall_sales',
    'market_stall_licenses',
    'market_stall_audit'
  ];

  const rows = await db.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${requiredTables.map(() => '?').join(',')})`,
    requiredTables
  );
  const found = new Set(rows.map(row => row.TABLE_NAME));
  const missing = requiredTables.filter(table => !found.has(table));
  assert(missing.length === 0, `tabelas ausentes no banco: ${missing.join(', ')}`);

  const columns = await db.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'market_stalls'
       AND COLUMN_NAME IN ('visual_ref_id', 'tax_rate', 'cell_id')`
  );
  const foundColumns = new Set(columns.map(row => row.COLUMN_NAME));
  for (const column of ['visual_ref_id', 'tax_rate', 'cell_id']) {
    assert(foundColumns.has(column), `market_stalls sem coluna ${column}`);
  }

  if (typeof db.close === 'function') {
    await db.close();
  }
  return 'ok';
}

addCheck('exports dos servicos', () => {
  const governance = require(path.join(gamemodeDir, 'governance-service'));
  const marketStalls = require(path.join(gamemodeDir, 'market-stalls-service'));

  assertServiceExports(governance, [
    'commandDefs',
    'initGovernanceService',
    // `handleUiEvent` e `getInteractionActions` sairam em 13/08/2026: a
    // governanca nao tem mais UI propria, tem acoes registradas no
    // `core/interaction-registry.js`. Ver ADR_002.
    'hasPermission',
    'stopTarget',
    'requestSearch',
    'arrestTarget'
  ], 'governance');

  assertServiceExports(marketStalls, [
    'commandDefs',
    'initMarketStallsService',
    'placeStall',
    'packStall',
    'addItem',
    'buyItem',
    'inspectStall',
    'suspendStall',
    'confiscateItem'
  ], 'market-stalls');
});

addCheck('comandos obrigatorios', () => {
  const governance = require(path.join(gamemodeDir, 'governance-service'));
  const marketStalls = require(path.join(gamemodeDir, 'market-stalls-service'));

  assertCommands(governance.commandDefs(), [
    '/realmcreate',
    '/citycreate',
    '/govfcreate',
    '/guardduty',
    '/guardstop',
    '/search',
    '/fine',
    '/arrest',
    '/taxset'
  ], 'governance');

  assertCommands(marketStalls.commandDefs(), [
    '/stallplace',
    '/stallpack',
    '/stalladd',
    '/stallbuy',
    '/stalllicense',
    '/stallinspect',
    '/stallsuspend',
    '/stallconfiscate'
  ], 'market-stalls');
});

addCheck('permissoes de barraca na governanca', () => {
  const governance = require(path.join(gamemodeDir, 'governance-service'));
  for (const permission of [
    'STALL_INSPECT',
    'STALL_SUSPEND',
    'STALL_CONFISCATE',
    'STALL_ISSUE_LICENSE',
    'STALL_COLLECT_TAX'
  ]) {
    assert(governance.PERMISSIONS[permission], `permissao ausente: ${permission}`);
  }
});

addCheck('migrations principais', () => {
  assertFileContains(rel('skymp', 'packages', 'database', 'migration-v3-governance.sql'), [
    'CREATE TABLE IF NOT EXISTS `realms`',
    'CREATE TABLE IF NOT EXISTS `cities`',
    'CREATE TABLE IF NOT EXISTS `governance_roles`',
    'CREATE TABLE IF NOT EXISTS `guard_detentions`',
    'CREATE TABLE IF NOT EXISTS `warrants`',
    'CREATE TABLE IF NOT EXISTS `shops`'
  ]);

  assertFileContains(rel('skymp', 'packages', 'database', 'migration-v4-market-stalls.sql'), [
    'CREATE TABLE IF NOT EXISTS `market_stalls`',
    '`visual_ref_id`',
    'CREATE TABLE IF NOT EXISTS `market_stall_items`',
    'CREATE TABLE IF NOT EXISTS `market_stall_sales`',
    'CREATE TABLE IF NOT EXISTS `market_stall_licenses`'
  ]);
});

addCheck('flags de ambiente', () => {
  assertFileContains(path.join(gamemodeDir, '.env.example'), [
    'ENABLE_GOVERNANCE_SERVICE=false',
    'ENABLE_MARKET_STALLS_SERVICE=false'
  ]);
});

// Este check nasceu porque o de cima dava [PASS] enquanto o .env NAO era lido
// por ninguem: conferir que a flag existe no .env.example prova que alguem
// escreveu a linha, nao que ligar a linha faz alguma coisa. Durante meses o
// gamemode nunca carregou o arquivo, entao todo modulo lab ficava desativado
// e o unico sintoma era a mensagem "DESATIVADO (... nao definido)" no boot.
//
// A ordem importa e por isso e verificada: module-registry le
// process.env[ENABLE_*] em bootAll(), mas core/server-options.js faz load()
// preguicoso no primeiro get() — e death-service/proximity-ranges chamam get()
// ainda no require. Carregar o .env depois de qualquer um desses requires
// significa ler o ambiente errado sem nenhum erro aparecer.
addCheck('phase0 carrega o .env antes de tudo', () => {
  // Comentarios saem antes da busca. O comentario que explica POR QUE a forma
  // nua nao funciona contem, literalmente, `require('dotenv')` — e sem remove-lo
  // este check casava com a prosa em vez do codigo, achava o indice errado e
  // reprovava um arquivo correto.
  const source = readText(path.join(gamemodeDir, 'phase0-basic.js'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Casa a forma nua e a forma com caminho: o que este check garante e que o
  // .env E carregado e QUANDO. Se a forma for a nua, quem reprova e o check
  // seguinte, com a mensagem certa sobre o %TEMP%.
  const dotenvAt = source.search(/require\((?:'dotenv'|path\.join\([^)]*'dotenv'\))\)/);
  assert(dotenvAt !== -1, "phase0-basic.js nao carrega dotenv — as flags ENABLE_* nunca chegam no process.env");
  assert(
    source.slice(dotenvAt, dotenvAt + 260).includes('.env'),
    'phase0-basic.js chama dotenv sem apontar para o arquivo .env do gamemode'
  );

  const registryAt = source.indexOf("'core', 'module-registry'");
  assert(registryAt !== -1, 'phase0-basic.js nao requer o module-registry');
  assert(
    dotenvAt < registryAt,
    'dotenv precisa ser carregado ANTES do module-registry, senao bootAll() le process.env vazio'
  );

  const optionsAt = source.indexOf("'core', 'server-options'");
  assert(
    optionsAt === -1 || dotenvAt < optionsAt,
    'dotenv precisa ser carregado ANTES do server-options, que resolve o arquivo por NODE_ENV'
  );
});

// Este check nasceu de um boot real, nao de leitura de codigo.
//
// O SkyMP copia o arquivo de entrada pra `%TEMP%\skymp5-server<random>\` e
// executa de la (esta escrito no topo do phase0-basic.js). Um `require` com
// especificador nu e resolvido a partir do diretorio do arquivo EM EXECUCAO —
// o temp, sem node_modules — e derruba o gamemode inteiro no boot com
// "Cannot find module".
//
// A primeira versao do carregamento do .env usava `require('dotenv')`. Passou
// nos 366 testes e no CI, porque os dois rodam a partir de skymp/gamemode/,
// onde a resolucao funciona. So apareceu ao subir o servidor. Um teste nao
// pegaria isso: so um boot de verdade, ou este check.
addCheck('phase0 nao usa require de pacote com caminho relativo', () => {
  const source = readText(path.join(gamemodeDir, 'phase0-basic.js'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Builtins do Node resolvem em qualquer lugar; o resto precisa de caminho.
  const builtins = new Set(['path', 'fs', 'os', 'crypto', 'events', 'util', 'http', 'https', 'net', 'url', 'assert']);
  const nus = [];

  for (const [, especificador] of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (builtins.has(especificador)) continue;
    nus.push(especificador);
  }

  assert(
    nus.length === 0,
    `phase0-basic.js tem require(s) que o SkyMP nao consegue resolver: ${nus.join(', ')}. ` +
    `O arquivo roda a partir de %TEMP%, entao todo pacote precisa de caminho absoluto — ` +
    `use require(path.join(gamemodeDir, 'node_modules', '<pacote>')).`
  );
});

addCheck('config visual de exemplo', () => {
  validateVisualConfigExample(rel('skymp', 'config', 'market-stalls.visual.example.json'));
});

addCheck('registro no phase0', () => {
  assertFileContains(path.join(gamemodeDir, 'phase0-basic.js'), [
    "id: 'governance'",
    "enabledBy: 'ENABLE_GOVERNANCE_SERVICE'",
    "id: 'market-stalls'",
    "enabledBy: 'ENABLE_MARKET_STALLS_SERVICE'",
    "dependencies: ['governance', 'interaction']",
    "id: 'interaction'",
    "enabledBy: 'ENABLE_INTERACTION_FRAMEWORK'",
    'browserModal',
    'createInteractionService'
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Afinidade da Alma
//
// Os testes unitarios cobrem o payload do painel (nenhum numero sai pro
// jogador). O que eles NAO conseguem cobrir e a fronteira entre processos: a
// semente vive no gamemode, e o painel web e o game-api sao outros processos,
// com outro acesso ao mesmo banco. Se alguem escrever um endpoint que devolve
// `soul_seed` ou `SOUL_SECRET`, nenhum teste do gamemode reprova — e o sistema
// inteiro deixa de ser oculto, porque a ficha e publica e o codigo e aberto.
//
// Este check e a unica coisa que olha para os dois lados ao mesmo tempo.
// ─────────────────────────────────────────────────────────────────────────────
addCheck('a semente da alma nao sai do gamemode', () => {
  const proibido = [/soul_seed/i, /SOUL_SECRET/i, /character_soul/i];

  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
      const alvo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) { varrer(alvo); continue; }
      if (!/\.(js|ts|html|json)$/.test(entrada.name)) continue;

      const texto = readText(alvo);
      for (const padrao of proibido) {
        assert(
          !padrao.test(texto),
          `${path.relative(repoRoot, alvo)} menciona ${padrao} — a semente da alma nao pode sair do gamemode ` +
          '(SOUL_AFFINITY.md §III.3). Se o painel precisa mostrar algo da alma, mostre a ficcao, nunca o numero.'
        );
      }
    }
  };

  for (const app of ['web', 'bot-discord', 'launcher', 'game-api']) {
    const dir = rel('apps', app);
    if (fs.existsSync(dir)) varrer(dir);
  }
  return 'nenhum app toca a semente';
});

addCheck('soul-service registrado e desligado por padrao', () => {
  assertFileContains(path.join(gamemodeDir, 'phase0-basic.js'), [
    "id: 'soul'",
    "enabledBy: 'ENABLE_SOUL_SERVICE'",
    "phase: 'lab'"
  ]);
  // A flag desligada e o segredo declarado vazio: ligar exige duas acoes
  // conscientes, e o modulo falha alto se so a primeira for feita.
  assertFileContains(path.join(gamemodeDir, '.env.example'), [
    'ENABLE_SOUL_SERVICE=false',
    'SOUL_SECRET='
  ]);
});

addCheck('spawn visual usa Papyrus PlaceAtMe', () => {
  assertFileContains(path.join(gamemodeDir, 'market-stalls-service.js'), [
    "Game', 'getFormEx'",
    "ObjectReference',",
    "'PlaceAtMe'",
    'mp.getIdFromDesc'
  ]);
});

addCheck('schema real opcional', checkDatabaseSchemaIfRequested);

async function runChecks() {
  let passed = 0;
  const failures = [];

  for (const check of CHECKS) {
    try {
      const result = await check.fn();
      passed += 1;
      console.log(`[PASS] ${check.name}${result ? ` (${result})` : ''}`);
    } catch (err) {
      failures.push({ name: check.name, error: err });
      console.error(`[FAIL] ${check.name}: ${err.message}`);
    }
  }

  console.log(`\nResultado: ${passed}/${CHECKS.length} checks passaram.`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runChecks().catch(err => {
    console.error(`[FATAL] ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  addCheck,
  assertCommands,
  assertFileContains,
  checkDatabaseSchemaIfRequested,
  flattenCommandNames,
  runChecks,
  validateVisualConfigExample
};

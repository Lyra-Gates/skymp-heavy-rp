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
    'handleUiEvent',
    'getInteractionActions',
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
  const source = readText(path.join(gamemodeDir, 'phase0-basic.js'));

  const dotenvAt = source.indexOf("require('dotenv')");
  assert(dotenvAt !== -1, "phase0-basic.js nao carrega dotenv — as flags ENABLE_* nunca chegam no process.env");
  assert(
    source.slice(dotenvAt, dotenvAt + 200).includes('.env'),
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

addCheck('config visual de exemplo', () => {
  validateVisualConfigExample(rel('skymp', 'config', 'market-stalls.visual.example.json'));
});

addCheck('registro no phase0', () => {
  assertFileContains(path.join(gamemodeDir, 'phase0-basic.js'), [
    "id: 'governance'",
    "enabledBy: 'ENABLE_GOVERNANCE_SERVICE'",
    "id: 'market-stalls'",
    "enabledBy: 'ENABLE_MARKET_STALLS_SERVICE'",
    "dependencies: ['governance']",
    'browserModal',
    'governance.handleUiEvent'
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

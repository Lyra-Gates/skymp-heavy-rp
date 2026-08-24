#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { listarArquivosSql, semComentarios, instrucoesSql } = require('./check-schema-drift');

const gamemodeDir = path.resolve(__dirname, '..');
const databaseDir = path.resolve(gamemodeDir, '..', 'packages', 'database');
const defaultConfigPath = path.resolve(gamemodeDir, '..', 'config', 'database.local.json');
const SCHEMA_DATABASE = 'skymp_rp';

function buildMigrationPlan(dir = databaseDir) {
  return listarArquivosSql(dir).map(filePath => {
    const sql = semComentarios(fs.readFileSync(filePath, 'utf8'));
    const statements = instrucoesSql(sql).map(value => value.trim()).filter(Boolean);
    return { filename: path.basename(filePath), filePath, statements };
  });
}

async function assertEmptyDatabase(connection, databaseName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
      WHERE table_schema = ?`,
    [databaseName]
  );
  const tableCount = Number(rows && rows[0] && rows[0].table_count) || 0;
  if (tableCount > 0) {
    throw new Error(
      `Banco '${databaseName}' ja possui ${tableCount} tabela(s). ` +
      'Este comando e somente para banco vazio; use npm run check:schema para um banco existente.'
    );
  }
}

async function applyMigrationPlan(connection, plan, { databaseName = 'skymp_rp', logger = console } = {}) {
  if (databaseName !== SCHEMA_DATABASE) {
    throw new Error(
      `database.local.json aponta para '${databaseName}', mas os SQL versionados usam '${SCHEMA_DATABASE}'. ` +
      'Recusado para nao migrar um banco diferente do configurado.'
    );
  }
  await assertEmptyDatabase(connection, databaseName);
  let appliedStatements = 0;

  for (const file of plan) {
    logger.log(`[migrations] ${file.filename}: ${file.statements.length} instrucao(oes)`);
    for (let index = 0; index < file.statements.length; index++) {
      try {
        await connection.query(file.statements[index]);
        appliedStatements++;
      } catch (cause) {
        const error = new Error(
          `Falha em ${file.filename}, instrucao ${index + 1}/${file.statements.length}: ${cause.message}`,
          { cause }
        );
        throw error;
      }
    }
  }
  return { files: plan.length, statements: appliedStatements };
}

function readConfig(configPath) {
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    host: parsed.host || '127.0.0.1',
    port: Number(parsed.port) || 3306,
    user: parsed.user || 'root',
    password: parsed.password || '',
    database: parsed.database || 'skymp_rp'
  };
}

function readEnvConfig(env = process.env) {
  if (!env.DB_USER) throw new Error('DB_USER must be set with --from-env');
  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER,
    password: env.DB_PASS || '',
    database: env.DB_NAME || 'skymp_rp'
  };
}

async function main(argv = process.argv.slice(2)) {
  const plan = buildMigrationPlan();
  const statementCount = plan.reduce((sum, file) => sum + file.statements.length, 0);
  if (argv.includes('--dry-run')) {
    for (const file of plan) console.log(`${file.filename}: ${file.statements.length}`);
    console.log(`[migrations] dry-run: ${plan.length} arquivo(s), ${statementCount} instrucao(oes), sem conexao ao banco.`);
    return;
  }

  const fromEnv = argv.includes('--from-env');
  const configArg = argv.find(arg => arg.startsWith('--config='));
  const configPath = configArg ? path.resolve(configArg.slice('--config='.length)) : defaultConfigPath;
  if (!fromEnv && !fs.existsSync(configPath)) throw new Error(`Config de banco nao encontrada: ${configPath}`);
  const config = fromEnv ? readEnvConfig() : readConfig(configPath);

  // Sem `database` de propósito: schema.sql é quem cria e seleciona o banco.
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: false
  });
  try {
    const result = await applyMigrationPlan(connection, plan, { databaseName: config.database });
    console.log(`[migrations] OK: ${result.files} arquivo(s), ${result.statements} instrucao(oes).`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[migrations] FATAL: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildMigrationPlan, assertEmptyDatabase, applyMigrationPlan, readConfig, readEnvConfig, main, SCHEMA_DATABASE };

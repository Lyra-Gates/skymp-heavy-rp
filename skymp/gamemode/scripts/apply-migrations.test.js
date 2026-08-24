const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');
const { buildMigrationPlan, applyMigrationPlan, readEnvConfig } = require('./apply-migrations');

const databaseDir = path.resolve(__dirname, '..', '..', 'packages', 'database');

describe('aplicador de migrations para banco vazio', () => {
  it('monta plano com schema primeiro e migrations em ordem numérica até v28', () => {
    const plan = buildMigrationPlan(databaseDir);
    assert.equal(plan[0].filename, 'schema.sql');
    assert.equal(plan.at(-1).filename, 'migration-v28-crafting-stations.sql');
    const versions = plan.slice(1).map(file => Number(file.filename.match(/^migration-v(\d+)/)[1]));
    assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
    assert.ok(plan.every(file => file.statements.length > 0));
  });

  it('recusa banco já populado antes de executar DDL', async () => {
    let queries = 0;
    const connection = {
      execute: async () => [[{ table_count: 3 }], []],
      query: async () => { queries++; }
    };
    await assert.rejects(
      applyMigrationPlan(connection, [{ filename: 'schema.sql', statements: ['CREATE TABLE x (id INT)'] }]),
      /somente para banco vazio/
    );
    assert.equal(queries, 0);
  });

  it('recusa nome de banco diferente do USE versionado', async () => {
    const connection = { execute: async () => [[{ table_count: 0 }]], query: async () => {} };
    await assert.rejects(
      applyMigrationPlan(connection, [], { databaseName: 'outro_banco' }),
      /SQL versionados usam 'skymp_rp'/
    );
  });

  it('executa cada instrução sequencialmente e retorna contagem', async () => {
    const executed = [];
    const connection = {
      execute: async () => [[{ table_count: 0 }], []],
      query: async sql => { executed.push(sql); }
    };
    const plan = [
      { filename: 'schema.sql', statements: ['CREATE DATABASE x', 'USE x'] },
      { filename: 'migration-v2.sql', statements: ['CREATE TABLE y (id INT)'] }
    ];
    const result = await applyMigrationPlan(connection, plan, { logger: { log() {} } });
    assert.deepEqual(executed, ['CREATE DATABASE x', 'USE x', 'CREATE TABLE y (id INT)']);
    assert.deepEqual(result, { files: 2, statements: 3 });
  });

  it('informa arquivo e posição da instrução sem imprimir o SQL', async () => {
    const connection = {
      execute: async () => [[{ table_count: 0 }], []],
      query: async sql => { if (sql.includes('SECRET_VALUE')) throw new Error('syntax error'); }
    };
    const plan = [{ filename: 'migration-v9.sql', statements: ['SELECT 1', "SELECT 'SECRET_VALUE'"] }];
    await assert.rejects(
      applyMigrationPlan(connection, plan, { logger: { log() {} } }),
      err => {
        assert.match(err.message, /migration-v9\.sql, instrucao 2\/2/);
        assert.doesNotMatch(err.message, /SECRET_VALUE/);
        return true;
      }
    );
  });

  it('lê configuração de ambiente para containers sem arquivo de segredo', () => {
    assert.deepEqual(readEnvConfig({
      DB_HOST: 'mariadb', DB_PORT: '3307', DB_USER: 'skymp', DB_PASS: 'secret', DB_NAME: 'skymp_rp'
    }), {
      host: 'mariadb', port: 3307, user: 'skymp', password: 'secret', database: 'skymp_rp'
    });
    assert.throws(() => readEnvConfig({}), /DB_USER/);
  });
});

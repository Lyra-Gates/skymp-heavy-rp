#!/usr/bin/env node
/**
 * check-schema-drift.js
 *
 * Confere se o banco real bate com o que as migrations versionadas declaram.
 *
 * Por que isto existe
 * ───────────────────
 * As migrations `v2`–`v8` são aplicadas **à mão**, em ordem, e nada verifica
 * que foram todas aplicadas. Um banco meio-migrado é a falha mais cara de
 * diagnosticar que existe neste projeto, porque tudo *quase* funciona: o
 * servidor sobe, o login passa, e só a query que toca a coluna faltante
 * quebra — às vezes semanas depois, numa cena, com ouro no meio.
 *
 * O sintoma clássico: alguém aplicou até a v6, o `game-api` grava sessão na
 * `game_sessions` (v8) e a admissão na fila falha com erro de SQL cru, que o
 * jogador vê como "servidor offline".
 *
 * O que ele compara
 * ─────────────────
 * Lê `schema.sql` + todas as `migration-v*.sql` como **fonte da verdade** e
 * confronta com `information_schema` do banco conectado:
 *
 *   - tabela declarada e ausente no banco  → migration não aplicada
 *   - coluna declarada e ausente no banco  → migration parcialmente aplicada
 *   - índice declarado e ausente no banco  → v7 não aplicada (silencioso: só
 *                                            aparece como lentidão sob carga)
 *   - tabela no banco que nenhuma migration cria → alteração feita à mão
 *
 * O último caso não falha o comando por padrão: um servidor de produção pode
 * legitimamente ter tabelas de ferramenta externa. Ele avisa, porque uma
 * tabela que só existe na máquina de uma pessoa é como um schema se separa em
 * dois sem ninguém perceber.
 *
 * Uso
 * ───
 *   node scripts/check-schema-drift.js            compara com o banco
 *   node scripts/check-schema-drift.js --list     só imprime o esperado (sem banco)
 *   node scripts/check-schema-drift.js --strict   tabela extra também falha
 *
 * Sai com código 1 se houver qualquer coisa faltando.
 */

const fs = require('fs');
const path = require('path');

const gamemodeDir = path.resolve(__dirname, '..');
const databaseDir = path.resolve(gamemodeDir, '..', 'packages', 'database');

// ─────────────────────────────────────────────────────────────────────────────
// Leitura das migrations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordena `schema.sql` primeiro e as migrations pelo número de versão.
 * Ordenação alfabética colocaria `v10` antes de `v2` — não temos v10 hoje, mas
 * o dia que tiver, o erro seria silencioso.
 */
function listarArquivosSql(dir) {
  const arquivos = fs.readdirSync(dir).filter(nome => nome.endsWith('.sql'));

  const schema = arquivos.filter(nome => nome === 'schema.sql');
  const migrations = arquivos
    .filter(nome => nome.startsWith('migration-v'))
    .sort((a, b) => versaoDe(a) - versaoDe(b));

  return [...schema, ...migrations].map(nome => path.join(dir, nome));
}

function versaoDe(nomeArquivo) {
  const m = /^migration-v(\d+)/.exec(nomeArquivo);
  return m ? Number(m[1]) : 0;
}

/** Remove comentários de linha para não casar padrões dentro de explicação. */
function semComentarios(sql) {
  return sql
    .split('\n')
    .map(linha => linha.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * Extrai o schema declarado. Deliberadamente conservador: reconhece só as
 * formas que este repositório de fato usa. Uma forma nova de DDL passa
 * despercebida, e é por isso que o `--list` existe — dá pra conferir a olho
 * se o que ele entendeu bate com o que foi escrito.
 */
function extrairEsperado(arquivos) {
  /** @type {Map<string, {colunas: Set<string>, indices: Set<string>, origem: string}>} */
  const tabelas = new Map();

  const garante = (nome, origem) => {
    if (!tabelas.has(nome)) {
      tabelas.set(nome, { colunas: new Set(), indices: new Set(), origem });
    }
    return tabelas.get(nome);
  };

  for (const arquivo of arquivos) {
    const origem = path.basename(arquivo);
    const sql = semComentarios(fs.readFileSync(arquivo, 'utf8'));

    // CREATE TABLE IF NOT EXISTS `nome` ( ...corpo... )
    const reCreate = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`\s*\(([\s\S]*?)\n\)/gi;
    let m;
    while ((m = reCreate.exec(sql)) !== null) {
      const tabela = garante(m[1], origem);
      for (const linha of m[2].split('\n')) {
        const col = /^\s*`([^`]+)`\s+\S/.exec(linha);
        if (col) tabela.colunas.add(col[1]);

        const idx = /^\s*(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`([^`]+)`/i.exec(linha);
        if (idx) tabela.indices.add(idx[1]);
      }
    }

    // ALTER TABLE `nome` ... (ADD COLUMN / ADD INDEX / ADD KEY)
    const reAlter = /ALTER\s+TABLE\s+`([^`]+)`([\s\S]*?);/gi;
    while ((m = reAlter.exec(sql)) !== null) {
      const tabela = garante(m[1], origem);
      const corpo = m[2];

      const reCol = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`/gi;
      let c;
      while ((c = reCol.exec(corpo)) !== null) tabela.colunas.add(c[1]);

      const reIdx = /ADD\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`/gi;
      let i;
      while ((i = reIdx.exec(corpo)) !== null) tabela.indices.add(i[1]);
    }

    // CREATE INDEX `nome` ON `tabela`
    const reCreateIdx = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`\s+ON\s+`([^`]+)`/gi;
    while ((m = reCreateIdx.exec(sql)) !== null) {
      garante(m[2], origem).indices.add(m[1]);
    }
  }

  return tabelas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparação com o banco
// ─────────────────────────────────────────────────────────────────────────────

async function lerBancoReal(db) {
  const tabelas = await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
  );
  const colunas = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  const indices = await db.query(
    `SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()`
  );

  const real = new Map();
  for (const r of tabelas) real.set(r.TABLE_NAME, { colunas: new Set(), indices: new Set() });
  for (const r of colunas) real.get(r.TABLE_NAME)?.colunas.add(r.COLUMN_NAME);
  for (const r of indices) real.get(r.TABLE_NAME)?.indices.add(r.INDEX_NAME);
  return real;
}

/**
 * Compara o esperado com o real. Função pura, sem I/O — é o que o teste
 * exercita sem precisar de banco.
 */
function compararSchemas(esperado, real) {
  const tabelasFaltando = [];
  const colunasFaltando = [];
  const indicesFaltando = [];
  const tabelasExtra = [];

  for (const [nome, decl] of esperado) {
    const atual = real.get(nome);
    if (!atual) {
      tabelasFaltando.push({ tabela: nome, origem: decl.origem });
      continue;
    }
    for (const coluna of decl.colunas) {
      if (!atual.colunas.has(coluna)) {
        colunasFaltando.push({ tabela: nome, coluna, origem: decl.origem });
      }
    }
    for (const indice of decl.indices) {
      if (!atual.indices.has(indice)) {
        indicesFaltando.push({ tabela: nome, indice, origem: decl.origem });
      }
    }
  }

  for (const nome of real.keys()) {
    if (!esperado.has(nome)) tabelasExtra.push(nome);
  }

  return { tabelasFaltando, colunasFaltando, indicesFaltando, tabelasExtra };
}

function houveFalta(resultado) {
  return resultado.tabelasFaltando.length > 0
    || resultado.colunasFaltando.length > 0
    || resultado.indicesFaltando.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saída
// ─────────────────────────────────────────────────────────────────────────────

function imprimirEsperado(esperado) {
  console.log(`Schema declarado pelas migrations: ${esperado.size} tabelas\n`);
  for (const [nome, decl] of [...esperado].sort()) {
    console.log(`  ${nome}  (${decl.colunas.size} colunas, ${decl.indices.size} indices)  <- ${decl.origem}`);
  }
}

function imprimirResultado(resultado, strict) {
  const { tabelasFaltando, colunasFaltando, indicesFaltando, tabelasExtra } = resultado;

  for (const t of tabelasFaltando) {
    console.error(`[FALTA] tabela '${t.tabela}' declarada em ${t.origem} nao existe no banco`);
  }
  for (const c of colunasFaltando) {
    console.error(`[FALTA] coluna '${c.tabela}.${c.coluna}' declarada em ${c.origem} nao existe no banco`);
  }
  for (const i of indicesFaltando) {
    console.error(`[FALTA] indice '${i.indice}' em '${i.tabela}' (${i.origem}) nao existe no banco`);
  }
  for (const t of tabelasExtra) {
    const nivel = strict ? 'EXTRA' : 'AVISO';
    console.error(`[${nivel}] tabela '${t}' existe no banco e nenhuma migration a cria`);
  }

  if (!houveFalta(resultado) && tabelasExtra.length === 0) {
    console.log('[OK] banco e migrations estao alinhados.');
    return true;
  }

  if (!houveFalta(resultado)) {
    console.log('\n[OK] nada faltando. Ha tabela extra (ver acima) — nao e bloqueante sem --strict.');
    return !strict;
  }

  console.error(
    '\nAplique as migrations pendentes de skymp/packages/database, em ordem (v2 -> v8).\n' +
    'Se voce acha que ja aplicou todas, aplicou parcialmente: as migrations sao\n' +
    'idempotentes (IF NOT EXISTS), entao rodar de novo e seguro.'
  );
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const apenasListar = args.includes('--list');
  const strict = args.includes('--strict');

  const arquivos = listarArquivosSql(databaseDir);
  if (arquivos.length === 0) {
    console.error(`[FATAL] nenhum .sql encontrado em ${databaseDir}`);
    process.exitCode = 1;
    return;
  }

  const esperado = extrairEsperado(arquivos);

  if (apenasListar) {
    imprimirEsperado(esperado);
    return;
  }

  const db = require(path.join(gamemodeDir, 'database'));
  db.init();
  try {
    const real = await lerBancoReal(db);
    const resultado = compararSchemas(esperado, real);
    if (!imprimirResultado(resultado, strict)) {
      process.exitCode = 1;
    }
  } finally {
    const pool = db.getPool && db.getPool();
    if (pool && typeof pool.end === 'function') await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[FATAL] ${err.message}`);
    console.error(
      'Sem conexao com o banco este check nao roda. Para conferir so o que as\n' +
      'migrations declaram, sem banco: node scripts/check-schema-drift.js --list'
    );
    process.exitCode = 1;
  });
}

module.exports = {
  listarArquivosSql,
  versaoDe,
  semComentarios,
  extrairEsperado,
  compararSchemas,
  houveFalta
};

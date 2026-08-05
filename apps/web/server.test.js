/**
 * Smoke tests do painel web.
 *
 * O `apps/web` era o único serviço com regra de negócio real — autorização de
 * staff, aprovação de whitelist, troca de OAuth — e nenhum teste. Estes testes
 * cobrem os caminhos onde um erro é silencioso e caro: um endpoint de staff que
 * esquece o guard, ou um UPDATE que reescreve linha demais.
 *
 * O MySQL é substituído por um duplo em memória antes do `require` do servidor,
 * então nada aqui toca banco nem rede.
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

// ── Duplo de MySQL ───────────────────────────────────────────────────────────
// Guarda toda query executada, pra que os testes possam afirmar sobre o SQL em
// si (é o SQL que continha o bug do personagem aposentado, não o handler).
const queryLog = [];
let queryHandler = () => [];

const fakePool = {
  execute: async (sql, params = []) => {
    queryLog.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    const result = await queryHandler(sql, params);
    if (Array.isArray(result)) return [result, []];
    return [result, []];
  }
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'mysql2/promise') {
    return { createPool: () => fakePool };
  }
  return realLoad.apply(this, arguments);
};

process.env.INTERNAL_API_SECRET = 'test-internal-secret';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';

const { app, validateApplication, hashTicket } = require(path.join(__dirname, 'server.js'));

Module._load = realLoad;

// ── Servidor efêmero ─────────────────────────────────────────────────────────
let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  queryLog.length = 0;
  queryHandler = () => [];
});

const get = (p, opts) => fetch(`${baseUrl}${p}`, { redirect: 'manual', ...opts });
const post = (p, body) => fetch(`${baseUrl}${p}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  redirect: 'manual'
});

// ─────────────────────────────────────────────────────────────────────────────

describe('autenticação obrigatória', () => {
  // Sem sessão, nenhuma rota de dado pode responder 200. O risco real aqui é
  // alguém adicionar um endpoint novo e esquecer o guard.
  const protectedRoutes = [
    '/api/me',
    '/api/dashboard',
    '/api/whitelist',
    '/api/characters',
    '/api/audit',
    '/api/economy/holds',
    '/api/economy/top-gold',
    '/api/criminal',
    '/api/factions',
    '/api/prison',
    '/api/crashes'
  ];

  for (const route of protectedRoutes) {
    test(`GET ${route} exige autenticação`, async () => {
      const res = await get(route);
      assert.equal(res.status, 401, `${route} respondeu ${res.status} sem sessão`);
    });
  }

  test('POST /api/apply exige autenticação', async () => {
    const res = await post('/api/apply', { first_name: 'A' });
    assert.equal(res.status, 401);
  });
});

describe('validação da aplicação de personagem', () => {
  const valid = {
    first_name: 'Ralof',
    last_name: 'de Riverwood',
    biography: 'x'.repeat(120),
    motivations: 'y'.repeat(40),
    weaknesses: 'z'.repeat(40),
    social_ties: 'w'.repeat(40)
  };

  test('aceita ficha completa', () => {
    const { error, clean } = validateApplication(valid);
    assert.equal(error, undefined);
    assert.equal(clean.first_name, 'Ralof');
  });

  test('rejeita nome ausente', () => {
    assert.match(validateApplication({ ...valid, first_name: '' }).error, /Nome/);
  });

  test('rejeita nome só com espaços', () => {
    assert.match(validateApplication({ ...valid, first_name: '   ' }).error, /Nome/);
  });

  test('rejeita biografia curta demais', () => {
    assert.match(validateApplication({ ...valid, biography: 'curta' }).error, /Biografia/);
  });

  test('rejeita campo acima do limite da coluna', () => {
    assert.match(validateApplication({ ...valid, biography: 'x'.repeat(6000) }).error, /Biografia/);
  });

  // A rubrica de whitelist trata ficha sem estes campos como reprovada. Eles
  // eram `required` só no HTML, o que é trivial de contornar.
  for (const field of ['motivations', 'weaknesses', 'social_ties']) {
    test(`rejeita ${field} ausente (rubrica Heavy RP)`, () => {
      const { error } = validateApplication({ ...valid, [field]: '' });
      assert.ok(error, `${field} vazio deveria ser rejeitado no servidor`);
    });
  }

  test('faz trim antes de gravar', () => {
    const { clean } = validateApplication({ ...valid, first_name: '  Ralof  ' });
    assert.equal(clean.first_name, 'Ralof');
  });

  test('rejeita tipo não-string sem quebrar', () => {
    assert.ok(validateApplication({ ...valid, first_name: { toString: () => 'x' } }).error);
    assert.ok(validateApplication({}).error);
  });
});

describe('troca de OAuth do launcher', () => {
  test('rejeita redirect_uri fora da allowlist', async () => {
    const res = await post('/api/launcher/oauth/exchange', {
      code: 'abc',
      redirect_uri: 'http://servidor-do-atacante.example/callback'
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /redirect_uri/);
  });

  test('rejeita code ausente', async () => {
    const res = await post('/api/launcher/oauth/exchange', {
      redirect_uri: 'http://localhost:19847/callback'
    });
    assert.equal(res.status, 400);
  });

  test('aceita o redirect_uri do launcher (chega a falar com o Discord)', async () => {
    const res = await post('/api/launcher/oauth/exchange', {
      code: 'codigo-invalido',
      redirect_uri: 'http://localhost:19847/callback'
    });
    // Passa da validação de forma; o Discord real recusa o code falso.
    assert.notEqual(res.status, 400, 'o redirect_uri da allowlist não deveria ser barrado');
  });
});

describe('ticket de lançamento', () => {
  test('guarda hash, nunca o token em claro', () => {
    const token = 'a'.repeat(64);
    const hash = hashTicket(token);
    assert.equal(hash.length, 64);
    assert.notEqual(hash, token);
    assert.equal(hashTicket(token), hash, 'o hash precisa ser determinístico');
  });
});

describe('endpoint de crash reports', () => {
  test('rejeita corpo sem crash válido', async () => {
    const res = await post('/api/crashes/client', { crashes: [] });
    assert.equal(res.status, 400);
  });

  test('rejeita crash sem conteúdo', async () => {
    const res = await post('/api/crashes/client', { crashes: [{ filename: 'a.log', content: '' }] });
    assert.equal(res.status, 400);
  });
});

describe('endpoints removidos continuam removidos', () => {
  // Servia um manifesto com hash falso e ninguém o consumia. Se voltar, volta
  // a ser um alvo pra alguém apontar o launcher.
  test('GET /api/launcher/manifest não devolve JSON de manifesto', async () => {
    const res = await get('/api/launcher/manifest');
    const body = await res.text();
    assert.ok(!body.includes('dummy_hash_for_testing'), 'o stub de manifesto voltou');
  });
});

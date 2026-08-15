const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateManifest } = require('./validate');

// Todo arquivo existe, salvo quando o teste diz o contrário.
const allFilesExist = { fileExists: () => true };

/** O pin do manifesto de teste. Os patches abaixo apontam para um prefixo dele. */
const PIN = 'd85f18d808f877401c4e20484d2c2f6f73cf9caa';

function patch(overrides = {}) {
  return {
    id: 'exemplo-valido',
    target: 'skymp',
    file: 'skymp/exemplo.patch',
    upstream_commit: 'd85f18d',
    reason: 'Sem isto o gamemode não decide o spawn.',
    files_touched: ['skymp5-server/src/systems/spawn.ts'],
    impact: 'Nenhum quando o hook não é exposto.',
    test: 'skymp/gamemode/spawn.test.js',
    loss_condition: 'Reclone do SkyMP sobrescreve o arquivo.',
    removal_strategy: 'Apagar quando o PR upstream entrar.',
    upstream_pr: 'https://github.com/skyrim-multiplayer/skymp/pull/1',
    added: '2026-08-13',
    ...overrides
  };
}

function validate(patches, opts = allFilesExist) {
  return validateManifest({ version: 1, upstream: { pin: PIN }, patches }, opts);
}

describe('manifesto vazio', () => {
  test('lista vazia é válida — não ter patch é o estado preferido', () => {
    const res = validate([]);
    assert.equal(res.ok, true);
    assert.deepEqual(res.errors, []);
  });

  test('o manifest.json real do repositório é válido', () => {
    const dir = __dirname;
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const res = validateManifest(manifest, {
      fileExists: (rel) => fs.existsSync(path.join(dir, rel))
    });
    assert.equal(res.ok, true, `manifest.json do repositório inválido: ${res.errors.join('; ')}`);
  });
});

describe('patch bem formado', () => {
  test('passa', () => {
    const res = validate([patch()]);
    assert.equal(res.ok, true, res.errors.join('; '));
  });
});

describe('campos obrigatórios', () => {
  for (const field of [
    'id', 'target', 'file', 'upstream_commit', 'reason',
    'impact', 'loss_condition', 'removal_strategy', 'added'
  ]) {
    test(`ausência de "${field}" reprova`, () => {
      const p = patch();
      delete p[field];
      const res = validate([p]);
      assert.equal(res.ok, false);
      assert.ok(
        res.errors.some((e) => e.includes(`"${field}"`)),
        `esperava erro citando ${field}, veio: ${res.errors.join('; ')}`
      );
    });

    test(`"${field}" vazio ou só espaço reprova`, () => {
      const res = validate([patch({ [field]: '   ' })]);
      assert.equal(res.ok, false);
    });
  }
});

describe('loss_condition — o campo que justifica este validador', () => {
  test('null reprova', () => {
    const res = validate([patch({ loss_condition: null })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('loss_condition')));
  });

  test('não há escape: nem notes preenchido salva', () => {
    const res = validate([patch({ loss_condition: '', notes: 'não sei' })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('loss_condition')));
  });
});

describe('test e upstream_pr aceitam null, mas exigem justificativa', () => {
  test('test null sem notes reprova', () => {
    const res = validate([patch({ test: null })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('test é null')));
  });

  test('test null com notes passa', () => {
    const res = validate([patch({ test: null, notes: 'Mudança de build; coberta pelo próprio build da CI.' })]);
    assert.equal(res.ok, true, res.errors.join('; '));
  });

  test('upstream_pr ausente reprova', () => {
    const p = patch();
    delete p.upstream_pr;
    const res = validate([p]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('upstream_pr')));
  });

  test('upstream_pr null sem notes reprova', () => {
    const res = validate([patch({ upstream_pr: null })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('upstream_pr é null')));
  });

  test('upstream_pr null com notes passa', () => {
    const res = validate([patch({ upstream_pr: null, notes: 'Específico do nosso modpack; não serve ao upstream.' })]);
    assert.equal(res.ok, true, res.errors.join('; '));
  });
});

describe('integridade do registro', () => {
  test('id duplicado reprova', () => {
    const res = validate([patch(), patch()]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('duplicado')));
  });

  test('id fora de kebab-case reprova', () => {
    const res = validate([patch({ id: 'Spawn_Hook' })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('kebab-case')));
  });

  test('target desconhecido reprova', () => {
    const res = validate([patch({ target: 'skyrim' })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('target')));
  });

  test('arquivo .patch inexistente reprova', () => {
    const res = validate([patch()], { fileExists: () => false });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('não existe')));
  });

  test('files_touched vazio reprova', () => {
    const res = validate([patch({ files_touched: [] })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('files_touched')));
  });

  test('added em formato não-ISO reprova', () => {
    const res = validate([patch({ added: '13/08/2026' })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('ISO')));
  });

  test('acumula erros de vários patches em vez de parar no primeiro', () => {
    const res = validate([patch({ id: 'Um_Ruim' }), patch({ id: 'outro', target: 'x' })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length >= 2, `esperava vários erros, veio: ${res.errors.join('; ')}`);
  });
});

describe('pin — o commit contra o qual todos os patches se aplicam', () => {
  test('manifesto vazio não precisa de pin', () => {
    const res = validateManifest({ version: 1, patches: [] }, allFilesExist);
    assert.equal(res.ok, true, res.errors.join('; '));
  });

  test('patch sem pin declarado reprova', () => {
    const res = validateManifest({ version: 1, patches: [patch()] }, allFilesExist);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('upstream.pin')), res.errors.join('; '));
  });

  test('pin abreviado reprova — SHA completo ou nada', () => {
    const res = validateManifest({ version: 1, upstream: { pin: 'd85f18d' }, patches: [patch()] }, allFilesExist);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('upstream.pin')));
  });

  test('upstream_commit que não é prefixo do pin reprova', () => {
    const res = validate([patch({ upstream_commit: 'abc1234' })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('não bate com upstream.pin')), res.errors.join('; '));
  });

  test('upstream_commit completo e igual ao pin passa', () => {
    const res = validate([patch({ upstream_commit: PIN })]);
    assert.equal(res.ok, true, res.errors.join('; '));
  });

  test('a comparação ignora caixa', () => {
    const res = validate([patch({ upstream_commit: 'D85F18D' })]);
    assert.equal(res.ok, true, res.errors.join('; '));
  });

  test('upstream_commit curto demais reprova antes de comparar com o pin', () => {
    const res = validate([patch({ upstream_commit: 'd85' })]);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('não parece um SHA')), res.errors.join('; '));
  });

  test('pin invalido reprova mesmo sem patch algum', () => {
    const res = validateManifest({ version: 1, upstream: { pin: 'nao-e-sha' }, patches: [] }, allFilesExist);
    assert.equal(res.ok, false);
  });
});

describe('manifesto malformado', () => {
  test('version errada reprova', () => {
    const res = validateManifest({ version: 2, patches: [] }, allFilesExist);
    assert.equal(res.ok, false);
  });

  test('patches não-lista reprova', () => {
    const res = validateManifest({ version: 1, patches: {} }, allFilesExist);
    assert.equal(res.ok, false);
  });

  test('manifesto nulo reprova sem lançar', () => {
    const res = validateManifest(null, allFilesExist);
    assert.equal(res.ok, false);
  });
});

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createManifestLoader, isValidManifest } = require('./modsManifest');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-manifest-test-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeManifest(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

describe('validação de forma do manifesto', () => {
  test('aceita manifesto bem formado', () => {
    assert.equal(isValidManifest({
      hashAlgorithm: 'sha256',
      mods: [{ filename: 'Skyrim.esm', hash: HASH_A }],
      loadOrder: ['Skyrim.esm']
    }), true);
  });

  test('rejeita manifesto vazio', () => {
    assert.equal(isValidManifest({ hashAlgorithm: 'sha256', mods: [], loadOrder: [] }), false);
  });

  test('rejeita algoritmo ausente ou legado', () => {
    const base = { mods: [{ filename: 'Skyrim.esm', hash: HASH_A }], loadOrder: ['Skyrim.esm'] };
    assert.equal(isValidManifest(base), false);
    assert.equal(isValidManifest({ ...base, hashAlgorithm: 'md5' }), false);
  });

  test('rejeita hash que não seja SHA-256 hexadecimal', () => {
    assert.equal(isValidManifest({
      hashAlgorithm: 'sha256',
      mods: [{ filename: 'Skyrim.esm', hash: 'abc' }],
      loadOrder: ['Skyrim.esm']
    }), false);
  });

  test('rejeita mod sem hash', () => {
    assert.equal(isValidManifest({ hashAlgorithm: 'sha256', mods: [{ filename: 'a.esp' }], loadOrder: ['a.esp'] }), false);
  });

  test('rejeita mod sem filename', () => {
    assert.equal(isValidManifest({ hashAlgorithm: 'sha256', mods: [{ hash: HASH_A }], loadOrder: ['a.esp'] }), false);
  });

  test('rejeita ausência de loadOrder', () => {
    assert.equal(isValidManifest({ hashAlgorithm: 'sha256', mods: [{ filename: 'a.esp', hash: HASH_A }] }), false);
  });

  test('rejeita não-objeto', () => {
    assert.equal(isValidManifest(null), false);
    assert.equal(isValidManifest('{}'), false);
  });
});

describe('loader', () => {
  test('manifesto ausente reporta erro em vez de lista vazia', () => {
    // Este é o ponto central: lista vazia passaria na verificação de paridade
    // do launcher e deixaria qualquer modpack entrar.
    const loader = createManifestLoader(path.join(tmpDir, 'nao-existe.json'));
    const result = loader.load();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'manifest_missing');
    assert.equal(result.manifest, undefined);
  });

  test('JSON corrompido reporta erro', () => {
    const p = writeManifest('corrompido.json', '{ isso nao e json');
    const result = createManifestLoader(p).load();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'manifest_invalid_json');
  });

  test('forma inválida reporta erro', () => {
    const p = writeManifest('forma-errada.json', { hashAlgorithm: 'sha256', mods: [{ filename: 'a.esp' }], loadOrder: ['a.esp'] });
    const result = createManifestLoader(p).load();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'manifest_invalid_shape');
  });

  test('carrega manifesto válido', () => {
    const p = writeManifest('valido.json', {
      hashAlgorithm: 'sha256',
      mods: [{ filename: 'Skyrim.esm', hash: HASH_A }, { filename: 'HeavyRP.esm', hash: HASH_B }],
      loadOrder: ['Skyrim.esm', 'HeavyRP.esm']
    });
    const result = createManifestLoader(p).load();
    assert.equal(result.ok, true);
    assert.equal(result.manifest.mods.length, 2);
    assert.deepEqual(result.manifest.loadOrder, ['Skyrim.esm', 'HeavyRP.esm']);
  });

  test('recarrega quando o arquivo muda no disco', () => {
    const p = writeManifest('cache.json', { hashAlgorithm: 'sha256', mods: [{ filename: 'a.esp', hash: HASH_A }], loadOrder: ['a.esp'] });
    const loader = createManifestLoader(p);

    assert.equal(loader.load().manifest.mods.length, 1);

    // mtime tem granularidade de ms em alguns sistemas; forçamos um valor
    // distinto pra garantir que o teste exercite a invalidação e não o acaso.
    fs.writeFileSync(p, JSON.stringify({
      hashAlgorithm: 'sha256',
      mods: [{ filename: 'a.esp', hash: HASH_A }, { filename: 'b.esp', hash: HASH_B }],
      loadOrder: ['a.esp', 'b.esp']
    }));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(p, future, future);

    assert.equal(loader.load().manifest.mods.length, 2, 'o cache deveria ter sido invalidado pelo mtime');
  });
});

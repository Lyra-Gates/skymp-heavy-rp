/**
 * core/safe-zones.test.js
 *
 * Zona segura decide se um golpe acontece. Erro aqui não dá erro: dá alguém
 * morrendo dentro da área de spawn, ou combate que não funciona no mapa
 * inteiro. Os dois modos de falha são silenciosos, então o que estes testes
 * cobrem é sobretudo o comportamento na ausência e na má configuração.
 *
 * A regra dos dois lados (§4.1 do estudo do Red House) tem teste próprio: é o
 * detalhe que separa proteção de exploit.
 *
 * Executa com: node --test core/safe-zones.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const NA_ZONA = 0xff000001;
const FORA = 0xff000002;
const LONGE_NA_MESMA_CELULA = 0xff000003;

const CELULA_SEGURA = '0x162e2';
const OUTRA_CELULA = '0x1a2b3';

const posicoes = new Map();
const originalMp = global.mp;

global.mp = {
  get: (actorId, prop) => (prop === 'locationalData' ? posicoes.get(actorId) || null : null)
};

const safeZones = require('./safe-zones');

after(() => {
  if (originalMp === undefined) delete global.mp;
  else global.mp = originalMp;
});

beforeEach(() => {
  posicoes.clear();
  posicoes.set(NA_ZONA, { pos: [0, 0, 0], cellOrWorldDesc: CELULA_SEGURA });
  posicoes.set(FORA, { pos: [0, 0, 0], cellOrWorldDesc: OUTRA_CELULA });
  posicoes.set(LONGE_NA_MESMA_CELULA, { pos: [9000, 0, 0], cellOrWorldDesc: CELULA_SEGURA });

  safeZones._setZones([
    { id: 'templo', label: 'Templo de Kynareth', cellId: CELULA_SEGURA, pos: null, radius: null, blocks: ['combat'] }
  ]);
});

describe('safe-zones — sem configuração, não existe zona', () => {
  it('lista vazia não protege ninguém', () => {
    safeZones._setZones([]);
    assert.strictEqual(safeZones.zoneOf(NA_ZONA), null);
    assert.deepEqual(safeZones.blocksCategory(NA_ZONA, 'combat'), { blocked: false });
  });

  it('config ausente no disco resulta em lista vazia, não em erro', () => {
    // O arquivo real não existe no repositório (só o .example).
    assert.deepEqual(safeZones.loadZones(), []);
  });
});

describe('safe-zones — célula inteira', () => {
  it('quem está na célula está na zona', () => {
    const zona = safeZones.zoneOf(NA_ZONA);
    assert.ok(zona);
    assert.strictEqual(zona.id, 'templo');
  });

  it('quem está em outra célula não está', () => {
    assert.strictEqual(safeZones.zoneOf(FORA), null);
  });

  it('sem raio, distância dentro da célula não importa', () => {
    assert.ok(safeZones.zoneOf(LONGE_NA_MESMA_CELULA), 'a zona é a célula toda');
  });

  it('só bloqueia a categoria configurada', () => {
    assert.strictEqual(safeZones.blocksCategory(NA_ZONA, 'combat').blocked, true);
    assert.strictEqual(safeZones.blocksCategory(NA_ZONA, 'trade').blocked, false);
  });
});

describe('safe-zones — raio', () => {
  beforeEach(() => {
    safeZones._setZones([
      { id: 'praca', label: 'Praça do Mercado', cellId: CELULA_SEGURA, pos: [0, 0, 0], radius: 1000, blocks: ['combat'] }
    ]);
  });

  it('dentro do raio está protegido', () => {
    posicoes.set(NA_ZONA, { pos: [500, 0, 0], cellOrWorldDesc: CELULA_SEGURA });
    assert.ok(safeZones.zoneOf(NA_ZONA));
  });

  it('na mesma célula mas fora do raio não está', () => {
    assert.strictEqual(
      safeZones.zoneOf(LONGE_NA_MESMA_CELULA), null,
      'com raio, a célula deixa de ser suficiente'
    );
  });

  it('a fronteira do raio conta como dentro', () => {
    posicoes.set(NA_ZONA, { pos: [1000, 0, 0], cellOrWorldDesc: CELULA_SEGURA });
    assert.ok(safeZones.zoneOf(NA_ZONA));
  });
});

describe('safe-zones — a regra dos dois lados', () => {
  it('agressor protegido não pode agir sobre quem está fora', () => {
    // O abuso óbvio: ficar dentro da zona atirando pra fora.
    const r = safeZones.blocksBetween(NA_ZONA, FORA, 'combat');
    assert.strictEqual(r.blocked, true);
    assert.strictEqual(r.side, 'actor');
  });

  it('alvo protegido não pode ser atingido de fora', () => {
    const r = safeZones.blocksBetween(FORA, NA_ZONA, 'combat');
    assert.strictEqual(r.blocked, true);
    assert.strictEqual(r.side, 'target');
  });

  it('dois lados fora da zona: liberado', () => {
    posicoes.set(0xff000009, { pos: [0, 0, 0], cellOrWorldDesc: OUTRA_CELULA });
    assert.strictEqual(safeZones.blocksBetween(FORA, 0xff000009, 'combat').blocked, false);
  });
});

describe('safe-zones — configuração inválida não vira comportamento surpresa', () => {
  it('ator sem locationalData não está em zona nenhuma', () => {
    assert.strictEqual(safeZones.zoneOf(0xdeadbeef), null);
  });

  it('locationalData sem célula não casa com zona', () => {
    posicoes.set(0xff00000a, { pos: [0, 0, 0] });
    assert.strictEqual(safeZones.zoneOf(0xff00000a), null);
  });

  it('as categorias válidas são as da action-policy', () => {
    // Se a action-policy ganhar uma categoria e esta lista não acompanhar,
    // configurá-la numa zona seria silenciosamente ignorado.
    const actionPolicy = require('./action-policy');
    const usadas = new Set();
    for (const acao of actionPolicy.listActions()) {
      for (const c of acao.categories) usadas.add(c);
    }
    const faltando = [...usadas].filter(c => !safeZones.CATEGORIAS_VALIDAS.has(c));
    assert.deepEqual(
      faltando, [],
      `categoria(s) usada(s) pela action-policy e desconhecida(s) aqui: ${faltando.join(', ')}`
    );
  });
});

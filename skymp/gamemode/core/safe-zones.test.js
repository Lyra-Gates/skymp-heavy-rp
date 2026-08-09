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
 * ─── Mutações verificadas (CONTRIBUTING.md §6) ───────────────────────────────
 *
 *   1. Remover a chamada a `motivoDeCellIdInvalido` do `parseZones`
 *        → reprova "cellId com prefixo 0x e recusado" e os outros três casos
 *          malformados: a zona volta a entrar na lista, inerte e silenciosa.
 *   2. Trocar o `continue` da recusa por um `console.error` sem `continue`
 *        → reprova os mesmos, e é a mutação que importa: logar sem remover é
 *          exatamente o estado que o achado descreve (parece ativa, não é).
 *   3. Afrouxar o regex de hex para aceitar qualquer coisa antes do `:`
 *        → reprova "hex invalido antes do ':' e recusado".
 *
 * As células dos fixtures estão no formato `FormDesc` real
 * (`"162e2:Skyrim.esm"`), não em hex com `0x`. Isso importa mesmo onde o teste
 * compara mock contra mock: o fixture é a documentação executável do formato, e
 * era ele que dava cobertura à ilusão de que `"0x162e2"` servia.
 *
 * Executa com: node --test core/safe-zones.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const NA_ZONA = 0xff000001;
const FORA = 0xff000002;
const LONGE_NA_MESMA_CELULA = 0xff000003;

// Formato `FormDesc`: hex SEM `0x`, `:`, arquivo. É o que
// `locationalData.cellOrWorldDesc` devolve — ver SKYMP_UPSTREAM_REFERENCE.md §8.5.
const CELULA_SEGURA = '162e2:Skyrim.esm';
const OUTRA_CELULA = '1a2b3:Skyrim.esm';

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

// ─────────────────────────────────────────────────────────────────────────────
// cellId malformado: o achado da REVISAO_REALIDADE_COMPARTILHADA.md §2 e §10
//
// `FormDesc::FromString` não valida, então um cellId no formato errado não dá
// erro em lugar nenhum: só nunca casa. A zona carrega, aparece nos logs como
// ativa e não protege ninguém — falha ABERTA. O que estes testes fixam é que
// isso agora é barulhento e a zona sai da lista.
// ─────────────────────────────────────────────────────────────────────────────

describe('safe-zones — cellId fora do formato FormDesc é recusado, alto', () => {
  const erros = [];
  const originalError = console.error;

  beforeEach(() => {
    erros.length = 0;
    console.error = (...args) => erros.push(args.join(' '));
  });

  const restaurar = () => { console.error = originalError; };
  after(restaurar);

  /** @returns {{zonas: object[], erros: string[]}} */
  function carregar(cellId) {
    const zonas = safeZones.parseZones({
      enabled: true,
      zones: [{ id: 'templo', label: 'Templo', cellId, blocks: ['combat'] }]
    });
    return { zonas, erros: [...erros] };
  }

  it('cellId bem formado carrega normalmente', () => {
    const { zonas, erros: logs } = carregar('162e2:Skyrim.esm');
    restaurar();
    assert.strictEqual(zonas.length, 1);
    assert.strictEqual(zonas[0].cellId, '162e2:Skyrim.esm');
    assert.deepStrictEqual(logs, [], 'zona valida nao deve gerar erro no log');
  });

  it('cellId com prefixo 0x é recusado — era o valor do exemplo', () => {
    const { zonas, erros: logs } = carregar('0x162e2');
    restaurar();
    assert.deepStrictEqual(zonas, [], 'a zona nao pode entrar na lista ativa');
    assert.strictEqual(logs.length, 1);
    assert.match(logs[0], /\[safe-zones\]/);
    assert.match(logs[0], /cellId invalido/);
    assert.match(logs[0], /IGNORADA/);
    // O aviso precisa dizer o que fazer, não só que está errado.
    assert.match(logs[0], /162e2:Skyrim\.esm/, 'o log deve sugerir a forma certa');
  });

  it('cellId sem o ":" é recusado — é o que resolve para outra faixa em silêncio', () => {
    const { zonas, erros: logs } = carregar('162e2');
    restaurar();
    assert.deepStrictEqual(zonas, []);
    assert.match(logs[0], /cellId invalido/);
  });

  it('hex inválido antes do ":" é recusado', () => {
    const { zonas, erros: logs } = carregar('templo:Skyrim.esm');
    restaurar();
    assert.deepStrictEqual(zonas, []);
    assert.match(logs[0], /nao e hexadecimal/);
  });

  it('arquivo vazio depois do ":" é recusado', () => {
    const { zonas } = carregar('162e2:');
    restaurar();
    assert.deepStrictEqual(zonas, []);
  });

  it('uma zona malformada não derruba as válidas da mesma config', () => {
    const zonas = safeZones.parseZones({
      enabled: true,
      zones: [
        { id: 'quebrada', cellId: '0x162e2', blocks: ['combat'] },
        { id: 'boa', cellId: '1a26f:Skyrim.esm', blocks: ['combat'] }
      ]
    });
    restaurar();
    assert.strictEqual(zonas.length, 1);
    assert.strictEqual(zonas[0].id, 'boa');
  });

  it('a zona recusada não protege ninguém — é o efeito, não só o log', () => {
    const zonas = safeZones.parseZones({
      enabled: true,
      zones: [{ id: 'templo', cellId: '0x162e2', blocks: ['combat'] }]
    });
    restaurar();
    safeZones._setZones(zonas);
    // O ator está exatamente na célula que a config queria proteger.
    posicoes.set(NA_ZONA, { pos: [0, 0, 0], cellOrWorldDesc: '162e2:Skyrim.esm' });
    assert.strictEqual(safeZones.zoneOf(NA_ZONA), null);
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

  it('o exemplo em disco usa o formato FormDesc', () => {
    // Este é o caminho pelo qual o defeito entraria: alguém copia o exemplo.
    // Enquanto ele trouxe `"0x162e2"`, copiar o exemplo produzia uma zona que
    // carregava, aparecia como ativa e nunca disparava.
    const fs = require('fs');
    const path = require('path');
    const exemplo = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'config', 'safe-zones.example.json'), 'utf8'
    ));
    for (const z of exemplo.zones) {
      assert.strictEqual(
        safeZones.motivoDeCellIdInvalido(z.cellId), null,
        `zona '${z.id}' do exemplo tem cellId invalido: ${z.cellId}`
      );
    }
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

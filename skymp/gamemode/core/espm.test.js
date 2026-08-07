/**
 * core/espm.test.js
 *
 * O formato que estes testes assumem **não foi inventado**: foi lido de um
 * servidor real em 06/08/2026, com uma sonda apontada como gamemode. Os
 * retornos abaixo são cópias do que o log mostrou — inclusive o `{}` para
 * FormID que não é record de plugin, que é o detalhe que uma implementação
 * adivinhada erraria (é truthy).
 *
 * O que estes testes protegem, além do óbvio: a decisão de **deixar passar
 * quando não dá pra saber**. Esta validação existe pra pegar erro de digitação,
 * não pra ser autoridade sobre o que é item — e uma versão futura que a
 * transforme em bloqueio quebraria `/additem` em qualquer servidor onde a API
 * não exista.
 *
 * Executa com: node --test core/espm.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const GOLD = 0x0000000f;
const IRON_SWORD = 0x00012eb7;
const IRON_CUIRASS = 0x00012e49;
const PLAYER_REF = 0x00000014;
const INEXISTENTE = 0x7fffffff;

// Respostas reais do servidor, encurtadas: `fields` vem com centenas de bytes
// e nada aqui olha pra ele.
const RESPOSTAS = {
  [GOLD]: { record: { id: 15, editorId: 'Gold001', type: 'MISC', flags: 0, fields: [] } },
  [IRON_SWORD]: { record: { id: 77495, editorId: 'IronSword', type: 'WEAP', flags: 0, fields: [] } },
  [IRON_CUIRASS]: { record: { id: 77385, editorId: 'ArmorIronCuirass', type: 'ARMO', flags: 0, fields: [] } },
  // O que o servidor devolve pra referência e pra FormID inexistente: `{}`.
  [PLAYER_REF]: {},
  [INEXISTENTE]: {}
};

let consultas;
const mpOriginal = global.mp;

global.mp = {
  lookupEspmRecordById: (formId) => {
    consultas.push(formId);
    return RESPOSTAS[formId] !== undefined ? RESPOSTAS[formId] : {};
  }
};

const espm = require('./espm');

after(() => {
  if (mpOriginal === undefined) delete global.mp;
  else global.mp = mpOriginal;
});

beforeEach(() => {
  consultas = [];
  espm._limparCache();
});

describe('espm — o formato real do retorno', () => {
  it('lê type e editorId de um record que existe', () => {
    const r = espm.lookup(GOLD);
    assert.deepEqual(r, { existe: true, type: 'MISC', editorId: 'Gold001' });
  });

  it('`{}` significa "não é record de plugin", e `{}` é truthy', () => {
    // O erro que uma implementacao adivinhada cometeria: checar `if (r)` em vez
    // de `if (r && r.record)`. `{}` passaria, e o Player viraria um item.
    assert.strictEqual(espm.lookup(PLAYER_REF).existe, false);
    assert.strictEqual(espm.lookup(INEXISTENTE).existe, false);
  });

  it('baseId não numérico não consulta nada', () => {
    assert.strictEqual(espm.lookup(NaN).existe, false);
    assert.strictEqual(consultas.length, 0);
  });
});

describe('espm — pareceItem', () => {
  it('aceita arma, armadura e item diverso', () => {
    for (const id of [GOLD, IRON_SWORD, IRON_CUIRASS]) {
      assert.strictEqual(espm.pareceItem(id).ok, true, `0x${id.toString(16)} deveria passar`);
    }
  });

  it('recusa FormID que não existe, e diz isso', () => {
    const r = espm.pareceItem(INEXISTENTE);
    assert.strictEqual(r.ok, false);
    assert.match(r.motivo, /nao existe/);
  });

  it('recusa record que não vai pra inventário, e diz o que ele é', () => {
    // Um NPC_ digitado por engano no lugar de um item.
    RESPOSTAS[0x00013480] = { record: { id: 78976, editorId: 'Lydia', type: 'NPC_', flags: 0, fields: [] } };
    const r = espm.pareceItem(0x00013480);

    assert.strictEqual(r.ok, false);
    assert.match(r.motivo, /NPC_/, 'a mensagem precisa dizer o que o FormID e, senao nao ajuda a corrigir');
    assert.match(r.motivo, /Lydia/);
    delete RESPOSTAS[0x00013480];
  });

  it('a lista é de permissão, não de bloqueio', () => {
    // Um tipo que ninguem lembrou de proibir nao pode passar por isso.
    RESPOSTAS[0x00099999] = { record: { id: 1, editorId: 'AlgumaCoisa', type: 'QUST', flags: 0, fields: [] } };
    assert.strictEqual(espm.pareceItem(0x00099999).ok, false);
    delete RESPOSTAS[0x00099999];
  });
});

describe('espm — deixa passar quando não dá pra saber', () => {
  it('sem a função na API, não bloqueia', () => {
    const salvo = global.mp;
    global.mp = {}; // servidor sem lookupEspmRecordById
    espm._limparCache();

    assert.strictEqual(
      espm.pareceItem(INEXISTENTE).ok, true,
      'a validacao existe pra pegar erro de digitacao, nao pra quebrar /additem onde a API nao existe'
    );

    global.mp = salvo;
  });

  it('erro na consulta não vira "item inválido"', () => {
    const salvo = global.mp;
    global.mp = { lookupEspmRecordById: () => { throw new Error('boom'); } };
    espm._limparCache();

    const originalError = console.error;
    console.error = () => {};
    const r = espm.pareceItem(GOLD);
    console.error = originalError;

    assert.strictEqual(r.ok, true, 'instabilidade da API nao pode bloquear operacao legitima');
    global.mp = salvo;
  });
});

describe('espm — cache', () => {
  it('consulta o servidor uma vez por baseId', () => {
    // O retorno traz todos os fields em bytes; a load order nao muda em runtime.
    espm.lookup(GOLD);
    espm.lookup(GOLD);
    espm.lookup(GOLD);

    assert.strictEqual(consultas.length, 1, 'o resultado e imutavel enquanto o servidor roda');
  });

  it('baseIds diferentes são consultados separadamente', () => {
    espm.lookup(GOLD);
    espm.lookup(IRON_SWORD);
    assert.deepEqual(consultas, [GOLD, IRON_SWORD]);
  });

  it('o resultado "não existe" também é cacheado', () => {
    espm.lookup(INEXISTENTE);
    espm.lookup(INEXISTENTE);
    assert.strictEqual(consultas.length, 1, 'FormID errado repetido nao pode custar consulta toda vez');
  });
});

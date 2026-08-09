/**
 * corpse-probe.test.js
 *
 * A sonda é a Peça 2 da §16 do `HOSTILE_MOB_ACTIVATION_DECISION.md`, e a
 * resposta dela escolhe entre três desenhos incompatíveis de uma feature
 * inteira. Um instrumento assim erra de duas maneiras, e as duas são caras:
 *
 *   - **Falso positivo**: dizer "escreve" porque `mp.set` não lançou. Uma API
 *     que aceita a chamada e ignora o valor em silêncio é o caso mais provável
 *     de todos, e o único que uma checagem de exceção nunca pegaria. É o
 *     terceiro teste daqui, e é o que justifica o passo de reler.
 *   - **Tocar um jogador**. `mp.set(actorId, 'inventory', {entries: []})` num
 *     ator de jogador apaga o inventário de alguém — e ao contrário do cadáver
 *     de um lobo, aquilo passou pelo `transaction-service` e tem meses dentro.
 *
 * ─── Mutações verificadas (CONTRIBUTING.md §6) ───────────────────────────────
 *
 *   1. Tirar o passo "reler" e classificar por `mp.set` não ter lançado
 *      → reprova "mp.set aceito e ignorado NAO conta como escrita".
 *   2. Tirar a varredura de profileId de `motivoDeRecusa`
 *      → reprova "recusa ator de jogador conectado sem personagem ativo".
 *   3. Tirar a checagem `getActiveCharacterData`
 *      → reprova "recusa ator de personagem ativo".
 *   4. Tirar o passo "restaurar"
 *      → reprova "restaura o inventario original depois de provar a escrita".
 *   5. Fazer `_estaVazio` devolver `false` (em vez de `null`) para formato
 *      desconhecido → reprova "formato desconhecido vira INDETERMINADO".
 *
 * Executa com: node --test corpse-probe.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith('/database') || request === './database' || request === '../database') {
    return { query: async () => [], getConnection: async () => ({}), init: () => {} };
  }
  return originalLoad.apply(this, arguments);
};

const CADAVER = 0x000a0001;
const ATOR_DE_JOGADOR = 0xff000001;
const ATOR_COM_PERSONAGEM = 0xff000002;

const INVENTARIO_ORIGINAL = { entries: [{ baseId: 0x1a, count: 2 }, { baseId: 0x2b, count: 1 }] };

let inventarios = new Map();
let jogadoresPorPerfil = new Map();
let comportamentoDoSet = 'normal'; // 'normal' | 'ignora' | 'lanca'
const chamadasSet = [];

const originalMp = global.mp;
global.mp = {
  getDescFromId: (formId) => `${formId.toString(16)}:Skyrim.esm`,
  getActorsByProfileId: (profileId) => jogadoresPorPerfil.get(profileId) || [],
  get: (actorId, prop) => {
    if (prop === 'inventory') return inventarios.has(actorId) ? inventarios.get(actorId) : undefined;
    if (prop === 'baseDesc') return '1a6a0:Skyrim.esm';
    return null;
  },
  set: (actorId, prop, valor) => {
    chamadasSet.push({ actorId, prop, valor });
    if (comportamentoDoSet === 'lanca') throw new Error('property somente leitura');
    if (comportamentoDoSet === 'ignora') return; // aceita e nao muda nada — o caso perigoso
    inventarios.set(actorId, valor);
  },
  callPapyrusFunction: () => 0
};

const commands = require('./commands');
const sonda = require('./corpse-probe');

Module._load = originalLoad;

after(() => {
  if (originalMp === undefined) delete global.mp;
  else global.mp = originalMp;
});

beforeEach(() => {
  chamadasSet.length = 0;
  comportamentoDoSet = 'normal';
  inventarios = new Map([[CADAVER, INVENTARIO_ORIGINAL]]);
  jogadoresPorPerfil = new Map([[3, [ATOR_DE_JOGADOR]]]);
  commands.removeActiveCharacter(ATOR_COM_PERSONAGEM);
});

// ─────────────────────────────────────────────────────────────────────────────
// A recusa dura
// ─────────────────────────────────────────────────────────────────────────────

describe('corpse-probe — nunca toca inventario de jogador', () => {
  it('recusa ator de personagem ativo', () => {
    commands.registerActiveCharacter(
      ATOR_COM_PERSONAGEM,
      { id: 7001, first_name: 'Alguem', last_name: 'Vivo' }, 1, 1
    );

    const r = sonda.sondar(ATOR_COM_PERSONAGEM);

    assert.match(r.recusado, /personagem ativo/);
    assert.strictEqual(chamadasSet.length, 0, 'nem uma escrita — a recusa precisa vir ANTES de qualquer mp.set');
    assert.strictEqual(r.veredito, null, 'recusa nao produz veredito: nao houve experimento');
  });

  it('recusa ator de jogador conectado sem personagem ativo', () => {
    // A janela entre conectar e escolher personagem. `getActiveCharacterData`
    // devolve undefined aqui, e sozinha ela deixaria passar.
    const r = sonda.sondar(ATOR_DE_JOGADOR);

    assert.match(r.recusado, /profileId 3/);
    assert.strictEqual(chamadasSet.length, 0);
  });

  it('deixa passar um ator que nao e de ninguem', () => {
    assert.strictEqual(sonda.motivoDeRecusa(CADAVER), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Os três desenhos
// ─────────────────────────────────────────────────────────────────────────────

describe('corpse-probe — o veredito escolhe o desenho', () => {
  it('le, esvazia e confirma relendo -> desenho pedido', () => {
    const r = sonda.sondar(CADAVER);

    assert.strictEqual(r.veredito, 'LE_E_ESCREVE');
    assert.match(r.desenho, /transaction-service/);
    assert.deepStrictEqual(r.inventarioOriginal, INVENTARIO_ORIGINAL);
    assert.strictEqual(r.formatoObservado, 'object{entries}', 'o formato observado vale tanto quanto o veredito');
  });

  it('mp.set aceito e ignorado NAO conta como escrita', () => {
    comportamentoDoSet = 'ignora';

    const r = sonda.sondar(CADAVER);

    assert.strictEqual(
      r.veredito, 'LE_MAS_NAO_ESCREVE',
      'ESTE e o falso positivo perigoso: sem o passo de reler, "mp.set nao lancou" viraria "escreve"'
    );
    assert.match(r.desenho, /Plano C/);
    assert.deepStrictEqual(
      inventarios.get(CADAVER), INVENTARIO_ORIGINAL,
      'e o cadaver continua intacto, que e o que de fato aconteceu'
    );
  });

  it('mp.set que lanca -> Plano C', () => {
    comportamentoDoSet = 'lanca';

    const r = sonda.sondar(CADAVER);

    assert.strictEqual(r.veredito, 'LE_MAS_NAO_ESCREVE');
    assert.ok(r.passos.some(p => p.passo === 'esvaziar' && p.ok === false));
  });

  it('inventario ilegivel e inescrivel -> Plano B, a mecanica perde o loot', () => {
    inventarios = new Map(); // mp.get devolve undefined
    comportamentoDoSet = 'lanca';

    const r = sonda.sondar(CADAVER);

    assert.strictEqual(r.veredito, 'NAO_LE_NAO_ESVAZIA');
    assert.match(r.desenho, /Plano B/);
    assert.match(r.desenho, /Cacador volta a estaca zero/);
  });

  it('formato desconhecido vira INDETERMINADO, nunca sucesso', () => {
    inventarios = new Map([[CADAVER, { itens: ['formato inesperado'] }]]);
    comportamentoDoSet = 'ignora';

    const r = sonda.sondar(CADAVER);

    assert.strictEqual(
      r.veredito, 'INDETERMINADO',
      'as duas vezes em que este projeto assumiu formato de API sem ver custaram caro'
    );
    assert.match(r.desenho, /NAO trate como sucesso/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A restauração
// ─────────────────────────────────────────────────────────────────────────────

describe('corpse-probe — devolve o mundo ao estado anterior', () => {
  it('restaura o inventario original depois de provar a escrita', () => {
    const r = sonda.sondar(CADAVER);

    assert.strictEqual(r.restaurado, true);
    assert.deepStrictEqual(
      inventarios.get(CADAVER), INVENTARIO_ORIGINAL,
      'esvaziar e ir embora destruiria o loot daquele cadaver sem necessidade'
    );
    assert.deepStrictEqual(
      r.passos.map(p => p.passo), ['ler', 'esvaziar', 'reler', 'restaurar'],
      'os quatro passos, nesta ordem'
    );
  });

  it('restauracao que falha vira aviso alto, com o conteudo original no arquivo', () => {
    let chamadas = 0;
    const setNormal = global.mp.set;
    global.mp.set = (actorId, prop, valor) => {
      chamadas++;
      if (chamadas === 2) throw new Error('falhou ao repor'); // a restauração
      return setNormal(actorId, prop, valor);
    };
    try {
      const r = sonda.sondar(CADAVER);

      assert.strictEqual(r.restaurado, false);
      assert.match(r.avisoDeRestauracao, /ficou VAZIO/);
      assert.deepStrictEqual(
        r.inventarioOriginal, INVENTARIO_ORIGINAL,
        'sem isto no relatorio nao ha como repor a mao, e o item se perde de vez'
      );
    } finally {
      global.mp.set = setNormal;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A regra pura
// ─────────────────────────────────────────────────────────────────────────────

describe('corpse-probe — classificar', () => {
  it('cobre a tabela da §16 inteira', () => {
    assert.strictEqual(sonda.classificar(true, true).veredito, 'LE_E_ESCREVE');
    assert.strictEqual(sonda.classificar(true, false).veredito, 'LE_MAS_NAO_ESCREVE');
    assert.strictEqual(sonda.classificar(false, false).veredito, 'NAO_LE_NAO_ESVAZIA');
    assert.strictEqual(sonda.classificar(false, true).veredito, 'ESCREVE_MAS_NAO_LE');
    assert.strictEqual(sonda.classificar(true, null).veredito, 'INDETERMINADO');
    assert.strictEqual(sonda.classificar(false, null).veredito, 'NAO_LE_NAO_ESVAZIA');
  });

  it('_estaVazio e tolerante ao formato mas nao chuta', () => {
    assert.strictEqual(sonda._estaVazio({ entries: [] }), true);
    assert.strictEqual(sonda._estaVazio({ entries: [{ baseId: 1 }] }), false);
    assert.strictEqual(sonda._estaVazio([]), true);
    assert.strictEqual(sonda._estaVazio([1]), false);
    assert.strictEqual(sonda._estaVazio({}), true);
    assert.strictEqual(sonda._estaVazio(undefined), null, '"nao sei" nao pode virar "sim"');
    assert.strictEqual(sonda._estaVazio('cheio'), null);
    assert.strictEqual(sonda._estaVazio({ itens: [] }), null, 'formato desconhecido: nao chuta');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permissão
// ─────────────────────────────────────────────────────────────────────────────

describe('corpse-probe — o comando exige staff', () => {
  it('sem permissao, nao sonda nada', () => {
    const def = sonda.commandDefs()[0];
    const notificacoes = [];
    const realNotify = commands.sendNotification;
    commands.sendNotification = (id, msg) => notificacoes.push(msg);
    try {
      def.handler(ATOR_DE_JOGADOR, '0x' + CADAVER.toString(16));
    } finally {
      commands.sendNotification = realNotify;
    }

    assert.deepStrictEqual(notificacoes, ['Sem permissao.']);
    assert.strictEqual(chamadasSet.length, 0, 'a checagem de permissao vem antes de tudo');
  });
});

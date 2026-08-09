/**
 * core/death-events.test.js
 *
 * O defeito que estes testes existem para impedir não é hipotético e não é
 * sobre este arquivo: até 08/08/2026 o `death-service.js` fazia
 * `mp.onDeath = (...) => {...}`. Qualquer segundo módulo que precisasse do
 * mesmo hook — e o `hunting-service` do `HOSTILE_MOB_ACTIVATION_DECISION.md`
 * §7.3 é o primeiro que vai precisar — escreveria por cima e a detecção de
 * morte de JOGADOR pararia. Sem erro, sem log, sem crash: o polling de 2 s do
 * próprio `death-service` cobriria o buraco com dois segundos de atraso, que é
 * pouco o bastante para ninguém desconfiar.
 *
 * O teste que importa é o último ("integração"). Os anteriores exercitam o
 * barramento; só ele prova que o `death-service` **usa** o barramento.
 *
 * ─── Mutações verificadas (CONTRIBUTING.md §6) ───────────────────────────────
 *
 *   1. Trocar `deathEvents.subscribe('death-service', ...)` de volta por
 *      `mp.onDeath = ...` em `death-service.js`
 *        → reprova "o segundo assinante nao silencia a deteccao de morte de jogador".
 *   2. Trocar o `Map.set` de `subscribe()` por uma variável única (`_handler = fn`)
 *        → reprova "dois assinantes recebem a mesma morte".
 *   3. Tirar o `try/catch` de dentro do laço de `_dispatch`
 *        → reprova "assinante que lanca nao impede os demais".
 *   4. Trocar o `throw` de nome duplicado por um `return` silencioso
 *        → reprova "inscricao duplicada lanca".
 *
 * Executa com: node --test core/death-events.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, afterEach, after } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────
// Mock de banco — o teste de integração carrega o death-service inteiro, que
// puxa `./database` e `core/transaction-service`. Mesmo padrão de
// death-service.test.js.
// ─────────────────────────────────────────────────────────────────────────────

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith('/database') || request === './database' || request === '../database') {
    return {
      query: async () => [],
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async () => [[]]
      }),
      init: () => {}
    };
  }
  return originalLoad.apply(this, arguments);
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock de `mp`. Precisa existir ANTES do primeiro subscribe(), porque é ele que
// instala o hook.
// ─────────────────────────────────────────────────────────────────────────────

const originalMp = global.mp;
const mpState = new Map();

global.mp = {
  get: (actorId, prop) => mpState.get(`${actorId}:${prop}`) ?? null,
  set: (actorId, prop, value) => mpState.set(`${actorId}:${prop}`, value),
  getDescFromId: (formId) => `${formId.toString(16)}:Skyrim.esm`,
  callPapyrusFunction: () => null,
  getActorsByProfileId: () => []
};

const deathEvents = require('./death-events');
const commands = require('../commands');
const characterState = require('./character-state');
const { STATES } = characterState;
const deathService = require('../death-service');

Module._load = originalLoad;

after(() => {
  if (originalMp === undefined) delete global.mp;
  else global.mp = originalMp;
});

/** Remove tudo que este arquivo inscreveu, para um teste não vazar no outro. */
function limparAssinantes() {
  for (const nome of deathEvents.subscriberNames()) deathEvents.unsubscribe(nome);
}

// ─────────────────────────────────────────────────────────────────────────────
// O barramento
// ─────────────────────────────────────────────────────────────────────────────

describe('death-events — o hook tem dono unico e varios assinantes', () => {
  beforeEach(limparAssinantes);
  afterEach(limparAssinantes);

  it('dois assinantes recebem a mesma morte', () => {
    const recebido = [];
    deathEvents.subscribe('primeiro', (actorId, killerId) => recebido.push(['primeiro', actorId, killerId]));
    deathEvents.subscribe('segundo', (actorId, killerId) => recebido.push(['segundo', actorId, killerId]));

    // Pelo hook de verdade, não pelo `_dispatch`: é o caminho que o servidor usa.
    global.mp.onDeath(0xff000001, 0x000a0001);

    assert.deepStrictEqual(recebido, [
      ['primeiro', 0xff000001, 0x000a0001],
      ['segundo', 0xff000001, 0x000a0001]
    ], 'o segundo assinante nao pode substituir o primeiro — e o defeito inteiro que este arquivo existe pra travar');
  });

  it('assinante que lanca nao impede os demais', () => {
    const rodou = [];
    deathEvents.subscribe('quebrado', () => { throw new Error('boom'); });
    deathEvents.subscribe('saudavel', () => rodou.push('saudavel'));

    assert.doesNotThrow(() => global.mp.onDeath(0xff000001, 0));

    assert.deepStrictEqual(
      rodou, ['saudavel'],
      'se o hunting-service quebrar concedendo loot, a queda do jogador ainda precisa virar DOWNED'
    );
  });

  it('inscricao duplicada lanca em vez de perder um handler', () => {
    deathEvents.subscribe('mesmo-nome', () => {});

    assert.throws(
      () => deathEvents.subscribe('mesmo-nome', () => {}),
      /ja esta inscrito/,
      'silenciar a duplicata reintroduz exatamente o defeito: um handler perdido sem ninguem saber'
    );
  });

  it('unsubscribe tira o assinante do despacho', () => {
    const rodou = [];
    deathEvents.subscribe('temporario', () => rodou.push('temporario'));
    deathEvents.subscribe('permanente', () => rodou.push('permanente'));

    deathEvents.unsubscribe('temporario');
    global.mp.onDeath(0xff000001, 0);

    assert.deepStrictEqual(rodou, ['permanente']);
  });

  it('subscribe recusa nome vazio e handler que nao e funcao', () => {
    assert.throws(() => deathEvents.subscribe('', () => {}), /nome nao-vazio/);
    assert.throws(() => deathEvents.subscribe('   ', () => {}), /nome nao-vazio/);
    assert.throws(() => deathEvents.subscribe('x', null), /exige uma funcao/);
  });

  it('grita quando encontra mp.onDeath ja atribuido direto', () => {
    deathEvents._resetForTest();
    // Simula alguém que voltou a usar a atribuição direta em algum módulo.
    global.mp.onDeath = () => {};

    const erros = [];
    const realError = console.error;
    console.error = (...args) => erros.push(args.join(' '));
    try {
      deathEvents.subscribe('chegou-depois', () => {});
    } finally {
      console.error = realError;
    }

    assert.ok(
      erros.some(e => e.includes('JA tinha uma funcao atribuida')),
      'a perda de um handler nao pode ser silenciosa — o aviso e a unica coisa que aponta pro arquivo culpado'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integração — o teste que a §16 do HOSTILE_MOB_ACTIVATION_DECISION pede
// primeiro, antes de qualquer linha de hunting-service
// ─────────────────────────────────────────────────────────────────────────────

describe('death-events — um segundo consumidor nao silencia o death-service', () => {
  const VITIMA_ACTOR = 0xff00e001;
  const VITIMA_CHARACTER = 9001;

  after(limparAssinantes);

  it('o death-service assina o barramento em vez de tomar o hook', () => {
    // Estado de boot de verdade: hook não instalado. Sem isto o teste herda o
    // `_hookInstalled = true` dos casos acima, e a instalação — que é onde mora
    // a proteção — nunca roda. É o que faz a mutação "voltar para
    // `mp.onDeath = ...`" reprovar pela razão certa: com o hook limpo, o
    // assinante que chega depois passa por cima do death-service, que é
    // exatamente a ordem em que o hunting-service entraria no boot.
    deathEvents._resetForTest();

    // `initDeathService` cria um setInterval de 2 s (o polling de rede de
    // segurança) que NÃO é unref'd — em produção isso é correto, num teste
    // seguraria o processo aberto. Trocamos o global só durante o init para
    // poder desligá-lo depois; o resto do serviço sobe de verdade.
    const realSetInterval = global.setInterval;
    const timers = [];
    global.setInterval = (fn, ms) => {
      const t = realSetInterval(fn, ms);
      if (typeof t.unref === 'function') t.unref();
      timers.push(t);
      return t;
    };
    try {
      deathService.initDeathService();
    } finally {
      global.setInterval = realSetInterval;
      for (const t of timers) clearInterval(t);
    }

    assert.ok(
      deathEvents.subscriberNames().includes('death-service'),
      'o death-service precisa entrar pelo barramento; com `mp.onDeath = ...` ele nao aparece aqui'
    );
  });

  it('a morte de jogador vira DOWNED mesmo com um segundo assinante inscrito depois', async () => {
    // O segundo consumidor entra DEPOIS do death-service, que é exatamente a
    // ordem em que o hunting-service entraria: um módulo lab, ligado por flag,
    // inicializado na sequência do registry.
    let segundoRodou = false;
    deathEvents.subscribe('hunting-service-fake', () => { segundoRodou = true; });

    commands.registerActiveCharacter(
      VITIMA_ACTOR,
      { id: VITIMA_CHARACTER, first_name: 'Vitima', last_name: 'DoBarramento' },
      1, 1
    );
    characterState.set(VITIMA_CHARACTER, STATES.NORMAL, {});
    mpState.set(`${VITIMA_ACTOR}:locationalData`, { pos: [0, 0, 0], cellOrWorldDesc: 'whiterun' });
    mpState.set(`${VITIMA_ACTOR}:type`, 'MpActor');
    deathService._downedPlayers.clear();

    global.mp.onDeath(VITIMA_ACTOR, 0x000a0001);

    // `handlePlayerDowned` é async e o hook não espera por ela — o estado DOWNED
    // é setado de forma síncrona, mas o `await logKiller` que vem depois cede o
    // controle. Um tick basta e não é espera arbitrária.
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(
      characterState.get(VITIMA_CHARACTER), STATES.DOWNED,
      'ESTE e o defeito perigoso: com `mp.onDeath = ...` no death-service, o assinante que ' +
      'chega depois passa por cima e a queda so seria vista pelo polling de 2 s — atrasada, ' +
      'sem killerId, e sem nenhum erro no log'
    );
    assert.strictEqual(segundoRodou, true, 'o segundo consumidor tambem precisa receber');
    assert.strictEqual(
      deathService.isDowned(VITIMA_CHARACTER), true,
      'e o killerId precisa ter chegado junto: e ele que fecha o alibi de RDM da §4.3'
    );
  });
});

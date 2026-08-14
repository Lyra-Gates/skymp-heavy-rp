const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { createAdapter, SkympBoundaryError } = require('./index');
const { isKnownPapyrusFunction, METHODS, STATICS } = require('./papyrus-catalog');

/**
 * `mp` falso. Registra o que foi chamado para que os testes afirmem sobre o
 * **argumento que atravessou a fronteira**, e nao so sobre o retorno — e o
 * argumento errado que era o bug.
 */
function fakeMp({ userByActor = {}, semUserByActor = false, semReflexao = true, reflexao = {} } = {}) {
  const chamadas = [];
  const mp = {
    kick: (userId) => chamadas.push(['kick', userId]),
    callPapyrusFunction: (t, c, f, self, args) => {
      chamadas.push(['papyrus', t, c, f, self, args]);
      return 42;
    },
    getEspmLoadOrder: () => ['Skyrim.esm'],
    makeEventSource: () => {}
  };
  if (!semUserByActor) {
    mp.getUserByActor = (formId) => (formId in userByActor ? userByActor[formId] : -1);
  }
  if (!semReflexao) {
    mp._sp3GetFunctionImplementation = (cls, fn, isStatic) => {
      const chave = `${cls}.${fn}:${isStatic ? 'global' : 'method'}`.toLowerCase();
      return reflexao[chave] ? {} : null;
    };
  }
  return { mp, chamadas };
}

describe('skymp-adapter — identidade (userId x actorId)', () => {
  it('kick converte actorId em userId antes de chamar mp.kick', () => {
    const { mp, chamadas } = fakeMp({ userByActor: { 0xff000001: 3 } });
    const adapter = createAdapter({ mp });

    assert.equal(adapter.kick(0xff000001), true);
    // O ponto do modulo inteiro: o que chega em mp.kick e 3, nao 0xff000001.
    assert.deepEqual(chamadas, [['kick', 3]]);
  });

  it('kick devolve false e nao chama mp.kick quando o ator nao tem usuario', () => {
    const { mp, chamadas } = fakeMp({ userByActor: {} });
    const adapter = createAdapter({ mp });

    assert.equal(adapter.kick(0xff000009), false);
    assert.deepEqual(chamadas, []);
  });

  it('kick recusa em vez de chutar quando falta getUserByActor', () => {
    const erros = [];
    const { mp, chamadas } = fakeMp({ semUserByActor: true });
    const adapter = createAdapter({ mp, logger: { warn() {}, error: (m) => erros.push(m) } });

    // Chutar aqui significaria desconectar a pessoa errada.
    assert.equal(adapter.kick(0xff000001), false);
    assert.deepEqual(chamadas, []);
    assert.match(erros.join(' '), /getUserByActor/);
  });

  it('kick rejeita actorId que nao e inteiro nao-negativo', () => {
    const { mp } = fakeMp();
    const adapter = createAdapter({ mp });
    for (const ruim of [undefined, null, -1, 1.5, '0xff000001', NaN]) {
      assert.throws(() => adapter.kick(ruim), SkympBoundaryError);
    }
  });

  it('kickUser passa o userId direto, sem converter', () => {
    const { mp, chamadas } = fakeMp();
    const adapter = createAdapter({ mp });

    assert.equal(adapter.kickUser(7), true);
    assert.deepEqual(chamadas, [['kick', 7]]);
  });

  it('kick e kickUser devolvem false quando mp nao existe', () => {
    const adapter = createAdapter({ mp: null });
    assert.equal(adapter.kick(0xff000001), false);
    assert.equal(adapter.kickUser(1), false);
  });
});

describe('skymp-adapter — guarda de Papyrus', () => {
  it('deixa passar funcao que o servidor implementa', () => {
    const { mp, chamadas } = fakeMp();
    const adapter = createAdapter({ mp });

    const self = { type: 'form', desc: '14:Skyrim.esm' };
    assert.equal(adapter.callPapyrus('method', 'Actor', 'SetActorValue', self, ['Health', 100]), 42);
    assert.deepEqual(chamadas[0], ['papyrus', 'method', 'Actor', 'SetActorValue', self, ['Health', 100]]);
  });

  it('lanca em Actor.GetActorValue — o achado que derrubava todo jogador', () => {
    const { mp, chamadas } = fakeMp();
    const adapter = createAdapter({ mp });

    assert.throws(
      () => adapter.callPapyrus('method', 'Actor', 'getActorValue', {}, ['Health']),
      (err) => err instanceof SkympBoundaryError && /GetActorValue|getActorValue/i.test(err.message)
    );
    // Nao pode ter chegado ao motor.
    assert.deepEqual(chamadas, []);
  });

  it('lanca em Actor.Resurrect', () => {
    const { mp } = fakeMp();
    const adapter = createAdapter({ mp });
    assert.throws(() => adapter.callPapyrus('method', 'Actor', 'Resurrect', {}, []), SkympBoundaryError);
  });

  it('fora de strict, avisa e deixa passar', () => {
    const avisos = [];
    const { mp, chamadas } = fakeMp();
    const adapter = createAdapter({ mp, strict: false, logger: { warn: (m) => avisos.push(m), error() {} } });

    assert.equal(adapter.callPapyrus('method', 'Actor', 'Resurrect', {}, []), 42);
    assert.equal(chamadas.length, 1);
    assert.match(avisos.join(' '), /Resurrect/);
  });

  it('rejeita callType invalido antes de qualquer outra coisa', () => {
    const { mp, chamadas } = fakeMp();
    const adapter = createAdapter({ mp });
    assert.throws(() => adapter.callPapyrus('static', 'Debug', 'Notification', null, ['oi']), SkympBoundaryError);
    assert.deepEqual(chamadas, []);
  });

  it('a busca e case-insensitive, como o CIString do VM', () => {
    const { mp } = fakeMp();
    const adapter = createAdapter({ mp });
    assert.equal(adapter.papyrusFunctionExists('global', 'debug', 'NOTIFICATION'), true);
    assert.equal(adapter.papyrusFunctionExists('method', 'ACTOR', 'setactorvalue'), true);
  });

  it('separa metodo de estatica: Debug.Notification nao existe como method', () => {
    const { mp } = fakeMp();
    const adapter = createAdapter({ mp });
    assert.equal(adapter.papyrusFunctionExists('global', 'Debug', 'Notification'), true);
    assert.equal(adapter.papyrusFunctionExists('method', 'Debug', 'Notification'), false);
  });
});

describe('skymp-adapter — reflexao do VM tem precedencia sobre o catalogo', () => {
  it('aceita funcao que o catalogo nao conhece se o VM a implementa', () => {
    const { mp, chamadas } = fakeMp({
      semReflexao: false,
      reflexao: { 'actor.getactorvalue:method': true }
    });
    const adapter = createAdapter({ mp });

    // O catalogo diz que nao existe; o servidor diz que existe. O servidor vence.
    assert.equal(isKnownPapyrusFunction('method', 'Actor', 'GetActorValue'), false);
    assert.equal(adapter.callPapyrus('method', 'Actor', 'GetActorValue', {}, ['Health']), 42);
    assert.equal(chamadas.length, 1);
  });

  it('recusa funcao que o catalogo conhece se o VM nao a implementa', () => {
    const { mp } = fakeMp({ semReflexao: false, reflexao: {} });
    const adapter = createAdapter({ mp });

    assert.equal(isKnownPapyrusFunction('method', 'Actor', 'SetActorValue'), true);
    assert.throws(() => adapter.callPapyrus('method', 'Actor', 'SetActorValue', {}, []), SkympBoundaryError);
  });

  it('cai para o catalogo quando a reflexao lanca', () => {
    const avisos = [];
    const { mp } = fakeMp();
    mp._sp3GetFunctionImplementation = () => { throw new Error('VM ocupado'); };
    const adapter = createAdapter({ mp, logger: { warn: (m) => avisos.push(m), error() {} } });

    assert.equal(adapter.papyrusFunctionExists('method', 'Actor', 'SetActorValue'), true);
    assert.match(avisos.join(' '), /VM ocupado/);
  });

  it('consulta a reflexao uma vez por nome', () => {
    let consultas = 0;
    const { mp } = fakeMp();
    mp._sp3GetFunctionImplementation = () => { consultas++; return {}; };
    const adapter = createAdapter({ mp });

    adapter.papyrusFunctionExists('method', 'Actor', 'SetActorValue');
    adapter.papyrusFunctionExists('method', 'Actor', 'setactorvalue');
    assert.equal(consultas, 1);
  });
});

describe('skymp-adapter — capacidades', () => {
  it('detecta capacidade de metodo perguntando ao mp', () => {
    const { mp } = fakeMp();
    const adapter = createAdapter({ mp });

    assert.equal(adapter.supports('espmLoadOrder'), true);
    assert.equal(adapter.supports('headlessBot'), false);
    assert.equal(adapter.supports('papyrusReflection'), false);
  });

  it('capacidade declarada nao depende do mp — vem da leitura do upstream', () => {
    const adapter = createAdapter({ mp: {} });

    assert.equal(adapter.supports('nativeDeathEvent'), true);
    assert.equal(adapter.supports('loginAttemptHook'), true);
    // As tres que a auditoria provou ausentes.
    assert.equal(adapter.supports('playerSpawnHook'), false);
    assert.equal(adapter.supports('cellTransitionEvent'), false);
    assert.equal(adapter.supports('eslPlugins'), false);
  });

  it('capacidade desconhecida lanca em vez de responder false', () => {
    const adapter = createAdapter({ mp: {} });
    // Responder false a um nome com erro de digitacao seria pior que lancar:
    // o codigo desviaria para o caminho degradado sem ninguem perceber.
    assert.throws(() => adapter.supports('naoExiste'), SkympBoundaryError);
    assert.throws(() => adapter.explain('naoExiste'), SkympBoundaryError);
  });

  it('explain diz o motivo, nao so o booleano', () => {
    const { mp } = fakeMp();
    const adapter = createAdapter({ mp });

    assert.match(adapter.explain('espmLoadOrder'), /getEspmLoadOrder existe/);
    assert.match(adapter.explain('headlessBot'), /ausente/);
    assert.match(adapter.explain('playerSpawnHook'), /EventEmitter|spawn\.ts/);
    assert.match(adapter.explain('playerSpawnHook'), /d85f18d8/);
  });

  it('capabilities lista todas, detectadas e declaradas', () => {
    const { mp } = fakeMp();
    const todas = createAdapter({ mp }).capabilities();

    assert.equal(todas.espmLoadOrder, true);
    assert.equal(todas.playerSpawnHook, false);
    assert.ok(Object.keys(todas).length >= 18);
  });
});

describe('papyrus-catalog', () => {
  it('tem 88 metodos e 40 estaticas, extraidos de d85f18d8', () => {
    assert.equal(METHODS.size, 88);
    assert.equal(STATICS.size, 40);
  });

  it('todos os nomes estao em minusculo e no formato Classe.Funcao', () => {
    for (const nome of [...METHODS, ...STATICS]) {
      assert.equal(nome, nome.toLowerCase(), `"${nome}" nao esta em minusculo`);
      assert.match(nome, /^[a-z0-9]+\.[a-z0-9]+$/, `"${nome}" fora do formato`);
    }
  });

  it('as oito funcoes REQUIRED da politica estao no catalogo', () => {
    const obrigatorias = [
      ['method', 'Actor', 'SetActorValue'],
      ['method', 'Actor', 'PlayIdle'],
      ['method', 'ObjectReference', 'AddItem'],
      ['method', 'ObjectReference', 'RemoveItem'],
      ['method', 'ObjectReference', 'Disable'],
      ['global', 'Debug', 'Notification'],
      ['global', 'Debug', 'SendAnimationEvent'],
      ['global', 'Game', 'GetFormEx']
    ];
    for (const [t, c, f] of obrigatorias) {
      assert.equal(isKnownPapyrusFunction(t, c, f), true, `${c}.${f} sumiu do catalogo`);
    }
  });

  it('as funcoes AVOID nao estao no catalogo', () => {
    assert.equal(isKnownPapyrusFunction('method', 'Actor', 'GetActorValue'), false);
    assert.equal(isKnownPapyrusFunction('method', 'Actor', 'Resurrect'), false);
    assert.equal(isKnownPapyrusFunction('method', 'Actor', 'SetGhost'), false);
    assert.equal(isKnownPapyrusFunction('global', 'Debug', 'SendModEvent'), false);
  });

  it('callType invalido nunca casa', () => {
    assert.equal(isKnownPapyrusFunction('static', 'Debug', 'Notification'), false);
  });
});

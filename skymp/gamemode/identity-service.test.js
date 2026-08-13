/**
 * identity-service.test.js
 *
 * O sistema de identidade não tinha teste nenhum, e é o que sustenta o
 * disfarce: **o nome exibido depende de quem está olhando**
 * (`docs/technical/NAMETAG_IDENTITY_SYSTEM.md`).
 *
 * Por que isto vira teste agora
 * ─────────────────────────────
 * A regra Heavy RP §5 chama de metagaming "reconhecer personagens disfarçados
 * sem evidência in-character". Toda essa regra depende de uma única função
 * (`getDisplayName`) devolver "Desconhecido" para quem o observador não
 * conhece.
 *
 * Isso é frágil de um jeito específico: qualquer tela nova que puxe nome de
 * personagem de outra fonte — o painel web, o bot, um painel institucional —
 * mata o disfarce **sem erro nenhum**. Não quebra, não loga: o encapuzado
 * simplesmente passa a ser reconhecido. É a falha que ninguém percebe até um
 * jogador reclamar que sua cena foi arruinada.
 *
 * Estes testes fixam o contrato para que qualquer integração futura que o
 * viole falhe aqui, e não em jogo.
 *
 * Executa com: node --test identity-service.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');

const identityQueries = [];

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith('/database') || request === './database') {
    return {
      init: () => {},
      query: async (sql, params = []) => {
        identityQueries.push({ sql, params });
        if (/SELECT .* FROM character_known_identities/i.test(sql)) return [];
        return [];
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const identity = require('./identity-service');

Module._load = originalLoad;

const ALICE = { characterId: 1, firstName: 'Alvara', lastName: 'Dawnmere' };
const BRUNO = { characterId: 2, firstName: 'Bruno', lastName: 'Stonehand' };
const CARLA = { characterId: 3, firstName: 'Carla', lastName: 'Vex' };

beforeEach(() => {
  identityQueries.length = 0;
  for (const c of [ALICE, BRUNO, CARLA]) identity.forgetKnownIdentities(c.characterId);
});

describe('firewall de identidade — quem não conhece, não sabe o nome', () => {
  it('desconhecido aparece como Desconhecido, nao pelo nome civil', () => {
    const visto = identity.getDisplayName(ALICE, BRUNO);
    assert.equal(
      visto, identity.UNKNOWN_NAME,
      'Alvara nunca foi apresentada a Bruno; ver o nome civil dele e metagaming'
    );
    assert.ok(
      !/Bruno|Stonehand/.test(visto),
      'o nome civil vazou no lugar do rotulo de desconhecido'
    );
  });

  it('o proprio personagem se reconhece', () => {
    assert.equal(identity.getDisplayName(ALICE, ALICE), 'Alvara Dawnmere');
  });

  it('depois de apresentado, o nome aparece — e so para quem foi apresentado', () => {
    identity.cacheKnownIdentity(ALICE.characterId, BRUNO.characterId, 'Bruno Stonehand', 'introduced');

    assert.equal(identity.getDisplayName(ALICE, BRUNO), 'Bruno Stonehand');
    assert.equal(
      identity.getDisplayName(CARLA, BRUNO), identity.UNKNOWN_NAME,
      'conhecimento e por observador; Carla nao herda o que Alvara sabe'
    );
  });

  it('conhecimento nao e reciproco', () => {
    // Alvara sabe quem é Bruno. Bruno não sabe quem é Alvara. Isso é o caso
    // do informante, do espião e do encapuzado — e some se alguém "otimizar"
    // o cache para uma tabela de pares.
    identity.cacheKnownIdentity(ALICE.characterId, BRUNO.characterId, 'Bruno Stonehand', 'introduced');

    assert.equal(identity.getDisplayName(ALICE, BRUNO), 'Bruno Stonehand');
    assert.equal(identity.getDisplayName(BRUNO, ALICE), identity.UNKNOWN_NAME);
  });

  it('o apelido dado vale mais que o nome civil', () => {
    // Você conhece alguém como "O Corvo". O sistema mostra o que você aprendeu,
    // não o que o registro civil diz.
    identity.cacheKnownIdentity(ALICE.characterId, BRUNO.characterId, 'O Corvo', 'alias');
    assert.equal(identity.getDisplayName(ALICE, BRUNO), 'O Corvo');
  });

  it('sem observador, nunca revela nome civil', () => {
    // Caminho de chamada de sistema (log, painel, integração externa). Se um
    // consumidor esquecer de passar o observador, o padrao seguro e nao contar.
    assert.equal(identity.getDisplayName(null, BRUNO), identity.UNKNOWN_NAME);
    assert.equal(identity.getDisplayName(undefined, BRUNO), identity.UNKNOWN_NAME);
  });

  it('esquecer o observador apaga o que ele sabia', () => {
    identity.cacheKnownIdentity(ALICE.characterId, BRUNO.characterId, 'Bruno Stonehand', 'introduced');
    identity.forgetKnownIdentities(ALICE.characterId);
    assert.equal(
      identity.getDisplayName(ALICE, BRUNO), identity.UNKNOWN_NAME,
      'na desconexao o cache sai; a memoria volta do banco no proximo login'
    );
  });
});

describe('sanitização do nome exibido', () => {
  it('recusa o que nao e string', () => {
    for (const entrada of [null, undefined, 42, {}, []]) {
      assert.equal(identity.sanitizeDisplayName(entrada), '');
    }
  });

  it('nome vazio nao vira identidade conhecida', () => {
    identity.cacheKnownIdentity(ALICE.characterId, BRUNO.characterId, '   ', 'introduced');
    assert.equal(
      identity.getDisplayName(ALICE, BRUNO), identity.UNKNOWN_NAME,
      'nome em branco nao pode criar um vinculo de conhecimento vazio'
    );
  });

  it('upsert recusa vinculo invalido em vez de gravar lixo', async () => {
    await assert.rejects(
      () => identity.upsertKnownIdentity(null, BRUNO.characterId, 'Bruno', 'introduced'),
      /Invalid identity relationship/
    );
    await assert.rejects(
      () => identity.upsertKnownIdentity(ALICE.characterId, BRUNO.characterId, '', 'introduced'),
      /Invalid identity relationship/
    );
    assert.equal(identityQueries.length, 0, 'nao pode ter chegado ao banco');
  });
});

describe('nome completo do personagem', () => {
  it('aceita as duas convencoes de campo do banco', () => {
    assert.equal(identity.getCharacterFullName({ firstName: 'Alvara', lastName: 'Dawnmere' }), 'Alvara Dawnmere');
    assert.equal(identity.getCharacterFullName({ first_name: 'Alvara', last_name: 'Dawnmere' }), 'Alvara Dawnmere');
  });

  it('personagem ausente ou sem nome cai em Desconhecido', () => {
    assert.equal(identity.getCharacterFullName(null), identity.UNKNOWN_NAME);
    assert.equal(identity.getCharacterFullName({}), identity.UNKNOWN_NAME);
  });
});

/**
 * A interação `identity.introduce` (13/08/2026).
 *
 * "Apresentar-se" era um botão que a CEF inventava: `DEFAULT_INTERACTION_SECTIONS`
 * acrescentava três ações às do servidor, incondicionalmente, para todo alvo
 * (`docs/research/CORE_FRAMEWORK_AUDIT.md` §7). Duas eram botões mortos; esta
 * era a única viva, e ainda assim aparecia sem o servidor ter autorizado nada.
 *
 * Estes casos travam as duas coisas que a migração precisava acertar: que a
 * ação existe de fato no registro, e que `getKnownDisplayName` — de que o
 * `canSee` depende — continua exportada. A segunda é o tipo de quebra que só
 * apareceria em jogo: uma função não exportada é `undefined`, e chamá-la dentro
 * do `canSee` viraria "ação indisponível" em silêncio, para sempre.
 */
describe('identity.introduce — a interação', () => {
  const interactionRegistry = require('./core/interaction-registry');
  // Carregar `commands.js` é o que dispara `registerCoreCommands()`, e é lá que
  // a interação é declarada.
  require('./commands');

  it('está registrada, contra jogador, e não gera linha de auditoria', () => {
    const entry = interactionRegistry.get('identity.introduce');
    assert.ok(entry, 'a ação sumiu do registro — o menu voltaria a não ter nada social');
    assert.equal(entry.module, 'identity');
    assert.equal(entry.target, interactionRegistry.TARGET_TYPES.PLAYER);
    assert.equal(entry.section, 'social');
    // Apresentar-se é gesto de cena, não evento de arbitragem. `identity-service`
    // já grava `identity:introduce` em audit_logs por dentro do comando.
    assert.equal(entry.audit, interactionRegistry.AUDIT_LEVELS.TRACE);
    assert.equal(entry.idempotent, false);
  });

  it('exige proximidade e respeita a política de ação de fala', () => {
    const entry = interactionRegistry.get('identity.introduce');
    // O mesmo raio do `broadcastProximityMessage` que anuncia a cena: apresentar-se
    // de onde ninguém lê o `* fulano se apresenta` seria apresentação sem cena.
    assert.equal(entry.distance, 450);
    // Quem está algemado, abatido ou morto não fala — e quem responde isso é a
    // `action-policy`, não uma segunda tabela de estados aqui.
    assert.equal(entry.policyAction, 'introduce');
  });

  it('canSee esconde a ação de quem o alvo já conhece', () => {
    const entry = interactionRegistry.get('identity.introduce');
    const OBSERVADOR = 20;
    const APRESENTANDO = 10;

    // Estranhos: a ação aparece.
    assert.equal(entry.canSee({ characterId: APRESENTANDO, target: { characterId: OBSERVADOR } }), true);

    // Depois que o alvo passa a conhecer, o botão some — apresentar-se de novo
    // não é erro nem exploit, é um botão que não faz nada, e um menu de RP que
    // oferece gestos vazios ensina o jogador a ignorá-lo.
    identity.cacheKnownIdentity(OBSERVADOR, APRESENTANDO, 'Alvara Dawnmere', 'introduced');
    assert.equal(entry.canSee({ characterId: APRESENTANDO, target: { characterId: OBSERVADOR } }), false);

    // E é direcional: o apresentando continuar sem conhecer o alvo não muda nada.
    assert.equal(entry.canSee({ characterId: OBSERVADOR, target: { characterId: APRESENTANDO } }), true);

    identity.forgetKnownIdentities(OBSERVADOR);
  });

  it('getKnownDisplayName continua exportada — o canSee depende dela', () => {
    assert.equal(typeof identity.getKnownDisplayName, 'function');
  });
});

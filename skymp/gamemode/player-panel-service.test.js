/**
 * player-panel-service.test.js
 *
 * Testes automatizados para o player-panel-service.
 * Executa com: node --test player-panel-service.test.js
 *
 * Mocka o banco de dados (mesmo padrão de core/action-policy.test.js) para
 * testar a montagem dos snapshots e o dispatch de eventos de UI, sem precisar
 * de MySQL nem do runtime `mp` do SkyMP.
 */

const assert = require('assert');
const { describe, it, before, after } = require('node:test');

// ─────────────────────────────────────────────────────────────────────────────
// Mock do banco de dados por padrão de SQL (mesma técnica de action-policy.test.js)
// ─────────────────────────────────────────────────────────────────────────────
const Module = require('module');
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request.endsWith('/database') || request === './database') {
    return {
      query: async (sql, params = []) => {
        if (/SELECT 1 FROM character_known_identities/i.test(sql)) {
          // Só o characterId 42 é "conhecido" na fixture — usado pra testar
          // que renameKnownPerson exige conhecimento prévio do alvo.
          return params[1] === 42 ? [{ 1: 1 }] : [];
        }
        if (/character_known_identities/i.test(sql)) {
          return [{ target_character_id: 42, display_name: 'Jorah', source: 'introduced', updated_at: '2026-01-01' }];
        }
        if (/SELECT gold FROM characters/i.test(sql)) {
          return [{ gold: 777 }];
        }
        if (/governance_memberships/i.test(sql)) {
          return [{ scope_type: 'city', scope_id: 'whiterun', on_duty: 1, role_name: 'guard', label: 'Guarda', weight: 50 }];
        }
        if (/FROM warrants/i.test(sql)) return [];
        if (/FROM fines/i.test(sql)) return [];
        if (/FROM criminal_records/i.test(sql)) return [];
        if (/FROM market_stalls/i.test(sql)) {
          return [{ id: 1, name: 'Barraca do Jorah', status: 'active', items: 3 }];
        }
        if (/FROM cities/i.test(sql)) return [];
        return [];
      },
      init: () => {}
    };
  }
  return originalLoad.apply(this, arguments);
};

const commands = require('./commands');
const characterState = require('./core/character-state');
const { STATES } = characterState;
const playerPanel = require('./player-panel-service');

Module._load = originalLoad;

// ─────────────────────────────────────────────────────────────────────────────
// Fixture: um personagem ativo simulado
// ─────────────────────────────────────────────────────────────────────────────
const ACTOR_ID = 0xff000123;
const CHARACTER_ID = 501;

before(() => {
  commands.registerActiveCharacter(
    ACTOR_ID,
    { id: CHARACTER_ID, first_name: 'Jorah', last_name: 'Ferreiro' },
    1,
    1
  );
  characterState.set(CHARACTER_ID, STATES.NORMAL, {});
});

after(() => {
  commands.removeActiveCharacter(ACTOR_ID);
  playerPanel.cleanup(ACTOR_ID);
});

// ─────────────────────────────────────────────────────────────────────────────
// Testes
// ─────────────────────────────────────────────────────────────────────────────

describe('player-panel-service', () => {
  describe('buildStatusSnapshot', () => {
    it('retorna null para ator sem personagem ativo', async () => {
      const snapshot = await playerPanel.buildStatusSnapshot(0xdeadbeef);
      assert.strictEqual(snapshot, null);
    });

    it('retorna nome, ouro e estado RP do personagem ativo', async () => {
      const snapshot = await playerPanel.buildStatusSnapshot(ACTOR_ID);
      assert.ok(snapshot);
      assert.strictEqual(snapshot.name, 'Jorah Ferreiro');
      assert.strictEqual(snapshot.gold, 777);
      assert.strictEqual(snapshot.state, STATES.NORMAL);
      assert.ok(snapshot.vitals);
    });

    it('reflete mudanças de estado RP (ex: preso)', async () => {
      characterState.set(CHARACTER_ID, STATES.IMPRISONED, { reason: 'teste' });
      const snapshot = await playerPanel.buildStatusSnapshot(ACTOR_ID);
      assert.strictEqual(snapshot.state, STATES.IMPRISONED);
      assert.strictEqual(snapshot.metadata.reason, 'teste');
      characterState.set(CHARACTER_ID, STATES.NORMAL, {});
    });
  });

  describe('buildSocialSnapshot', () => {
    it('retorna null para ator sem personagem ativo', async () => {
      const snapshot = await playerPanel.buildSocialSnapshot(0xdeadbeef);
      assert.strictEqual(snapshot, null);
    });

    it('lista pessoas conhecidas do personagem', async () => {
      const snapshot = await playerPanel.buildSocialSnapshot(ACTOR_ID);
      assert.ok(snapshot);
      assert.strictEqual(snapshot.knownPeople.length, 1);
      assert.strictEqual(snapshot.knownPeople[0].name, 'Jorah');
    });
  });

  describe('renameKnownPerson', () => {
    it('renomeia uma pessoa JÁ CONHECIDA e retorna true', async () => {
      const ok = await playerPanel.renameKnownPerson(ACTOR_ID, 42, 'O Cocheiro');
      assert.strictEqual(ok, true);
    });

    it('retorna false para um characterId nunca visto (evita varrer characterIds)', async () => {
      const ok = await playerPanel.renameKnownPerson(ACTOR_ID, 9999, 'Fulano');
      assert.strictEqual(ok, false);
    });

    it('retorna false para ator sem personagem ativo', async () => {
      const ok = await playerPanel.renameKnownPerson(0xdeadbeef, 42, 'Apelido');
      assert.strictEqual(ok, false);
    });

    it('retorna false para apelido vazio ou alvo inválido', async () => {
      assert.strictEqual(await playerPanel.renameKnownPerson(ACTOR_ID, 42, '   '), false);
      assert.strictEqual(await playerPanel.renameKnownPerson(ACTOR_ID, 0, 'Apelido'), false);
      assert.strictEqual(await playerPanel.renameKnownPerson(ACTOR_ID, 'not-a-number', 'Apelido'), false);
    });
  });

  describe('handleUiEvent', () => {
    it('trata panel:open e retorna true', async () => {
      const handled = await playerPanel.handleUiEvent(ACTOR_ID, { type: 'panel:open' });
      assert.strictEqual(handled, true);
    });

    it('trata panel:refresh:status sem lançar erro', async () => {
      const handled = await playerPanel.handleUiEvent(ACTOR_ID, { type: 'panel:refresh:status' });
      assert.strictEqual(handled, true);
    });

    it('ignora eventos de tipo desconhecido', async () => {
      const handled = await playerPanel.handleUiEvent(ACTOR_ID, { type: 'panel:unknown' });
      assert.strictEqual(handled, false);
    });

    it('ignora eventos malformados', async () => {
      const handled = await playerPanel.handleUiEvent(ACTOR_ID, null);
      assert.strictEqual(handled, false);
    });

    it('trata panel:social:rename e persiste o apelido', async () => {
      const handled = await playerPanel.handleUiEvent(ACTOR_ID, {
        type: 'panel:social:rename',
        data: { targetCharacterId: 42, alias: 'Novo Apelido' }
      });
      assert.strictEqual(handled, true);
    });

    it('trata panel:social:rename com dados inválidos sem lançar', async () => {
      const handled = await playerPanel.handleUiEvent(ACTOR_ID, { type: 'panel:social:rename', data: {} });
      assert.strictEqual(handled, true);
    });
  });

  describe('handlePanelRefreshRequest', () => {
    it('reenvia a seção quando o painel do ator está aberto', async () => {
      await playerPanel.handleUiEvent(ACTOR_ID, { type: 'panel:open' });
      // Não lança e não exige mock adicional — apenas exercita o caminho de push.
      await assert.doesNotReject(async () => {
        playerPanel.handlePanelRefreshRequest(ACTOR_ID, 'governance');
      });
      playerPanel.cleanup(ACTOR_ID);
    });

    it('não faz nada quando o painel do ator está fechado', () => {
      playerPanel.cleanup(ACTOR_ID);
      assert.doesNotThrow(() => playerPanel.handlePanelRefreshRequest(ACTOR_ID, 'governance'));
    });

    it('ignora canais desconhecidos', async () => {
      await playerPanel.handleUiEvent(ACTOR_ID, { type: 'panel:open' });
      assert.doesNotThrow(() => playerPanel.handlePanelRefreshRequest(ACTOR_ID, 'not-a-channel'));
      playerPanel.cleanup(ACTOR_ID);
    });
  });

  describe('commandDefs', () => {
    it('registra o comando /painel', () => {
      const defs = playerPanel.commandDefs();
      const painel = defs.find(d => Array.isArray(d.name) && d.name.includes('/painel'));
      assert.ok(painel, 'comando /painel deve estar registrado');
      assert.strictEqual(typeof painel.handler, 'function');
    });
  });
});

/**
 * O laço de vitals lê vida/magicka/stamina via Papyrus — três chamadas por
 * jogador, e cada ida ao Papyrus custa dezenas de milissegundos (o Red House
 * mediu 13–35 ms; ver REFERENCE_STUDY_SKYMP_RED_HOUSE.md §4.1).
 *
 * Até 06/08/2026 o laço lia os três para TODO painel aberto, a cada 2 s,
 * mesmo o de quem estava na aba Social — pagando o custo para atualizar um
 * número que ninguém estava vendo. O diffing que já existia não ajudava:
 * ele evita reenviar, não evita ler.
 *
 * A UI já mandava a informação necessária (`panel:refresh:<aba>` a cada
 * troca); o servidor é que a descartava.
 *
 * Estes testes contam as chamadas Papyrus de um tick. É a única forma de
 * provar a economia: o comportamento visível para quem está no Status não
 * muda, então nenhum teste de resultado pegaria uma regressão aqui.
 */
describe('player-panel — o tick de vitals só paga por quem está olhando', () => {
  const ATOR_STATUS = ACTOR_ID;
  const ATOR_SOCIAL = 0xff000456;
  const CHAR_SOCIAL = 502;

  let chamadasPapyrus;
  const mpOriginal = global.mp;

  before(() => {
    commands.registerActiveCharacter(
      ATOR_SOCIAL,
      { id: CHAR_SOCIAL, first_name: 'Elda', last_name: 'Corvo' },
      2,
      2
    );
    characterState.set(CHAR_SOCIAL, STATES.NORMAL, {});

    global.mp = {
      getDescFromId: (id) => `${id.toString(16)}:Skyrim.esm`,
      callPapyrusFunction: (tipo, classe, fn) => {
        chamadasPapyrus.push(`${classe}.${fn}`);
        return 100;
      },
      set: () => {}
    };
  });

  after(() => {
    commands.removeActiveCharacter(ATOR_SOCIAL);
    playerPanel.cleanup(ATOR_SOCIAL);
    if (mpOriginal === undefined) delete global.mp;
    else global.mp = mpOriginal;
  });

  function prepara() {
    chamadasPapyrus = [];
    playerPanel.cleanup(ATOR_STATUS);
    playerPanel.cleanup(ATOR_SOCIAL);
  }

  /**
   * `openPanel` dispara `pushAllSections` sem await (fire-and-forget), e esse
   * caminho tambem le vitals. Sem esperar ele terminar e zerar o contador, o
   * teste mediria abertura + tick e nao so o tick.
   */
  async function abrirEZerar(...atores) {
    for (const a of atores) playerPanel.openPanel(a);
    await new Promise((resolve) => setImmediate(resolve));
    chamadasPapyrus = [];
  }

  it('quem abre o painel entra no tick — a UI abre no Status', async () => {
    prepara();
    await abrirEZerar(ATOR_STATUS);

    assert.deepEqual(playerPanel._atoresQuePrecisamDeVitals(), [ATOR_STATUS]);

    await playerPanel._tickVitals();
    assert.equal(
      chamadasPapyrus.length, 3,
      'Health, Magicka e Stamina — quem está no Status precisa das três'
    );
  });

  it('trocar para outra aba tira o jogador do tick', async () => {
    prepara();
    playerPanel.openPanel(ATOR_STATUS);
    await playerPanel.handleUiEvent(ATOR_STATUS, { type: 'panel:refresh:social' });

    chamadasPapyrus = [];
    await playerPanel._tickVitals();

    assert.deepEqual(playerPanel._atoresQuePrecisamDeVitals(), []);
    assert.equal(
      chamadasPapyrus.length, 0,
      'ninguém está olhando o Status — o tick não pode custar nada'
    );
  });

  it('voltar para o Status recoloca o jogador no tick', async () => {
    prepara();
    playerPanel.openPanel(ATOR_STATUS);
    await playerPanel.handleUiEvent(ATOR_STATUS, { type: 'panel:refresh:economy' });
    await playerPanel.handleUiEvent(ATOR_STATUS, { type: 'panel:refresh:status' });

    chamadasPapyrus = [];
    await playerPanel._tickVitals();

    assert.equal(chamadasPapyrus.length, 3, 'voltou pro Status, volta a ser lido');
  });

  it('com dois painéis abertos, paga só pelo que está no Status', async () => {
    prepara();
    playerPanel.openPanel(ATOR_STATUS);
    playerPanel.openPanel(ATOR_SOCIAL);
    await playerPanel.handleUiEvent(ATOR_SOCIAL, { type: 'panel:refresh:social' });

    chamadasPapyrus = [];
    await playerPanel._tickVitals();

    // Antes desta mudança seriam 6 — três por painel aberto.
    assert.equal(chamadasPapyrus.length, 3, 'metade dos painéis abertos, metade do custo');
    assert.deepEqual(playerPanel._atoresQuePrecisamDeVitals(), [ATOR_STATUS]);
  });

  it('fechar o painel tira do tick e não deixa a aba para trás', async () => {
    prepara();
    await abrirEZerar(ATOR_STATUS);
    await playerPanel.handleUiEvent(ATOR_STATUS, { type: 'panel:close' });

    chamadasPapyrus = [];
    await playerPanel._tickVitals();

    assert.equal(chamadasPapyrus.length, 0);
    // Reabrir precisa voltar pro Status, nao herdar a aba de uma sessao antiga.
    playerPanel.openPanel(ATOR_STATUS);
    assert.deepEqual(playerPanel._atoresQuePrecisamDeVitals(), [ATOR_STATUS]);
  });

  it('lê os três ActorValues, não outra coisa', async () => {
    prepara();
    await abrirEZerar(ATOR_STATUS);
    await playerPanel._tickVitals();

    assert.deepEqual(
      chamadasPapyrus,
      ['Actor.getActorValue', 'Actor.getActorValue', 'Actor.getActorValue']
    );
  });
});

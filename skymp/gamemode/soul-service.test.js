/**
 * soul-service.test.js
 *
 * O domínio (`core/soul.js`) já tem 28 testes: orçamento fixo, distribuição,
 * determinismo, "a resolução nunca falha" e pressão. Nada disso se repete aqui.
 *
 * Este arquivo cobre o que só existe quando o sistema fala com o mundo — os
 * três testes obrigatórios do `SOUL_AFFINITY.md` §III.12 que o domínio não
 * consegue provar sozinho:
 *
 *   - **item 7, "escrever primeiro"**: a semente não vaza. Nenhum payload que
 *     chega no jogador contém valor de afinidade, banda ou semente. É o teste
 *     que protege o sistema inteiro: se um número escapar, a alma deixa de ser
 *     oculta e a comunidade monta a planilha em semanas.
 *   - **item 6**: nó irreversível recusa avançar sem consentimento. É a §14.2 e
 *     a alternativa ao VETO da mordida com 70% de morte — sem esta regra, o
 *     sistema volta a permitir que outro jogador decida um destino permanente.
 *   - **item 8**: marca visível respeita o firewall de identidade. Quem não
 *     conhece o portador não pode receber nada que revele o nome civil dele.
 *
 * Verificação por mutação, no padrão do resto do projeto: cada bloco abaixo diz
 * qual mudança no serviço o faz reprovar.
 *
 * Executa com: node --test soul-service.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const CHAR = 6001;
const ACTOR = 0xff00a001;
const OUTRO_CHAR = 6002;

// ─────────────────────────────────────────────────────────────────────────────
// Banco de mentira
// ─────────────────────────────────────────────────────────────────────────────

let tabelaSoul = {};        // characterId -> linha
let tabelaSigns = [];
let tabelaMarks = [];
let tabelaPaths = [];
let auditoria = [];
let notificacoes = [];
let refreshesPedidos = [];
let fichas = {};
let tentativasNaJanela = 0;

function query(sql, params = []) {
  // ── character_soul ────────────────────────────────────────────────────────
  if (/FROM character_soul WHERE character_id/i.test(sql)) {
    const linha = tabelaSoul[params[0]];
    return linha ? [linha] : [];
  }
  if (/INSERT IGNORE INTO character_soul/i.test(sql)) {
    const [characterId, soul_seed, arcana, divina, sombria, bestial, vontade, sensibilidade, estabilidade] = params;
    if (!tabelaSoul[characterId]) {
      tabelaSoul[characterId] = { soul_seed, arcana, divina, sombria, bestial, vontade, sensibilidade, estabilidade };
    }
    return [];
  }

  // ── ficha aprovada ────────────────────────────────────────────────────────
  if (/SELECT motivations, weaknesses, social_ties FROM characters/i.test(sql)) {
    return fichas[params[0]] ? [fichas[params[0]]] : [];
  }
  if (/SELECT account_id FROM characters/i.test(sql)) {
    return [{ account_id: 42 }];
  }

  // ── sinais ────────────────────────────────────────────────────────────────
  if (/SELECT id FROM character_signs/i.test(sql)) {
    return tabelaSigns.filter(s => s.character_id === params[0] && s.sign_key === params[1]);
  }
  if (/INSERT INTO character_signs/i.test(sql)) {
    tabelaSigns.push({ id: tabelaSigns.length + 1, character_id: params[0], sign_key: params[1], source: params[2] });
    return [];
  }
  if (/SELECT sign_key FROM character_signs/i.test(sql)) {
    return tabelaSigns.filter(s => s.character_id === params[0]);
  }

  // ── marcas ────────────────────────────────────────────────────────────────
  if (/INSERT INTO character_marks/i.test(sql)) {
    tabelaMarks.push({
      character_id: params[0], kind: params[1], visibility: params[2],
      descriptor: params[3], origin_event_id: params[4]
    });
    return [];
  }
  if (/SELECT descriptor FROM character_marks[\s\S]*visibility = 'visivel'/i.test(sql)) {
    return tabelaMarks.filter(m => m.character_id === params[0] && m.visibility === 'visivel');
  }
  if (/SELECT descriptor FROM character_marks/i.test(sql)) {
    return tabelaMarks.filter(m => m.character_id === params[0]);
  }

  // ── arvore ────────────────────────────────────────────────────────────────
  if (/FROM character_paths WHERE character_id = \? AND tree/i.test(sql)) {
    return tabelaPaths.filter(p => p.character_id === params[0] && p.tree === params[1]);
  }
  if (/SELECT tree, node FROM character_paths/i.test(sql)) {
    return tabelaPaths.filter(p => p.character_id === params[0]);
  }
  if (/INSERT INTO character_paths/i.test(sql)) {
    const [character_id, tree, node] = params;
    const consentido = /consented_at = NOW\(\)|VALUES \(\?, \?, \?, NOW\(\)\)/.test(sql) || /NOW\(\)\)/.test(sql);
    const existente = tabelaPaths.find(p => p.character_id === character_id && p.tree === tree);
    if (existente) {
      existente.node = node;
      if (consentido) existente.consented_at = '2026-08-07 00:00:00';
    } else {
      tabelaPaths.push({ character_id, tree, node, consented_at: consentido ? '2026-08-07 00:00:00' : null });
    }
    return [];
  }

  // ── auditoria e pressao ───────────────────────────────────────────────────
  if (/SELECT COUNT\(\*\) AS n FROM audit_logs/i.test(sql)) {
    return [{ n: tentativasNaJanela }];
  }
  if (/INSERT INTO audit_logs/i.test(sql)) {
    auditoria.push({ action: params[0], targetAccountId: params[2], details: params[3] });
    return [];
  }

  return [];
}

const Module = require('module');
const originalLoad = Module._load;

const commandsMock = {
  sendNotification: (actorId, message) => notificacoes.push({ actorId, message }),
  getActiveCharacterData: (actorId) => (actorId === ACTOR ? { characterId: CHAR, accountId: 42 } : null),
  getActiveActorByCharacterId: (characterId) => (characterId === CHAR ? ACTOR : null),
  broadcastProximityMessage: () => {}
};

Module._load = function (request) {
  if (request.endsWith('/database') || request === './database' || request === '../database') {
    return { init: () => {}, close: async () => {}, query: async (sql, params) => query(sql, params) };
  }
  if (request === './commands' || request.endsWith('/commands')) return commandsMock;
  return originalLoad.apply(this, arguments);
};

const soulService = require('./soul-service');
const soul = require('./core/soul');
const identity = require('./identity-service');
const panelRefreshBus = require('./core/panel-refresh-bus');

Module._load = originalLoad;

panelRefreshBus.onRefresh((actorId, channel) => refreshesPedidos.push({ actorId, channel }));

const SEGREDO = 'segredo-de-teste-nunca-usar-em-producao';

beforeEach(async () => {
  process.env.SOUL_SECRET = SEGREDO;
  tabelaSoul = {};
  tabelaSigns = [];
  tabelaMarks = [];
  tabelaPaths = [];
  auditoria = [];
  notificacoes = [];
  refreshesPedidos = [];
  tentativasNaJanela = 0;
  fichas = {
    [CHAR]: { motivations: 'Vingar o pai', weaknesses: 'Bebe demais', social_ties: 'Irmao em Riften' },
    [OUTRO_CHAR]: { motivations: 'Construir a igreja', weaknesses: 'Orgulho', social_ties: 'Nenhum' }
  };
  await soulService.initSoulService();
});

after(() => {
  soulService.shutdownSoulService();
  delete process.env.SOUL_SECRET;
});

// ─────────────────────────────────────────────────────────────────────────────

describe('soul-service — ciclo de vida', () => {
  it('sem SOUL_SECRET o servico nao sobe', async () => {
    delete process.env.SOUL_SECRET;
    await assert.rejects(
      () => soulService.initSoulService(),
      /SOUL_SECRET ausente/,
      'derivar alma com segredo vazio deixaria a ficha publica calcular a alma de todo mundo'
    );
    process.env.SOUL_SECRET = SEGREDO;
  });
});

describe('soul-service — a alma vem da ficha e e congelada', () => {
  it('deriva e persiste os sete valores no primeiro acesso', async () => {
    const registro = await soulService.ensureSoul(CHAR);

    assert.ok(registro, 'deveria ter derivado');
    assert.strictEqual(typeof registro.seed, 'string');

    const afinidades = soul.AFFINITIES.reduce((s, a) => s + registro.values[a], 0);
    const tracos = soul.TRAITS.reduce((s, t) => s + registro.values[t], 0);
    assert.strictEqual(afinidades, soul.AFFINITY_BUDGET, 'orcamento fixo — nenhuma alma e melhor que outra');
    assert.strictEqual(tracos, soul.TRAIT_BUDGET);
    assert.ok(tabelaSoul[CHAR], 'precisa ter gravado');
  });

  it('mesma ficha aprovada, mesma alma — o fim do reroll-farming', async () => {
    const primeira = await soulService.ensureSoul(CHAR);
    soulService._soulCache.clear();
    tabelaSoul = {}; // como se fosse outro personagem com a mesma ficha
    const segunda = await soulService.ensureSoul(CHAR);

    assert.deepStrictEqual(segunda.values, primeira.values);
    assert.strictEqual(segunda.seed, primeira.seed);
  });

  it('a alma NAO e rederivada quando a staff edita a ficha depois', async () => {
    const antes = await soulService.ensureSoul(CHAR);

    // A staff corrige a ficha pelo painel — o que o painel de fato permite.
    fichas[CHAR].motivations = 'Texto completamente diferente';
    soulService._soulCache.clear();
    const depois = await soulService.ensureSoul(CHAR);

    // Mutação que reprova: trocar o `SELECT ... FROM character_soul` por uma
    // rederivação incondicional. Alguém que jogou meses acordaria com outra
    // alma, sem aviso — e as marcas, que são a progressão, ficariam órfãs.
    assert.deepStrictEqual(depois.values, antes.values, 'alma gravada nunca e rederivada');
    assert.strictEqual(depois.seed, antes.seed);
  });

  it('fichas diferentes produzem almas diferentes', async () => {
    const a = await soulService.ensureSoul(CHAR);
    const b = await soulService.ensureSoul(OUTRO_CHAR);
    assert.notStrictEqual(a.seed, b.seed);
  });
});

describe('soul-service — o primeiro sinal (§II.1)', () => {
  it('todo personagem recebe um sinal no primeiro spawn', async () => {
    const chave = await soulService.onFirstSpawn(CHAR);

    assert.ok(chave, 'a primeira sessao nao pode ser vazia');
    assert.ok(soulService.SIGN_CATALOG[chave], 'a chave precisa existir no catalogo');
    assert.strictEqual(tabelaSigns.length, 1);
    assert.strictEqual(tabelaSigns[0].source, 'first_spawn');

    const entregue = notificacoes.find(n => n.message === soulService.SIGN_CATALOG[chave]);
    assert.ok(entregue, 'o sinal precisa chegar no jogador, nao so no banco');
    assert.strictEqual(entregue.actorId, ACTOR);
  });

  it('spawnar de novo nao revela um segundo sinal', async () => {
    await soulService.onFirstSpawn(CHAR);
    await soulService.onFirstSpawn(CHAR);
    assert.strictEqual(tabelaSigns.length, 1);
  });

  it('o sinal escolhido e o do atributo mais distante de "comum"', () => {
    // Alma montada à mão: sombria em `raro`, todo o resto no meio. O sinal
    // precisa falar da sombria — é o que aquele personagem tem de diferente.
    const escolhido = soulService._chooseSign({
      arcana: 40, divina: 40, sombria: 95, bestial: 25,
      vontade: 50, sensibilidade: 50, estabilidade: 50
    });
    assert.strictEqual(escolhido, 'sombria_alta');
  });

  it('banda baixa tambem gera sinal — nenhuma alma e vazia', () => {
    const escolhido = soulService._chooseSign({
      arcana: 50, divina: 50, sombria: 50, bestial: 50,
      vontade: 60, sensibilidade: 5, estabilidade: 85
    });
    // Sensibilidade `surdo` está a duas bandas de `comum`; estabilidade `forte`
    // está a uma. O sinal é "Você não sonha. Nunca sonhou." — que é identidade
    // tão jogável quanto qualquer dom.
    assert.strictEqual(escolhido, 'sensibilidade_baixa');
  });

  it('sinal fora do catalogo nao grava nada', async () => {
    const r = await soulService.revealSign(CHAR, 'chave_inventada');
    assert.strictEqual(r, null);
    assert.strictEqual(tabelaSigns.length, 0);
  });
});

describe('soul-service — resolucao e auditoria (§14.3)', () => {
  it('devolve um dos quatro resultados, e nenhum deles e falha', async () => {
    const r = await soulService.resolveAttempt({
      characterId: CHAR, affinity: 'arcana', eventId: 'encantar:lamina:1', difficulty: 2
    });

    assert.ok(r, 'nunca retorna null com alma existente');
    assert.ok(soul.OUTCOMES.includes(r.outcome), `'${r.outcome}' precisa ser um dos quatro`);
  });

  it('grava soul:resolve com entradas, peso e resultado', async () => {
    await soulService.resolveAttempt({
      characterId: CHAR, affinity: 'divina', eventId: 'bencao:altar:7', circumstance: 2, difficulty: 1
    });

    const linha = auditoria.find(a => a.action === 'soul:resolve');
    assert.ok(linha, 'sem linha de auditoria a acusacao de favorecimento e infalsificavel');

    const d = JSON.parse(linha.details);
    assert.strictEqual(d.eventId, 'bencao:altar:7');
    assert.ok(soul.OUTCOMES.includes(d.outcome));
    assert.strictEqual(typeof d.peso, 'number');
    assert.strictEqual(typeof d.roll, 'number');
    assert.strictEqual(d.inputs.circumstance, 2);
    assert.strictEqual(d.inputs.difficulty, 1);
    assert.ok(d.inputs.banda, 'a banda usada precisa estar registrada pra reproducao');
  });

  it('a auditoria NAO carrega a semente — ela vazaria pelo /api/audit do painel', async () => {
    const registro = await soulService.ensureSoul(CHAR);
    await soulService.resolveAttempt({ characterId: CHAR, affinity: 'arcana', eventId: 'e:1' });

    const linha = auditoria.find(a => a.action === 'soul:resolve');

    // `GET /api/audit` (apps/web/server.js) devolve `details` inteiro pra
    // qualquer staff no navegador. Com a semente ali, mais o codigo publico
    // deste repositorio, qualquer pessoa reproduziria TODAS as rolagens futuras
    // daquele personagem — nao so a contestada.
    assert.strictEqual(
      linha.details.includes(registro.seed), false,
      'a semente inteira nao pode entrar em audit_logs'
    );
    // Mas a reproducao continua possivel: a impressao digital diz qual alma foi
    // usada, e a semente esta em character_soul pra quem tem o banco.
    const d = JSON.parse(linha.details);
    assert.strictEqual(d.seedRef, registro.seed.slice(0, 8));
  });

  it('resultado "marcado" grava marca ligada ao evento que a causou', async () => {
    // Pressão alta + dificuldade alta concentra em complicado/marcado (§III.5).
    // Insistir não converge pro limpo: converge pra marcas.
    tentativasNaJanela = 20;

    let marcou = false;
    for (let i = 0; i < 40 && !marcou; i++) {
      tabelaMarks = [];
      const r = await soulService.resolveAttempt({
        characterId: CHAR, affinity: 'sombria', eventId: `forcar:${i}`, difficulty: 4
      });
      if (r.outcome === 'marcado') {
        marcou = true;
        assert.ok(r.mark, 'resultado marcado precisa produzir marca');
        assert.strictEqual(tabelaMarks.length, 1);
        assert.strictEqual(tabelaMarks[0].origin_event_id, `forcar:${i}`, 'a marca precisa apontar pro evento que a gerou');
        assert.ok(soulService.MARK_CATALOG[tabelaMarks[0].descriptor]);
      }
    }
    assert.ok(marcou, 'com pressao 4 e dificuldade 4, marcado precisa sair em 40 tentativas');
  });

  it('a mesma alma no mesmo evento produz sempre o mesmo resultado', async () => {
    const primeiro = await soulService.resolveAttempt({ characterId: CHAR, affinity: 'arcana', eventId: 'fixo:1' });
    const segundo = await soulService.resolveAttempt({ characterId: CHAR, affinity: 'arcana', eventId: 'fixo:1' });
    // `tentativasNaJanela` fica em 0 no mock, então é a mesma tentativa: mesma
    // entrada, mesmo resultado. É o que permite a staff reproduzir.
    assert.strictEqual(segundo.outcome, primeiro.outcome);
  });
});

describe('soul-service — o painel nunca vê número (§III.12 item 7)', () => {
  /**
   * O teste que o desenho manda escrever primeiro. Ele varre o payload inteiro,
   * recursivamente, atrás de qualquer coisa que denuncie a alma.
   *
   * Mutação que reprova: adicionar `afinidades: registro.values` ao retorno de
   * `buildPanelPayload`, ou incluir a banda numa string de sinal.
   */
  function varrer(objeto, visitante, caminho = '$') {
    if (objeto === null || objeto === undefined) return;
    if (Array.isArray(objeto)) {
      objeto.forEach((v, i) => varrer(v, visitante, `${caminho}[${i}]`));
      return;
    }
    if (typeof objeto === 'object') {
      for (const [k, v] of Object.entries(objeto)) varrer(v, visitante, `${caminho}.${k}`);
      return;
    }
    visitante(objeto, caminho);
  }

  it('nenhum valor de afinidade nem a semente saem no payload', async () => {
    const registro = await soulService.ensureSoul(CHAR);
    await soulService.onFirstSpawn(CHAR);
    await soulService.createMark(CHAR, 'mao_fria', 'e:1');
    await soulService.advancePath({ characterId: CHAR, tree: 'sombria' });

    const payload = await soulService.buildPanelPayload(CHAR);
    const serializado = JSON.stringify(payload);

    assert.strictEqual(serializado.includes(registro.seed), false, 'a semente nao pode sair');
    assert.strictEqual(serializado.includes(registro.seed.slice(0, 8)), false, 'nem um pedaco dela');

    // Nenhum número solto — o payload é só texto e chaves de árvore.
    varrer(payload, (valor, caminho) => {
      assert.strictEqual(
        typeof valor, 'string',
        `${caminho} devolveu ${typeof valor} (${valor}) — o jogador so pode receber ficcao, nunca numero`
      );
    });

    // E nenhuma banda vazando por dentro de uma frase.
    for (const banda of soul.BANDS) {
      assert.strictEqual(
        new RegExp(`\\b${banda}\\b`, 'i').test(serializado), false,
        `a banda '${banda}' apareceu no payload`
      );
    }
  });

  it('o payload entrega sinais e marcas como frase, e o caminho por chave', async () => {
    await soulService.onFirstSpawn(CHAR);
    await soulService.createMark(CHAR, 'sono_partido', 'e:2');
    await soulService.advancePath({ characterId: CHAR, tree: 'bestial' });

    const payload = await soulService.buildPanelPayload(CHAR);

    assert.strictEqual(payload.sinais.length, 1);
    assert.ok(Object.values(soulService.SIGN_CATALOG).includes(payload.sinais[0]));
    assert.strictEqual(payload.marcas.length, 1);
    assert.strictEqual(payload.marcas[0].texto, soulService.MARK_CATALOG.sono_partido.text);
    assert.deepStrictEqual(payload.caminhos, [{ arvore: 'bestial', no: 'infeccao' }]);
  });

  it('/alma responde com frases e sem numero', async () => {
    await soulService.onFirstSpawn(CHAR);
    notificacoes = [];

    const comando = soulService.commandDefs().find(c => c.name.includes('/alma'));
    comando.handler(ACTOR);
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(notificacoes.length >= 1, 'o comando precisa responder algo');
    for (const n of notificacoes) {
      assert.strictEqual(/\d/.test(n.message), false, `'${n.message}' carrega numero`);
    }
  });
});

describe('soul-service — no irreversivel exige consentimento (§14.2, item 6)', () => {
  it('o primeiro no de cada arvore e reversivel — e a infeccao, nao o destino', async () => {
    const r = await soulService.advancePath({ characterId: CHAR, tree: 'sombria' });

    assert.strictEqual(r.node, 'infeccao');
    assert.strictEqual(r.blocked, undefined, 'infeccao nunca pode exigir consentimento');
    assert.strictEqual(tabelaPaths[0].consented_at, null);
  });

  it('o no irreversivel seguinte e recusado sem consentimento', async () => {
    await soulService.advancePath({ characterId: CHAR, tree: 'sombria' }); // infeccao

    const r = await soulService.advancePath({ characterId: CHAR, tree: 'sombria' }); // vampirismo

    // Mutação que reprova: remover a checagem `proximo.irreversible && !consent`.
    // Sem ela, uma mordida bastaria pra transformar alguém permanentemente — a
    // versão sobrenatural do RDM que o VETO da §3.1 existe pra impedir.
    assert.strictEqual(r.blocked, 'consentimento_ausente');
    assert.strictEqual(r.node, 'infeccao', 'nao pode ter avancado');
    assert.strictEqual(tabelaPaths[0].node, 'infeccao');
  });

  it('o jogador e avisado de que o passo nao tem volta', async () => {
    await soulService.advancePath({ characterId: CHAR, tree: 'sombria' });
    notificacoes = [];

    await soulService.advancePath({ characterId: CHAR, tree: 'sombria' });

    // A.3 do Anexo: aviso antes do irreversível. Recusa silenciosa seria pior
    // que não ter a regra — o jogador precisa saber que a porta existe.
    assert.ok(
      notificacoes.some(n => /não tem volta/i.test(n.message)),
      'recusar sem avisar deixaria o jogador achando que e bug'
    );
  });

  it('com consentimento avanca e grava consented_at', async () => {
    await soulService.advancePath({ characterId: CHAR, tree: 'sombria' });

    const r = await soulService.advancePath({ characterId: CHAR, tree: 'sombria', consent: true });

    assert.strictEqual(r.node, 'vampirismo');
    assert.strictEqual(r.blocked, undefined);
    assert.ok(tabelaPaths[0].consented_at, 'no irreversivel sem consented_at e bug de processo');
  });

  it('avanco pra no criminal sai no evento, pra governanca tipificar', async () => {
    const eventos = [];
    const handler = (e) => eventos.push(e);
    soulService.onSoulEvent('soul.path.advanced', handler);

    await soulService.advancePath({ characterId: CHAR, tree: 'sombria' });
    await soulService.advancePath({ characterId: CHAR, tree: 'sombria', consent: true });

    soulService.offSoulEvent('soul.path.advanced', handler);

    assert.strictEqual(eventos.length, 2);
    assert.strictEqual(eventos[0].criminal, false, 'infeccao nao e crime — ninguem escolheu ser mordido');
    assert.strictEqual(eventos[1].criminal, true, 'vampirismo e crime tipificavel');
    assert.strictEqual(eventos[1].irreversible, true);
  });

  it('a infeccao abre a janela de escolha, e so ela', async () => {
    const infeccoes = [];
    const handler = (e) => infeccoes.push(e);
    soulService.onSoulEvent('soul.infection.started', handler);

    await soulService.advancePath({ characterId: CHAR, tree: 'bestial' });
    await soulService.advancePath({ characterId: CHAR, tree: 'bestial', consent: true });

    soulService.offSoulEvent('soul.infection.started', handler);

    assert.strictEqual(infeccoes.length, 1, 'so o primeiro no abre a janela');
    assert.strictEqual(infeccoes[0].node, 'infeccao');
  });

  it('arvore desconhecida nao grava nada', async () => {
    const r = await soulService.advancePath({ characterId: CHAR, tree: 'marcial' });
    assert.strictEqual(r, null);
    assert.strictEqual(tabelaPaths.length, 0);
  });
});

describe('soul-service — marca visivel respeita o firewall de identidade (item 8)', () => {
  beforeEach(async () => {
    await soulService.createMark(CHAR, 'mao_fria', 'e:1');      // visivel
    await soulService.createMark(CHAR, 'sono_partido', 'e:2');  // sentida
    identity.forgetKnownIdentities(OUTRO_CHAR);
  });

  it('quem nao conhece o portador le "Desconhecido"', async () => {
    const visto = await soulService.describeVisibleMarks(OUTRO_CHAR, CHAR);

    // Mutação que reprova: trocar `identity.getDisplayName` por uma leitura
    // direta de `characters.first_name`. A marca viraria um vazamento de nome
    // civil por um caminho que o identity-service não controla — o mesmo
    // defeito que fez o disguise-service ser apagado.
    assert.strictEqual(visto.portador, identity.UNKNOWN_NAME);
  });

  it('quem conhece le o nome que conhece', async () => {
    identity.cacheKnownIdentity(OUTRO_CHAR, CHAR, 'Bjorn Punho-de-Ferro', 'introduced');

    const visto = await soulService.describeVisibleMarks(OUTRO_CHAR, CHAR);

    assert.strictEqual(visto.portador, 'Bjorn Punho-de-Ferro');
  });

  it('so marcas visiveis saem — sentida e do portador, nao do observador', async () => {
    const visto = await soulService.describeVisibleMarks(OUTRO_CHAR, CHAR);

    assert.deepStrictEqual(visto.marcas, [soulService.MARK_CATALOG.mao_fria.text]);
    assert.strictEqual(
      visto.marcas.includes(soulService.MARK_CATALOG.sono_partido.text), false,
      'marca sentida nao pode aparecer pra terceiros'
    );
  });

  it('nenhum descritor do catalogo carrega nome de personagem', () => {
    // Estrutural, e de propósito: os descritores são chaves de catálogo escritas
    // no código, então o vazamento é impossível por construção e não por revisão
    // lembrar da regra. Este teste reprova se alguém adicionar uma frase com
    // interpolação de nome.
    for (const [chave, marca] of Object.entries(soulService.MARK_CATALOG)) {
      assert.strictEqual(/\$\{|%s|\{\{/.test(marca.text), false, `'${chave}' tem interpolacao no texto`);
    }
  });
});

describe('soul-service — cache por characterId sai na desconexao', () => {
  it('cleanup esquece so o personagem pedido', async () => {
    await soulService.ensureSoul(CHAR);
    await soulService.ensureSoul(OUTRO_CHAR);

    soulService.cleanup(CHAR);

    assert.strictEqual(soulService._soulCache.has(CHAR), false);
    assert.strictEqual(soulService._soulCache.has(OUTRO_CHAR), true);
  });
});

describe('soul-service — o painel e avisado quando algo muda', () => {
  it('sinal, marca e avanco pedem refresh da aba Social', async () => {
    refreshesPedidos = [];

    await soulService.onFirstSpawn(CHAR);
    await soulService.createMark(CHAR, 'mao_fria', 'e:1');
    await soulService.advancePath({ characterId: CHAR, tree: 'arcana' });

    const social = refreshesPedidos.filter(r => r.actorId === ACTOR && r.channel === 'social');
    assert.ok(social.length >= 3, 'as tres coisas mudam a aba Social');
  });
});

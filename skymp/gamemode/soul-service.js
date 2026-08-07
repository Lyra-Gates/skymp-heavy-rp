/**
 * soul-service.js — Afinidade da Alma, camada de serviço
 *
 * Desenho fechado: `docs/design/SOUL_AFFINITY.md`. Este arquivo **implementa**
 * aquele documento; não reabre nenhuma decisão dele.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A divisão com core/soul.js
 * ─────────────────────────────────────────────────────────────────────────────
 * `core/soul.js` é o domínio: gerador com orçamento fixo, bandas, semente e
 * resolução em quatro resultados. Função pura — não abre banco, não toca `mp`,
 * não sabe que existe um jogo, e tem 28 testes por isso.
 *
 * Este arquivo é tudo que fala com o mundo: persiste a alma, revela sinais,
 * grava marcas, avança a árvore, audita rolagem e alimenta o painel. Ele nunca
 * decide um resultado — só pergunta ao domínio e cuida das consequências.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * As três regras que este arquivo precisa preservar
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. **O jogador nunca vê número** (§II.1). Não existe caminho daqui até a UI
 *    que carregue valor de afinidade, banda ou semente. `buildPanelPayload` é o
 *    único produtor de payload, e há teste varrendo o objeto inteiro atrás de
 *    qualquer um dos sete valores.
 * 2. **O dado nunca diz não** (§II.2). `resolveAttempt` não tem retorno que
 *    signifique falha — devolve qual das quatro histórias saiu.
 * 3. **Toda rolagem é auditável** (§14.3). Cada resolução grava `soul:resolve`
 *    com entradas, peso e resultado. Sem isso a acusação de favorecimento é
 *    infalsificável, e é assim que servidor de RP morre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ Ainda não rodou com jogador conectado
 * ─────────────────────────────────────────────────────────────────────────────
 * Igual a `hit-events`, `espm` e `safe-zones`: **confirmado por teste
 * automatizado, não confirmado em sessão real.** O que só o cliente prova —
 * o sinal chegando na tela, a marca sendo lida por outro jogador — está na
 * Etapa 9.4 do `docs/technical/FASE_0_ROTEIRO.md`, e não foi executado.
 */

const db = require('./database');
const soul = require('./core/soul');
const commands = require('./commands');
const identity = require('./identity-service');
const panelRefreshBus = require('./core/panel-refresh-bus');
const { EventEmitter } = require('events');

const MODULE = 'soul';

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de sinais (§II.1, III.7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O jogador recebe *sinais*, não valores. Cada chave abaixo é um acontecimento
 * que já dá pra interpretar na primeira sessão — identidade, não poder.
 *
 * O texto mora aqui e a chave vai pro banco. É a mesma regra do `descriptor`
 * das marcas, e existe por dois motivos: texto do jogador nunca entra num campo
 * que outro jogador lê, e reescrever uma frase não exige migration.
 *
 * Duas frases por atributo — uma para banda alta, uma para banda baixa. Nenhuma
 * delas diz se é bom: `surdo` em Sensibilidade ("Você não sonha. Nunca sonhou.")
 * é tão jogável quanto `raro`, que é a §14.4 aparecendo na superfície.
 */
const SIGN_CATALOG = Object.freeze({
  arcana_alta:          'As chamas te obedecem rápido demais.',
  arcana_baixa:         'A magia te ignora como se você não estivesse ali.',
  divina_alta:          'O sacerdote te olha demais e não diz nada.',
  divina_baixa:         'Você já entrou em três templos e nenhum deles pareceu notar.',
  sombria_alta:         'As velas se apagam do lado onde você senta.',
  sombria_baixa:        'Os mortos não têm nada a te dizer, e isso é um alívio.',
  bestial_alta:         'Cães rosnam quando você passa, e você não sabe por quê.',
  bestial_baixa:        'Nenhum animal te teme. Nenhum te procura.',
  vontade_alta:         'Você já disse não a algo que ninguém mais conseguiu recusar.',
  vontade_baixa:        'É mais fácil concordar. Sempre foi.',
  sensibilidade_alta:   'Você ouve conversas em cômodos vazios.',
  sensibilidade_baixa:  'Você não sonha. Nunca sonhou.',
  estabilidade_alta:    'O que abala os outros passa por você como vento.',
  estabilidade_baixa:   'Há dias em que o seu nome soa errado na sua própria boca.'
});

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de marcas (§II.3, III.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **As marcas são a progressão.** Não há nível; há o que ficou em você.
 *
 * `visivel` conversa com o `identity-service`: esconder marca é motivo real
 * para capuz. `sentida` só o portador sabe, até alguém perceber. `conhecida`
 * entrou na reputação.
 *
 * Uma pessoa com muitas marcas é obviamente alguém que foi longe — status
 * narrativo, não numérico, e não farmável, porque cada marca custou uma cena.
 */
const MARK_CATALOG = Object.freeze({
  mao_fria:        { kind: 'fisica',     visibility: 'visivel',   text: 'A mão que forjou aquilo não esquenta mais.' },
  olhos_pálidos:   { kind: 'fisica',     visibility: 'visivel',   text: 'A cor saiu dos seus olhos e não voltou.' },
  voz_dupla:       { kind: 'fisica',     visibility: 'visivel',   text: 'Às vezes a sua voz sai com outra por baixo.' },
  sono_partido:    { kind: 'espiritual', visibility: 'sentida',   text: 'Você acorda três vezes por noite, sempre na mesma hora.' },
  peso_no_peito:   { kind: 'espiritual', visibility: 'sentida',   text: 'Há algo apoiado no seu peito que não estava ali antes.' },
  nome_lembrado:   { kind: 'espiritual', visibility: 'sentida',   text: 'Alguém que você não conhece repete o seu nome, longe.' },
  fama_de_risco:   { kind: 'social',     visibility: 'conhecida', text: 'Quem entende do assunto sabe o que você tentou.' },
  divida_de_favor: { kind: 'social',     visibility: 'conhecida', text: 'Alguém pagou parte do preço por você, e não esqueceu.' }
});

/** Marcas candidatas por afinidade — a escolha final é determinística. */
const MARKS_BY_AFFINITY = Object.freeze({
  arcana:  ['mao_fria', 'sono_partido', 'fama_de_risco'],
  divina:  ['peso_no_peito', 'divida_de_favor', 'nome_lembrado'],
  sombria: ['olhos_pálidos', 'nome_lembrado', 'fama_de_risco'],
  bestial: ['voz_dupla', 'sono_partido', 'divida_de_favor']
});

// ─────────────────────────────────────────────────────────────────────────────
// Árvore de Transformação (§III.1, III.8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uma árvore por afinidade, exatamente as do §III.1.
 *
 * `irreversible: true` é o que obriga `consented_at` (§14.2). O primeiro nó de
 * toda árvore é sempre reversível de propósito: é a infecção do §II.6, que
 * **nunca resolve nada sozinha** — abre uma janela em que o jogador escolhe
 * entre buscar cura, esconder ou aceitar. É a alternativa ao VETO da mordida
 * com 70% de morte, e o motivo de a mordida não poder ser um nó irreversível.
 */
const TREES = Object.freeze({
  arcana: [
    { node: 'alteracao', irreversible: false },
    { node: 'ritual', irreversible: false },
    { node: 'arquimago', irreversible: true }
  ],
  divina: [
    { node: 'bencaos', irreversible: false },
    { node: 'milagres', irreversible: false },
    { node: 'santo', irreversible: true }
  ],
  sombria: [
    { node: 'infeccao', irreversible: false },
    { node: 'vampirismo', irreversible: true },
    { node: 'necromancia', irreversible: true },
    { node: 'lorde_vampiro', irreversible: true }
  ],
  bestial: [
    { node: 'infeccao', irreversible: false },
    { node: 'licantropia', irreversible: true },
    { node: 'totens', irreversible: true },
    { node: 'alfa', irreversible: true },
    { node: 'lobo_ancestral', irreversible: true }
  ]
});

/**
 * Nós que a governança tipifica como crime. `soul.path.advanced` é emitido para
 * quem quiser escutar; o `governance-service` ligará nisso quando o crime for
 * desenhado (§III.9). Aqui é só o dado, não a consequência — tipificar é
 * decisão da governança, não desta camada.
 */
const CRIMINAL_NODES = Object.freeze(['vampirismo', 'necromancia', 'lorde_vampiro']);

// ─────────────────────────────────────────────────────────────────────────────
// Estado em memória
// ─────────────────────────────────────────────────────────────────────────────

/** characterId -> { seed, values } — evita reler a alma a cada resolução. */
const _soulCache = new Map();

/**
 * Barramento próprio, pequeno e nomeado — o padrão do `panel-refresh-bus`, e
 * não um canal genérico no `module-registry` (aquela generalização foi avaliada
 * e adiada de propósito; ver o cabeçalho de `core/module-registry.js`).
 */
const _emitter = new EventEmitter();
_emitter.setMaxListeners(20);

let _secret = null;

// ─────────────────────────────────────────────────────────────────────────────
// Ciclo de vida
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O segredo do servidor vem do ambiente e é lido no boot, não no require.
 *
 * **Sem ele o módulo não sobe.** Falhar alto aqui é deliberado: derivar alma com
 * um segredo vazio produziria almas que qualquer pessoa recalcula a partir da
 * ficha, que é pública no painel — e o estrago seria silencioso e permanente,
 * porque a alma é congelada no primeiro spawn. É a mesma lição do `.env` que
 * ninguém carregava: o modo de falha precisa apontar pro lado seguro.
 */
async function initSoulService() {
  _secret = process.env.SOUL_SECRET || null;
  if (!_secret) {
    throw new Error(
      '[soul] SOUL_SECRET ausente. A alma vem de HMAC(segredo, ficha) — sem segredo, ' +
      'qualquer pessoa calcula a alma de qualquer personagem a partir da ficha publica. ' +
      'Defina SOUL_SECRET no skymp/gamemode/.env antes de ligar ENABLE_SOUL_SERVICE.'
    );
  }
  _soulCache.clear();
  console.log('[soul] Servico da Afinidade da Alma iniciado.');
}

function shutdownSoulService() {
  _soulCache.clear();
  _emitter.removeAllListeners();
  _secret = null;
}

/**
 * Esquece a alma em cache na desconexão.
 *
 * Chaveado por characterId (não por actorId), então não sofre do reaproveitamento
 * de slot que atingiu o `staffCache` e o `_lastHealth`. Ainda assim precisa sair:
 * cache que só cresce é vazamento, e a alma não muda entre sessões — reler no
 * próximo login custa uma query e evita servir dado obsoleto se a staff mexer
 * na ficha.
 */
function cleanup(characterId) {
  _soulCache.delete(characterId);
}

// ─────────────────────────────────────────────────────────────────────────────
// A alma
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Garante que o personagem tenha alma, derivando-a da ficha aprovada.
 *
 * Idempotente e **congelante**: uma vez gravada, a alma nunca é rederivada. Se
 * a staff editar a ficha depois — o painel permite —, rederivar trocaria a alma
 * de alguém que já jogou meses com ela, sem aviso. Persistir no primeiro spawn
 * é o único comportamento compatível com "as marcas são a progressão".
 *
 * @param {number} characterId
 * @returns {Promise<{seed: string, values: Object}|null>}
 */
async function ensureSoul(characterId) {
  if (_soulCache.has(characterId)) return _soulCache.get(characterId);

  const existentes = await db.query(
    `SELECT soul_seed, arcana, divina, sombria, bestial, vontade, sensibilidade, estabilidade
     FROM character_soul WHERE character_id = ?`,
    [characterId]
  );

  if (existentes.length > 0) {
    const linha = existentes[0];
    const registro = {
      seed: linha.soul_seed,
      values: {
        arcana: linha.arcana, divina: linha.divina, sombria: linha.sombria, bestial: linha.bestial,
        vontade: linha.vontade, sensibilidade: linha.sensibilidade, estabilidade: linha.estabilidade
      }
    };
    _soulCache.set(characterId, registro);
    return registro;
  }

  const fichas = await db.query(
    'SELECT motivations, weaknesses, social_ties FROM characters WHERE id = ?',
    [characterId]
  );
  if (fichas.length === 0) {
    console.error(`[soul] Personagem ${characterId} nao existe — alma nao derivada.`);
    return null;
  }
  const ficha = fichas[0];

  const seed = soul.deriveSeed(_secret, characterId, {
    motivations: ficha.motivations,
    weaknesses: ficha.weaknesses,
    socialTies: ficha.social_ties
  });
  const values = soul.generateSoul(seed);

  // `INSERT IGNORE`: dois spawns concorrentes do mesmo personagem chegariam aqui
  // juntos, e a segunda gravacao nao pode sobrescrever a primeira. A chave
  // primaria e o character_id, entao o banco resolve.
  await db.query(
    `INSERT IGNORE INTO character_soul
       (character_id, soul_seed, arcana, divina, sombria, bestial, vontade, sensibilidade, estabilidade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [characterId, seed, values.arcana, values.divina, values.sombria, values.bestial,
     values.vontade, values.sensibilidade, values.estabilidade]
  );

  const registro = { seed, values };
  _soulCache.set(characterId, registro);
  console.log(`[soul] Alma derivada para char ${characterId}.`);
  return registro;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sinais
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escolhe o sinal mais característico da alma.
 *
 * "Mais característico" é o atributo cuja banda está **mais longe de `comum`** —
 * o que o personagem tem de mais diferente do resto do mundo, que é o que vale
 * a pena interpretar. Empate é resolvido pela ordem fixa dos atributos, não por
 * sorteio: dois personagens com a mesma alma precisam receber o mesmo sinal,
 * senão o sinal deixa de ser reproduzível e cai fora da §14.3.
 */
function _chooseSign(values) {
  const COMUM = soul.BANDS.indexOf('comum');
  const atributos = [...soul.AFFINITIES, ...soul.TRAITS];

  let escolhido = atributos[0];
  let maiorDistancia = -1;

  for (const attr of atributos) {
    const distancia = Math.abs(soul.bandIndex(values[attr]) - COMUM);
    if (distancia > maiorDistancia) {
      maiorDistancia = distancia;
      escolhido = attr;
    }
  }

  const alto = soul.bandIndex(values[escolhido]) >= COMUM;
  return `${escolhido}_${alto ? 'alta' : 'baixa'}`;
}

/**
 * Revela um sinal e o entrega ao jogador.
 *
 * **Todo personagem recebe o primeiro sinal na primeira sessão** (§II.1). Não é
 * poder: é identidade. Resolve o problema mais mortal de servidor de RP, que
 * não é balanceamento — é a primeira hora ser vazia.
 *
 * @returns {Promise<string|null>} a chave revelada, ou null se já a tinha
 */
async function revealSign(characterId, signKey, source = 'first_spawn') {
  if (!SIGN_CATALOG[signKey]) {
    console.error(`[soul] Sinal desconhecido '${signKey}' — nada revelado.`);
    return null;
  }

  const jaTem = await db.query(
    'SELECT id FROM character_signs WHERE character_id = ? AND sign_key = ?',
    [characterId, signKey]
  );
  if (jaTem.length > 0) return null;

  await db.query(
    'INSERT INTO character_signs (character_id, sign_key, source) VALUES (?, ?, ?)',
    [characterId, signKey, source]
  );

  const actorId = commands.getActiveActorByCharacterId(characterId);
  if (actorId) {
    commands.sendNotification(actorId, SIGN_CATALOG[signKey]);
    panelRefreshBus.requestRefresh(actorId, 'social');
  }

  _emitter.emit('soul.sign.revealed', { characterId, signKey, source });
  console.log(`[soul] Sinal '${signKey}' revelado para char ${characterId} (${source}).`);
  return signKey;
}

/**
 * Ponto de entrada do primeiro spawn: garante alma e entrega o primeiro sinal.
 * Idempotente — chamar de novo não revela um segundo sinal.
 */
async function onFirstSpawn(characterId) {
  const registro = await ensureSoul(characterId);
  if (!registro) return null;
  return revealSign(characterId, _chooseSign(registro.values), 'first_spawn');
}

// ─────────────────────────────────────────────────────────────────────────────
// Marcas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grava uma marca. Marca **nunca é removida** — no máximo coberta, o que também
 * é jogável e caro. Por isso não existe `removeMark`.
 */
async function createMark(characterId, descriptor, originEventId = null) {
  const catalogo = MARK_CATALOG[descriptor];
  if (!catalogo) {
    console.error(`[soul] Marca desconhecida '${descriptor}' — nada gravado.`);
    return null;
  }

  await db.query(
    'INSERT INTO character_marks (character_id, kind, visibility, descriptor, origin_event_id) VALUES (?, ?, ?, ?, ?)',
    [characterId, catalogo.kind, catalogo.visibility, descriptor, originEventId]
  );

  const actorId = commands.getActiveActorByCharacterId(characterId);
  if (actorId) {
    commands.sendNotification(actorId, catalogo.text);
    panelRefreshBus.requestRefresh(actorId, 'social');
  }

  _emitter.emit('soul.mark.created', { characterId, descriptor, ...catalogo });
  console.log(`[soul] Marca '${descriptor}' gravada em char ${characterId} (evento ${originEventId || 'sem origem'}).`);
  return descriptor;
}

/**
 * Marcas que um observador consegue perceber num alvo.
 *
 * ⚠️ **Firewall de identidade** (§III.12, teste 8). Só marcas `visivel` saem
 * daqui, e o nome de quem as carrega passa pelo `identity-service` — quem não
 * conhece o portador lê `Desconhecido`. Sem isso a marca viraria um vazamento
 * de nome civil por um caminho que o `identity-service` não controla, que é
 * exatamente o defeito que fez o `disguise-service` ser apagado.
 *
 * Os descritores são chaves de catálogo e nunca contêm nome de ninguém — o que
 * torna o vazamento impossível por construção, não por revisão.
 */
async function describeVisibleMarks(observerCharacterId, targetCharacterId) {
  const linhas = await db.query(
    `SELECT descriptor FROM character_marks
     WHERE character_id = ? AND visibility = 'visivel'
     ORDER BY created_at ASC`,
    [targetCharacterId]
  );

  const observador = observerCharacterId ? { characterId: observerCharacterId } : null;
  const alvo = { characterId: targetCharacterId };
  const nome = identity.getDisplayName(observador, alvo);

  return {
    portador: nome,
    marcas: linhas
      .filter(l => MARK_CATALOG[l.descriptor])
      .map(l => MARK_CATALOG[l.descriptor].text)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolução
// ─────────────────────────────────────────────────────────────────────────────

/** Janela da pressão (§III.5). Insistir não converge pro limpo: converge pra marca. */
const PRESSURE_WINDOW_MINUTES = 60;

/**
 * Resolve uma tentativa ligada à alma e cuida das consequências.
 *
 * **Nunca devolve falha.** Devolve qual das quatro histórias saiu — limpo, caro,
 * complicado ou marcado —, e todas as quatro dão certo. É a §II.2, e é o que
 * separa este sistema de uma porta fechada.
 *
 * @param {object} p
 * @param {number} p.characterId
 * @param {string} p.affinity      qual afinidade governa o ato
 * @param {string} p.eventId       identifica o ato; entra na rolagem e no audit
 * @param {number} [p.circumstance] mestre presente, componente certo, lugar consagrado
 * @param {number} [p.difficulty]   dificuldade do ato
 * @returns {Promise<{outcome: string, mark: string|null}|null>}
 */
async function resolveAttempt({ characterId, affinity, eventId, circumstance = 0, difficulty = 0 }) {
  const registro = await ensureSoul(characterId);
  if (!registro) return null;

  // Pressão sai do próprio audit: quantas vezes este personagem tentou este
  // mesmo ato na última hora. Ler do log em vez de manter contador em memória é
  // deliberado — contador em memória zera no restart, e "reinicie o servidor
  // pra limpar a pressão" seria um exploit criado pela implementação.
  const tentativas = await db.query(
    `SELECT COUNT(*) AS n FROM audit_logs
     WHERE action = 'soul:resolve'
       AND details LIKE ?
       AND created_at >= NOW() - INTERVAL ? MINUTE`,
    [`%"characterId":${characterId},%"eventId":"${eventId}"%`, PRESSURE_WINDOW_MINUTES]
  );
  const anteriores = Number(tentativas[0]?.n || 0);
  const pressure = soul.pressureFrom(anteriores);

  const resultado = soul.resolve({
    soul: registro.values,
    affinity,
    seed: registro.seed,
    eventId,
    attempt: anteriores,
    circumstance,
    difficulty,
    pressure
  });

  // ── Auditoria (§14.3) ──────────────────────────────────────────────────────
  //
  // A semente NAO entra aqui, e a escolha e de seguranca, nao de economia de
  // espaco: `GET /api/audit` do painel web devolve `details` inteiro pra
  // qualquer staff no navegador. Gravar a semente ali a tiraria do servidor —
  // e com ela mais o codigo publico deste repositorio, qualquer pessoa
  // reproduz TODAS as rolagens futuras daquele personagem, nao so a contestada.
  //
  // A reproducao continua possivel e e o que a §14.3 exige: a semente esta em
  // `character_soul`, acessivel a quem tem o banco, e a impressao digital
  // abaixo prova qual alma foi usada sem revelar a alma.
  const character = await db.query('SELECT account_id FROM characters WHERE id = ?', [characterId]);
  await db.query(
    'INSERT INTO audit_logs (action, actor_account_id, target_account_id, details) VALUES (?, ?, ?, ?)',
    [
      'soul:resolve', null, character[0]?.account_id || null,
      JSON.stringify({
        characterId,
        eventId,
        outcome: resultado.outcome,
        peso: resultado.peso,
        roll: resultado.roll,
        inputs: resultado.inputs,
        seedRef: registro.seed.slice(0, 8),
        modulo: MODULE
      })
    ]
  );

  // ── Consequência ───────────────────────────────────────────────────────────
  let mark = null;
  if (resultado.outcome === 'marcado') {
    // A marca é escolhida deterministicamente pela própria rolagem: a mesma
    // alma tentando o mesmo ato na mesma tentativa recebe a mesma marca, senão
    // o resultado deixa de ser reproduzível pela staff.
    const candidatas = MARKS_BY_AFFINITY[affinity];
    const escolhida = candidatas[Math.floor(resultado.roll * candidatas.length) % candidatas.length];
    mark = await createMark(characterId, escolhida, eventId);
  }

  _emitter.emit('soul.resolved', { characterId, ...resultado, mark });

  const actorId = commands.getActiveActorByCharacterId(characterId);
  if (actorId) panelRefreshBus.requestRefresh(actorId, 'social');

  return { outcome: resultado.outcome, mark };
}

// ─────────────────────────────────────────────────────────────────────────────
// Árvore de Transformação
// ─────────────────────────────────────────────────────────────────────────────

/** Estado atual do personagem numa árvore, ou null se nunca entrou nela. */
async function getPath(characterId, tree) {
  const linhas = await db.query(
    'SELECT tree, node, entered_at, consented_at FROM character_paths WHERE character_id = ? AND tree = ?',
    [characterId, tree]
  );
  return linhas[0] || null;
}

/**
 * Avança o personagem um nó na árvore.
 *
 * **Nó irreversível recusa avançar sem consentimento** (§14.2, e o teste 6 dos
 * obrigatórios). É a implementação da alternativa ao VETO da mordida com 70% de
 * morte: nenhum evento único decide um destino, e alterar permanentemente a
 * alma de outro personagem sem consentimento é a versão sobrenatural do RDM.
 *
 * O primeiro nó de cada árvore é sempre reversível — é a infecção, que abre a
 * janela de escolha (buscar cura / esconder / aceitar) em vez de resolver nada.
 *
 * @param {object} p
 * @param {number}  p.characterId
 * @param {string}  p.tree
 * @param {boolean} [p.consent] consentimento explícito do jogador
 * @returns {Promise<{node: string, blocked?: string}|null>}
 */
async function advancePath({ characterId, tree, consent = false }) {
  const trilha = TREES[tree];
  if (!trilha) {
    console.error(`[soul] Arvore desconhecida '${tree}'.`);
    return null;
  }

  const atual = await getPath(characterId, tree);
  const indiceAtual = atual ? trilha.findIndex(n => n.node === atual.node) : -1;
  const proximo = trilha[indiceAtual + 1];

  if (!proximo) return { node: atual ? atual.node : trilha[0].node, blocked: 'fim_da_arvore' };

  if (proximo.irreversible && !consent) {
    // Recusa silenciosa seria pior que não ter a regra: o jogador precisa saber
    // que existe uma porta e que ela cobra uma decisão explícita. É o A.3 do
    // Anexo — aviso antes do irreversível.
    const actorId = commands.getActiveActorByCharacterId(characterId);
    if (actorId) {
      commands.sendNotification(actorId, 'Este passo não tem volta. Ele só acontece se você disser que sim.');
    }
    console.log(`[soul] char ${characterId} barrado em '${proximo.node}' (${tree}): sem consentimento.`);
    return { node: atual ? atual.node : null, blocked: 'consentimento_ausente' };
  }

  await db.query(
    `INSERT INTO character_paths (character_id, tree, node, consented_at)
     VALUES (?, ?, ?, ${proximo.irreversible ? 'NOW()' : 'NULL'})
     ON DUPLICATE KEY UPDATE
       node = VALUES(node),
       entered_at = NOW(),
       consented_at = ${proximo.irreversible ? 'NOW()' : 'consented_at'}`,
    [characterId, tree, proximo.node]
  );

  _emitter.emit('soul.path.advanced', {
    characterId, tree, node: proximo.node,
    irreversible: proximo.irreversible,
    // A governança tipifica necromancia e vampirismo como crime — o que
    // transforma caçada em processo, e não em linchamento (§III.9). Aqui só sai
    // o dado; tipificar é decisão dela.
    criminal: CRIMINAL_NODES.includes(proximo.node)
  });

  if (indiceAtual === -1 && !proximo.irreversible) {
    _emitter.emit('soul.infection.started', { characterId, tree, node: proximo.node });
  }

  const actorId = commands.getActiveActorByCharacterId(characterId);
  if (actorId) panelRefreshBus.requestRefresh(actorId, 'social');

  console.log(`[soul] char ${characterId} avancou para '${proximo.node}' em ${tree}.`);
  return { node: proximo.node };
}

// ─────────────────────────────────────────────────────────────────────────────
// Painel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload da aba Social.
 *
 * ⚠️ **Este é o teste que protege o sistema inteiro** (§III.12, item 7, "escrever
 * primeiro"). Nada aqui pode carregar valor de afinidade, banda ou semente. O
 * jogador recebe frases — sinais que já leu, marcas que carrega, onde está em
 * cada árvore. Números são do servidor; ficção é do jogador.
 *
 * Se alguém adicionar um campo com número, o teste varre o objeto inteiro e
 * reprova. Não depende de revisão de código lembrar da regra.
 */
async function buildPanelPayload(characterId) {
  const [sinais, marcas, trilhas] = await Promise.all([
    db.query('SELECT sign_key FROM character_signs WHERE character_id = ? ORDER BY revealed_at ASC', [characterId]),
    db.query('SELECT descriptor FROM character_marks WHERE character_id = ? ORDER BY created_at ASC', [characterId]),
    db.query('SELECT tree, node FROM character_paths WHERE character_id = ?', [characterId])
  ]);

  return {
    sinais: sinais.map(s => SIGN_CATALOG[s.sign_key]).filter(Boolean),
    marcas: marcas
      .filter(m => MARK_CATALOG[m.descriptor])
      .map(m => ({ texto: MARK_CATALOG[m.descriptor].text, visibilidade: MARK_CATALOG[m.descriptor].visibility })),
    caminhos: trilhas.map(t => ({ arvore: t.tree, no: t.node }))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Eventos e comandos
// ─────────────────────────────────────────────────────────────────────────────

function onSoulEvent(evento, handler) { _emitter.on(evento, handler); }
function offSoulEvent(evento, handler) { _emitter.off(evento, handler); }

function commandDefs() {
  return [
    {
      name: ['/alma', '/soul'],
      description: 'Mostra o que o seu personagem sabe sobre a propria alma — sinais, marcas e caminho',
      usage: '/alma',
      handler: (actorId) => {
        const character = commands.getActiveCharacterData(actorId);
        if (!character) return;
        buildPanelPayload(character.characterId)
          .then(payload => {
            // O comando serve pra quem não abriu o painel. Mesmo conteúdo, mesma
            // regra: frases, nunca número.
            if (payload.sinais.length === 0 && payload.marcas.length === 0) {
              commands.sendNotification(actorId, 'Ainda não há nada que você saiba sobre si mesmo.');
              return;
            }
            for (const frase of payload.sinais) commands.sendNotification(actorId, frase);
            for (const marca of payload.marcas) commands.sendNotification(actorId, marca.texto);
          })
          .catch(err => console.error('[soul] Falha ao montar /alma:', err.message));
      }
    }
  ];
}

module.exports = {
  commandDefs,
  initSoulService,
  shutdownSoulService,
  cleanup,
  ensureSoul,
  onFirstSpawn,
  revealSign,
  createMark,
  describeVisibleMarks,
  resolveAttempt,
  getPath,
  advancePath,
  buildPanelPayload,
  onSoulEvent,
  offSoulEvent,
  SIGN_CATALOG,
  MARK_CATALOG,
  TREES,
  // Exposto só pra teste: a escolha do sinal é determinística e precisa ser
  // exercitável sem banco.
  _chooseSign,
  _soulCache
};

/**
 * player-panel-service.js
 *
 * Painel do jogador: agrega dados de outros serviços (status vital, governança,
 * economia/mercado, social) e os envia para a UI via a property `panelData`.
 *
 * Não duplica lógica de negócio — só lê. Toda ação continua passando pelos
 * serviços originais (governance-service, market-stalls-service) via o menu
 * de interação já existente.
 *
 * Fluxo:
 *   - Comando /painel (ou evento 'panel:open') abre o painel e envia um snapshot
 *     de cada seção.
 *   - Enquanto o painel estiver aberto, um polling de 2s atualiza a aba de Status
 *     (vida/magicka/stamina/ouro/estado RP), só reenviando quando o valor muda.
 *   - Governança/Economia/Social são atualizados sob demanda via 'panel:refresh:<secao>'.
 */

const db = require('./database');
const commands = require('./commands');
const characterState = require('./core/character-state');
const transactionService = require('./core/transaction-service');
const governance = require('./governance-service');
const marketStalls = require('./market-stalls-service');
const identity = require('./identity-service');
const panelRefreshBus = require('./core/panel-refresh-bus');
// Mesmo motivo do death-service: a forma do `self` tem um lugar so.
const { actorRef } = require('./core/papyrus');

const VITALS_POLL_INTERVAL_MS = 2000;

let initialized = false;
let _vitalsTimer = null;

// actorIds com o painel atualmente aberto
const _openPanelActors = new Set();
// actorId -> último snapshot de status serializado (para diffing no polling)
const _lastStatusJson = new Map();

/**
 * actorId -> aba visível no momento ('status' | 'governance' | 'economy' | 'social').
 *
 * Existe por causa de custo, não de funcionalidade. Ler vida/magicka/stamina
 * custa **três** idas ao Papyrus, e cada uma custa dezenas de milissegundos —
 * o servidor RP Red House mediu 13–35 ms por chamada
 * (`REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1). Antes disto o laço lia os três
 * para **todo** painel aberto a cada 2 s, mesmo o de quem estava olhando a
 * aba Social: com 10 painéis abertos são 30 chamadas por janela, ~450 ms
 * gastos para atualizar um número que ninguém está vendo.
 *
 * A informação para evitar isso já chegava e era descartada: `player-panel.js`
 * manda `panel:refresh:<aba>` toda vez que o jogador troca de aba
 * (`switchTab`). Só faltava o servidor guardar qual foi a última.
 */
const _activeTab = new Map();

/** Aba que o painel mostra ao abrir — ver `renderTab` em skymp/ui/player-panel.js. */
const ABA_INICIAL = 'status';

// ─────────────────────────────────────────────────────────────────────────────
// Leitura de dados
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê vida/magicka/stamina atuais via Papyrus (mesmo padrão de death-service.js).
 * @param {number} actorId
 */
function readVitals(actorId) {
  if (typeof mp === 'undefined') return { health: 0, magicka: 0, stamina: 0 };
  try {
    const self = actorRef(actorId);
    return {
      health: mp.callPapyrusFunction('method', 'Actor', 'getActorValue', self, ['Health']),
      magicka: mp.callPapyrusFunction('method', 'Actor', 'getActorValue', self, ['Magicka']),
      stamina: mp.callPapyrusFunction('method', 'Actor', 'getActorValue', self, ['Stamina'])
    };
  } catch (err) {
    console.error('[player-panel] Falha ao ler vitals:', err.message);
    return { health: 0, magicka: 0, stamina: 0 };
  }
}

async function buildStatusSnapshot(actorId) {
  const character = commands.getActiveCharacterData(actorId);
  if (!character) return null;

  const gold = await transactionService.getGold(character.characterId);
  const state = characterState.get(character.characterId);
  const metadata = characterState.getMetadata(character.characterId);

  return {
    name: `${character.firstName} ${character.lastName}`,
    gold,
    state,
    metadata,
    vitals: readVitals(actorId)
  };
}

async function buildSocialSnapshot(actorId) {
  const character = commands.getActiveCharacterData(actorId);
  if (!character) return null;

  const known = await db.query(
    `SELECT target_character_id, display_name, source, updated_at
     FROM character_known_identities
     WHERE observer_character_id = ?
     ORDER BY updated_at DESC LIMIT 20`,
    [character.characterId]
  ).catch(() => []);

  return {
    knownPeople: known.map(k => ({
      characterId: k.target_character_id,
      name: k.display_name,
      source: k.source,
      at: k.updated_at
    })),
    hint: 'Use o menu de interação (clique direito) em outro jogador para negociar, se apresentar ou entrar em grupo.'
  };
}

/**
 * Renomeia (apelida) uma pessoa já conhecida direto pela aba Social do painel.
 * Não exige que o alvo esteja online — `character_known_identities` é indexada
 * por characterId, então isso funciona mesmo com o alvo desconectado — MAS exige
 * que já exista uma entrada known prévia (apresentação/apelido anterior) pra esse
 * alvo, senão qualquer characterId (1..N) poderia ser varrido pra quebrar o
 * sistema de anonimato/disfarce. Ver identity-service.getKnownDisplayName.
 * @param {number} actorId
 * @param {number} targetCharacterId
 * @param {string} alias
 * @returns {Promise<boolean>}
 */
async function renameKnownPerson(actorId, targetCharacterId, alias) {
  const myCharacter = commands.getActiveCharacterData(actorId);
  if (!myCharacter) return false;

  const cleanAlias = identity.sanitizeDisplayName(alias);
  const parsedTargetId = Number(targetCharacterId);
  if (!cleanAlias || !Number.isFinite(parsedTargetId) || parsedTargetId <= 0) return false;

  const alreadyKnown = await db.query(
    'SELECT 1 FROM character_known_identities WHERE observer_character_id = ? AND target_character_id = ? LIMIT 1',
    [myCharacter.characterId, parsedTargetId]
  ).catch(() => []);
  if (alreadyKnown.length === 0) return false;

  await identity.upsertKnownIdentity(myCharacter.characterId, parsedTargetId, cleanAlias, 'alias');
  await identity.auditIdentityEvent(
    myCharacter.accountId,
    null,
    'identity:alias',
    `via_panel observerCharacterId=${myCharacter.characterId} targetCharacterId=${parsedTargetId} alias=${cleanAlias}`
  );

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envio para a UI
// ─────────────────────────────────────────────────────────────────────────────

function sendPanelData(actorId, channel, data) {
  if (typeof mp === 'undefined') return;
  try {
    mp.set(actorId, 'panelData', { channel, data, sentAt: Date.now() });
  } catch (err) {
    console.error('[player-panel] Falha ao enviar panelData:', err.message);
  }
}

async function pushStatus(actorId) {
  const snapshot = await buildStatusSnapshot(actorId);
  if (!snapshot) return;
  _lastStatusJson.set(actorId, JSON.stringify(snapshot));
  sendPanelData(actorId, 'status', snapshot);
}

async function pushGovernance(actorId) {
  const snapshot = await governance.getMyGovernanceSummary(actorId);
  if (!snapshot) return;
  sendPanelData(actorId, 'governance', snapshot);
}

async function pushEconomy(actorId) {
  const character = commands.getActiveCharacterData(actorId);
  if (!character) return;

  const [gold, marketSummary] = await Promise.all([
    transactionService.getGold(character.characterId),
    marketStalls.getMyEconomySummary(actorId)
  ]);

  sendPanelData(actorId, 'economy', { gold, ...(marketSummary || {}) });
}

async function pushSocial(actorId) {
  const snapshot = await buildSocialSnapshot(actorId);
  if (!snapshot) return;
  sendPanelData(actorId, 'social', snapshot);
}

async function pushAllSections(actorId) {
  await Promise.all([
    pushStatus(actorId),
    pushGovernance(actorId),
    pushEconomy(actorId),
    pushSocial(actorId)
  ]);
}

const PUSH_BY_CHANNEL = {
  status: pushStatus,
  governance: pushGovernance,
  economy: pushEconomy,
  social: pushSocial
};

/**
 * Reage a panelRefreshBus.requestRefresh(actorId, channel) — disparado por
 * outros serviços (ex: governance-service após multa/prisão) quando algo
 * muda para um jogador. Só empurra dado se o painel dele estiver aberto;
 * caso contrário não faz nada (evita abrir o painel à força).
 * @param {number} actorId
 * @param {string} channel
 */
function handlePanelRefreshRequest(actorId, channel) {
  if (!_openPanelActors.has(actorId)) return;
  const push = PUSH_BY_CHANNEL[channel];
  if (!push) return;
  push(actorId).catch(err => console.error('[player-panel] Falha ao reagir a refresh solicitado:', err.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling de vitals (só para quem está com o painel aberto)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quem o laço de vitals precisa ler neste tick.
 *
 * Só quem está **com a aba Status visível**. O diffing que já existia
 * (`_lastStatusJson`) evita reenviar dado igual, mas o custo não está no envio
 * — está em montar o snapshot, que são três chamadas Papyrus mais uma query
 * de ouro. Diffing depois de pagar o custo não economiza o custo.
 */
function _atoresQuePrecisamDeVitals() {
  const alvos = [];
  for (const actorId of _openPanelActors) {
    if ((_activeTab.get(actorId) || ABA_INICIAL) === 'status') alvos.push(actorId);
  }
  return alvos;
}

/**
 * Um tick do laço de vitals. Função nomeada (em vez do corpo inline do
 * `setInterval`) pra que o teste possa exercitar um tick sem esperar 2 s reais
 * — e, principalmente, pra poder CONTAR as chamadas Papyrus que ele dispara,
 * que é o que a otimização mudou.
 */
async function _tickVitals() {
  for (const actorId of _atoresQuePrecisamDeVitals()) {
    try {
      const snapshot = await buildStatusSnapshot(actorId);
      if (!snapshot) continue;
      const json = JSON.stringify(snapshot);
      if (_lastStatusJson.get(actorId) === json) continue;
      _lastStatusJson.set(actorId, json);
      sendPanelData(actorId, 'status', snapshot);
    } catch (err) {
      console.error('[player-panel] Falha no polling de status:', err.message);
    }
  }
}

function startVitalsLoop() {
  if (_vitalsTimer) return;
  _vitalsTimer = setInterval(() => {
    _tickVitals().catch(err => console.error('[player-panel] Falha no tick de vitals:', err.message));
  }, VITALS_POLL_INTERVAL_MS);
}

function stopVitalsLoop() {
  if (_vitalsTimer) clearInterval(_vitalsTimer);
  _vitalsTimer = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

function openPanel(actorId) {
  if (typeof mp !== 'undefined') {
    mp.set(actorId, 'browserVisible', true);
    mp.set(actorId, 'browserFocused', true);
  }
  _openPanelActors.add(actorId);
  // A UI abre no Status; sem registrar isso, o primeiro tick pularia o painel
  // de quem acabou de abrir e a vida ficaria congelada ate a primeira troca.
  _activeTab.set(actorId, ABA_INICIAL);
  pushAllSections(actorId).catch(err => console.error('[player-panel] Falha ao abrir painel:', err.message));
}

/**
 * Remove o actorId do rastreio do painel (chamar na desconexão do jogador).
 * @param {number} actorId
 */
function cleanup(actorId) {
  _openPanelActors.delete(actorId);
  _lastStatusJson.delete(actorId);
  _activeTab.delete(actorId);
}

/**
 * Handler de eventos UI→servidor para o namespace 'panel'.
 * Registrado no core/ui-event-router.
 * @param {number} actorId
 * @param {{type: string, data?: object}} uiEvent
 * @returns {Promise<boolean>}
 */
async function handleUiEvent(actorId, uiEvent) {
  if (!uiEvent || typeof uiEvent.type !== 'string') return false;

  // `panel:refresh:<aba>` é mandado pelo `switchTab` da UI a cada troca de aba.
  // Guardar qual foi a última é o que permite o laço de vitals pular quem não
  // está olhando o Status — ver `_activeTab`.
  const trocaDeAba = /^panel:refresh:(status|governance|economy|social)$/.exec(uiEvent.type);
  if (trocaDeAba) _activeTab.set(actorId, trocaDeAba[1]);

  switch (uiEvent.type) {
    case 'panel:open':
      openPanel(actorId);
      return true;
    case 'panel:close':
      cleanup(actorId);
      return true;
    case 'panel:refresh:status':
      await pushStatus(actorId);
      return true;
    case 'panel:refresh:governance':
      await pushGovernance(actorId);
      return true;
    case 'panel:refresh:economy':
      await pushEconomy(actorId);
      return true;
    case 'panel:refresh:social':
      await pushSocial(actorId);
      return true;
    case 'panel:social:rename': {
      const data = uiEvent.data || {};
      const renamed = await renameKnownPerson(actorId, data.targetCharacterId, data.alias);
      if (renamed) await pushSocial(actorId);
      return true;
    }
    default:
      return false;
  }
}

function commandDefs() {
  return [
    {
      name: ['/painel', '/panel'],
      description: 'Abre o painel do jogador (status, governança, economia, social)',
      usage: '/painel',
      handler: (actorId) => openPanel(actorId)
    }
  ];
}

async function initPlayerPanelService() {
  startVitalsLoop();
  panelRefreshBus.onRefresh(handlePanelRefreshRequest);
  initialized = true;
  console.log('[player-panel] Player panel service initialized.');
}

function shutdownPlayerPanelService() {
  stopVitalsLoop();
  panelRefreshBus.offRefresh(handlePanelRefreshRequest);
  _openPanelActors.clear();
  _lastStatusJson.clear();
  _activeTab.clear();
  initialized = false;
}

module.exports = {
  commandDefs,
  initPlayerPanelService,
  shutdownPlayerPanelService,
  handleUiEvent,
  openPanel,
  cleanup,
  buildStatusSnapshot,
  buildSocialSnapshot,
  renameKnownPerson,
  handlePanelRefreshRequest,
  isInitialized: () => initialized,
  // Expostos só pra teste: a otimização de custo mora na seleção de quem entra
  // no tick, e o único jeito de provar que ela funciona é contar as chamadas
  // Papyrus que um tick dispara.
  _tickVitals,
  _atoresQuePrecisamDeVitals
};

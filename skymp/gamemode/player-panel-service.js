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

const VITALS_POLL_INTERVAL_MS = 2000;

let initialized = false;
let _vitalsTimer = null;

// actorIds com o painel atualmente aberto
const _openPanelActors = new Set();
// actorId -> último snapshot de status serializado (para diffing no polling)
const _lastStatusJson = new Map();

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
    const selfObj = { type: 'form', desc: mp.getDescFromId(actorId) };
    return {
      health: mp.callPapyrusFunction('method', 'Actor', 'getActorValue', selfObj, ['Health']),
      magicka: mp.callPapyrusFunction('method', 'Actor', 'getActorValue', selfObj, ['Magicka']),
      stamina: mp.callPapyrusFunction('method', 'Actor', 'getActorValue', selfObj, ['Stamina'])
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

// ─────────────────────────────────────────────────────────────────────────────
// Polling de vitals (só para quem está com o painel aberto)
// ─────────────────────────────────────────────────────────────────────────────

function startVitalsLoop() {
  if (_vitalsTimer) return;
  _vitalsTimer = setInterval(() => {
    for (const actorId of _openPanelActors) {
      buildStatusSnapshot(actorId)
        .then(snapshot => {
          if (!snapshot) return;
          const json = JSON.stringify(snapshot);
          if (_lastStatusJson.get(actorId) === json) return;
          _lastStatusJson.set(actorId, json);
          sendPanelData(actorId, 'status', snapshot);
        })
        .catch(err => console.error('[player-panel] Falha no polling de status:', err.message));
    }
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
  pushAllSections(actorId).catch(err => console.error('[player-panel] Falha ao abrir painel:', err.message));
}

/**
 * Remove o actorId do rastreio do painel (chamar na desconexão do jogador).
 * @param {number} actorId
 */
function cleanup(actorId) {
  _openPanelActors.delete(actorId);
  _lastStatusJson.delete(actorId);
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
  initialized = true;
  console.log('[player-panel] Player panel service initialized.');
}

function shutdownPlayerPanelService() {
  stopVitalsLoop();
  _openPanelActors.clear();
  _lastStatusJson.clear();
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
  isInitialized: () => initialized
};

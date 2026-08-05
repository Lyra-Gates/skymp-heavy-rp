/**
 * death-service.js
 *
 * Morte e resgate com consequência real (Heavy RP).
 *
 * Antes: HP<=0 disparava um respawn automático 10s depois, sem estado, sem
 * penalidade, sem chance de outro jogador intervir — "morrer" era um
 * non-event mecânico. Agora:
 *
 *   HP<=0 → estado DOWNED (bloqueia gameplay/fala via core/action-policy.js,
 *           que já restringe esses estados) → ou:
 *     (a) outro jogador usa /socorrer <actorId> a tempo → volta pra NORMAL
 *         com uma pequena estabilização de vida; ou
 *     (b) ninguém socorre dentro de BLEED_OUT_MS → estado DEAD, penalidade
 *         de ouro é aplicada via core/transaction-service (atômico), um
 *         snapshot de quem estava por perto é gravado em audit_logs (evidência
 *         de RDM pra staff), e só então o personagem respawna no ponto seguro.
 */

const db = require('./database');
const commands = require('./commands');
const characterState = require('./core/character-state');
const { STATES } = characterState;
const transactionService = require('./core/transaction-service');
const panelRefreshBus = require('./core/panel-refresh-bus');
const rangeUtils = require('./core/range-utils');

const RESPAWN_POS = [-150, -100, -200]; // Coordenadas ficticias do Templo de Kynareth
const RESPAWN_CELL = '0x162e2'; // ID do Templo
const DEATH_PENALTY_COINS = 50;
const DEATH_PENALTY_PERCENTAGE = 0.1; // 10% do ouro atual, o que for maior

const BLEED_OUT_MS = 4 * 60 * 1000; // janela de socorro: 4 minutos
const RESPAWN_DELAY_MS = 5000; // pausa dramática entre "morreu" e respawn
const RESCUE_RANGE = 300;
const DEATH_CONTEXT_RANGE = 1200; // mesmo raio de "say" do rp-chat-service
const STABILIZE_HEALTH = 25;

// characterId -> { actorId, downedAt, timer }
const _downedPlayers = new Map();

function initDeathService() {
  if (typeof mp === 'undefined') return;
  console.log('[death-service] Initializing Death and Respawn hooks...');

  setInterval(() => {
    try {
      // Para cada profileId de player 1..50
      for (let pId = 1; pId <= 50; pId++) {
        const actors = mp.getActorsByProfileId(pId);
        if (!actors || actors.length === 0) continue;

        for (const actorId of actors) {
          const selfObj = { type: 'form', desc: mp.getDescFromId(actorId) };
          const health = mp.callPapyrusFunction('method', 'Actor', 'getActorValue', selfObj, ['Health']);
          const currentlyDead = (health <= 0);
          const wasDead = mp.get(actorId, '_wasDead') || false;

          if (currentlyDead && !wasDead) {
            handlePlayerDowned(actorId).catch(err => console.error('[death-service] Falha ao processar queda:', err.message));
            mp.set(actorId, '_wasDead', true);
          } else if (!currentlyDead && wasDead) {
            mp.set(actorId, '_wasDead', false);
          }
        }
      }
    } catch (err) {
      console.error('[death-service] Error polling health:', err.message);
    }
  }, 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Queda → DOWNED
// ─────────────────────────────────────────────────────────────────────────────

async function handlePlayerDowned(actorId) {
  const character = commands.getActiveCharacterData(actorId);
  if (!character) return;
  if (_downedPlayers.has(character.characterId)) return; // já processando esta queda

  console.log(`[death-service] Player Actor ${actorId.toString(16)} caiu. Estado: DOWNED.`);
  characterState.set(character.characterId, STATES.DOWNED, { downedAt: Date.now() });
  commands.broadcastProximityMessage(actorId, '* O corpo cai ao chão, ferido e sangrando.', 1500);
  panelRefreshBus.requestRefresh(actorId, 'status');

  const timer = setTimeout(() => {
    bleedOut(actorId, character.characterId).catch(err => console.error('[death-service] Falha no bleed-out:', err.message));
  }, BLEED_OUT_MS);
  // unref: um bleed-out pendente não deve impedir o processo (ou os testes) de encerrar.
  if (typeof timer.unref === 'function') timer.unref();

  _downedPlayers.set(character.characterId, { actorId, downedAt: Date.now(), timer });
}

// ─────────────────────────────────────────────────────────────────────────────
// Socorro (comando /socorrer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estabiliza um alvo DOWNED próximo, cancelando o bleed-out.
 * @param {number} rescuerActorId
 * @param {number} targetActorId
 */
async function rescueTarget(rescuerActorId, targetActorId) {
  if (rescuerActorId === targetActorId) {
    commands.sendNotification(rescuerActorId, 'Voce nao pode se socorrer sozinho — peça ajuda a alguém por perto.');
    return;
  }

  const rescuer = commands.getActiveCharacterData(rescuerActorId);
  const target = commands.getActiveCharacterData(targetActorId);
  if (!rescuer || !target) {
    commands.sendNotification(rescuerActorId, 'Alvo invalido.');
    return;
  }

  const downed = _downedPlayers.get(target.characterId);
  if (!downed) {
    commands.sendNotification(rescuerActorId, 'Esse personagem nao esta abatido.');
    return;
  }

  const range = rangeUtils.assertRange(rescuerActorId, targetActorId, RESCUE_RANGE);
  if (!range.ok) {
    commands.sendNotification(rescuerActorId, range.reason);
    return;
  }

  clearTimeout(downed.timer);
  _downedPlayers.delete(target.characterId);

  characterState.set(target.characterId, STATES.NORMAL, {});
  if (typeof mp !== 'undefined') {
    const targetSelf = { type: 'form', desc: mp.getDescFromId(targetActorId) };
    mp.callPapyrusFunction('method', 'Actor', 'Resurrect', targetSelf, []);
    mp.callPapyrusFunction('method', 'Actor', 'SetActorValue', targetSelf, ['Health', STABILIZE_HEALTH]);
    mp.set(targetActorId, '_wasDead', false);
  }

  commands.sendNotification(rescuerActorId, 'Voce estabilizou o ferido.');
  commands.sendNotification(targetActorId, 'Voce foi socorrido e recobra a consciencia, fraco.');
  commands.broadcastProximityMessage(rescuerActorId, '* Presta socorro a um ferido caído por perto.', 600);
  panelRefreshBus.requestRefresh(targetActorId, 'status');
}

// ─────────────────────────────────────────────────────────────────────────────
// Bleed-out → penalidade + respawn
// ─────────────────────────────────────────────────────────────────────────────

async function bleedOut(actorId, characterId) {
  _downedPlayers.delete(characterId);
  console.log(`[death-service] Personagem ${characterId} sangrou ate a morte sem socorro.`);

  characterState.set(characterId, STATES.DEAD, {});
  await logDeathContext(actorId, characterId, 'bleed_out');

  const gold = await transactionService.getGold(characterId);
  const penalty = Math.min(gold, Math.max(DEATH_PENALTY_COINS, Math.floor(gold * DEATH_PENALTY_PERCENTAGE)));
  if (penalty > 0) {
    await transactionService.removeGold({ characterId, amount: penalty, reason: 'death_penalty', module: 'death' });
  }

  commands.broadcastProximityMessage(actorId, '* O corpo para de se mexer.', 1500);
  panelRefreshBus.requestRefresh(actorId, 'status');

  const respawnTimer = setTimeout(() => {
    executeRespawn(actorId, characterId, penalty).catch(err => console.error('[death-service] Falha no respawn:', err.message));
  }, RESPAWN_DELAY_MS);
  if (typeof respawnTimer.unref === 'function') respawnTimer.unref();

  return penalty;
}

async function executeRespawn(actorId, characterId, penalty = 0) {
  if (typeof mp === 'undefined') return;

  try {
    const selfObj = { type: 'form', desc: mp.getDescFromId(actorId) };
    mp.callPapyrusFunction('method', 'Actor', 'Resurrect', selfObj, []);

    mp.set(actorId, 'locationalData', {
      pos: RESPAWN_POS,
      worldOrCell: RESPAWN_CELL,
      angleZ: 0
    });
    mp.set(actorId, '_wasDead', false);

    characterState.set(characterId, STATES.NORMAL, {});
    console.log(`[death-service] Respawn complete for actor ${actorId.toString(16)}.`);

    commands.sendNotification(actorId, penalty > 0
      ? `Voce foi resgatado e acordou em um local seguro. Perdeu ${penalty} septims no processo.`
      : 'Voce foi resgatado e acordou em um local seguro.');
    panelRefreshBus.requestRefresh(actorId, 'status');
  } catch (err) {
    console.error(`[death-service] Failed to respawn actor ${actorId.toString(16)}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidência anti-RDM: quem estava por perto na hora da morte
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Não existe hook nativo confiável de "quem causou o dano" nesta base — o
 * contexto é por proximidade (mesmo padrão de commands.broadcastProximityMessage),
 * não uma atribuição definitiva. Ainda assim dá à staff uma trilha real pra
 * arbitrar denúncias de RDM, em vez de só a palavra dos jogadores.
 */
async function logDeathContext(actorId, characterId, cause) {
  const nearby = [];

  try {
    if (typeof mp !== 'undefined') {
      const neighbors = mp.get(actorId, 'neighbors') || [];
      const loc = mp.get(actorId, 'locationalData');
      const pos = loc && loc.pos;
      const cell = loc && (loc.cellOrWorldSpaceId || loc.cellId || loc.worldOrCell);

      for (const neighborId of neighbors) {
        if (neighborId === actorId) continue;
        if (mp.get(neighborId, 'type') !== 'MpActor') continue;

        const neighborChar = commands.getActiveCharacterData(neighborId);
        if (!neighborChar) continue;

        const neighborLoc = mp.get(neighborId, 'locationalData');
        if (!pos || !neighborLoc || !neighborLoc.pos) continue;
        const neighborCell = neighborLoc.cellOrWorldSpaceId || neighborLoc.cellId || neighborLoc.worldOrCell;
        if (cell && neighborCell && cell !== neighborCell) continue;

        const dx = pos[0] - neighborLoc.pos[0];
        const dy = pos[1] - neighborLoc.pos[1];
        const dz = pos[2] - neighborLoc.pos[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance <= DEATH_CONTEXT_RANGE) {
          nearby.push({
            characterId: neighborChar.characterId,
            name: `${neighborChar.firstName} ${neighborChar.lastName}`,
            distance: Math.round(distance)
          });
        }
      }
    }
  } catch (err) {
    console.error('[death-service] Falha ao coletar contexto de morte:', err.message);
  }

  try {
    await db.query(
      'INSERT INTO audit_logs (action, actor_account_id, target_account_id, details) VALUES (?, ?, ?, ?)',
      ['death:context', null, null, JSON.stringify({ characterId, cause, nearby })]
    );
  } catch (err) {
    console.error('[death-service] Falha ao registrar contexto de morte:', err.message);
  }

  return nearby;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comandos
// ─────────────────────────────────────────────────────────────────────────────

function commandDefs() {
  return [
    {
      name: ['/socorrer', '/rescue'],
      description: 'Estabiliza um personagem abatido por perto, cancelando o sangramento',
      usage: '/socorrer <actorId>',
      handler: (actorId, args) => {
        const targetActorId = Number.parseInt(String(args || '').replace(/^0x/i, ''), 16);
        if (!Number.isFinite(targetActorId)) {
          commands.sendNotification(actorId, 'Uso: /socorrer <actorId>');
          return;
        }
        rescueTarget(actorId, targetActorId).catch(err => {
          console.error('[death-service] Falha ao processar socorro:', err.message);
          commands.sendNotification(actorId, 'Nao foi possivel prestar socorro.');
        });
      }
    }
  ];
}

module.exports = {
  commandDefs,
  initDeathService,
  rescueTarget,
  bleedOut,
  executeRespawn,
  logDeathContext,
  isDowned: (characterId) => _downedPlayers.has(characterId),
  // Exposto só pra testes: evita depender de setTimeout real pra exercitar o fluxo.
  _handlePlayerDowned: handlePlayerDowned,
  _downedPlayers
};

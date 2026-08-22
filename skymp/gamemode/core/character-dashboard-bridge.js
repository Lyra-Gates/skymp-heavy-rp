/**
 * core/character-dashboard-bridge.js
 *
 * Tarefa 11, objetivo 3 (redesenhado). O brief original pedia um "Character
 * Dashboard" novo com abas de Identidade/Finanças/Profissões/Gestos — mas
 * `player-panel-service.js` + `skymp/ui/player-panel.js`/`.css` JÁ SÃO
 * isso: nome, ouro real (`transactionService.getGold`), social, governança,
 * abas de verdade, aberto por `/painel`. Construir um componente novo
 * duplicaria um sistema que já funciona.
 *
 * Este arquivo é só a PONTE: registra `TARGET_TYPES.SELF` no Interaction
 * Framework (o resolvedor de `player` recusa `targetActorId === actorId` de
 * propósito — `interaction-targets.js` linha ~102, citando
 * `CORE_FRAMEWORK_AUDIT.md` §6.7a: "interação consigo é painel, não menu
 * contextual") e uma única interação (`character.dashboard`) cujo `execute`
 * só chama `playerPanelService.openPanel(actorId)` — o MESMO código que
 * `/painel` já chama. Zero UI nova, zero leitura de dado duplicada.
 *
 * Isso é o que faz o prompt `[E]` (`core/interaction-prompt-service.js`) ter
 * um candidato mesmo quando não há ator nem âncora física por perto: SELF é
 * sempre "alcançável" (sem `assertRange` — nunca fora de alcance de si
 * mesmo), então vira o fallback natural quando `_melhorCandidato` não acha
 * nada melhor.
 *
 * TODO: Hook para Profession-Service (PR #34, branch `feat/professions-
 * foundation`, ainda não mergeada em `main`). Quando mergear, o lugar certo
 * pra rank/xp aparecerem é uma aba nova em `player-panel-service.js`
 * (`pushProfession`, mesmo padrão de `pushEconomy`), não aqui — este arquivo
 * não lê dado nenhum, só abre o painel.
 */

'use strict';

const interactionRegistry = require('./interaction-registry');

const MODULE_ID = 'character-dashboard-bridge';

/**
 * @param {{targets: {registerResolver: Function}, openPanel: (actorId: number) => void}} dependencies
 */
function registerInteractions(dependencies = {}) {
  const { targets, openPanel } = dependencies;
  if (!targets || typeof targets.registerResolver !== 'function') {
    throw new Error(`[${MODULE_ID}] precisa de 'targets' (interaction-targets) para registrar o resolvedor SELF.`);
  }
  if (typeof openPanel !== 'function') {
    throw new Error(`[${MODULE_ID}] precisa de 'openPanel' (player-panel-service) injetado.`);
  }

  // O alvo é sempre quem pediu — `rawTargetId` não importa, mas o campo
  // existe na assinatura do resolvedor (`interaction-targets.js`) por
  // simetria com os outros, não por uso.
  targets.registerResolver(interactionRegistry.TARGET_TYPES.SELF, (_rawTargetId, actorId) => ({
    type: interactionRegistry.TARGET_TYPES.SELF,
    id: `self:${actorId}`,
    label: 'Você',
    actorId
    // Sem `assertRange`: `buildContext` (`interaction-service.js`) só checa
    // distância quando o alvo resolvido expõe essa função — de propósito,
    // pra nunca recusar alguém por "distância até si mesmo".
  }));

  interactionRegistry.register({
    id: 'character.dashboard',
    module: MODULE_ID,
    target: interactionRegistry.TARGET_TYPES.SELF,
    section: 'self',
    label: 'Ver personagem',
    order: 10,
    audit: interactionRegistry.AUDIT_LEVELS.TRACE,
    execute: async (ctx) => {
      openPanel(ctx.actorId);
      return { message: null };
    }
  });
}

module.exports = { MODULE_ID, registerInteractions };

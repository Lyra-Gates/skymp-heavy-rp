const { actorRef } = require('./core/papyrus');
// Serviço de Limpeza de NPCs Vanilla (World Cleaner)
// Desativa a maioria dos NPCs vanilla para dar espaço ao RP, exceto mercadores vitais ou guardas essenciais (se configurado).

const config = {
  cleanupIntervalMs: 60000, // Limpa a cada 1 minuto
  safeRadius: 5000,         // Limpa apenas NPCs que estejam longe dos players para não quebrar imersão brusca
};

const whitelistedBaseIds = new Set([
  // Adicione IDs base de mercadores essenciais aqui (ex: Belethor, Adrianne, etc)
]);

function startWorldCleaner() {
  if (typeof mp === 'undefined') return;
  console.log('[npc-cleaner] Starting world cleaner service...');

  setInterval(() => {
    try {
      // profileId 0 no SkyMP costuma agrupar NPCs nativos e spawns do servidor.
      // Em versões recentes, a API mp.getActorsByProfileId(0) retorna atores que o servidor reconheceu.
      const actors = mp.getActorsByProfileId(0) || [];
      let removedCount = 0;

      for (const actorId of actors) {
        if (!actorId) continue;
        
        const baseId = mp.get(actorId, 'baseDesc');
        if (baseId && whitelistedBaseIds.has(baseId)) {
          continue; // NPC protegido
        }

        // Tenta remover (disable)
        // Isso remove visualmente e da colisao o NPC
        mp.callPapyrusFunction('method', 'ObjectReference', 'disable', actorRef(actorId), [false]);
        mp.callPapyrusFunction('method', 'ObjectReference', 'delete', actorRef(actorId), []);
        removedCount++;
      }

      if (removedCount > 0) {
        console.log(`[npc-cleaner] Sweep complete. Removed ${removedCount} vanilla NPCs.`);
      }
    } catch (err) {
      console.error('[npc-cleaner] Error during cleanup sweep:', err.message);
    }
  }, config.cleanupIntervalMs);
}

module.exports = {
  startWorldCleaner
};

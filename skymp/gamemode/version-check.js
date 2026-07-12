const MIN_VERSION = "1.0.0-beta";

function handlePlayerConnect(actorId, clientVersion) {
    if (!clientVersion || clientVersion !== MIN_VERSION) {
        // Envia mensagem de erro
        if (typeof mp !== 'undefined') {
            try {
                mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`[SISTEMA] Versão Incompatível! Use o Launcher oficial (Esperado: ${MIN_VERSION}). Você será desconectado.`]);
                // Em um servidor SkyMP real, poderíamos forçar kick, mas a API varia. 
                // Usando um método genérico ou avisando a staff.
                const admin = require('./admin-service');
                if (admin && admin.kickPlayer) {
                    setTimeout(() => {
                        admin.kickPlayer(0, actorId, "Cliente desatualizado. Baixe o Launcher em nosso site.");
                    }, 5000); // Dá 5 segundos para o jogador ler a mensagem antes de ser expulso
                }
            } catch (e) {
                console.error("[version-check] Erro ao kickar jogador desatualizado:", e.message);
            }
        }
        return false; // Bloqueado
    }
    return true; // Permitido
}

module.exports = {
    handlePlayerConnect,
    MIN_VERSION
};

const btn = document.getElementById('main-btn');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const progressContainer = document.getElementById('progress-container');
const pathInput = document.getElementById('game-path');

// Escutar eventos de progresso de validação
window.electronAPI.onVerifyProgress((data) => {
    const percent = (data.current / data.total) * 100;
    progressBar.style.width = percent + '%';
    statusText.innerText = `Verificando arquivo ${data.current} de ${data.total}...`;
});

btn.addEventListener('click', async () => {
    btn.disabled = true;
    const gamePath = pathInput.value;
    
    try {
        statusText.innerText = 'Obtendo manifesto do servidor...';
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        
        const manifest = await window.electronAPI.fetchManifest();
        
        if (!manifest || !manifest.files) {
            throw new Error("Manifesto inválido recebido do servidor.");
        }
        
        statusText.innerText = 'Verificando integridade dos arquivos...';
        const toDownload = await window.electronAPI.verifyFiles(manifest.files, gamePath);
        
        if (toDownload.length > 0) {
            statusText.innerText = `Falta baixar/atualizar ${toDownload.length} arquivos. (Download simulado - Fase Beta)`;
            // Mock de download
            await new Promise(r => setTimeout(r, 2000)); 
            // Na implementação real, chamaríamos IPC para baixar esses arquivos.
        }
        
        statusText.innerText = 'Iniciando o jogo...';
        progressBar.style.width = '100%';
        
        await window.electronAPI.launchGame(gamePath);
        
        statusText.innerText = 'Jogo em execução!';
        setTimeout(() => { btn.disabled = false; }, 5000);
        
    } catch (err) {
        console.error(err);
        statusText.innerText = 'Erro: ' + err.message;
        btn.disabled = false;
        progressContainer.style.display = 'none';
    }
});

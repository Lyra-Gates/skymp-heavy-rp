const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { execFile } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile('src/index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Baixar Manifesto
ipcMain.handle('fetch-manifest', async () => {
    try {
        const response = await axios.get('http://localhost:3001/api/launcher/manifest');
        return response.data;
    } catch (err) {
        console.error('Failed to fetch manifest:', err.message);
        throw err;
    }
});

// Helper: Calcular Hash SHA256
function getFileHash(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) return resolve(null);
        
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

// IPC: Verificar arquivos
ipcMain.handle('verify-files', async (event, files, gamePath) => {
    const toDownload = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fullPath = path.join(gamePath, file.path);
        const hash = await getFileHash(fullPath);
        
        if (hash !== file.hash) {
            toDownload.push(file);
        }
        
        event.sender.send('verify-progress', {
            current: i + 1,
            total: files.length,
            file: file.path
        });
    }
    
    return toDownload;
});

// IPC: Iniciar o jogo
ipcMain.handle('launch-game', (event, gamePath) => {
    return new Promise((resolve, reject) => {
        const exePath = path.join(gamePath, 'skse64_loader.exe');
        
        if (!fs.existsSync(exePath)) {
            return reject(new Error('skse64_loader.exe não encontrado em ' + gamePath));
        }

        execFile(exePath, [], { cwd: gamePath }, (error) => {
            if (error) {
                console.error(error);
                return reject(error);
            }
            resolve(true);
        });
        
        // Minimiza o launcher ao rodar
        if(mainWindow) mainWindow.minimize();
    });
});

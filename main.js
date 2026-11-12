'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

// The API key lives in .env (gitignored): PRESAGE_API_KEY=...
function readEnvKey() {
    try {
        const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
        const m = text.match(/^\s*PRESAGE_API_KEY\s*=\s*(.+?)\s*$/m);
        return m ? m[1].replace(/^["']|["']$/g, '') : '';
    } catch {
        return '';
    }
}

ipcMain.on('pm:config', (event) => {
    event.returnValue = { apiKey: readEnvKey() };
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1100,
        height: 780,
        backgroundColor: '#0c0d11',
        title: 'Pulse Mirror',
        webPreferences: {
            preload: require.resolve('@smartspectra/node-sdk/preload'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    bindSmartSpectraIpc(win);
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    // Mirror renderer logs that start with [pm] to the terminal while developing.
    win.webContents.on('console-message', (event, ...args) => {
        const msg = event.message ?? args[1];
        if (typeof msg === 'string' && msg.startsWith('[pm]')) console.log(msg);
    });
    win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    // Second preload: hands the renderer its config. The SDK preload stays the window's own.
    session.defaultSession.setPreloads([path.join(__dirname, 'preload-config.js')]);
    // Camera only, and only for our own local page. Never the microphone.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
        const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
        const types = (details && details.mediaTypes) || [];
        const cameraOnly = types.length === 1 && types[0] === 'video';
        callback(permission === 'media' && cameraOnly && url.startsWith('file://'));
    });
    createWindow();
});

app.on('window-all-closed', () => app.quit());

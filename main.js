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
    // Stop the SDK and the camera before the window goes away; closing mid-download can crash the native layer.
    let closing = false;
    win.on('close', (event) => {
        if (closing) return;
        closing = true;
        event.preventDefault();
        const done = () => { if (!win.isDestroyed()) win.destroy(); };
        const timer = setTimeout(done, 4000);
        win.webContents.executeJavaScript('window.pmShutdown ? window.pmShutdown() : null').catch(() => {}).finally(() => { clearTimeout(timer); done(); });
    });
    const demo = process.argv.includes('--review-locked');
    win.loadFile(path.join(__dirname, 'index.html'), demo ? { search: 'demo=locked' } : undefined);
    if (process.argv.includes('--review') || demo) reviewRun(win, demo);
}

// Development only: `electron . --review` presses Start after 3 s and saves
// screenshots of the real window to .impeccable/review/, then quits.
function reviewRun(win, demo) {
    const dir = path.join(__dirname, '.impeccable', 'review');
    fs.mkdirSync(dir, { recursive: true });
    const shots = demo ? [1, 12, 15, 17, 19, 21, 26] : [1, 10, 25, 40, 55, 70, 90];
    win.webContents.once('did-finish-load', () => {
        setTimeout(() => win.webContents.executeJavaScript('document.getElementById("start").click()'), 3000);
        shots.forEach((s, i) => setTimeout(async () => {
            const image = await win.webContents.capturePage();
            fs.writeFileSync(path.join(dir, 'state-' + String(i + 1).padStart(2, '0') + '-t' + s + '.png'), image.toPNG());
            if (i === shots.length - 1) win.close();
        }, s * 1000));
    });
}

app.whenReady().then(() => {
    // Second preload: hands the renderer its config. The SDK preload stays the window's own.
    session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload-config.js') });
    // Camera only, and only for our own local page. Never the microphone.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
        const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
        const types = (details && details.mediaTypes) || [];
        const cameraOnly = types.length === 1 && types[0] === 'video';
        callback(permission === 'media' && cameraOnly && url.startsWith('file://'));
    });
    createWindow();
});

// Give the SDK's native threads a moment to finish their shutdown before the process exits.
app.on('window-all-closed', () => setTimeout(() => app.exit(0), 2500));

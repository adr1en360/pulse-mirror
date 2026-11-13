'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

// Only our own page may ask for the key or save a file. The URL may carry a query in development.
const INDEX_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const fromOurPage = (event) => !!(event.senderFrame && String(event.senderFrame.url).split('?')[0] === INDEX_URL);

// Only the files the app itself makes: an mp4, a webm or a png, of a sane size.
const MAX_SAVE_BYTES = 64 * 1024 * 1024;
function looksLike(bytes, ext) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 16 || bytes.length > MAX_SAVE_BYTES) return false;
    if (ext === 'png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (ext === 'mp4') return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;   // "ftyp"
    return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;                       // EBML (webm)
}

// A second copy would fight the first for the camera and the SDK.
if (!app.requestSingleInstanceLock()) app.quit();

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
    event.returnValue = fromOurPage(event) ? { apiKey: readEnvKey() } : {};
});

let mainWindow = null;

// Save a captured clip. The only way a clip ever leaves memory: a file the user chooses.
ipcMain.handle('pm:save', async (event, bytes, ext) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !fromOurPage(event)) return { saved: false };
    const safeExt = ext === 'mp4' ? 'mp4' : ext === 'png' ? 'png' : 'webm';
    const isImage = safeExt === 'png';
    if (!looksLike(bytes, safeExt)) return { saved: false };
    // Local date, so the file name matches the date in the caption.
    const now = new Date();
    const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const result = await dialog.showSaveDialog(mainWindow, {
        title: isImage ? 'Save your image' : 'Save your clip',
        defaultPath: 'pulse-mirror-' + stamp + '.' + safeExt,
        filters: [{ name: isImage ? 'Image' : 'Video', extensions: [safeExt] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    const target = result.filePath;
    await fs.promises.writeFile(target, bytes);
    return { saved: true, path: target };
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1100,
        height: 780,
        minWidth: 1000,
        minHeight: 640,
        backgroundColor: '#0c0d11',
        title: 'Pulse Mirror',
        webPreferences: {
            preload: require.resolve('@smartspectra/node-sdk/preload'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    mainWindow = win;
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
    win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    Menu.setApplicationMenu(null);   // no default menu, so no DevTools shortcut during a demo
    // Second preload: hands the renderer its config. The SDK preload stays the window's own.
    session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload-config.js') });
    // Camera only, and only for our own local page. Never the microphone.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
        const url = String((details && details.requestingUrl) || (wc && wc.getURL()) || '').split('?')[0];
        const types = (details && details.mediaTypes) || [];
        const cameraOnly = types.length === 1 && types[0] === 'video';
        callback(permission === 'media' && cameraOnly && url === INDEX_URL);
    });
    createWindow();
});

// Give the SDK's native threads a moment to finish their shutdown before the process exits.
app.on('window-all-closed', () => setTimeout(() => app.exit(0), 2500));

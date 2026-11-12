'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
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

let mainWindow = null;

// Save a captured clip. The only way a clip ever leaves memory: a file the user chooses.
// In a review run the file goes to .impeccable/review/ instead of the dialog.
ipcMain.handle('pm:save', async (event, bytes, ext) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { saved: false };
    const safeExt = ext === 'mp4' ? 'mp4' : ext === 'png' ? 'png' : 'webm';
    const isImage = safeExt === 'png';
    const reviewDir = path.join(__dirname, '.impeccable', 'review');
    let target;
    if (process.argv.includes('--review-locked') || process.argv.includes('--review-real')) {
        fs.mkdirSync(reviewDir, { recursive: true });
        target = path.join(reviewDir, 'clip.' + safeExt);
    } else {
        const stamp = new Date().toISOString().slice(0, 10);
        const result = await dialog.showSaveDialog(mainWindow, {
            title: isImage ? 'Save your image' : 'Save your clip',
            defaultPath: 'pulse-mirror-' + stamp + '.' + safeExt,
            filters: [{ name: isImage ? 'Image' : 'Video', extensions: [safeExt] }],
        });
        if (result.canceled || !result.filePath) return { saved: false };
        target = result.filePath;
    }
    fs.writeFileSync(target, Buffer.from(bytes));
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
    const demo = process.argv.includes('--review-locked');
    win.loadFile(path.join(__dirname, 'index.html'), demo ? { search: 'demo=locked' } : undefined);
    if (process.argv.includes('--review') || demo) reviewRun(win, demo);
    if (process.argv.includes('--review-real')) realRun(win);
}

// Development only: `electron . --review-real` starts the camera, waits for a genuine pulse lock,
// captures and saves a clip to .impeccable/review/, taking screenshots on the way.
function realRun(win) {
    const dir = path.join(__dirname, '.impeccable', 'review');
    fs.mkdirSync(dir, { recursive: true });
    const snap = async (name) => {
        try { fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG()); } catch { /* window gone */ }
    };
    const js = (code) => win.webContents.executeJavaScript(code).catch(() => null);
    win.webContents.once('did-finish-load', () => {
        setTimeout(() => js('document.getElementById("start").click()'), 3000);
        let lockedAt = 0, captured = false, saved = false, ticks = 0;
        const began = Date.now();
        const timer = setInterval(async () => {
            ticks++;
            const st = String(await js('document.body.dataset.state + "|" + (document.body.dataset.clip || "")'));
            const [state, clip] = st.split('|');
            const now = Date.now();
            if (state === 'locked' && !lockedAt) lockedAt = now;
            if (!lockedAt && ticks % 20 === 0) snap('real-wait-' + ticks + 's.png');
            if (lockedAt && !captured && now - lockedAt > 3500) {
                captured = true;
                await snap('real-1-locked.png');
                js('document.getElementById("capture").click()');
                setTimeout(() => snap('real-2-recording.png'), 2500);
            }
            if (clip === 'review' && !saved) {
                saved = true;
                await new Promise((r) => setTimeout(r, 2500));
                await snap('real-3-review.png');
                await js('document.getElementById("save").click()');
                setTimeout(() => win.close(), 2500);
            }
            if (now - began > 175000 && !saved) { await snap('real-timeout.png'); win.close(); }
        }, 1000);
        win.on('closed', () => clearInterval(timer));
    });
}

// Development only: `electron . --review` presses Start after 3 s and saves
// screenshots of the real window to .impeccable/review/, then quits.
function reviewRun(win, demo) {
    const dir = path.join(__dirname, '.impeccable', 'review');
    fs.mkdirSync(dir, { recursive: true });
    const shots = demo ? [11, 14, 17, 21, 24, 28, 36] : [1, 10, 25, 40, 55, 70, 90];
    win.webContents.once('did-finish-load', () => {
        setTimeout(() => win.webContents.executeJavaScript('document.getElementById("start").click()'), 3000);
        if (demo) {
            setTimeout(() => win.webContents.executeJavaScript('document.getElementById("capture").click()'), 12000);
            setTimeout(() => win.webContents.executeJavaScript('document.getElementById("name").value = "Ada"'), 21000);
            setTimeout(() => win.webContents.executeJavaScript('document.getElementById("saveimage").click()'), 23000);
            setTimeout(() => win.webContents.executeJavaScript('document.getElementById("save").click()'), 25000);
        }
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

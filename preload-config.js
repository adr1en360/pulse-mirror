'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseMirror', {
    ...ipcRenderer.sendSync('pm:config'),
    // Ask the main process to save a clip or a still image; it shows the Save dialog.
    saveClip: (bytes, ext) => ipcRenderer.invoke('pm:save', bytes, ext),
});

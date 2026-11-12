'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseMirror', ipcRenderer.sendSync('pm:config'));

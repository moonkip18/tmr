// preload.js — exposes a minimal, context-isolated bridge for the Electron build.
// The web app detects Electron via TmrNative.isElectron and uses this to:
//  - dispatch study hotkeys (Ctrl+Shift+S / Ctrl+Shift+A)
//  - start/stop the overnight sleep schedule and receive play events back
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('TmrNative', {
  isElectron: true,
  platform: process.platform,
  startSleep: (plan) => ipcRenderer.invoke('tmr-native', 'startSleep', plan),
  stopSleep: () => ipcRenderer.invoke('tmr-native', 'stopSleep'),
  onEvent: (cb) => ipcRenderer.on('tmr-sleep-event', (_e, msg, payload) => cb(msg, payload)),
});

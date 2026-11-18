/* synapsis — Electron main. Registers the global study hotkey (Ctrl+Shift+S)
   and auto toggle (Ctrl+Shift+A), then dispatches to the web app.
   Overnight sleep schedule runs in the main process for reliability (renderer
   timers may be throttled when the window is backgrounded). The main process
   sends play/stop noise events to the renderer, which plays the actual audio
   via WebAudio. */
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { setInterval, clearInterval, setTimeout, clearTimeout } = require('timers');

let win = null;
const IS_DEV = !app.isPackaged;

// ---- overnight sleep scheduler ----
let sleepState = { running: false };
let sleepTimers = { interval: null, block: null };
let sleepCtx = { inBlock: false, blockEnd: 0, startedAt: 0, cueCount: 0 };

function startSleepService(plan) {
  if (sleepState.running) return;
  sleepState.running = true;
  sleepCtx = { inBlock: false, blockEnd: 0, startedAt: Date.now(), cueCount: 0 };

  const leadInMs = (plan.leadInSec || 60 * 60) * 1000;
  const intervalMs = (plan.intervalSec || 300) * 1000;
  // The cap bounds CUEING TIME and counts from the END of the lead-in (the
  // lead-in is silence, not part of the cued session). Every cue checks the
  // budget, so pauses inside OFF blocks don't eat the cap and the loop
  // reschedules itself across block transitions instead of stacking timers.
  const capMs = (plan.capSec || 40 * 60 * 1000) * 1000;
  const blockOnMs = (plan.blockOnSec || 0) * 1000;
  const blockOffMs = (plan.blockOffSec || 0) * 1000;
  const useBlock = blockOnMs > 0 && blockOffMs > 0;
  const sessionStart = Date.now() + leadInMs;   // cap clock starts here
  const sessionEnd = sessionStart + capMs;

  // Real cue replay: the plan carries the cueable items (validation mode has
  // already flagged noCue entries; those are excluded here so the renderer
  // only ever fires real cues). Each tick fires the round-robin item.
  const cueable = (plan.items || []).filter((it) => !it.noCue);
  let cueIdx = 0;

  win?.webContents.send('tmr-sleep-event', 'lead-in', { cueCount: 0 });

  const scheduleNext = (delayMs) => {
    if (!sleepState.running) return;
    sleepTimers.interval = setTimeout(cueTick, delayMs);
  };

  const cueTick = () => {
    if (!sleepState.running) return;
    const now = Date.now();
    if (now >= sessionEnd) { stopSleepService(); return; }
    if (useBlock && !sleepCtx.inBlock) {
      // inside an OFF block: check again when the block timer flips us back
      scheduleNext(Math.min(5000, blockOffMs));
      return;
    }
    sleepCtx.cueCount++;
    const item = cueable.length ? cueable[cueIdx % cueable.length] : null;
    cueIdx++;
    win?.webContents.send('tmr-sleep-event', 'play', {
      cueCount: sleepCtx.cueCount,
      itemIdx: item ? (plan.items || []).indexOf(item) : -1,
      text: item ? item.text : null,
      tuneId: item ? item.tuneId : null,
    });
    scheduleNext(intervalMs);
  };

  // block transition timer
  if (useBlock) {
    sleepTimers.block = setInterval(() => {
      if (!sleepState.running) { clearInterval(sleepTimers.block); return; }
      if (Date.now() >= sleepCtx.blockEnd) {
        sleepCtx.inBlock = !sleepCtx.inBlock;
        sleepCtx.blockEnd = Date.now() + (sleepCtx.inBlock ? blockOnMs : blockOffMs);
        win?.webContents.send('tmr-sleep-event', sleepCtx.inBlock ? 'block-on' : 'block-off', { cueCount: sleepCtx.cueCount });
      }
    }, 1000);
  }

  sleepTimers.interval = setTimeout(() => {
    if (!sleepState.running) return;
    if (useBlock) {
      sleepCtx.inBlock = true;
      sleepCtx.blockEnd = Date.now() + blockOnMs;
    }
    cueTick();
  }, leadInMs);
}

function stopSleepService() {
  sleepState.running = false;
  if (sleepTimers.interval) { clearTimeout(sleepTimers.interval); sleepTimers.interval = null; }
  if (sleepTimers.block) { clearInterval(sleepTimers.block); sleepTimers.block = null; }
  win?.webContents.send('tmr-sleep-event', 'stopped', { cueCount: sleepCtx.cueCount });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080, height: 760, minWidth: 640, minHeight: 520,
    backgroundColor: '#050506',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
  win.on('blur', () => win.setAlwaysOnTop(true, 'pop-up-menu'));
}

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register('CommandOrControl+Shift+S', () => win?.webContents.send('tmr-hotkey-play'));
  globalShortcut.register('CommandOrControl+Shift+A', () => win?.webContents.send('tmr-hotkey-auto'));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('tmr-native', async (_e, cmd, plan) => {
  if (cmd === 'startSleep') { startSleepService(plan || {}); return 'started'; }
  if (cmd === 'stopSleep') { stopSleepService(); return 'stopped'; }
  return null;
});

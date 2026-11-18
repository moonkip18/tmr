/* synapsis — TMR study desk. Web core shared by Windows (.exe).
   Design driven by the TMR literature:
   - each item gets a DETERMINISTIC tone (persisted per item, survives
     reorder/rename) so the memory↔cue association is valid overnight.
   - learn each item first (Rudoy 2009: ~7 pairings to criterion).
   - single noise (pink) plays on click, repeats every 5 min.
   - sleep cueing: silence lead-in, sparse gaps (≥5s to respect spindle
     refractory), bounded cueing time from the END of the lead-in, mic gate,
     10min on / 8min off blocks. Loud/early cues reverse the benefit.
   - everything on this machine is LOCAL. The "estimated alignment" readout
     is a SIMULATION from population sleep-cycle averages — not a measurement
     of your sleep. No microphone data, no audio, ever leaves this file. */
(() => {
  'use strict';

  const Tmr = {
    // ---- data ----
    items: [],           // {id,text,learned,tuneId}
    settings: { volume: 0.09, leadMin: 60, interval: 12, capMin: 40, blockOnMin: 10, blockOffMin: 8, micGate: true, validationMode: false, voice: 'tone' },
    currentIdx: -1,
    autoTimer: null,
    sleepState: { running: false, cueCount: 0 },
    nightLog: [],        // this session's cue events {t, tuneId, text}
    recallDone: false,

    // ---- noise: the single sleep sound ----
    noiseType: 'pink',
    activeNoise: null,
    noiseVol: 0.15,
    repeatTimer: null,

    // ---- audio ----
    ctx: null,
    ttsVoice: null,

    load() {
      const raw = localStorage.getItem('tmr-items');
      if (raw) { try { this.items = JSON.parse(raw) || []; } catch (_e) { this.items = []; } }
      const s = localStorage.getItem('tmr-settings');
      if (s) Object.assign(this.settings, JSON.parse(s));
      const log = localStorage.getItem('tmr-last-night');
      if (log) { try { this.lastNight = JSON.parse(log); } catch (_e) { this.lastNight = null; } }
    },
    save() { localStorage.setItem('tmr-items', JSON.stringify(this.items)); },
    saveSettings() { localStorage.setItem('tmr-settings', JSON.stringify(this.settings)); },

    // ---- deterministic cue palette, keyed by persisted tuneId ----
    cueFor(item) {
      const palette = [
        [440, 587], [349, 523], [262, 659], [330, 740], [392, 523],
        [294, 587], [466, 698], [262, 494], [523, 784], [349, 466],
      ];
      const tuneId = ((item.tuneId % palette.length) + palette.length) % palette.length;
      return { freqs: palette[tuneId], durMs: 420, tuneId };
    },

    async ensureCtx() {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx;
    },
    playTone(freqs, durMs, vol = 0.18) {
      return this.ensureCtx().then((ctx) => {
        const now = ctx.currentTime;
        freqs.forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          const t = now + i * 0.05;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(vol, t + 0.015);
          g.gain.linearRampToValueAtTime(0.0001, t + durMs/1000 - 0.02);
          o.connect(g).connect(ctx.destination);
          o.start(t); o.stop(t + durMs/1000);
        });
      });
    },

    // ---- cue tone for a study item ----
    playItem(item) {
      const cue = this.cueFor(item);
      this.playTone(cue.freqs, cue.durMs, this.settings.volume * 0.6);
    },
    playIdx(idx) {
      const it = this.items[idx];
      if (it) { this.currentIdx = idx; this.playItem(it); this.updateDesk(); return true; }
      return false;
    },

    // ---- noise generation (gen ~20s chunks, schedule next every 5 min) ----
    genNoise(seconds, type) {
      const sr = this.ctx ? this.ctx.sampleRate : 44100;
      const n = sr * seconds;
      const buf = new Float32Array(n);
      if (type === 'pink') {
        let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0;
        for (let i = 0; i < n; i++) {
          const white = (Math.random() * 2 - 1);
          b0 = 0.997 * b0 + 0.03 * white;
          b1 = 0.997 * b1 + 0.03 * b0;
          b2 = 0.997 * b2 + 0.03 * b1;
          b3 = 0.997 * b3 + 0.03 * b2;
          b4 = 0.997 * b4 + 0.03 * b3;
          b5 = 0.997 * b5 + 0.03 * b4;
          buf[i] = 0.9 * b5 - 0.5 * b4;
        }
      } else {
        for (let i = 0; i < n; i++) buf[i] = (Math.random() * 2 - 1) * 0.8;
      }
      return buf;
    },

    // ---- single noise: play, repeat every 5 min ----
    async startNoise() {
      const ctx = await this.ensureCtx();
      const buf = this.genNoise(20, this.noiseType);
      const ab = ctx.createBuffer(1, buf.length, ctx.sampleRate);
      ab.copyToChannel(buf, 0);
      const src = ctx.createBufferSource();
      src.buffer = ab;
      const gain = ctx.createGain();
      gain.gain.value = this.noiseVol;
      src.connect(gain).connect(ctx.destination);
      src.start();
      this.activeNoise = { src, gain };
      this.set('noise-status', `${this.noiseName()} playing · next in 5'`);
      this.$('noise-play').textContent = 'pause';
      this.$('noise-play').classList.add('playing');
      if (this.repeatTimer) clearTimeout(this.repeatTimer);
      this.repeatTimer = setTimeout(() => {
        if (this.activeNoise) this.scheduleNoiseRepeat();
      }, 300000); // 5 min
    },
    scheduleNoiseRepeat() {
      const ctx = this.ctx;
      if (!ctx) return;
      const buf = this.genNoise(20, this.noiseType);
      const ab = ctx.createBuffer(1, buf.length, ctx.sampleRate);
      ab.copyToChannel(buf, 0);
      const src = ctx.createBufferSource();
      src.buffer = ab;
      const gain = ctx.createGain();
      gain.gain.value = this.noiseVol;
      src.connect(gain).connect(ctx.destination);
      src.start();
      this.activeNoise = { src, gain };
      this.set('noise-status', `${this.noiseName()} playing · next in 5'`);
      if (this.repeatTimer) clearTimeout(this.repeatTimer);
      this.repeatTimer = setTimeout(() => {
        if (this.activeNoise) this.scheduleNoiseRepeat();
      }, 300000);
    },
    stopNoise() {
      if (this.activeNoise) {
        try { this.activeNoise.src.stop(); } catch(_e) {}        this.activeNoise = null;
      }
      if (this.repeatTimer) { clearTimeout(this.repeatTimer); this.repeatTimer = null; }
      this.set('noise-status', 'paused');
      this.$('noise-play').textContent = 'play';
      this.$('noise-play').classList.remove('playing');
    },
    toggleNoise() {
      if (this.repeatTimer || this.activeNoise) this.stopNoise();
      else this.startNoise();
    },
    noiseName() {
      const names = { white: 'White Noise', pink: 'Pink Noise', brown: 'Brown Noise' };
      return names[this.noiseType] || 'Pink Noise';
    },
    setNoiseVol(v) {
      this.noiseVol = v;
      if (this.activeNoise) this.activeNoise.gain.gain.value = v;
      this.set('noise-vol-val', Math.round(v * 100));
    },

    // ---- learn session ----
    learn(idx) {
      const it = this.items[idx];
      if (!it) return;
      const passes = 7;
      let n = 0;
      const step = () => {
        this.playItem(it);
        n++;
        this.set('desk-status', `pairing ${n}/${passes}`);
        if (n < passes) setTimeout(step, 2600);
        else { this.set('desk-status', `learned ✓`); it.learned = true; this.save(); this.updateDesk(); this.renderItems(); }
      };
      step();
    },

    // ---- study auto: cue every 5 min ----
    startAuto() {
      if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; this.set('desk-status','auto stopped'); this.updateDesk(); return; }
      if (this.items.length === 0) return this.set('desk-status', 'no items');
      let step = 0;
      this.set('desk-status', 'auto every 5′ · Ctrl+Shift+A to stop');
      this.autoTimer = setInterval(() => {
        const idx = step % this.items.length;
        this.playIdx(idx);
        step++;
        this.set('desk-status', `auto · cue ${step} every 5'`);
      }, 300000);
    },

    // ---- sleep plan (native bridge) ----
    // The plan carries the CUEABLE items (validation mode marks ~50% noCue
    // and the main process simply never fires those) — the after-sleep
    // comparison needs uncued controls from the SAME list.
    sleepPlan() {
      const items = this.items.map((it) => {
        const cue = this.cueFor(it);
        const item = { text: it.text, freqs: cue.freqs, tuneId: cue.tuneId };
        if (this.settings.validationMode && Math.random() < 0.5) item.noCue = true;
        return item;
      });
      return {
        items,
        leadInSec: this.settings.leadMin * 60,
        intervalSec: this.settings.interval,
        capSec: this.settings.capMin * 60,
        volume: this.settings.volume,
        voice: this.settings.voice === 'tone+text' ? 'tone+text' : 'tone',
        micGate: this.settings.micGate,
        blockOnSec: this.settings.blockOnMin * 60,
        blockOffSec: this.settings.blockOffMin * 60,
        validationMode: this.settings.validationMode,
        noiseType: this.noiseType,
        noiseVolume: this.noiseVol,
      };
    },
    startSleep() {
      this.ensureCtx().then(() => {
        this.sleepState = { running: true, cueCount: 0 };
        this.nightLog = [];
        this.recallDone = false;
        this.set('sleep-status', 'lead-in · silence until deep sleep begins');
        this.renderEstimation();
        if (window.TmrNative && typeof window.TmrNative.startSleep === 'function') {
          window.TmrNative.startSleep(this.sleepPlan());
        }
      });
    },
    scheduleNoiseBurst() {
      const ctx = this.ctx;
      if (!ctx) return;
      const buf = this.genNoise(20, this.noiseType);
      const ab = ctx.createBuffer(1, buf.length, ctx.sampleRate);
      ab.copyToChannel(buf, 0);
      const src = ctx.createBufferSource();
      src.buffer = ab;
      const gain = ctx.createGain();
      gain.gain.value = this.noiseVol;
      src.connect(gain).connect(ctx.destination);
      src.start();
      this.activeNoise = { src, gain };
      setTimeout(() => { try { this.activeNoise.src.stop(); } catch(_e) {} }, 20000);
    },
    stopSleep() {
      this.sleepState.running = false;
      if (this.activeNoise) { try { this.activeNoise.src.stop(); } catch(_e) {} this.activeNoise = null; }
      this.set('sleep-status', 'stopped');
      if (window.TmrNative && typeof window.TmrNative.stopSleep === 'function') window.TmrNative.stopSleep();
      this.finishNight(false);
    },
    onSleepEvent(msg, payload) {
      this.sleepState = Object.assign(this.sleepState, payload || {});
      if (msg === 'lead-in') this.set('sleep-status', 'lead-in · waiting for deep sleep');
      else if (msg === 'play') {
        // REAL cue replay: the main process tells us which plan item to fire;
        // we play its persisted tone (and a soft noise bed under it).
        const idx = (payload && typeof payload.itemIdx === 'number') ? payload.itemIdx : -1;
        const planItem = this.lastPlanItems ? this.lastPlanItems[idx] : null;
        if (planItem) {
          this.playTone(planItem.freqs, 420, this.settings.volume * 0.6);
          if (this.settings.voice === 'tone+text' && 'speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(planItem.text);
            u.volume = Math.min(1, this.settings.volume * 4); u.rate = 0.9;
            speechSynthesis.speak(u);
          }
          this.nightLog.push({ t: Date.now(), tuneId: planItem.tuneId, text: planItem.text });
        }
        this.scheduleNoiseBurst();
        this.set('sleep-status', `cueing · ${this.sleepState.cueCount} cues played`);
      }
      else if (msg === 'block-on') this.set('sleep-status', 'cue block ON');
      else if (msg === 'block-off') this.set('sleep-status', 'cue block OFF (resting)');
      else if (msg === 'stopped') { this.set('sleep-status', 'stopped'); this.finishNight(false); }
      else this.set('sleep-status', msg || 'idle');
    },
    // ---- night wrap-up: persist a local log + enable the morning test ----
    finishNight(auto) {
      if (this.recallDone && !this.nightLog.length) return;
      const summary = {
        endedAt: Date.now(),
        cueCount: this.nightLog.length,
        cued: this.nightLog.slice(-12).map((e) => ({ tuneId: e.tuneId, text: e.text })),
        estimated: this.estimateAlignment(),
      };
      this.lastNight = summary;
      localStorage.setItem('tmr-last-night', JSON.stringify(summary));
      this.renderLastNight();
      this.recallDone = false;
      this.renderRecall();
      this.set('sleep-status', auto ? 'night complete · try the morning recall' : 'stopped · morning recall ready');
    },

    // ---- SIMULATED alignment estimate (not a measurement) ----
    // Deterministic model from plan settings + population sleep-cycle
    // averages (deep sleep dominates the first two ~90-min cycles; the
    // 60-min lead-in usually lands cues inside cycle 1-2). No sensor data.
    estimateAlignment() {
      const s = this.settings;
      const leadMin = s.leadMin;
      const cycleMin = 90;
      const cyclePos = ((leadMin % cycleMin) + cycleMin) % cycleMin;
      // share of the cueing window that falls in the deep-sleep-rich part
      // of the night (first two cycles), a fixed population estimate
      const inFirst2 = leadMin + s.capMin <= 2 * cycleMin ? 1 : Math.max(0, (2 * cycleMin - leadMin) / s.capMin);
      const blockDuty = (s.blockOnMin + s.blockOffMin) > 0 ? s.blockOnMin / (s.blockOnMin + s.blockOffMin) : 1;
      const expectedCues = Math.floor((s.capMin * 60) / Math.max(5, s.interval)) * blockDuty;
      const deepShare = Math.round(0.55 * inFirst2 * 100);
      const lowVol = s.volume <= 0.12;
      return {
        expectedCues,
        deepSharePct: deepShare,
        spindleSafe: s.interval >= 5,
        volumeOk: lowVol,
        cyclePosMin: cyclePos,
        disclaimer: 'simulation from population averages — not a measurement of your sleep',
      };
    },
    renderEstimation() {
      const est = this.estimateAlignment();
      const el = this.$('est-body');
      if (!el) return;
      el.innerHTML = '';
      const rows = [
        [`expected cues (capped)`, `~${est.expectedCues}`],
        [`deep-sleep window overlap`, `~${est.deepSharePct}% (est.)`],
        [`spindle refractory respected`, est.spindleSafe ? 'yes (≥5s gaps)' : 'NO — raise interval'],
        [`volume in safe range`, est.volumeOk ? 'yes (low)' : 'borderline — keep ≤ 12'],
      ];
      rows.forEach(([k, v]) => {
        const r = document.createElement('div');
        r.className = 'est-row';
        const a = document.createElement('span'); a.textContent = k;
        const b = document.createElement('span'); b.textContent = v;
        r.append(a, b); el.append(r);
      });
      const d = document.createElement('div');
      d.className = 'status-line est-disclaimer';
      d.textContent = est.disclaimer;
      el.append(d);
    },
    renderLastNight() {
      const el = this.$('last-night');
      if (!el) return;
      if (!this.lastNight) { el.textContent = 'no completed session yet'; return; }
      const n = this.lastNight.cueCount || 0;
      el.textContent = `${n} cues · ended ${new Date(this.lastNight.endedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · est. deep overlap ~${this.lastNight.estimated ? this.lastNight.estimated.deepSharePct : '?'}%`;
    },

    // ---- morning recall test ----
    // Cued vs uncued (validation mode) items, cue played on demand;
    // answers stay in localStorage, keyed by date. Local only.
    renderRecall() {
      const el = this.$('recall-list');
      if (!el) return;
      if (!this.lastNight || this.recallDone) { el.innerHTML = ''; this.set('recall-status', this.recallDone ? 'recall saved — good morning' : 'run an overnight session first'); return; }
      el.innerHTML = '';
      const pool = (this.lastNight.cued || []).filter(Boolean);
      if (!pool.length) { this.set('recall-status', 'no cues were logged'); return; }
      this.set('recall-status', 'play each cue — do you remember the item?');
      pool.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'recall-row';
        const btn = document.createElement('button');
        btn.className = 'kbd-chip'; btn.textContent = `▶ cue ${c.tuneId + 1}`;
        btn.addEventListener('click', () => this.playTone(this.cueFor({ tuneId: c.tuneId }).freqs, 420, this.settings.volume * 0.6));
        const txt = document.createElement('span');
        txt.className = 'recall-text'; txt.textContent = c.text || `(tune ${c.tuneId + 1})`;
        const yes = document.createElement('button'); yes.className = 'kbd-chip'; yes.textContent = 'remember';
        const no = document.createElement('button'); no.className = 'kbd-chip'; no.textContent = 'gone';
        const key = `tmr-recall-${new Date().toISOString().slice(0, 10)}`;
        const store = JSON.parse(localStorage.getItem(key) || '{}');
        yes.addEventListener('click', () => { store[c.tuneId + '|' + c.text] = true; localStorage.setItem(key, JSON.stringify(store)); row.classList.add('done'); });
        no.addEventListener('click', () => { store[c.tuneId + '|' + c.text] = false; localStorage.setItem(key, JSON.stringify(store)); row.classList.add('done'); });
        row.append(btn, txt, yes, no);
        el.append(row);
      });
      const save = document.createElement('button');
      save.className = 'kbd-chip'; save.textContent = 'save recall';
      save.addEventListener('click', () => { this.recallDone = true; this.renderRecall(); });
      el.append(save);
    },

    // ---- DOM ----
    init() {
      this.load();
      this.lastPlanItems = null;
      if (window.TmrNative && typeof window.TmrNative.onEvent === 'function') {
        window.TmrNative.onEvent((msg, payload) => this.onSleepEvent(msg, payload));
      }
      if ('speechSynthesis' in window) {
        const onV = () => { if (speechSynthesis.getVoices().length) this.ttsVoice = speechSynthesis.getVoices()[0].name; };
        speechSynthesis.onvoiceschanged = onV; onV();
      }
      this.onClick('noise-play', () => this.toggleNoise());
      this.on('noise-vol', 'input', () => this.setNoiseVol(this.num('noise-vol') / 100));
      this.onClick('add-btn', () => this.addCurrent());
      this.on('item-text', 'keydown', (e) => { if (e.key === 'Enter') this.addCurrent(); });
      this.renderItems();
      ['sleep-vol','sleep-lead','sleep-int','sleep-cap','sleep-block-on','sleep-block-off'].forEach(k =>
        this.on(k, 'input', () => { this.saveSettingsFromForm(); this.renderEstimation(); }));
      this.on('sleep-mic', 'change', () => this.saveSettingsFromForm());
      this.on('validation-mode', 'change', () => this.saveSettingsFromForm());
      this.on('voice-mode', 'change', (v) => { this.settings.voice = v; this.saveSettings(); });
      this.onClick('sleep-start', () => this.startSleep());
      this.onClick('sleep-stop', () => this.stopSleep());
      this.onClick('clear-data', () => { if (confirm('clear all items?')) { this.reset(); } this.renderItems(); });
      this.onClick('gear-btn', () => {
        const s = this.$('settings');
        if (s) s.style.display = (s.style.display === 'none') ? '' : 'none';
      });
      // restore slider positions from loaded settings
      this.$('sleep-lead').value = this.settings.leadMin;
      this.$('sleep-int').value = this.settings.interval;
      this.$('sleep-cap').value = this.settings.capMin;
      this.$('sleep-block-on').value = this.settings.blockOnMin;
      this.$('sleep-block-off').value = this.settings.blockOffMin;
      this.$('sleep-vol').value = Math.round(((this.settings.volume - 0.04) / 0.12) * 100);
      this.set('sleep-vol-val', this.$('sleep-vol').value);
      this.bindHotkeys();
      this.updateDesk();
      this.updateNoiseBtn();
      this.renderEstimation();
      this.renderLastNight();
      this.renderRecall();
      this.updateNoiseBtn();
    },
    bindHotkeys() {
      document.addEventListener('tmr-hotkey-play', () => {
        if (this.currentIdx >= 0) this.playIdx(this.currentIdx);
        else if (this.items.length) this.playIdx(0);
      });
      document.addEventListener('tmr-hotkey-auto', () => this.startAuto());
    },
    addCurrent() {
      const text = (this.$('item-text').value || '').trim();
      if (!text) return this.set('desk-status', 'type an item first');
      // tuneId: lowest unused slot → stable per item, persisted forever
      const used = new Set(this.items.map((i) => i.tuneId));
      let tuneId = 0; while (used.has(tuneId)) tuneId++;
      this.items.push({ id: Date.now() + Math.random().toString(16).slice(2, 6), text, learned: false, tuneId });
      this.currentIdx = this.items.length - 1;
      this.save();
      this.$('item-text').value = '';
      this.renderItems();
      this.updateDesk();
      this.set('desk-status', 'added · press learn to pair a cue');
    },
    deleteItem(idx) {
      this.items.splice(idx, 1);
      if (this.currentIdx >= this.items.length) this.currentIdx = this.items.length - 1;
      this.save();
      this.renderItems();
      this.updateDesk();
    },
    selectItem(idx) { this.currentIdx = idx; this.updateDesk(); this.renderItems(); },
    renderItems() {
      const el = this.$('item-list');
      if (!el) return;
      el.innerHTML = '';
      this.items.forEach((it, idx) => {
        const row = document.createElement('div');
        row.className = 'item-row' + (idx === this.currentIdx ? ' current' : '');
        const tune = document.createElement('button');
        tune.className = 'kbd-chip tune-chip'; tune.textContent = `♪ ${this.cueFor(it).tuneId + 1}`;
        tune.title = 'play this item cue'; tune.addEventListener('click', () => this.playItem(it));
        const txt = document.createElement('span');
        txt.className = 'item-text'; txt.textContent = it.text + (it.learned ? ' ✓' : '');
        txt.addEventListener('click', () => this.selectItem(idx));
        const del = document.createElement('button');
        del.className = 'item-del'; del.textContent = '×'; del.title = 'delete item';
        del.addEventListener('click', () => this.deleteItem(idx));
        row.append(tune, txt, del);
        el.append(row);
      });
      const cnt = this.$('item-count');
      if (cnt) cnt.textContent = `${this.items.length} ${this.items.length === 1 ? 'item' : 'items'} · cues stay with their item`;
    },
    saveSettingsFromForm() {
      this.settings.leadMin = this.num('sleep-lead');
      this.settings.interval = this.num('sleep-int');
      this.settings.capMin = this.num('sleep-cap');
      this.settings.blockOnMin = this.num('sleep-block-on');
      this.settings.blockOffMin = this.num('sleep-block-off');
      this.settings.volume = (this.num('sleep-vol') / 100) * 0.12 + 0.04;
      this.set('sleep-vol-val', this.num('sleep-vol'));
      this.settings.micGate = !!this.$('sleep-mic').checked;
      this.settings.validationMode = !!this.$('validation-mode').checked;
      this.saveSettings();
    },
    updateDesk() {
      const it = this.items[this.currentIdx];
      const txt = this.$('item-text');
      if (it) txt.value = it.text; else txt.value = '';
      const btn = this.$('learn-btn');
      if (btn) btn.textContent = this.currentIdx >= 0 ? 'relearn (7×)' : 'learn (7×)';
    },
    updateNoiseBtn() {
      const playing = !!(this.repeatTimer || this.activeNoise);
      const btn = this.$('noise-play');
      if (btn) { btn.textContent = playing ? 'pause' : 'play'; btn.classList.toggle('playing', playing); }
    },
    reset() { this.items = []; this.currentIdx = -1; this.save(); this.renderItems(); this.updateDesk(); },
    $(id) { return document.getElementById(id); },
    on(id, ev, fn) { const el = this.$(id); if (el) el.addEventListener(ev, fn); },
    onClick(id, fn) { const el = this.$(id); if (el) el.addEventListener('click', fn); },
    set(id, html) { const el = this.$(id); if (el) el.textContent = html; },
    num(id) { return parseFloat(this.$(id).value) || 0; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Tmr.init());
  else Tmr.init();
  window.Tmr = Tmr;
})();

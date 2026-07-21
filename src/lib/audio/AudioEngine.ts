// Synthetic Web Audio engine for JARVIS UI sounds.
// All sounds are generated procedurally — no audio assets required.

type Settings = {
  master: number; // 0..1
  hum: boolean;
  ui: boolean;
};

const STORAGE_KEY = "jarvis.audio";

function loadSettings(): Settings {
  if (typeof window === "undefined") return { master: 0.55, hum: true, ui: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { master: 0.55, hum: true, ui: true };
    const p = JSON.parse(raw);
    return {
      master: typeof p.master === "number" ? p.master : 0.55,
      hum: p.hum !== false,
      ui: p.ui !== false,
    };
  } catch {
    return { master: 0.55, hum: true, ui: true };
  }
}

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private humNodes: { stop: () => void } | null = null;
  settings: Settings = loadSettings();
  private listeners = new Set<(s: Settings) => void>();
  // iOS Safari & Chrome autoplay policy: AudioContext can only be created
  // (without warnings) inside a user gesture. Stay silent until unlock().
  private unlocked = false;

  /** Call from a click / keydown handler to permit audio playback. */
  unlock() {
    this.unlocked = true;
    // create + resume the context now that we're inside a gesture
    this.ensure();
  }

  isUnlocked() {
    return this.unlocked;
  }

  subscribe(fn: (s: Settings) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      } catch {
        // ignore (private mode / disabled storage)
      }
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.settings.master, this.ctx.currentTime, 0.05);
    }
    if (!this.settings.hum) this.stopHum();
    this.listeners.forEach((l) => l(this.settings));
  }

  /** Lazily create context inside a user gesture. */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    // Block any background audio (boot sequence, hum, beeps) until the
    // user has interacted at least once. Prevents iOS/Safari warnings.
    if (!this.unlocked) return null;
    if (!this.ctx) {
      const Ctx =
        (window.AudioContext as typeof AudioContext) ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.master;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Expose context for shared analyser nodes (mic hook). */
  getContext(): AudioContext | null {
    return this.ensure();
  }

  /** Noise buffer generator (cached). */
  private noiseBuf: AudioBuffer | null = null;
  private noise(): AudioBuffer {
    const ctx = this.ensure()!;
    if (this.noiseBuf) return this.noiseBuf;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  private envelope(g: GainNode, when: number, peak: number, attack: number, release: number) {
    g.gain.cancelScheduledValues(when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + release);
  }

  playClick() {
    if (!this.settings.ui) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 6;
    const g = ctx.createGain();
    src.connect(bp).connect(g).connect(this.master);
    const t = ctx.currentTime;
    this.envelope(g, t, 0.4, 0.002, 0.08);
    src.start(t);
    src.stop(t + 0.15);
  }

  playBeep(freq = 1320, dur = 0.12, peak = 0.25) {
    if (!this.settings.ui) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    osc.connect(g).connect(this.master);
    const t = ctx.currentTime;
    this.envelope(g, t, peak, 0.005, dur);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  playAccessGranted() {
    this.playBeep(880, 0.1, 0.25);
    setTimeout(() => this.playBeep(1320, 0.14, 0.28), 110);
  }

  playAccessDenied() {
    if (!this.settings.ui) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 220;
      const g = ctx.createGain();
      osc.connect(g).connect(this.master);
      const at = t + i * 0.13;
      this.envelope(g, at, 0.22, 0.003, 0.09);
      osc.start(at);
      osc.stop(at + 0.15);
    }
  }

  playEngage() {
    if (!this.settings.ui) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    // Rising oscillator
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(4000, t + 1.2);
    const g = ctx.createGain();
    osc.connect(lp).connect(g).connect(this.master);
    this.envelope(g, t, 0.35, 0.05, 1.2);
    osc.start(t);
    osc.stop(t + 1.4);
    // Noise sweep
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(200, t);
    hp.frequency.exponentialRampToValueAtTime(3000, t + 1.2);
    const ng = ctx.createGain();
    src.connect(hp).connect(ng).connect(this.master);
    this.envelope(ng, t, 0.18, 0.05, 1.1);
    src.start(t);
    src.stop(t + 1.4);
  }

  playBoot() {
    if (!this.settings.ui) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(40, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 2.2);
    const g = ctx.createGain();
    osc.connect(g).connect(this.master);
    this.envelope(g, t, 0.22, 0.2, 2.0);
    osc.start(t);
    osc.stop(t + 2.4);
  }

  playShutdown() {
    if (!this.settings.ui) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 2.4);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 2.4);
    const g = ctx.createGain();
    osc.connect(lp).connect(g).connect(this.master);
    this.envelope(g, t, 0.3, 0.02, 2.4);
    osc.start(t);
    osc.stop(t + 2.6);
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = "lowpass";
    hp.frequency.value = 600;
    const ng = ctx.createGain();
    src.connect(hp).connect(ng).connect(this.master);
    this.envelope(ng, t, 0.12, 0.05, 2.0);
    src.start(t);
    src.stop(t + 2.4);
  }

  startHum() {
    if (!this.settings.hum) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (this.humNodes) return;
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = 60;
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = 120;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    // LFO on gain for subtle breathing
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.25;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.04;
    lfo.connect(lfoGain).connect(g.gain);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(this.master);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 1.5);
    o1.start();
    o2.start();
    lfo.start();
    this.humNodes = {
      stop: () => {
        const tt = ctx.currentTime;
        g.gain.cancelScheduledValues(tt);
        g.gain.setValueAtTime(g.gain.value, tt);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.6);
        setTimeout(() => {
          try {
            o1.stop();
            o2.stop();
            lfo.stop();
          } catch {}
        }, 700);
      },
    };
  }

  stopHum() {
    if (this.humNodes) {
      this.humNodes.stop();
      this.humNodes = null;
    }
  }
}

export const audio = new Engine();

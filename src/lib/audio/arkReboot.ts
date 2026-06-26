// Web Audio cues for Protocol: Ark Reboot.
import { audio } from "./AudioEngine";

export function playRebootIntro() {
  const ctx = audio.getContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  const dest = ctx.destination;

  // Deep bass sweep — energy ramping up.
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(40, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 1.2);

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.exponentialRampToValueAtTime(1800, t + 1.2);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.45, t + 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);

  osc.connect(lp).connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 1.5);

  // Noise pad on top for thickness.
  const buf = ctx.createBuffer(1, ctx.sampleRate * 1.4, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(120, t);
  hp.frequency.exponentialRampToValueAtTime(900, t + 1.2);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.18, t + 0.25);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  src.connect(hp).connect(ng).connect(dest);
  src.start(t);
  src.stop(t + 1.5);
}

export function playClickBeep() {
  const ctx = audio.getContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = 1180;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}
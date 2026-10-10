// Alert tones: a tone is f1 (and optionally f2, played alternately) for onMs each, then offMs of silence,
// repeated. They can be sent onto channels (published as audio) or played here as a local alert.
export const PRESET_TONES = [
  { id: "alert-a", name: "Alert A (pulsed)", f1: 1000, f2: 0, onMs: 400, offMs: 200, repeat: 3 },
  { id: "alert-b", name: "Alert B (high-low)", f1: 960, f2: 853, onMs: 300, offMs: 0, repeat: 4 },
  { id: "warble", name: "Warble", f1: 800, f2: 1000, onMs: 100, offMs: 0, repeat: 10 },
  { id: "long", name: "Long tone", f1: 1000, f2: 0, onMs: 2000, offMs: 0, repeat: 1 },
  { id: "two-tone", name: "Two-tone page", f1: 853, f2: 960, onMs: 1000, offMs: 0, repeat: 1 },
  { id: "chirp", name: "Short chirp", f1: 1400, f2: 0, onMs: 120, offMs: 80, repeat: 2 },
];

export const toneMs = (t) => ((t.f2 > 0 ? 2 : 1) * t.onMs + (t.offMs || 0)) * Math.max(1, t.repeat || 1);

function schedule(ctx, dest, t, startAt) {
  const gain = ctx.createGain();
  gain.gain.value = 0.35;
  gain.connect(dest);
  let at = startAt;
  const beep = (f, ms) => {
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.frequency.value = f; osc.type = "sine";
    // Short fade in and out so the start and end don't click.
    env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(1, at + 0.01);
    env.gain.setValueAtTime(1, at + ms / 1000 - 0.01); env.gain.linearRampToValueAtTime(0, at + ms / 1000);
    osc.connect(env); env.connect(gain);
    osc.start(at); osc.stop(at + ms / 1000 + 0.02);
    at += ms / 1000;
  };
  for (let i = 0; i < Math.max(1, t.repeat || 1); i++) {
    beep(t.f1, t.onMs);
    if (t.f2 > 0) beep(t.f2, t.onMs);
    if (t.offMs > 0) at += t.offMs / 1000;
  }
}

// Same shape as a recorded message: { track, start(), done, close() }, ready to publish on a channel.
export function playableTone(t) {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  let resolve; const done = new Promise((r) => { resolve = r; });
  return {
    track: dest.stream.getAudioTracks()[0],
    start: () => { schedule(ctx, dest, t, ctx.currentTime + 0.05); setTimeout(resolve, toneMs(t) + 250); },
    done,
    close: () => ctx.close(),
  };
}

// Plays through this computer's speakers (alerts and previews).
export function playLocal(t) {
  try {
    const ctx = new AudioContext();
    schedule(ctx, ctx.destination, t, ctx.currentTime + 0.02);
    setTimeout(() => ctx.close(), toneMs(t) + 400);
  } catch { /* audio unavailable */ }
}

// The little packet chirp of an APRS message: a burst of 1200/2200 Hz data tones.
export function playAprs() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain(); gain.gain.value = 0.25; gain.connect(ctx.destination);
    let at = ctx.currentTime + 0.02;
    const seq = [1200, 2200, 1200, 1200, 2200, 2200, 1200, 2200, 1200, 2200, 2200, 1200, 1200, 2200, 1200, 2200];
    for (const f of seq) {
      const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = f;
      const env = ctx.createGain(); env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(1, at + 0.003); env.gain.setValueAtTime(1, at + 0.022); env.gain.linearRampToValueAtTime(0, at + 0.026);
      osc.connect(env); env.connect(gain); osc.start(at); osc.stop(at + 0.03);
      at += 0.026;
    }
    setTimeout(() => ctx.close(), 800);
  } catch { /* audio unavailable */ }
}

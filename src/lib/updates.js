import { useEffect, useState } from "react";

const REPO = "WSIQ838/repeater-nation-Comms";
const EVERY_KEY = "dispatch-update-every", SKIP_KEY = "dispatch-update-skip", LAST_KEY = "dispatch-update-last";
const HOUR = 3600 * 1000;
// How often the console looks for a new version on its own. Every choice except "never"
// also checks once when the console opens.
export const UPDATE_EVERY = [
  { id: "never", label: "Never (only when I press Check for updates)" },
  { id: "startup", label: "When the console opens" },
  { id: "1h", label: "Every hour", ms: HOUR },
  { id: "6h", label: "Every 6 hours", ms: 6 * HOUR },
  { id: "24h", label: "Once a day", ms: 24 * HOUR },
  { id: "168h", label: "Once a week", ms: 168 * HOUR },
];
const DEFAULT_EVERY = "6h";

const read = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
// Looks at the latest published dispatch release and says whether it is newer than this app.
export async function checkForUpdate() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`Could not check for updates (${res.status}).`);
  const r = await res.json();
  const latest = String(r.tag_name || "").replace(/^dispatch-v/, "");
  const installer = (r.assets || []).find((a) => /x64-setup\.exe$/.test(a.name));
  return { current: __APP_VERSION__, latest, available: !!latest && newer(latest, __APP_VERSION__), page: r.html_url, download: installer?.browser_download_url || r.html_url };
}
export async function openLink(url) {
  if (window.__TAURI_INTERNALS__) { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); }
  else window.open(url, "_blank", "noopener");
}

export const loadUpdateEvery = () => { const v = read(EVERY_KEY); return UPDATE_EVERY.some((x) => x.id === v) ? v : DEFAULT_EVERY; };
export const skippedVersion = () => read(SKIP_KEY);
export const skipVersion = (v) => write(SKIP_KEY, v);

// One shared result, so the header button, Settings and the pop-up always agree.
// seq counts finished checks, so the pop-up can tell a new finding from one already dismissed.
let state = { update: null, error: "", checking: false, seq: 0, auto: false };
const subs = new Set();
const emit = () => { for (const f of subs) f({ ...state }); };
const set = (next) => { state = { ...state, ...next }; emit(); };
export const saveUpdateEvery = (v) => { write(EVERY_KEY, v); emit(); };

let running = null;
export function runUpdateCheck({ auto = false } = {}) {
  if (running) return running;
  set({ checking: true, error: "" });
  // Counted from when a check starts, so a failing check (offline) isn't retried every minute.
  write(LAST_KEY, String(Date.now()));
  running = checkForUpdate()
    .then((update) => set({ update, checking: false, seq: state.seq + 1, auto }))
    .catch((e) => set({ error: e?.message || "Could not check for updates.", checking: false, seq: state.seq + 1, auto }))
    .finally(() => { running = null; });
  return running;
}

export function useUpdateState() {
  const [s, setS] = useState(() => ({ ...state }));
  useEffect(() => { subs.add(setS); setS({ ...state }); return () => { subs.delete(setS); }; }, []);
  return s;
}

// Runs the automatic checks: once when the console opens (unless set to never), then on the
// chosen schedule. The time of the last check is kept, so restarting the console doesn't
// reset an hourly or daily schedule.
export function useAutoUpdateCheck() {
  const [every, setEvery] = useState(loadUpdateEvery);
  useEffect(() => { const f = () => setEvery(loadUpdateEvery()); subs.add(f); return () => { subs.delete(f); }; }, []);
  useEffect(() => { if (loadUpdateEvery() !== "never") runUpdateCheck({ auto: true }); }, []);
  useEffect(() => {
    const ms = UPDATE_EVERY.find((x) => x.id === every)?.ms;
    if (!ms) return undefined;
    const tick = () => { if (Date.now() - (Number(read(LAST_KEY)) || 0) >= ms) runUpdateCheck({ auto: true }); };
    const t = setInterval(tick, 60 * 1000);
    return () => clearInterval(t);
  }, [every]);
}

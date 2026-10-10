import { useEffect, useState } from "react";
import { dispatchRoster } from "./auth";

// Everyone on the radio, polled once for the whole console (Online panel, status board, map)
// while any of them is showing. Each unit also gets `since`: when its status last changed,
// as far as this computer has seen. It is kept across restarts, so a unit that has been
// "At Scene" since before the console opened still shows the right time when the status
// was seen changing earlier.
const POLL_MS = 5000;
const SINCE_KEY = "dispatch-status-since";
// The statuses a radio can set, in board order. Anything else goes under "Other".
export const STATUSES = ["Available", "En Route", "At Scene", "Busy", "Returning", "Out of Service"];
export const statusClass = (s) => "st-" + String(s || "none").toLowerCase().replace(/[^a-z]+/g, "-");

const loadSince = () => { try { return JSON.parse(localStorage.getItem(SINCE_KEY) || "{}") || {}; } catch { return {}; } };
const saveSince = (m) => { try { localStorage.setItem(SINCE_KEY, JSON.stringify(m)); } catch { /* storage unavailable */ } };

let state = { users: [], error: "", loaded: false };
const subs = new Set();
const emit = () => { for (const f of subs) f(state); };
let timer = null;

async function poll() {
  try {
    const r = await dispatchRoster();
    const since = loadSince(), now = Date.now(), seen = {};
    const users = (r?.users || []).map((u) => {
      const key = u.userId || u.identity, status = u.status || "";
      const prev = since[key];
      const at = prev && prev.status === status ? prev.at : now;
      seen[key] = { status, at };
      return { ...u, since: at };
    });
    // Keep units that dropped off for a day, so a radio that reconnects keeps its timer.
    for (const [k, v] of Object.entries(since)) if (!seen[k] && now - v.at < 24 * 3600 * 1000) seen[k] = v;
    saveSince(seen);
    state = { users, error: "", loaded: true };
  } catch (e) { state = { ...state, error: e?.message || "Could not load the roster.", loaded: true }; }
  emit();
}

export function useRoster() {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS); setS(state);
    if (!timer) { poll(); timer = setInterval(poll, POLL_MS); }
    return () => { subs.delete(setS); if (!subs.size) { clearInterval(timer); timer = null; } };
  }, []);
  return s;
}

// "4m", "1h 12m": how long a unit has had its status.
export function elapsed(at, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - at) / 60000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

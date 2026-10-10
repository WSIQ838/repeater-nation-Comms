import { PRESET_TONES } from "./tones";

// Presets set both the folder's header colour and its tile colour.
export const PALETTE = [
  { name: "Navy", accent: "#f08a1c", tile: "#14416b" },
  { name: "Red", accent: "#d23b3b", tile: "#b3262e" },
  { name: "Green", accent: "#34b24f", tile: "#2e9e47" },
  { name: "Blue", accent: "#2a78e0", tile: "#1f6bd1" },
  { name: "Purple", accent: "#8d4cd6", tile: "#6d36a8" },
  { name: "Teal", accent: "#1fb0b5", tile: "#1b8a8f" },
  { name: "Gold", accent: "#e0b020", tile: "#8a6a10" },
  { name: "Grey", accent: "#9aa7b5", tile: "#4a5666" },
];

const LAYOUT_KEY = "dispatch-layout", TONES_KEY = "dispatch-tones";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export const emptyLayout = () => ({ mode: "zones", folders: [], zoneStyle: {}, channels: {}, alertsOn: true });
export const loadLayout = () => ({ ...emptyLayout(), ...(read(LAYOUT_KEY) || {}) });
export const saveLayout = (l) => write(LAYOUT_KEY, l);
export const loadTones = () => { const t = read(TONES_KEY); return Array.isArray(t) && t.length ? t : PRESET_TONES; };
export const saveTones = (t) => write(TONES_KEY, t);
export const resetLayoutStorage = () => { try { localStorage.removeItem(LAYOUT_KEY); localStorage.removeItem(TONES_KEY); } catch { /* ignore */ } };
export const exportAll = () => JSON.stringify({ layout: loadLayout(), tones: loadTones() }, null, 2);
export function importAll(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== "object" || (!d.layout && !d.tones)) throw new Error("That isn't a dispatch layout export.");
  if (d.layout) saveLayout({ ...emptyLayout(), ...d.layout });
  if (Array.isArray(d.tones)) saveTones(d.tones);
}
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

// In "zones" mode every zone is a folder with one automatic tab, so new zones appear by themselves.
export function zoneFolders(zones, layout) {
  return zones.map((z, i) => {
    const st = layout.zoneStyle?.[z.id] || {};
    const p = PALETTE[i % 6];
    return { id: "zone-" + z.id, name: z.name, accent: st.accent || p.accent, tile: st.tile || p.tile, tabs: [{ id: "all", name: z.name, type: "zone", zoneId: z.id }] };
  });
}

// Which channels a tab shows. "channels" is a hand-picked list; the others fill themselves in.
export function resolveTab(tab, channels, states) {
  const st = (c) => states[c.id] || {};
  switch (tab.type) {
    case "channels": return (tab.channelIds || []).map((id) => channels.find((c) => c.id === id)).filter(Boolean);
    case "zone": return channels.filter((c) => c.zoneId === tab.zoneId);
    case "on": return channels.filter((c) => st(c).on);
    case "talking": return channels.filter((c) => st(c).on && ((st(c).onAir || []).length || st(c).keyed));
    case "recent": { const since = Date.now() - (tab.minutes || 5) * 60000; return channels.filter((c) => (st(c).lastAt || 0) >= since); }
    case "all": return channels;
    default: return [];
  }
}
export const TAB_TYPES = [
  { id: "channels", label: "Channels I pick" },
  { id: "zone", label: "A whole zone (automatic)" },
  { id: "on", label: "Channels I'm listening to (dynamic)" },
  { id: "talking", label: "Channels with traffic right now (dynamic)" },
  { id: "recent", label: "Channels heard recently (dynamic)" },
  { id: "all", label: "Every channel" },
];

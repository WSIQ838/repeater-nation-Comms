import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { listZonesAndChannels, dispatchLocations, dispatchMove } from "../lib/auth";
import { elapsed, statusClass, useRoster } from "../lib/roster";

const POLL_MS = 5000;
const STYLE = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};
// Trails: the last few places each radio reported, kept on this computer while the map is open.
const TRAIL_KEY = "dispatch-map-trails";
const TRAIL_POINTS = 40;
const TRAIL_MIN_M = 15; // ignore GPS jitter smaller than this
const metres = (a, b) => {
  const r = 6371000, rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso || "")) / 1000); return Number.isFinite(s) ? (s < 60 ? `${Math.max(0, s)}s ago` : `${Math.floor(s / 60)}m ago`) : "time unknown"; };

// The pop-up for one radio. Built once per marker and updated in place, so it stays open
// (and its Move list keeps its selection) while positions refresh.
function makePopup(onMove) {
  const box = document.createElement("div"); box.className = "mappop";
  box.innerHTML = '<div class="mptop"><strong></strong><span class="chip"></span></div><div class="mpch"></div><div class="mpat"></div><select></select><div class="mpnote"></div>';
  const sel = box.querySelector("select");
  sel.addEventListener("change", () => { const to = sel.value; sel.value = ""; if (to) onMove(to, box.querySelector(".mpnote")); });
  return { box, popup: new maplibregl.Popup({ offset: 16 }).setDOMContent(box) };
}

// Live positions of radios that are sharing their location (members opt in on their radio),
// coloured by status, with each unit's channel and a quick Move.
export default function MapView() {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map()); // userId -> { marker, dot, box, popup, unit }
  const trails = useRef(new Map()); // userId -> [[lng, lat], ...]
  const fitted = useRef(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [channels, setChannels] = useState([]);
  const [filter, setFilter] = useState("");
  const [locations, setLocations] = useState([]);
  const [showTrails, setShowTrails] = useState(() => { try { return localStorage.getItem(TRAIL_KEY) !== "0"; } catch { return true; } });
  const { users } = useRoster();
  const live = useRef({});
  live.current = { channels };

  useEffect(() => {
    map.current = new maplibregl.Map({ container: el.current, style: STYLE, center: [-98.5, 39.8], zoom: 3 });
    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    map.current.on("load", () => {
      map.current.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.current.addLayer({ id: "trails", type: "line", source: "trails", paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.75 }, layout: { "line-cap": "round", "line-join": "round" } });
    });
    listZonesAndChannels().then(({ zones, channels: list }) => setChannels(list.filter((c) => c.enabled !== false).map((c) => ({ id: c.id, label: `${zones.find((z) => z.id === c.zone_id)?.name || "Radio"} · ${c.name}` })))).catch(() => {});
    let stop = false;
    const poll = async () => {
      try {
        const r = await dispatchLocations();
        if (stop) return;
        const list = r?.locations || [];
        for (const l of list) {
          const t = trails.current.get(l.userId) || [], p = [l.lng, l.lat];
          if (!t.length || metres(t[t.length - 1], p) >= TRAIL_MIN_M) { t.push(p); if (t.length > TRAIL_POINTS) t.shift(); }
          trails.current.set(l.userId, t);
        }
        setLocations(list); setError("");
      } catch (e) { if (!stop) setError(e?.message || "Could not load locations."); }
    };
    poll(); const t = setInterval(poll, POLL_MS);
    return () => { stop = true; clearInterval(t); map.current.remove(); markers.current.clear(); };
  }, []);

  useEffect(() => {
    const label = (id) => live.current.channels.find((c) => c.id === id)?.label || "No channel";
    const byUser = new Map(users.map((u) => [u.userId, u]));
    const shown = locations.filter((l) => !filter || l.channelId === filter);
    setCount(shown.length);
    const ids = new Set(shown.map((l) => l.userId));
    for (const [id, m] of markers.current) if (!ids.has(id)) { m.marker.remove(); markers.current.delete(id); }
    const features = [];
    for (const l of shown) {
      const unit = byUser.get(l.userId); // on the radio right now: its status, and what Move needs
      const name = l.callsign || l.displayName || unit?.callsign || "Radio";
      const status = unit?.status || "";
      let m = markers.current.get(l.userId);
      if (!m) {
        const entry = { dot: document.createElement("div"), unit };
        const { box, popup } = makePopup(async (to, note) => {
          const u = entry.unit;
          if (!u) { note.textContent = "This radio isn't connected to a channel right now."; return; }
          note.textContent = "Sending…";
          try { await dispatchMove(u.identity, u.channelId, to); note.textContent = `Sent to ${label(to)}.`; }
          catch (e) { note.textContent = e?.message || "Could not move that radio."; }
        });
        entry.box = box; entry.popup = popup;
        entry.marker = new maplibregl.Marker({ element: entry.dot }).setLngLat([l.lng, l.lat]).setPopup(popup).addTo(map.current);
        markers.current.set(l.userId, entry);
        m = entry;
      } else m.marker.setLngLat([l.lng, l.lat]);
      m.unit = unit;
      m.dot.className = "pin " + statusClass(status);
      m.dot.textContent = name;
      m.box.querySelector("strong").textContent = name;
      const chip = m.box.querySelector(".chip");
      chip.className = "chip " + statusClass(status);
      chip.textContent = status ? `${status} · ${elapsed(unit.since)}` : "No status";
      m.box.querySelector(".mpch").textContent = label(unit?.channelId || l.channelId);
      m.box.querySelector(".mpat").textContent = `Position ${ago(l.reportedAt)}${l.accuracy ? ` · ±${Math.round(l.accuracy)} m` : ""}`;
      const sel = m.box.querySelector("select");
      if (document.activeElement !== sel) {
        const here = unit?.channelId || l.channelId;
        sel.disabled = !unit;
        sel.replaceChildren(new Option(unit ? "Move to channel…" : "Not on a channel", ""), ...live.current.channels.filter((c) => c.id !== here).map((c) => new Option(c.label, c.id)));
      }
      const t = trails.current.get(l.userId) || [];
      if (showTrails && t.length > 1) features.push({ type: "Feature", properties: { color: getComputedStyle(m.dot).backgroundColor || "#3da5ff" }, geometry: { type: "LineString", coordinates: t } });
    }
    map.current?.getSource("trails")?.setData({ type: "FeatureCollection", features });
    if (!fitted.current && shown.length) {
      fitted.current = true;
      const b = new maplibregl.LngLatBounds();
      shown.forEach((l) => b.extend([l.lng, l.lat]));
      map.current.fitBounds(b, { padding: 60, maxZoom: 13, duration: 0 });
    }
  }, [locations, filter, channels, users, showTrails]);

  const toggleTrails = (on) => { setShowTrails(on); try { localStorage.setItem(TRAIL_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ } };

  return (
    <div>
      {error && <p className="err">{error}</p>}
      <p className="maptools">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All channels</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <label><input type="checkbox" checked={showTrails} onChange={(e) => toggleTrails(e.target.checked)} /> Trails</label>
        <span>{count} sharing location · click a radio for its status and to move it to another channel</span>
      </p>
      <div ref={el} className="map" />
    </div>
  );
}

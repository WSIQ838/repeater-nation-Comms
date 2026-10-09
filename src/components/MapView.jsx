import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { listZonesAndChannels, dispatchLocations } from "../lib/auth";

const POLL_MS = 5000;
const STYLE = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Live positions of radios that are sharing their location (members opt in on their radio).
export default function MapView() {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());
  const fitted = useRef(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [channelNames, setChannelNames] = useState({});
  const [filter, setFilter] = useState("");
  const [locations, setLocations] = useState([]);

  useEffect(() => {
    map.current = new maplibregl.Map({ container: el.current, style: STYLE, center: [-98.5, 39.8], zoom: 3 });
    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    listZonesAndChannels().then(({ zones, channels }) => setChannelNames(Object.fromEntries(channels.map((c) => [c.id, `${zones.find((z) => z.id === c.zone_id)?.name || "Radio"} · ${c.name}`])))).catch(() => {});
    let stop = false;
    const poll = async () => {
      try { const r = await dispatchLocations(); if (!stop) { setLocations(r?.locations || []); setError(""); } }
      catch (e) { if (!stop) setError(e?.message || "Could not load locations."); }
    };
    poll(); const t = setInterval(poll, POLL_MS);
    return () => { stop = true; clearInterval(t); map.current.remove(); markers.current.clear(); };
  }, []);

  useEffect(() => {
    const shown = locations.filter((l) => !filter || l.channelId === filter);
    setCount(shown.length);
    const live = new Set(shown.map((l) => l.userId));
    for (const [id, m] of markers.current) if (!live.has(id)) { m.remove(); markers.current.delete(id); }
    for (const l of shown) {
      const text = `${l.callsign || l.displayName || "Radio"}`;
      const popup = () => new maplibregl.Popup({ offset: 14 }).setText(`${text} · ${channelNames[l.channelId] || "no channel"}`);
      let m = markers.current.get(l.userId);
      if (!m) {
        const dot = document.createElement("div"); dot.className = "pin"; dot.textContent = text;
        m = new maplibregl.Marker({ element: dot }).setLngLat([l.lng, l.lat]).setPopup(popup()).addTo(map.current);
        markers.current.set(l.userId, m);
      } else { m.setLngLat([l.lng, l.lat]); m.setPopup(popup()); }
    }
    if (!fitted.current && shown.length) {
      fitted.current = true;
      const b = new maplibregl.LngLatBounds();
      shown.forEach((l) => b.extend([l.lng, l.lat]));
      map.current.fitBounds(b, { padding: 60, maxZoom: 13, duration: 0 });
    }
  }, [locations, filter, channelNames]);

  return (
    <div>
      {error && <p className="err">{error}</p>}
      <p>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All channels</option>
          {Object.entries(channelNames).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        {" "}{count} sharing location
      </p>
      <div ref={el} className="map" />
    </div>
  );
}

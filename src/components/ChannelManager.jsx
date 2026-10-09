import { useCallback, useEffect, useState } from "react";
import { listZonesAndChannels, createZone, deleteZone, createChannel, deleteChannel, updateChannel } from "../lib/auth";

export default function ChannelManager() {
  const [data, setData] = useState({ zones: [], channels: [] });
  const [error, setError] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [chan, setChan] = useState({ name: "", number: "", zone_id: "" });

  const load = useCallback(() => listZonesAndChannels().then(setData).catch((e) => setError(e?.message || "Could not load.")), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => { setError(""); try { await fn(); await load(); } catch (e) { setError(e?.message || "Not allowed."); } };

  return (
    <div className="grid">
      {error && <p className="err">{error}</p>}
      <section className="card">
        <h2>Zones</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (!zoneName.trim()) return; run(async () => { await createZone({ name: zoneName.trim(), enabled: true, display_order: data.zones.length }); setZoneName(""); }); }}>
          <input placeholder="New zone name" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
          <button>Add zone</button>
        </form>
        <ul>{data.zones.map((z) => (
          <li key={z.id}>{z.name}<button onClick={() => confirm(`Delete zone "${z.name}"?`) && run(() => deleteZone(z.id))}>Remove</button></li>
        ))}</ul>
      </section>
      <section className="card">
        <h2>Channels</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (!chan.name.trim() || !chan.zone_id) return; run(async () => { await createChannel({ name: chan.name.trim(), number: Number(chan.number) || 0, zone_id: chan.zone_id, enabled: true }); setChan({ name: "", number: "", zone_id: chan.zone_id }); }); }}>
          <input placeholder="Channel name" value={chan.name} onChange={(e) => setChan({ ...chan, name: e.target.value })} />
          <input placeholder="#" size="3" value={chan.number} onChange={(e) => setChan({ ...chan, number: e.target.value })} />
          <select value={chan.zone_id} onChange={(e) => setChan({ ...chan, zone_id: e.target.value })}>
            <option value="">Zone…</option>
            {data.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <button>Add channel</button>
        </form>
        <ul>{data.channels.map((c) => (
          <li key={c.id}>
            {c.number} · {c.name} <em>({data.zones.find((z) => z.id === c.zone_id)?.name || "no zone"})</em>
            <button onClick={() => run(() => updateChannel(c.id, { enabled: !c.enabled }))}>{c.enabled ? "Disable" : "Enable"}</button>
            <button onClick={() => confirm(`Delete channel "${c.name}"?`) && run(() => deleteChannel(c.id))}>Remove</button>
          </li>
        ))}</ul>
      </section>
    </div>
  );
}

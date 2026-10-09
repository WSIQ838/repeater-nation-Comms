import { useCallback, useEffect, useState } from "react";
import { listZonesAndChannels, createZone, updateZone, deleteZone, createChannel, updateChannel, deleteChannel } from "../lib/auth";

const byOrder = (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0);
const byNumber = (a, b) => (a.number ?? 0) - (b.number ?? 0);

export default function ChannelManager() {
  const [data, setData] = useState({ zones: [], channels: [] });
  const [error, setError] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [chan, setChan] = useState({ name: "", number: "", zone_id: "" });
  const [edit, setEdit] = useState(null); // { kind: "zone"|"channel", id, name, number, zone_id }

  const load = useCallback(() => listZonesAndChannels().then(setData).catch((e) => setError(e?.message || "Could not load.")), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => { setError(""); try { await fn(); await load(); } catch (e) { setError(e?.message || "Not allowed."); } };

  const zones = [...data.zones].sort(byOrder);
  const moveZone = (i, d) => run(async () => {
    const a = zones[i], b = zones[i + d];
    if (!a || !b) return;
    // Renumber the whole list so ties or gaps in display_order can't make a swap a no-op.
    const order = zones.map((z) => z.id);
    [order[i], order[i + d]] = [order[i + d], order[i]];
    await Promise.all(order.map((id, n) => (zones.find((z) => z.id === id).display_order === n ? null : updateZone(id, { display_order: n }))));
  });

  const saveEdit = () => run(async () => {
    const name = edit.name.trim();
    if (!name) throw new Error("Name can't be empty.");
    if (edit.kind === "zone") await updateZone(edit.id, { name });
    else await updateChannel(edit.id, { name, number: Number(edit.number) || 0, zone_id: edit.zone_id });
    setEdit(null);
  });

  return (
    <div className="grid">
      {error && <p className="err">{error}</p>}
      <section className="card">
        <h2>Zones</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (!zoneName.trim()) return; run(async () => { await createZone({ name: zoneName.trim(), enabled: true, display_order: zones.length }); setZoneName(""); }); }}>
          <input placeholder="New zone name" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
          <button>Add zone</button>
        </form>
        <ul>{zones.map((z, i) => (
          <li key={z.id}>
            {edit?.kind === "zone" && edit.id === z.id ? (
              <>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                <button onClick={saveEdit}>Save</button><button onClick={() => setEdit(null)}>Cancel</button>
              </>
            ) : (
              <>
                <span>{z.name}{z.enabled === false && " (disabled)"}</span>
                <button disabled={i === 0} onClick={() => moveZone(i, -1)}>↑</button>
                <button disabled={i === zones.length - 1} onClick={() => moveZone(i, 1)}>↓</button>
                <button onClick={() => setEdit({ kind: "zone", id: z.id, name: z.name })}>Edit</button>
                <button onClick={() => run(() => updateZone(z.id, { enabled: z.enabled === false }))}>{z.enabled === false ? "Enable" : "Disable"}</button>
                <button onClick={() => {
                  const n = data.channels.filter((c) => c.zone_id === z.id).length;
                  if (confirm(n ? `Zone "${z.name}" still has ${n} channel(s). Delete it anyway?` : `Delete zone "${z.name}"?`)) run(() => deleteZone(z.id));
                }}>Remove</button>
              </>
            )}
          </li>
        ))}</ul>
      </section>
      <section className="card">
        <h2>Channels</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (!chan.name.trim() || !chan.zone_id) return; run(async () => { await createChannel({ name: chan.name.trim(), number: Number(chan.number) || 0, zone_id: chan.zone_id, enabled: true }); setChan({ name: "", number: "", zone_id: chan.zone_id }); }); }}>
          <input placeholder="Channel name" value={chan.name} onChange={(e) => setChan({ ...chan, name: e.target.value })} />
          <input placeholder="#" size="3" value={chan.number} onChange={(e) => setChan({ ...chan, number: e.target.value })} />
          <select value={chan.zone_id} onChange={(e) => setChan({ ...chan, zone_id: e.target.value })}>
            <option value="">Zone…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <button>Add channel</button>
        </form>
        <ul>{[...data.channels].sort(byNumber).map((c) => (
          <li key={c.id}>
            {edit?.kind === "channel" && edit.id === c.id ? (
              <>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                <input size="3" value={edit.number} onChange={(e) => setEdit({ ...edit, number: e.target.value })} />
                <select value={edit.zone_id} onChange={(e) => setEdit({ ...edit, zone_id: e.target.value })}>
                  {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
                <button onClick={saveEdit}>Save</button><button onClick={() => setEdit(null)}>Cancel</button>
              </>
            ) : (
              <>
                <span>{c.number} · {c.name} <em>({zones.find((z) => z.id === c.zone_id)?.name || "no zone"})</em>{!c.enabled && " (disabled)"}</span>
                <button onClick={() => setEdit({ kind: "channel", id: c.id, name: c.name, number: String(c.number ?? ""), zone_id: c.zone_id })}>Edit</button>
                <button onClick={() => run(() => updateChannel(c.id, { enabled: !c.enabled }))}>{c.enabled ? "Disable" : "Enable"}</button>
                <button onClick={() => confirm(`Delete channel "${c.name}"?`) && run(() => deleteChannel(c.id))}>Remove</button>
              </>
            )}
          </li>
        ))}</ul>
      </section>
    </div>
  );
}

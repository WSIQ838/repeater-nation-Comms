import { useCallback, useEffect, useState } from "react";
import { feedPending, feedApprove, feedReject, listZonesAndChannels } from "../lib/auth";

// Members ask for a stream channel (a listen-only channel that carries an audio feed). Control picks
// the zone and approves it, which creates the channel; or turns it down.
export function usePendingStreams(active) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let stop = false;
    const poll = () => feedPending().then((r) => { if (!stop) setCount((r?.requests || []).length); }).catch(() => {});
    poll(); const t = setInterval(poll, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [active]);
  return count;
}

export default function StreamRequests({ onChanged }) {
  const [items, setItems] = useState([]);
  const [zones, setZones] = useState([]);
  const [pick, setPick] = useState({}); // request id -> { zone, name }
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { const r = await feedPending(); setItems(r?.requests || []); setError(""); }
    catch (e) { setError(e?.message || "Could not load the requests."); }
  }, []);
  useEffect(() => {
    load(); const t = setInterval(load, 15000);
    listZonesAndChannels().then(({ zones: z }) => setZones(z.filter((x) => x.enabled !== false))).catch(() => {});
    return () => clearInterval(t);
  }, [load]);

  const act = async (id, fn, done) => {
    setBusy(id); setError(""); setNote("");
    try { await fn(); setNote(done); await load(); onChanged?.(); }
    catch (e) { setError(e?.message || "That didn't work."); }
    setBusy("");
  };

  return (
    <div className="grid wide">
      <section className="card">
        <h2>Stream channel requests</h2>
        <p className="muted">A member asks for a stream channel. Approving it creates a listen-only channel in the zone you choose, and lets that member connect their audio feed to it.</p>
        {error && <p className="err">{error}</p>}
        {note && <p>{note}</p>}
        {!items.length && <p className="muted">Nothing waiting for approval.</p>}
        <ul>{items.map((r) => {
          const p = pick[r.id] || {};
          return (
            <li key={r.id} className="streamreq">
              <span>
                <b>{r.name}</b> <em>from {r.requester}{r.callsign ? ` (${r.callsign})` : ""}</em>
                {r.description && <small>{r.description}</small>}
              </span>
              <select value={p.zone || ""} onChange={(e) => setPick({ ...pick, [r.id]: { ...p, zone: e.target.value } })}>
                <option value="">Zone…</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <input placeholder="Rename (optional)" value={p.name || ""} onChange={(e) => setPick({ ...pick, [r.id]: { ...p, name: e.target.value } })} />
              <button className="on" disabled={busy === r.id || !p.zone} onClick={() => act(r.id, () => feedApprove(r.id, p.zone, p.name), `Approved "${p.name || r.name}".`)}>Approve</button>
              <button disabled={busy === r.id} onClick={() => { const reason = prompt("Reason (optional, the member sees it):", "") ; if (reason !== null) act(r.id, () => feedReject(r.id, reason), `Turned down "${r.name}".`); }}>Reject</button>
            </li>
          );
        })}</ul>
      </section>
    </div>
  );
}

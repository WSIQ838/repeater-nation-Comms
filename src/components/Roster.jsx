import { useEffect, useMemo, useState } from "react";
import { listZonesAndChannels, dispatchRoster, dispatchMove } from "../lib/auth";

const POLL_MS = 5000;

// Everyone on the radio, grouped by channel. Dispatch can send any radio to another channel.
export default function Roster() {
  const [users, setUsers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    listZonesAndChannels().then(({ zones, channels }) => setChannels(
      channels.filter((c) => c.enabled !== false).map((c) => ({ ...c, label: `${zones.find((z) => z.id === c.zone_id)?.name || "Radio"} · ${c.name}` }))
    )).catch(() => {});
    let stop = false;
    const poll = async () => {
      try { const r = await dispatchRoster(); if (!stop) { setUsers(r?.users || []); setError(""); } }
      catch (e) { if (!stop) setError(e?.message || "Could not load the roster."); }
    };
    poll(); const t = setInterval(poll, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const byChannel = useMemo(() => {
    const m = new Map();
    for (const u of users) m.set(u.channelId, [...(m.get(u.channelId) || []), u]);
    return [...m.entries()];
  }, [users]);
  const label = (id) => channels.find((c) => c.id === id)?.label || "Unknown channel";

  const move = async (u, to) => {
    if (!to) return;
    setError(""); setNotice("");
    try { await dispatchMove(u.identity, u.channelId, to); setNotice(`Sent ${u.callsign || u.displayName} to ${label(to)}. Their radio switches only if it is the app (0.2.60 or newer); the website radio and older apps ignore the move.`); }
    catch (e) { setError(e?.message || "Could not move that radio."); }
  };

  return (
    <div>
      {error && <p className="err">{error}</p>}
      {notice && <p>{notice}</p>}
      {!byChannel.length && !error && <p>Nobody is on the radio right now.</p>}
      <div className="grid wide">
        {byChannel.map(([channelId, list]) => (
          <section key={channelId} className="card">
            <h3>{label(channelId)} <small>({list.length})</small></h3>
            <ul>{list.map((u) => (
              <li key={u.identity}>
                <span>{u.callsign || u.displayName}</span>
                <select value="" onChange={(e) => move(u, e.target.value)}>
                  <option value="">Move to…</option>
                  {channels.filter((c) => c.id !== channelId).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </li>
            ))}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}

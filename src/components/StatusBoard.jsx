import { useEffect, useMemo, useState } from "react";
import { listZonesAndChannels, dispatchMove } from "../lib/auth";
import { STATUSES, elapsed, statusClass, useRoster } from "../lib/roster";

// Every unit on the radio in a column for its status (Available, En Route, At Scene...), with
// how long it has had that status and the channel it is on. A unit can be sent to another channel.
export default function StatusBoard({ selfId }) {
  const { users, error, loaded } = useRoster();
  const [channels, setChannels] = useState([]);
  const [notice, setNotice] = useState("");
  const [moveError, setMoveError] = useState("");
  const [, tick] = useState(0);

  useEffect(() => {
    listZonesAndChannels().then(({ zones, channels: list }) => setChannels(list.filter((c) => c.enabled !== false).map((c) => ({ id: c.id, label: `${zones.find((z) => z.id === c.zone_id)?.name || "Radio"} · ${c.name}` })))).catch(() => {});
    // The time-in-status counters move on even when nobody changes status.
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const label = (id) => channels.find((c) => c.id === id)?.label || "Unknown channel";
  const units = users.filter((u) => !selfId || u.userId !== selfId);
  const columns = useMemo(() => {
    const cols = [...STATUSES, "Other", "No status"].map((name) => ({ name, units: [] }));
    for (const u of units) {
      const name = !u.status ? "No status" : STATUSES.find((s) => s.toLowerCase() === u.status.toLowerCase()) || "Other";
      cols.find((c) => c.name === name).units.push(u);
    }
    // Longest in a status first: the unit that has been "At Scene" longest is the one to check on.
    for (const c of cols) c.units.sort((a, b) => a.since - b.since);
    return cols.filter((c) => c.units.length || STATUSES.includes(c.name));
  }, [units]);

  const move = async (u, to) => {
    if (!to) return;
    setMoveError(""); setNotice("");
    try { await dispatchMove(u.identity, u.channelId, to); setNotice(`Sent ${u.callsign || u.displayName} to ${label(to)}.`); }
    catch (e) { setMoveError(e?.message || "Could not move that radio."); }
  };

  return (
    <div className="statusboard">
      <p className="sbhead">
        <strong>{units.length}</strong> {units.length === 1 ? "unit" : "units"} on the radio
        <small> · times show how long each unit has had its status, as seen by this console</small>
      </p>
      {error && <p className="err">{error}</p>}
      {moveError && <p className="err">{moveError}</p>}
      {notice && <p><small>{notice}</small></p>}
      {loaded && !units.length && !error && <p><small>Nobody is on the radio right now.</small></p>}
      <div className="sbcols">
        {columns.map((c) => (
          <section key={c.name} className={"sbcol " + statusClass(c.name)}>
            <h3>{c.name} <span>{c.units.length}</span></h3>
            {c.units.map((u) => (
              <div key={u.identity} className="sbunit">
                <div className="sbtop"><strong>{u.callsign || u.displayName}</strong><span className="sbtime">{elapsed(u.since)}</span></div>
                {c.name === "Other" && <small>{u.status}</small>}
                <small>{label(u.channelId)}</small>
                <select value="" onChange={(e) => move(u, e.target.value)}>
                  <option value="">Move to…</option>
                  {channels.filter((ch) => ch.id !== u.channelId).map((ch) => <option key={ch.id} value={ch.id}>{ch.label}</option>)}
                </select>
              </div>
            ))}
            {!c.units.length && <p className="sbempty">—</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

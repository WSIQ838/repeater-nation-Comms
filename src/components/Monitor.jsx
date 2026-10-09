import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import { listZonesAndChannels, issueMonitorSession } from "../lib/auth";

const who = (p) => { try { const m = p?.metadata ? JSON.parse(p.metadata) : {}; return m.callsign || m.displayName || p?.name || p?.identity; } catch { return p?.name || p?.identity; } };

// Receive-only monitoring of any number of channels at once.
export default function Monitor() {
  const [channels, setChannels] = useState([]);
  const [live, setLive] = useState({}); // channelId -> { people: [], onAir: [], volume, muted }
  const [error, setError] = useState("");
  const rooms = useRef(new Map()); // channelId -> { room, audio: Map }

  useEffect(() => {
    listZonesAndChannels().then(({ zones, channels }) => setChannels(
      channels.filter((c) => c.enabled).map((c) => ({ ...c, zoneId: c.zone_id, zoneName: zones.find((z) => z.id === c.zone_id)?.name || "Radio" }))
    )).catch((e) => setError(e?.message || "Could not load channels."));
    return () => { for (const id of [...rooms.current.keys()]) leave(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (id, fn) => setLive((s) => (s[id] ? { ...s, [id]: fn(s[id]) } : s));
  const roster = (room) => [...room.remoteParticipants.values()].map(who);

  const join = async (c) => {
    if (rooms.current.has(c.id)) return;
    setError("");
    try {
      const s = await issueMonitorSession(c);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      const entry = { room, audio: new Map() };
      rooms.current.set(c.id, entry);
      setLive((st) => ({ ...st, [c.id]: { people: [], onAir: [], volume: 1, muted: false } }));
      const refresh = () => patch(c.id, (l) => ({ ...l, people: roster(room) }));
      room.on(RoomEvent.ParticipantConnected, refresh);
      room.on(RoomEvent.ParticipantDisconnected, (p) => { entry.audio.delete(p.identity); patch(c.id, (l) => ({ ...l, people: roster(room), onAir: l.onAir.filter((n) => n !== who(p)) })); });
      room.on(RoomEvent.TrackSubscribed, (track, pub, p) => {
        if (track.kind !== "audio") return;
        const el = track.attach(); el.autoplay = true; el.style.display = "none"; document.body.appendChild(el);
        entry.audio.set(p.identity, el);
        patch(c.id, (l) => { el.volume = l.muted ? 0 : l.volume; return { ...l, onAir: [...new Set([...l.onAir, who(p)])] }; });
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, pub, p) => {
        track.detach().forEach((el) => el.remove()); entry.audio.delete(p.identity);
        patch(c.id, (l) => ({ ...l, onAir: l.onAir.filter((n) => n !== who(p)) }));
      });
      room.on(RoomEvent.Disconnected, () => { if (rooms.current.get(c.id) === entry) leave(c.id); });
      await room.connect(s.liveKitUrl, s.liveKitToken);
      refresh();
    } catch (e) {
      rooms.current.delete(c.id);
      setLive((st) => { const { [c.id]: _, ...rest } = st; return rest; });
      setError(e?.message || "Could not monitor that channel.");
    }
  };

  const leave = useCallback((id) => {
    const entry = rooms.current.get(id);
    rooms.current.delete(id);
    if (entry) { for (const el of entry.audio.values()) el.remove(); entry.room.disconnect(); }
    setLive((st) => { const { [id]: _, ...rest } = st; return rest; });
  }, []);

  const setAudio = (id, volume, muted) => {
    const entry = rooms.current.get(id);
    if (entry) for (const el of entry.audio.values()) el.volume = muted ? 0 : volume;
    patch(id, (l) => ({ ...l, volume, muted }));
  };

  return (
    <div>
      {error && <p className="err">{error}</p>}
      <div className="grid">
        {channels.map((c) => {
          const l = live[c.id];
          return (
            <section key={c.id} className={"card" + (l?.onAir.length ? " onair" : "")}>
              <h3>{c.zoneName} · {c.name}</h3>
              {!l ? <button onClick={() => join(c)}>Monitor</button> : (
                <>
                  <p>{l.onAir.length ? `ON AIR: ${l.onAir.join(", ")}` : "Idle"} · {l.people.length} on channel</p>
                  <input type="range" min="0" max="1" step="0.05" value={l.volume} onChange={(e) => setAudio(c.id, Number(e.target.value), l.muted)} />
                  <button onClick={() => setAudio(c.id, l.volume, !l.muted)}>{l.muted ? "Unmute" : "Mute"}</button>
                  <button onClick={() => leave(c.id)}>Stop</button>
                  <small>{l.people.join(", ")}</small>
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

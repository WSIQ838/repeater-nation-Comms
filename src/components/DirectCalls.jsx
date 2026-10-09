import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, createLocalAudioTrack } from "livekit-client";
import { listAllDirectCalls, directCallToken } from "../lib/auth";

const POLL_MS = 4000;
const name = (c, side) => c[`${side}_callsign`] || c[`${side}_name`] || c[`${side}_display_name`] || c[`${side}_user_id`] || "Unknown";
const since = (c) => { const t = Date.parse(c.answered_at || c.created_date || c.created_at || ""); if (!t) return ""; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// Live list of member-to-member direct calls. Dispatch can listen silently or join in and talk.
export default function DirectCalls() {
  const [calls, setCalls] = useState([]);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(null); // { id, mode, talking }
  const session = useRef(null); // { room, audio: [], mic }
  const [, tick] = useState(0);

  useEffect(() => {
    let stop = false, busy = false;
    const poll = async () => {
      if (busy) return; busy = true;
      try {
        const r = await listAllDirectCalls();
        if (!stop && Array.isArray(r?.calls)) { setCalls(r.calls); setError(""); }
        else if (!stop) setError(r?.error || "The server didn't return a call list.");
      } catch (e) { if (!stop) setError(e?.message || "Could not load calls."); }
      finally { busy = false; }
    };
    poll();
    const t = setInterval(() => { poll(); tick((n) => n + 1); }, POLL_MS);
    return () => { stop = true; clearInterval(t); leave(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A call that left the list has ended: drop out of it.
  useEffect(() => {
    if (joined && !calls.some((c) => c.id === joined.id) && session.current?.startedAt && Date.now() - session.current.startedAt > 8000) leave();
  }, [calls, joined]);

  const leave = useCallback(async () => {
    const s = session.current; session.current = null; setJoined(null);
    if (!s) return;
    for (const el of s.audio.values()) el.remove();
    try { s.mic?.stop(); } catch { /* already stopped */ }
    try { await s.room.disconnect(); } catch { /* already gone */ }
  }, []);

  const join = async (call, mode) => {
    setError("");
    await leave();
    try {
      const t = await directCallToken(call.id, mode);
      if (!t?.liveKitToken) throw new Error(t?.error || "The server refused dispatch access to this call.");
      const room = new Room();
      const s = { room, audio: new Map(), mic: null, startedAt: Date.now() };
      session.current = s;
      room.on(RoomEvent.TrackSubscribed, (track, _p, p) => {
        if (track.kind !== "audio") return;
        const el = track.attach(); el.autoplay = true; el.style.display = "none"; document.body.appendChild(el); s.audio.set(p.identity, el);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _p, p) => { track.detach().forEach((e) => e.remove()); s.audio.delete(p.identity); });
      room.on(RoomEvent.Disconnected, () => { if (session.current === s) leave(); });
      await room.connect(t.liveKitUrl, t.liveKitToken);
      setJoined({ id: call.id, mode, talking: false });
    } catch (e) { await leave(); setError(e?.message || "Could not join the call."); }
  };

  // Talk is hold-to-speak: the mic is only published while the button is held.
  const talk = async (on) => {
    const s = session.current;
    if (!s || joined?.mode !== "talk") return;
    try {
      if (on && !s.mic) {
        s.mic = await createLocalAudioTrack();
        if (session.current !== s) { s.mic.stop(); s.mic = null; return; }
        await s.room.localParticipant.publishTrack(s.mic);
      } else if (!on && s.mic) {
        const mic = s.mic; s.mic = null;
        await s.room.localParticipant.unpublishTrack(mic, true); mic.stop();
      }
      setJoined((j) => (j ? { ...j, talking: on } : j));
    } catch (e) { setError(e?.message || "Could not use the microphone."); }
  };

  return (
    <div>
      {error && <p className="err">{error}</p>}
      {!calls.length && !error && <p>No direct calls in progress.</p>}
      <div className="grid">
        {calls.map((c) => {
          const mine = joined?.id === c.id;
          return (
            <section key={c.id} className={"card" + (mine ? " onair" : "")}>
              <h3>{name(c, "caller")} ⇄ {name(c, "recipient")}</h3>
              <p>{c.status === "ringing" ? "Ringing" : "Active"} {since(c)}</p>
              {!mine ? (
                <>
                  <button onClick={() => join(c, "listen")}>Listen</button>
                  <button onClick={() => join(c, "talk")}>Join &amp; talk</button>
                </>
              ) : (
                <>
                  <p>{joined.mode === "listen" ? "Listening (silent)" : joined.talking ? "TRANSMITTING" : "Joined: hold to talk"}</p>
                  {joined.mode === "talk" && (
                    <button onPointerDown={() => talk(true)} onPointerUp={() => talk(false)} onPointerLeave={() => joined.talking && talk(false)}>Hold to talk</button>
                  )}
                  <button onClick={leave}>Leave call</button>
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import { listZonesAndChannels, issueMonitorSession, dispatchRoster, dispatchMove } from "../lib/auth";
import { ChannelLink, openMic } from "../lib/channelLink";
import { applySink } from "../lib/prefs";
import { listMessages, saveMessage, deleteMessage, recordMessage, playableTrack } from "../lib/messages";

const who = (p) => { try { const m = p?.metadata ? JSON.parse(p.metadata) : {}; return m.radioCallsign || m.callsign || m.displayName || p?.name || p?.identity; } catch { return p?.name || p?.identity; } };
const ON_KEY = "dispatch-channels-on";
const loadOn = () => { try { return new Set(JSON.parse(localStorage.getItem(ON_KEY) || "[]")); } catch { return new Set(); } };
const saveOn = (set) => { try { localStorage.setItem(ON_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ } };

// One channel: an on/off switch (listen), a volume slider, and a hold-to-talk button.
function ChannelCard({ channel, startOn, onChange, messages }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(1);
  const [onAir, setOnAir] = useState([]);
  const [people, setPeople] = useState(0);
  const [keyed, setKeyed] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const mon = useRef(null);      // listening connection: { room, audio }
  const tx = useRef(null);       // send connection, opened the first time PTT is used
  const mic = useRef(null);
  const key = useRef(0);
  const vol = useRef(1);
  const sending = useRef(false);

  const turnOn = async () => {
    if (mon.current) return;
    setBusy(true); setError("");
    try {
      const s = await issueMonitorSession(channel);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      const entry = { room, audio: new Map() };
      mon.current = entry;
      const count = () => setPeople(room.remoteParticipants.size);
      room.on(RoomEvent.ParticipantConnected, count);
      room.on(RoomEvent.ParticipantDisconnected, (p) => { entry.audio.delete(p.identity); setOnAir((l) => l.filter((n) => n !== who(p))); count(); });
      room.on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        if (track.kind !== "audio") return;
        const el = track.attach(); el.autoplay = true; el.style.display = "none"; el.volume = vol.current; applySink(el); document.body.appendChild(el);
        entry.audio.set(p.identity, el);
        setOnAir((l) => [...new Set([...l, who(p)])]);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
        track.detach().forEach((e) => e.remove()); entry.audio.delete(p.identity);
        setOnAir((l) => l.filter((n) => n !== who(p)));
      });
      room.on(RoomEvent.Disconnected, () => { if (mon.current === entry) turnOff(false); });
      await room.connect(s.liveKitUrl, s.liveKitToken);
      count(); setOn(true); onChange(channel.id, true);
    } catch (e) { mon.current = null; setError(e?.message || "Could not listen to this channel."); }
    setBusy(false);
  };

  const turnOff = async (persist = true) => {
    await release();
    const entry = mon.current; mon.current = null;
    if (entry) { for (const el of entry.audio.values()) el.remove(); entry.room.disconnect(); }
    const link = tx.current; tx.current = null;
    link?.disconnect();
    setOn(false); setOnAir([]); setPeople(0); setKeyed(false);
    if (persist) onChange(channel.id, false);
  };

  useEffect(() => { if (startOn) turnOn(); return () => { turnOff(false); }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const changeVolume = (v) => { vol.current = v; setVolume(v); for (const el of mon.current?.audio.values() || []) el.volume = v; };

  const sendLink = async () => {
    if (!tx.current) { const l = new ChannelLink(channel, { listen: false }); await l.connect(); tx.current = l; }
    if (!tx.current.canTransmit) throw new Error("This account has no verified callsign, so it can't transmit.");
    return tx.current;
  };

  // Hold to talk. A release before the floor is granted cancels the attempt cleanly.
  const down = async () => {
    if (!on || sending.current) return;
    sending.current = true; setError("");
    const mine = ++key.current;
    try {
      setNote("Connecting…");
      const l = await sendLink();
      if (key.current !== mine) return;
      await l.begin();
      if (key.current !== mine) { await l.end(); return; }
      mic.current = await openMic();
      if (key.current !== mine) { mic.current.stop(); mic.current = null; await l.end(); return; }
      await l.publish(mic.current);
      setKeyed(true); setNote("");
    } catch (e) { setError(e?.message || "Could not transmit."); await release(); }
    finally { if (key.current === mine && !mic.current) sending.current = false; }
  };
  async function release() {
    key.current++;
    const m = mic.current; mic.current = null;
    if (m) { await tx.current?.unpublish(m); m.stop(); }
    await tx.current?.end();
    setKeyed(false); setNote(""); sending.current = false;
  }

  const play = async (id) => {
    const m = messages.find((x) => x.id === id);
    if (!m || !on || sending.current) return;
    sending.current = true; setError(""); setNote(`Playing "${m.name}"`);
    let audio = null;
    try {
      const l = await sendLink();
      await l.begin();
      audio = await playableTrack(m.blob);
      await l.publish(audio.track);
      setKeyed(true); audio.start(); await audio.done;
    } catch (e) { setError(e?.message || "Could not play the message."); }
    finally {
      if (audio) { await tx.current?.unpublish(audio.track); audio.close(); }
      await tx.current?.end();
      setKeyed(false); setNote(""); sending.current = false;
    }
  };

  return (
    <section className={"card" + (onAir.length ? " onair" : "") + (keyed ? " keyed" : "")}>
      <div className="cardhead">
        <h3>{channel.zoneName} · {channel.name}</h3>
        <label className="switch" title={on ? "Listening: switch off" : "Switch on to listen"}>
          <input type="checkbox" checked={on} disabled={busy} onChange={() => (on ? turnOff() : turnOn())} />
          <span>{busy ? "…" : on ? "ON" : "OFF"}</span>
        </label>
      </div>
      {error && <p className="err">{error}</p>}
      {on && (
        <>
          <p>{keyed ? "YOU ARE TRANSMITTING" : onAir.length ? `ON AIR: ${onAir.join(", ")}` : "Idle"} <small>· {people} on channel</small></p>
          <label className="volrow">Volume
            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => changeVolume(Number(e.target.value))} />
          </label>
          <button className={"ptt" + (keyed ? " on" : "")} onPointerDown={down} onPointerUp={release} onPointerLeave={() => (keyed || sending.current) && release()}>
            {keyed ? "TRANSMITTING" : note || "Hold to talk"}
          </button>
          {messages.length > 0 && (
            <select value="" disabled={keyed || sending.current} onChange={(e) => e.target.value && play(e.target.value)}>
              <option value="">Play a recorded message…</option>
              {messages.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
        </>
      )}
    </section>
  );
}

// Everyone on the radio, with their status and channel. Dispatch can send a radio to another channel.
function RosterPanel({ channels }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const label = (id) => channels.find((c) => c.id === id)?.label || "Unknown channel";

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try { const r = await dispatchRoster(); if (!stop) { setUsers(r?.users || []); setError(""); } }
      catch (e) { if (!stop) setError(e?.message || "Could not load the roster."); }
    };
    poll(); const t = setInterval(poll, 5000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const sorted = useMemo(() => [...users].sort((a, b) => label(a.channelId).localeCompare(label(b.channelId)) || String(a.callsign || a.displayName).localeCompare(String(b.callsign || b.displayName))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, channels]);

  const move = async (u, to) => {
    if (!to) return;
    setError(""); setNotice("");
    try { await dispatchMove(u.identity, u.channelId, to); setNotice(`Sent ${u.callsign || u.displayName} to ${label(to)}. Only the radio app (0.2.60 or newer) follows a move.`); }
    catch (e) { setError(e?.message || "Could not move that radio."); }
  };

  return (
    <aside className="roster card">
      <h3>Online <small>({users.length})</small></h3>
      {error && <p className="err">{error}</p>}
      {notice && <p><small>{notice}</small></p>}
      {!users.length && !error && <p><small>Nobody is on the radio right now.</small></p>}
      <ul>{sorted.map((u) => (
        <li key={u.identity} className="person">
          <div>
            <strong>{u.callsign || u.displayName}</strong>
            {u.status && <span className="chip">{u.status}</span>}
            <br /><small>{label(u.channelId)}</small>
          </div>
          <select value="" onChange={(e) => move(u, e.target.value)}>
            <option value="">Move…</option>
            {channels.filter((c) => c.id !== u.channelId).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </li>
      ))}</ul>
    </aside>
  );
}

// Recorded messages (kept on this computer) that can be played onto any channel that is switched on.
function MessagesBar({ messages, reload }) {
  const [recorder, setRecorder] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    try {
      if (!recorder) { setRecorder(await recordMessage()); return; }
      const blob = await recorder.stop(); setRecorder(null);
      const name = prompt("Name this message:", "Message " + (messages.length + 1));
      if (name) { await saveMessage(name, blob); await reload(); }
    } catch (e) { setRecorder(null); setError(e?.message || "Could not record."); }
  };
  return (
    <div className="msgbar">
      <button onClick={() => setOpen(!open)}>Recorded messages ({messages.length}) {open ? "▲" : "▼"}</button>
      <button className={recorder ? "on" : ""} onClick={toggle}>{recorder ? "Stop and save" : "Record new"}</button>
      {error && <span className="err"> {error}</span>}
      {open && <ul>{messages.map((m) => (
        <li key={m.id}><span>{m.name}</span><button onClick={() => confirm(`Delete "${m.name}"?`) && deleteMessage(m.id).then(reload)}>Delete</button></li>
      ))}{!messages.length && <li><small>No messages yet. Play them from any switched-on channel.</small></li>}</ul>}
    </div>
  );
}

export default function Console() {
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [onSet] = useState(loadOn);
  const reload = () => listMessages().then(setMessages).catch(() => {});

  useEffect(() => {
    listZonesAndChannels().then(({ zones, channels }) => {
      const order = new Map(zones.map((z, i) => [z.id, z.display_order ?? i]));
      setChannels(channels.filter((c) => c.enabled !== false).map((c) => {
        const zoneName = zones.find((z) => z.id === c.zone_id)?.name || "Radio";
        return { ...c, zoneId: c.zone_id, zoneName, label: `${zoneName} · ${c.name}`, zoneOrder: order.get(c.zone_id) ?? 999 };
      }).sort((a, b) => a.zoneOrder - b.zoneOrder || (a.number ?? 0) - (b.number ?? 0)));
    }).catch((e) => setError(e?.message || "Could not load channels."));
    reload();
  }, []);

  const remember = (id, on) => { if (on) onSet.add(id); else onSet.delete(id); saveOn(onSet); };

  return (
    <div>
      {error && <p className="err">{error}</p>}
      <MessagesBar messages={messages} reload={reload} />
      <div className="console">
        <div className="grid">
          {channels.map((c) => <ChannelCard key={c.id} channel={c} startOn={onSet.has(c.id)} onChange={remember} messages={messages} />)}
        </div>
        <RosterPanel channels={channels} />
      </div>
    </div>
  );
}

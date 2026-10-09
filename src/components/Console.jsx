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
const hhmmss = (d) => d.toLocaleTimeString([], { hour12: false });

const Bolt = () => <svg viewBox="0 0 12 18" aria-hidden="true"><path d="M7.5 0 0 10h4.5L3.5 18 12 7H7.2z" fill="currentColor" /></svg>;

// One channel as a tile: the bolt is the transmit key (hold), the body switches listening on or off,
// and the arrow opens volume, recorded messages and the switch.
function ChannelTile({ channel, startOn, onChange, messages, reg, onActivity, onNotice }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(1);
  const [onAir, setOnAir] = useState([]);
  const [people, setPeople] = useState(0);
  const [keyed, setKeyed] = useState(false);
  const [menu, setMenu] = useState(false);
  const mon = useRef(null);      // listening connection: { room, audio }
  const tx = useRef(null);       // send connection, opened the first time the key is used
  const mic = useRef(null);
  const key = useRef(0);
  const vol = useRef(1);
  const sending = useRef(false);

  const turnOn = async () => {
    if (mon.current) return;
    setBusy(true);
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
        onActivity({ unit: who(p), channel: channel.name, at: new Date() });
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
        track.detach().forEach((e) => e.remove()); entry.audio.delete(p.identity);
        setOnAir((l) => l.filter((n) => n !== who(p)));
      });
      room.on(RoomEvent.Disconnected, () => { if (mon.current === entry) turnOff(false); });
      await room.connect(s.liveKitUrl, s.liveKitToken);
      count(); setOn(true); onChange(channel.id, true);
    } catch (e) { mon.current = null; onNotice(`${channel.name}: ${e?.message || "could not listen to this channel."}`); }
    setBusy(false);
  };

  const turnOff = async (persist = true) => {
    await release();
    const entry = mon.current; mon.current = null;
    if (entry) { for (const el of entry.audio.values()) el.remove(); entry.room.disconnect(); }
    const link = tx.current; tx.current = null;
    link?.disconnect();
    setOn(false); setOnAir([]); setPeople(0); setKeyed(false); setMenu(false);
    if (persist) onChange(channel.id, false);
  };

  useEffect(() => { if (startOn) turnOn(); return () => { turnOff(false); }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const changeVolume = (v) => { vol.current = v; setVolume(v); for (const el of mon.current?.audio.values() || []) el.volume = v; };

  const sendLink = async () => {
    if (!tx.current) { const l = new ChannelLink(channel, { listen: false }); await l.connect(); tx.current = l; }
    if (!tx.current.canTransmit) throw new Error("this account has no verified callsign, so it can't transmit.");
    return tx.current;
  };

  // Hold to talk. A release before the floor is granted cancels the attempt cleanly.
  const down = async () => {
    if (!on || sending.current) return;
    sending.current = true;
    const mine = ++key.current;
    try {
      const l = await sendLink();
      if (key.current !== mine) return;
      await l.begin();
      if (key.current !== mine) { await l.end(); return; }
      mic.current = await openMic();
      if (key.current !== mine) { mic.current.stop(); mic.current = null; await l.end(); return; }
      await l.publish(mic.current);
      setKeyed(true);
      onActivity({ unit: "Dispatch (you)", channel: channel.name, at: new Date() });
    } catch (e) { onNotice(`${channel.name}: ${e?.message || "could not transmit."}`); await release(); }
    finally { if (key.current === mine && !mic.current) sending.current = false; }
  };
  async function release() {
    key.current++;
    const m = mic.current; mic.current = null;
    if (m) { await tx.current?.unpublish(m); m.stop(); }
    await tx.current?.end();
    setKeyed(false); sending.current = false;
  }

  const play = async (id) => {
    const m = messages.find((x) => x.id === id);
    if (!m || !on || sending.current) return;
    sending.current = true; setMenu(false);
    onNotice(`${channel.name}: playing "${m.name}"`);
    let audio = null;
    try {
      const l = await sendLink();
      await l.begin();
      audio = await playableTrack(m.blob);
      await l.publish(audio.track);
      setKeyed(true); audio.start(); await audio.done;
    } catch (e) { onNotice(`${channel.name}: ${e?.message || "could not play the message."}`); }
    finally {
      if (audio) { await tx.current?.unpublish(audio.track); audio.close(); }
      await tx.current?.end();
      setKeyed(false); sending.current = false;
    }
  };

  // The console's General Transmit key drives every tile that is on.
  reg.current[channel.id] = { isOn: on, down, release };

  let state = on ? "on" : "off";
  if (busy) state = "wait";
  else if (keyed) state = "tx";
  else if (on && onAir.length) state = "rx";
  const sub = busy ? "Connecting…" : keyed ? "Transmitting" : onAir.length ? onAir.join(", ") : on ? `${people} ${people === 1 ? "person" : "people"}` : "Off";

  return (
    <div className={"tile " + state}>
      <button className="bolt" title="Hold to talk" disabled={!on} onPointerDown={down} onPointerUp={release} onPointerLeave={() => (keyed || sending.current) && release()}><Bolt /></button>
      <div className="tbody" onClick={() => !busy && (on ? turnOff() : turnOn())} title={on ? "Click to switch off" : "Click to listen"}>
        <div className="tname">{channel.name}</div>
        <div className="tsub">CH {channel.number ?? ""} · {sub}</div>
      </div>
      <span className="tbadge">{on ? `V${Math.round(volume * 10)}` : ""}</span>
      <button className="tmenu" title="Volume, messages" onClick={() => setMenu(!menu)}>▾</button>
      {menu && (
        <div className="tpop">
          <label>Volume
            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => changeVolume(Number(e.target.value))} />
          </label>
          {messages.length > 0 && (
            <select value="" disabled={!on || keyed} onChange={(e) => e.target.value && play(e.target.value)}>
              <option value="">Play a recorded message…</option>
              {messages.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <button onClick={() => (on ? turnOff() : turnOn())}>{on ? "Switch off" : "Switch on"}</button>
        </div>
      )}
    </div>
  );
}

function ActivityLog({ items }) {
  const [sel, setSel] = useState(null);
  return (
    <section className="axspanel activity">
      <h3>Activity Log</h3>
      <div className="logtable">
        <div className="logrow head"><span>Unit</span><span>Time</span><span>Channel</span></div>
        <div className="logbody">
          {!items.length && <div className="logempty">Nothing heard yet. Switch channels on to listen.</div>}
          {items.map((a, i) => (
            <div key={a.id} className={"logrow" + (i === 0 ? " latest" : "") + (sel === a.id ? " sel" : "")} onClick={() => setSel(a.id)}>
              <span>▸ {a.unit}</span><span>{hhmmss(a.at)}</span><span>{a.channel}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Everyone on the radio, with their status and channel. Dispatch can send a radio to another channel.
function OnlinePanel({ channels }) {
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
    <div>
      {error && <p className="err">{error}</p>}
      {notice && <p><small>{notice}</small></p>}
      {!users.length && !error && <p><small>Nobody is on the radio right now.</small></p>}
      <ul>{sorted.map((u) => (
        <li key={u.identity} className="person">
          <div>
            <strong>{u.callsign || u.displayName}</strong>
            {u.status && <span className={"chip st-" + String(u.status).toLowerCase().replace(/[^a-z]+/g, "-")}>{u.status}</span>}
            <br /><small>{label(u.channelId)}</small>
          </div>
          <select value="" onChange={(e) => move(u, e.target.value)}>
            <option value="">Move…</option>
            {channels.filter((c) => c.id !== u.channelId).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </li>
      ))}</ul>
      <span className="count">{users.length} online</span>
    </div>
  );
}

// Recorded messages live on this computer and can be played onto any channel that is switched on.
function MessagesPanel({ messages, reload, onNotice }) {
  const [recorder, setRecorder] = useState(null);
  const toggle = async () => {
    try {
      if (!recorder) { setRecorder(await recordMessage()); return; }
      const blob = await recorder.stop(); setRecorder(null);
      const name = prompt("Name this message:", "Message " + (messages.length + 1));
      if (name) { await saveMessage(name, blob); await reload(); }
    } catch (e) { setRecorder(null); onNotice(e?.message || "Could not record."); }
  };
  return (
    <div>
      <button className={recorder ? "on" : ""} onClick={toggle}>{recorder ? "Stop and save" : "Record new"}</button>
      <ul>{messages.map((m) => (
        <li key={m.id}><span>{m.name}</span><button onClick={() => confirm(`Delete "${m.name}"?`) && deleteMessage(m.id).then(reload)}>Delete</button></li>
      ))}</ul>
      {!messages.length && <p><small>No messages yet. Play them from the ▾ menu of any channel that is switched on.</small></p>}
    </div>
  );
}

export default function Console() {
  const [zones, setZones] = useState([]);
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [notice, setNotice] = useState("Ready.");
  const [activity, setActivity] = useState([]);
  const [side, setSide] = useState("online");
  const [onCount, setOnCount] = useState(0);
  const [onSet] = useState(loadOn);
  const reg = useRef({});
  const reload = () => listMessages().then(setMessages).catch(() => {});

  useEffect(() => {
    listZonesAndChannels().then(({ zones, channels }) => {
      const order = new Map(zones.map((z, i) => [z.id, z.display_order ?? i]));
      const list = channels.filter((c) => c.enabled !== false).map((c) => {
        const zoneName = zones.find((z) => z.id === c.zone_id)?.name || "Radio";
        return { ...c, zoneId: c.zone_id, zoneName, label: `${zoneName} · ${c.name}`, zoneOrder: order.get(c.zone_id) ?? 999 };
      }).sort((a, b) => a.zoneOrder - b.zoneOrder || (a.number ?? 0) - (b.number ?? 0));
      setChannels(list);
      const seen = [];
      for (const c of list) if (!seen.some((z) => z.id === c.zoneId)) seen.push({ id: c.zoneId, name: c.zoneName });
      setZones(seen);
    }).catch((e) => setNotice(e?.message || "Could not load channels."));
    reload();
  }, []);

  const remember = (id, on) => { if (on) onSet.add(id); else onSet.delete(id); saveOn(onSet); setOnCount(onSet.size); };
  useEffect(() => { setOnCount(onSet.size); }, [onSet]);
  const addActivity = (a) => setActivity((l) => [{ ...a, id: a.at.getTime() + Math.random() }, ...l].slice(0, 200));
  const general = (down) => { for (const t of Object.values(reg.current)) if (t.isOn) (down ? t.down() : t.release()); };

  return (
    <div className="axs">
      <div className="axstools">
        <button className="gt" title="Hold to talk on every channel that is on" onPointerDown={() => general(true)} onPointerUp={() => general(false)} onPointerLeave={() => general(false)}>
          <Bolt /><span>GENERAL TRANSMIT</span>
        </button>
        <div className="axsinfo"><b>{onCount}</b><span>CHANNELS ON</span></div>
        <div className="axsinfo"><b>{messages.length}</b><span>MESSAGES</span></div>
      </div>
      <div className="axsmain">
        <div className="axsleft">
          <div className="zones">
            {zones.map((z, i) => (
              <section key={z.id} className={"zone z" + (i % 6)}>
                <header>{z.name}</header>
                <div className="tiles">
                  {channels.filter((c) => c.zoneId === z.id).map((c) => (
                    <ChannelTile key={c.id} channel={c} startOn={onSet.has(c.id)} onChange={remember} messages={messages} reg={reg} onActivity={addActivity} onNotice={setNotice} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="axsright">
          <ActivityLog items={activity} />
          <section className="axspanel">
            <div className="axstabs">
              <button className={side === "online" ? "on" : ""} onClick={() => setSide("online")}>Online</button>
              <button className={side === "messages" ? "on" : ""} onClick={() => setSide("messages")}>Messages</button>
            </div>
            <div className="sidebody">
              {side === "online" ? <OnlinePanel channels={channels} /> : <MessagesPanel messages={messages} reload={reload} onNotice={setNotice} />}
            </div>
          </section>
        </div>
      </div>
      <div className="axsstatus"><span>{notice}</span>{notice !== "Ready." && <button onClick={() => setNotice("Ready.")}>✕</button>}</div>
    </div>
  );
}

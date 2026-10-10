import { useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import { listZonesAndChannels, issueMonitorSession, dispatchRoster, dispatchMove } from "../lib/auth";
import { ChannelLink, openMic } from "../lib/channelLink";
import { applySink } from "../lib/prefs";
import { listMessages, saveMessage, deleteMessage, recordMessage, playableTrack } from "../lib/messages";
import { playableTone, playLocal } from "../lib/tones";
import { loadLayout, saveLayout, loadTones, saveTones, zoneFolders, resolveTab } from "../lib/layout";
import { Icon } from "../lib/icons";
import LayoutEditor from "./LayoutEditor";
import { startDeck } from "../lib/deck";

const who = (p) => { try { const m = p?.metadata ? JSON.parse(p.metadata) : {}; return m.radioCallsign || m.callsign || m.displayName || p?.name || p?.identity; } catch { return p?.name || p?.identity; } };
const ON_KEY = "dispatch-channels-on";
const loadOn = () => { try { return new Set(JSON.parse(localStorage.getItem(ON_KEY) || "[]")); } catch { return new Set(); } };
const saveOn = (set) => { try { localStorage.setItem(ON_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ } };
const hhmmss = (d) => d.toLocaleTimeString([], { hour12: false });

const Bolt = () => <svg viewBox="0 0 12 18" aria-hidden="true"><path d="M7.5 0 0 10h4.5L3.5 18 12 7H7.2z" fill="currentColor" /></svg>;

// The connection side of one channel. It always runs (whatever folder or tab is showing) so a channel that
// is on never drops when its tile moves; the tile is only a view of the state this publishes.
function ChannelEngine({ channel, startOn, reg, ctl }) {
  const mon = useRef(null);      // listening connection: { room, audio }
  const tx = useRef(null);       // send connection, opened the first time the key is used
  const mic = useRef(null);
  const key = useRef(0);
  const vol = useRef(1);
  const sending = useRef(false);
  const air = useRef([]);
  const onRef = useRef(false);
  const set = (p) => ctl.patch(channel.id, p);
  const setAir = (list) => { air.current = list; set({ onAir: list }); };

  const turnOn = async () => {
    if (mon.current) return;
    set({ busy: true });
    try {
      const s = await issueMonitorSession(channel);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      const entry = { room, audio: new Map() };
      mon.current = entry;
      // Our own console joins as a radio when it transmits; don't count that as another person.
      const mine = (p) => { try { const me = ctl.selfId(); return !!me && JSON.parse(p.metadata || "{}").userId === me; } catch { return false; } };
      const count = () => set({ people: [...room.remoteParticipants.values()].filter((p) => !mine(p)).length });
      room.on(RoomEvent.ParticipantConnected, count);
      room.on(RoomEvent.ParticipantDisconnected, (p) => { entry.audio.delete(p.identity); setAir(air.current.filter((n) => n !== who(p))); count(); });
      room.on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        if (track.kind !== "audio") return;
        const el = track.attach(); el.autoplay = true; el.style.display = "none"; el.volume = vol.current; applySink(el); document.body.appendChild(el);
        entry.audio.set(p.identity, el);
        setAir([...new Set([...air.current, who(p)])]);
        set({ lastAt: Date.now() });
        ctl.activity({ unit: who(p), channel: channel.name, at: new Date() });
        ctl.alert(channel.id);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
        track.detach().forEach((e) => e.remove()); entry.audio.delete(p.identity);
        setAir(air.current.filter((n) => n !== who(p)));
      });
      room.on(RoomEvent.Disconnected, () => { if (mon.current === entry) turnOff(false); });
      await room.connect(s.liveKitUrl, s.liveKitToken);
      onRef.current = true; set({ on: true }); count(); ctl.remember(channel.id, true);
    } catch (e) { mon.current = null; ctl.notice(`${channel.name}: ${e?.message || "could not listen to this channel."}`); }
    set({ busy: false });
  };

  const turnOff = async (persist = true) => {
    await release();
    const entry = mon.current; mon.current = null;
    if (entry) { for (const el of entry.audio.values()) el.remove(); entry.room.disconnect(); }
    const link = tx.current; tx.current = null;
    link?.disconnect();
    onRef.current = false; air.current = [];
    set({ on: false, onAir: [], people: 0, keyed: false });
    if (persist) ctl.remember(channel.id, false);
  };

  useEffect(() => { if (startOn) turnOn(); return () => { turnOff(false); }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const setVolume = (v) => { vol.current = v; set({ volume: v }); for (const el of mon.current?.audio.values() || []) el.volume = v; };

  const sendLink = async () => {
    if (!tx.current) { const l = new ChannelLink(channel, { listen: false }); await l.connect(); tx.current = l; }
    if (!tx.current.canTransmit) throw new Error("this account has no verified callsign, so it can't transmit.");
    return tx.current;
  };

  // Hold to talk. A release before the floor is granted cancels the attempt cleanly.
  const down = async () => {
    if (!onRef.current || sending.current) return;
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
      set({ keyed: true, lastAt: Date.now() });
      ctl.activity({ unit: "Dispatch (you)", channel: channel.name, at: new Date() });
    } catch (e) { ctl.notice(`${channel.name}: ${e?.message || "could not transmit."}`); await release(); }
    finally { if (key.current === mine && !mic.current) sending.current = false; }
  };
  async function release() {
    key.current++;
    const m = mic.current; mic.current = null;
    if (m) { await tx.current?.unpublish(m); m.stop(); }
    await tx.current?.end();
    set({ keyed: false }); sending.current = false;
  }

  // Sends recorded or generated audio onto the channel. `make` returns { track, start, done, close }.
  const playOut = async (label, make) => {
    if (!onRef.current || sending.current) return;
    sending.current = true;
    ctl.notice(`${channel.name}: sending ${label}`);
    let audio = null;
    try {
      const l = await sendLink();
      await l.begin();
      audio = await make();
      await l.publish(audio.track);
      set({ keyed: true, lastAt: Date.now() });
      ctl.activity({ unit: `Dispatch (${label})`, channel: channel.name, at: new Date() });
      audio.start(); await audio.done;
    } catch (e) { ctl.notice(`${channel.name}: ${e?.message || "could not send."}`); }
    finally {
      if (audio) { await tx.current?.unpublish(audio.track); audio.close(); }
      await tx.current?.end();
      set({ keyed: false }); sending.current = false;
    }
  };

  reg.current[channel.id] = {
    get isOn() { return onRef.current; },
    turnOn, turnOff, down, release, setVolume,
    playMessage: (m) => playOut(`"${m.name}"`, () => playableTrack(m.blob)),
    playTone: (t) => playOut(t.name, () => playableTone(t)),
  };
  return null;
}

// One channel as a tile: the bolt is the transmit key (hold), the body switches listening on or off,
// and the arrow opens volume, messages, tones and the alert setting.
function ChannelTile({ channel, st, cfg, color, reg, ctl, messages, tones }) {
  const [menu, setMenu] = useState(false);
  const { on, busy, keyed, onAir = [], people = 0, volume = 1 } = st;
  const A = () => reg.current[channel.id]; // read when used: the engine registers itself while rendering
  let state = on ? "on" : "off";
  if (busy) state = "wait";
  else if (keyed) state = "tx";
  else if (on && onAir.length) state = "rx";
  const name = cfg.label || channel.name;
  const sub = busy ? "Connecting…" : keyed ? "Transmitting" : onAir.length ? onAir.join(", ") : on ? `${people} ${people === 1 ? "person" : "people"}` : "Off";

  return (
    <div className={"tile " + state} style={color ? { "--tc": color } : undefined}>
      <button className="bolt" title="Hold to talk" disabled={!on} onPointerDown={() => A()?.down()} onPointerUp={() => A()?.release()} onPointerLeave={() => (keyed || st.busy) && A()?.release()}><Bolt /></button>
      <div className="tbody" onClick={() => !busy && (on ? A()?.turnOff() : A()?.turnOn())} title={on ? "Click to switch off" : "Click to listen"}>
        <div className="tname">{cfg.icon && cfg.icon !== "none" && <Icon id={cfg.icon} />} {name}</div>
        <div className="tsub">CH {channel.number ?? ""} · {sub}</div>
      </div>
      <span className="tbadge">{on ? `V${Math.round(volume * 10)}` : ""}</span>
      <button className="tmenu" title="Volume, messages, tones, alert" onClick={() => setMenu(!menu)}>▾</button>
      {menu && (
        <div className="tpop">
          <label>Volume
            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => A()?.setVolume(Number(e.target.value))} />
          </label>
          <select value="" disabled={!on || keyed || !messages.length} onChange={(e) => { const m = messages.find((x) => x.id === e.target.value); if (m) { setMenu(false); A()?.playMessage(m); } }}>
            <option value="">{messages.length ? "Play a recorded message…" : "No recorded messages"}</option>
            {messages.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value="" disabled={!on || keyed} onChange={(e) => { const t = tones.find((x) => x.id === e.target.value); if (t) { setMenu(false); A()?.playTone(t); } }}>
            <option value="">Send a tone…</option>
            {tones.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label>Alert when heard
            <select value={cfg.alert || ""} onChange={(e) => { ctl.setChannelCfg(channel.id, { alert: e.target.value }); if (e.target.value) playLocal(tones.find((t) => t.id === e.target.value) || tones[0]); }}>
              <option value="">No alert</option>
              {tones.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <button onClick={() => { setMenu(false); on ? A()?.turnOff() : A()?.turnOn(); }}>{on ? "Switch off" : "Switch on"}</button>
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
function OnlinePanel({ channels, selfId }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const label = (id) => channels.find((c) => c.id === id)?.label || "Unknown channel";

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try { const r = await dispatchRoster(); if (!stop) { setUsers((r?.users || []).filter((u) => !selfId || u.userId !== selfId)); setError(""); } }
      catch (e) { if (!stop) setError(e?.message || "Could not load the roster."); }
    };
    poll(); const t = setInterval(poll, 5000);
    return () => { stop = true; clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId]);

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

export default function Console({ selfId }) {
  const [zones, setZones] = useState([]);
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [notice, setNotice] = useState("Ready.");
  const [activity, setActivity] = useState([]);
  const [side, setSide] = useState("online");
  const [states, setStates] = useState({});
  const [layout, setLayoutState] = useState(loadLayout);
  const [tones, setTonesState] = useState(loadTones);
  const [activeTab, setActiveTab] = useState({});
  const [editor, setEditor] = useState(false);
  const [toneMenu, setToneMenu] = useState(false);
  const [toneId, setToneId] = useState("");
  const [onSet] = useState(loadOn);
  const [, tick] = useState(0);
  const reg = useRef({});
  const live = useRef({});
  live.current = { layout, tones, selfId };

  const setLayout = (l) => { setLayoutState(l); saveLayout(l); };
  const setTones = (t) => { setTonesState(t); saveTones(t); };
  const reload = () => listMessages().then(setMessages).catch(() => {});

  // A stable handle the channel engines use to report back; it reads the latest layout through refs.
  const ctl = useMemo(() => ({
    patch: (id, p) => setStates((s) => ({ ...s, [id]: { ...(s[id] || {}), ...p } })),
    activity: (a) => setActivity((l) => [{ ...a, id: a.at.getTime() + Math.random() }, ...l].slice(0, 200)),
    notice: setNotice,
    selfId: () => live.current.selfId,
    remember: (id, on) => { if (on) onSet.add(id); else onSet.delete(id); saveOn(onSet); },
    alert: (id) => {
      const { layout: l, tones: t } = live.current;
      if (l.alertsOn === false) return;
      const tone = t.find((x) => x.id === l.channels?.[id]?.alert);
      if (tone) playLocal(tone);
    },
    setChannelCfg: (id, patch) => { const l = live.current.layout; setLayout({ ...l, channels: { ...l.channels, [id]: { ...(l.channels?.[id] || {}), ...patch } } }); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

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
    // A layout imported or reset in Settings.
    const changed = () => { setLayoutState(loadLayout()); setTonesState(loadTones()); };
    window.addEventListener("dispatch-layout-changed", changed);
    // Dynamic tabs ("heard recently") change with time, so look again every 15 seconds.
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => { window.removeEventListener("dispatch-layout-changed", changed); clearInterval(t); };
  }, []);

  const folders = layout.mode === "custom" ? layout.folders : zoneFolders(zones, layout);
  const onCount = channels.filter((c) => states[c.id]?.on).length;
  const general = (down) => { for (const t of Object.values(reg.current)) if (t.isOn) (down ? t.down() : t.release()); };
  const sendToneNow = (t) => {
    const ids = channels.filter((c) => states[c.id]?.on).map((c) => c.id);
    if (!ids.length) { setNotice("Switch a channel on first, then send the tone."); return; }
    ids.forEach((id) => reg.current[id]?.playTone(t));
  };
  const sendTone = () => { const t = tones.find((x) => x.id === toneId); if (!t) return; sendToneNow(t); setToneMenu(false); };

  // Stream Deck: the plugin sends key presses and gets the console's state (see lib/deck.js). Switched on in Settings.
  const [deckOn, setDeckOn] = useState(() => { try { return localStorage.getItem("dispatch-deck") === "1" && !!window.__TAURI_INTERNALS__; } catch { return false; } });
  const deckRef = useRef(null), deckCmd = useRef(null);
  deckCmd.current = (m) => {
    const ch = channels[(Number(m.slot) || 1) - 1], a = ch && reg.current[ch.id];
    switch (m.op) {
      case "listen": if (m.pressed && a) (a.isOn ? a.turnOff() : a.turnOn()); break;
      case "ptt": if (a) (m.pressed ? a.down() : a.release()); break;
      case "general": general(!!m.pressed); break;
      case "tone": { const t = tones[(Number(m.index) || 1) - 1]; if (m.pressed && t) sendToneNow(t); break; }
      case "message": {
        const msg = messages[(Number(m.index) || 1) - 1];
        if (m.pressed && msg) for (const c of channels) if (states[c.id]?.on) reg.current[c.id]?.playMessage(msg);
        break;
      }
      case "alerts": if (m.pressed) setLayout({ ...layout, alertsOn: layout.alertsOn === false }); break;
      default: break;
    }
  };
  useEffect(() => {
    const changed = () => { try { setDeckOn(localStorage.getItem("dispatch-deck") === "1" && !!window.__TAURI_INTERNALS__); } catch { /* ignore */ } };
    window.addEventListener("dispatch-deck-changed", changed);
    return () => window.removeEventListener("dispatch-deck-changed", changed);
  }, []);
  useEffect(() => {
    if (!deckOn) return undefined;
    const d = startDeck({ app: "dispatch", version: String(__APP_VERSION__), onCommand: (m) => deckCmd.current?.(m) });
    deckRef.current = d;
    return () => { d.stop(); deckRef.current = null; };
  }, [deckOn]);
  const deckJson = JSON.stringify({
    onCount, alertsOn: layout.alertsOn !== false, tx: channels.some((c) => states[c.id]?.keyed),
    tones: tones.map((t) => ({ id: t.id, name: t.name })), messages: messages.map((m) => ({ id: m.id, name: m.name })),
    channels: channels.map((c) => { const st = states[c.id] || {}; const cfg = layout.channels?.[c.id] || {}; return { id: c.id, name: cfg.label || c.name, on: !!st.on, rx: !!st.on && (st.onAir || []).length > 0, rxName: (st.onAir || [])[0] || "", tx: !!st.keyed, people: st.people || 0, color: cfg.color || "" }; }),
  });
  useEffect(() => { deckRef.current?.send(JSON.parse(deckJson)); }, [deckJson, deckOn]);

  return (
    <div className="axs">
      <div className="axstools">
        <button className="gt" title="Hold to talk on every channel that is on" onPointerDown={() => general(true)} onPointerUp={() => general(false)} onPointerLeave={() => general(false)}>
          <Bolt /><span>GENERAL TRANSMIT</span>
        </button>
        <div className="toolwrap">
          <button className="tool" onClick={() => { setToneMenu(!toneMenu); if (!toneId && tones[0]) setToneId(tones[0].id); }}><span className="ti">♪</span><span>TONE</span></button>
          {toneMenu && (
            <div className="tpop toolpop">
              <label>Tone to send
                <select value={toneId} onChange={(e) => setToneId(e.target.value)}>{tones.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </label>
              <small>Sends on every channel that is on ({onCount}).</small>
              <button className="on" onClick={sendTone}>Send tone</button>
            </div>
          )}
        </div>
        <button className={"tool" + (layout.alertsOn === false ? " dim" : "")} title="Play the alert tones you set for channels when they are heard" onClick={() => setLayout({ ...layout, alertsOn: layout.alertsOn === false })}>
          <span className="ti">🔔</span><span>ALERTS {layout.alertsOn === false ? "OFF" : "ON"}</span>
        </button>
        <button className="tool" onClick={() => setEditor(true)}><span className="ti">⚙</span><span>CONFIGURE</span></button>
        <div className="axsinfo"><b>{onCount}</b><span>CHANNELS ON</span></div>
        <div className="axsinfo"><b>{messages.length}</b><span>MESSAGES</span></div>
      </div>
      <div className="axsmain">
        <div className="axsleft">
          <div className="zones">
            {folders.map((f) => {
              const tab = f.tabs.find((t) => t.id === activeTab[f.id]) || f.tabs[0];
              const list = tab ? resolveTab(tab, channels, states) : [];
              return (
                <section key={f.id} className="zone" style={{ "--zc": f.accent, "--tc": f.tile }}>
                  <header className="ztabs">
                    {f.tabs.map((t) => (
                      <button key={t.id} className={t.id === tab?.id ? "on" : ""} onClick={() => setActiveTab({ ...activeTab, [f.id]: t.id })}>{f.tabs.length === 1 ? f.name : t.name}</button>
                    ))}
                  </header>
                  <div className="tiles">
                    {list.map((c) => (
                      <ChannelTile key={c.id} channel={c} st={states[c.id] || {}} cfg={layout.channels?.[c.id] || {}} color={layout.channels?.[c.id]?.color} reg={reg} ctl={ctl} messages={messages} tones={tones} />
                    ))}
                    {!list.length && <div className="ztempty">No channels here right now.</div>}
                  </div>
                </section>
              );
            })}
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
              {side === "online" ? <OnlinePanel channels={channels} selfId={selfId} /> : <MessagesPanel messages={messages} reload={reload} onNotice={setNotice} />}
            </div>
          </section>
        </div>
      </div>
      <div className="axsstatus"><span>{notice}</span>{notice !== "Ready." && <button onClick={() => setNotice("Ready.")}>✕</button>}</div>
      {/* Every channel's connection runs here, whichever folder or tab is showing. */}
      {channels.map((c) => <ChannelEngine key={c.id} channel={c} startOn={onSet.has(c.id)} reg={reg} ctl={ctl} />)}
      {editor && <LayoutEditor layout={layout} setLayout={setLayout} tones={tones} setTones={setTones} zones={zones} channels={channels} onClose={() => setEditor(false)} />}
    </div>
  );
}

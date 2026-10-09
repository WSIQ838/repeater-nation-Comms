import { useEffect, useRef, useState } from "react";
import { listZonesAndChannels } from "../lib/auth";
import { ChannelLink, openMic } from "../lib/channelLink";
import { listMessages, saveMessage, deleteMessage, recordMessage, playableTrack } from "../lib/messages";

// Dispatch transmits on one channel at a time: hold to talk, or play a recorded message.
export default function Talk() {
  const [channels, setChannels] = useState([]);
  const [selected, setSelected] = useState("");
  const [link, setLink] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [keyed, setKeyed] = useState(false);
  const [messages, setMessages] = useState([]);
  const [recorder, setRecorder] = useState(null);
  const micRef = useRef(null);
  const busyRef = useRef(false);
  const linkRef = useRef(null);
  linkRef.current = link;

  useEffect(() => {
    listZonesAndChannels().then(({ zones, channels }) => setChannels(
      channels.filter((c) => c.enabled !== false).map((c) => ({ ...c, zoneId: c.zone_id, zoneName: zones.find((z) => z.id === c.zone_id)?.name || "Radio" }))
    )).catch((e) => setError(e?.message || "Could not load channels."));
    listMessages().then(setMessages).catch(() => {});
    return () => { linkRef.current?.disconnect(); };
  }, []);

  const join = async () => {
    const channel = channels.find((c) => c.id === selected);
    if (!channel) return;
    setError(""); setStatus("Connecting…");
    try {
      const l = new ChannelLink(channel);
      await l.connect();
      setLink(l); setStatus("");
      if (!l.canTransmit) setError("Connected to listen only: this account has no verified callsign, so it can't transmit.");
    } catch (e) { setStatus(""); setError(e?.message || "Could not join the channel."); }
  };
  const leave = async () => { const l = link; setLink(null); setKeyed(false); await l?.disconnect(); };

  const down = async () => {
    if (!link || busyRef.current) return;
    busyRef.current = true; setError("");
    try { await link.begin(); micRef.current = await openMic(); await link.publish(micRef.current); setKeyed(true); }
    catch (e) { setError(e?.message || "Could not transmit."); await up(); }
  };
  const up = async () => {
    const mic = micRef.current; micRef.current = null;
    if (mic) { await link?.unpublish(mic); mic.stop(); }
    await link?.end();
    setKeyed(false); busyRef.current = false;
  };

  const play = async (m) => {
    if (!link || busyRef.current) return;
    busyRef.current = true; setError("");
    let audio = null;
    try {
      await link.begin();
      audio = await playableTrack(m.blob);
      await link.publish(audio.track);
      setKeyed(true); setStatus(`Playing "${m.name}"`);
      audio.start(); await audio.done;
    } catch (e) { setError(e?.message || "Could not play the message."); }
    finally {
      if (audio) { await link.unpublish(audio.track); audio.close(); }
      await link.end();
      setKeyed(false); setStatus(""); busyRef.current = false;
    }
  };

  const toggleRecord = async () => {
    try {
      if (!recorder) { setRecorder(await recordMessage()); return; }
      const blob = await recorder.stop(); setRecorder(null);
      const name = prompt("Name this message:", "Message " + (messages.length + 1));
      if (name) { await saveMessage(name, blob); setMessages(await listMessages()); }
    } catch (e) { setRecorder(null); setError(e?.message || "Could not record."); }
  };

  return (
    <div className="grid wide">
      {error && <p className="err">{error}</p>}
      <section className="card">
        <h2>Talk</h2>
        {!link ? (
          <>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Channel…</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.zoneName} · {c.name}</option>)}
            </select>
            <button disabled={!selected} onClick={join}>Join channel</button>
            <p>{status}</p>
          </>
        ) : (
          <>
            <p><strong>{link.channel.zoneName} · {link.channel.name}</strong> {status && `· ${status}`}</p>
            <button className={"ptt" + (keyed ? " on" : "")} disabled={!link.canTransmit}
              onPointerDown={down} onPointerUp={up} onPointerLeave={() => keyed && up()}>
              {keyed ? "TRANSMITTING" : "Hold to talk"}
            </button>
            <button onClick={leave}>Leave channel</button>
          </>
        )}
      </section>
      <section className="card">
        <h2>Recorded messages</h2>
        <button onClick={toggleRecord}>{recorder ? "Stop and save" : "Record new"}</button>
        <ul>{messages.map((m) => (
          <li key={m.id}>
            <span>{m.name}</span>
            <button disabled={!link || !link.canTransmit || keyed} onClick={() => play(m)}>Play on channel</button>
            <button onClick={() => confirm(`Delete "${m.name}"?`) && deleteMessage(m.id).then(listMessages).then(setMessages)}>Delete</button>
          </li>
        ))}</ul>
        {!messages.length && <p>No messages yet.</p>}
        {!link && messages.length > 0 && <small>Join a channel to play messages on it.</small>}
      </section>
    </div>
  );
}

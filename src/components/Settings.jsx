import { useEffect, useState } from "react";
import { getMicId, getSpeakerId, setMicId, setSpeakerId } from "../lib/prefs";
import { UPDATE_EVERY, loadUpdateEvery, openLink, runUpdateCheck, saveUpdateEvery, useUpdateState } from "../lib/updates";
import { exportAll, importAll, resetLayoutStorage } from "../lib/layout";

export default function Settings({ member, onSignOut }) {
  const [devices, setDevices] = useState([]);
  const [mic, setMic] = useState(getMicId());
  const [speaker, setSpeaker] = useState(getSpeakerId());
  const { update: state, checking, error } = useUpdateState();
  const [every, setEvery] = useState(loadUpdateEvery);
  const [layoutText, setLayoutText] = useState("");
  const [layoutMsg, setLayoutMsg] = useState("");
  const [deckOn, setDeckOn] = useState(() => { try { return localStorage.getItem("dispatch-deck") === "1"; } catch { return false; } });

  const loadDevices = async () => {
    try {
      // Names are blank until the browser has been allowed to use the microphone once.
      try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch { /* names stay blank */ }
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch { /* no devices available */ }
  };
  useEffect(() => { loadDevices(); }, []);

  const check = () => runUpdateCheck();

  return (
    <div className="grid wide">
      <section className="card">
        <h2>Updates</h2>
        <p>Installed version: <strong>{__APP_VERSION__}</strong></p>
        {state && !state.available && <p>You have the latest version{state.latest ? ` (${state.latest})` : ""}.</p>}
        {state?.available && <p><strong>Version {state.latest} is available.</strong></p>}
        {error && <p className="err">{error}</p>}
        <button onClick={check} disabled={checking}>{checking ? "Checking…" : "Check for updates"}</button>
        {state?.available && <button className="on" onClick={() => openLink(state.download)}>Download update</button>}
        {state?.available && <small>Download and run the installer; it replaces this version. Sign-in is kept.</small>}
        <label><br />Check for updates automatically<br />
          <select value={every} onChange={(e) => { setEvery(e.target.value); saveUpdateEvery(e.target.value); }}>
            {UPDATE_EVERY.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <small>When a check finds a newer version, a pop-up offers to download it.</small>
      </section>
      <section className="card">
        <h2>Audio</h2>
        <label>Microphone<br />
          <select value={mic} onChange={(e) => { setMic(e.target.value); setMicId(e.target.value); }}>
            <option value="">System default</option>
            {devices.filter((d) => d.kind === "audioinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
          </select>
        </label>
        <label><br />Speaker<br />
          <select value={speaker} onChange={(e) => { setSpeaker(e.target.value); setSpeakerId(e.target.value); }}>
            <option value="">System default</option>
            {devices.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>)}
          </select>
        </label>
        <small>Changes apply the next time you join a channel or call.</small>
      </section>
      {window.__TAURI_INTERNALS__ && (
        <section className="card">
          <h2>Stream Deck</h2>
          <label><input type="checkbox" checked={deckOn} onChange={(e) => { try { localStorage.setItem("dispatch-deck", e.target.checked ? "1" : "0"); } catch { /* storage unavailable */ } setDeckOn(e.target.checked); window.dispatchEvent(new Event("dispatch-deck-changed")); }} /> Let the Repeater Nation Stream Deck plugin control the console</label>
          <p><small>The plugin presses channel keys, push to talk, All Call, tones and messages, and shows live channel state on the keys. It only talks to a plugin on this computer. Install the plugin first, then switch this on.</small></p>
        </section>
      )}
      <section className="card">
        <h2>Console layout</h2>
        <p><small>Folders, tabs, colours, icons, alerts and tones are saved on this computer. Copy them to use the same setup elsewhere.</small></p>
        <button onClick={() => { setLayoutText(exportAll()); setLayoutMsg("Copy this text to save your layout."); }}>Show layout to copy</button>
        <button onClick={() => { if (!confirm("Reset folders, colours, icons, alerts and tones to the defaults?")) return; resetLayoutStorage(); window.dispatchEvent(new Event("dispatch-layout-changed")); setLayoutText(""); setLayoutMsg("Layout reset."); }}>Reset to defaults</button>
        <textarea rows="6" placeholder="Paste a saved layout here, then press Import" value={layoutText} onChange={(e) => setLayoutText(e.target.value)} style={{ width: "100%", marginTop: 8 }} />
        <button disabled={!layoutText.trim()} onClick={() => { try { importAll(layoutText); window.dispatchEvent(new Event("dispatch-layout-changed")); setLayoutMsg("Layout imported."); } catch (e) { setLayoutMsg(e?.message || "That text could not be read."); } }}>Import</button>
        {layoutMsg && <small> {layoutMsg}</small>}
      </section>
      <section className="card">
        <h2>Account</h2>
        <p>{member.full_name || member.email}<br /><small>{member.email} · {member.role}</small></p>
        <button onClick={onSignOut}>Sign out</button>
      </section>
    </div>
  );
}

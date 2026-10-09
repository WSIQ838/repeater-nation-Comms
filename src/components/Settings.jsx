import { useEffect, useState } from "react";
import { getMicId, getSpeakerId, setMicId, setSpeakerId } from "../lib/prefs";
import { checkForUpdate, openLink } from "../lib/updates";

export default function Settings({ member, onSignOut, update }) {
  const [devices, setDevices] = useState([]);
  const [mic, setMic] = useState(getMicId());
  const [speaker, setSpeaker] = useState(getSpeakerId());
  const [state, setState] = useState(update ? { ...update } : null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const loadDevices = async () => {
    try {
      // Names are blank until the browser has been allowed to use the microphone once.
      try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch { /* names stay blank */ }
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch { /* no devices available */ }
  };
  useEffect(() => { loadDevices(); }, []);

  const check = async () => {
    setChecking(true); setError("");
    try { setState(await checkForUpdate()); } catch (e) { setError(e?.message || "Could not check for updates."); }
    setChecking(false);
  };

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
      <section className="card">
        <h2>Account</h2>
        <p>{member.full_name || member.email}<br /><small>{member.email} · {member.role}</small></p>
        <button onClick={onSignOut}>Sign out</button>
      </section>
    </div>
  );
}

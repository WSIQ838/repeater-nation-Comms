import { useEffect, useState } from "react";
import { restoreSession, restoreSessionFromRedirect, restoreSessionFromLink, loginWithPassword, loginWithGoogle, googleSignInAvailable, clearSession, isDispatcher } from "./lib/auth";
import ChannelManager from "./components/ChannelManager";
import Monitor from "./components/Monitor";
import DirectCalls from "./components/DirectCalls";
import Talk from "./components/Talk";
import Roster from "./components/Roster";
import MapView from "./components/MapView";
import Settings from "./components/Settings";
import { checkForUpdate, openLink } from "./lib/updates";

function Login({ onDone, note }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = error || note;
  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true); setError("");
    try { onDone(await loginWithPassword(email, password)); }
    catch (err) { setError(err?.message || "Sign-in failed."); }
    finally { setBusy(false); }
  };
  return (
    <form className="card login" onSubmit={submit}>
      <h1>Dispatch</h1>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      {googleSignInAvailable() && <button type="button" onClick={() => loginWithGoogle().catch((err) => setError(err?.message || "Could not open the browser."))}>Sign in with Google</button>}
      {shown && <p className="err">{shown}</p>}
    </form>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = restoring
  const [tab, setTab] = useState("monitor");
  const [note, setNote] = useState("");
  const [update, setUpdate] = useState(null);

  useEffect(() => { restoreSessionFromRedirect().then((r) => r || restoreSession()).then(setSession); }, []);

  // Look for a newer release once the console opens.
  useEffect(() => { checkForUpdate().then(setUpdate).catch(() => {}); }, []);

  // Desktop app: the browser hands Google sign-in back through a repeaternation-dispatch:// link.
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let off = null, gone = false;
    const handle = (urls) => {
      const url = (urls || []).find((u) => u.startsWith("repeaternation-dispatch://"));
      if (!url) return;
      restoreSessionFromLink(url).then(setSession).catch((e) => setNote(e?.message || "Could not finish signing in."));
    };
    import("@tauri-apps/plugin-deep-link").then(async (dl) => {
      const unlisten = await dl.onOpenUrl(handle);
      if (gone) unlisten(); else off = unlisten;
      handle(await dl.getCurrent().catch(() => null));
    }).catch((e) => setNote("This build can't receive sign-in links: " + (e?.message || e)));
    return () => { gone = true; off?.(); };
  }, []);

  if (session === undefined) return <p className="center">Loading…</p>;
  if (!session) return <Login onDone={setSession} note={note} />;

  const { member } = session;
  if (!isDispatcher(member)) {
    return (
      <div className="card login">
        <h1>No dispatch access</h1>
        <p>{member.email} is not set up as a dispatcher. Ask an administrator to grant dispatch access.</p>
        <button onClick={async () => { await clearSession(); setSession(null); }}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="shell">
      <header>
        <strong>Repeater Nation Dispatch</strong>
        <nav>
          {["monitor", "talk", "roster", "map", "calls", "channels", "settings"].map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
        {update?.available && <button className="on" onClick={() => openLink(update.download)}>Update to {update.latest}</button>}
        <span>{member.full_name || member.email}</span>
        <button onClick={async () => { await clearSession(); setSession(null); }}>Sign out</button>
      </header>
      <main>{{ monitor: <Monitor />, talk: <Talk />, roster: <Roster />, map: <MapView />, calls: <DirectCalls />, channels: <ChannelManager />, settings: <Settings member={member} update={update} onSignOut={async () => { await clearSession(); setSession(null); }} /> }[tab]}</main>
    </div>
  );
}

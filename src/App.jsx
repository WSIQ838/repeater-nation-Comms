import { useEffect, useState } from "react";
import { restoreSession, loginWithPassword, clearSession, isDispatcher } from "./lib/auth";
import ChannelManager from "./components/ChannelManager";
import Monitor from "./components/Monitor";
import DirectCalls from "./components/DirectCalls";

function Login({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
      {error && <p className="err">{error}</p>}
    </form>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = restoring
  const [tab, setTab] = useState("monitor");

  useEffect(() => { restoreSession().then(setSession); }, []);

  if (session === undefined) return <p className="center">Loading…</p>;
  if (!session) return <Login onDone={setSession} />;

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
          {["monitor", "calls", "channels"].map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
        <span>{member.full_name || member.email}</span>
        <button onClick={async () => { await clearSession(); setSession(null); }}>Sign out</button>
      </header>
      <main>{tab === "monitor" ? <Monitor /> : tab === "calls" ? <DirectCalls /> : <ChannelManager />}</main>
    </div>
  );
}

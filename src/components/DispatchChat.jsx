import { useEffect, useRef, useState } from "react";
import { chatPoll, chatSend } from "../lib/auth";
import { playAprs } from "../lib/tones";

// Polls the controller chat while the console is open (whichever side tab is showing), so
// messages chirp and count as unread even when the chat isn't in view.
export function useDispatchChat(selfId, visible) {
  const [messages, setMessages] = useState([]);
  const [online, setOnline] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const since = useRef(""), first = useRef(true), vis = useRef(visible);
  vis.current = visible;

  useEffect(() => {
    if (visible) setUnread(0);
  }, [visible]);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await chatPoll(since.current);
        if (stop) return;
        setError(""); setOnline(r?.online || []);
        const fresh = r?.messages || [];
        if (fresh.length) {
          since.current = fresh[fresh.length - 1].at;
          setMessages((m) => { const have = new Set(m.map((x) => x.id)); return [...m, ...fresh.filter((x) => !have.has(x.id))].slice(-200); });
          const theirs = fresh.filter((x) => x.userId !== selfId);
          if (!first.current && theirs.length) { playAprs(); if (!vis.current) setUnread((n) => n + theirs.length); }
        }
        first.current = false;
      } catch (e) { if (!stop) setError(e?.message || "Could not reach the controller chat."); }
    };
    poll(); const t = setInterval(poll, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [selfId]);

  return { messages, online, unread, error };
}

export default function DispatchChat({ chat, selfId }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat.messages.length]);

  const send = async (e) => {
    e.preventDefault();
    const t = text.trim(); if (!t || sending) return;
    setSending(true); setErr("");
    try { await chatSend(t); setText(""); } catch (x) { setErr(x?.message || "Could not send."); }
    setSending(false);
  };

  return (
    <div className="dchat">
      <div className="dwho"><b>Online controllers ({chat.online.length})</b>
        {chat.online.map((p) => <span key={p.userId} className="dchip">{p.name}{p.userId === selfId ? " (you)" : ""}</span>)}
      </div>
      {(chat.error || err) && <p className="err">{err || chat.error}</p>}
      <div className="dlog">
        {chat.messages.length === 0 && <p className="muted">No messages yet. Everything typed here goes to every controller.</p>}
        {chat.messages.map((m) => (
          <div key={m.id} className={`dmsg${m.userId === selfId ? " me" : ""}`}>
            <span className="dmeta">{m.name} · {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span>{m.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="dsend" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message all controllers" />
        <button disabled={sending || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

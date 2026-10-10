// Stream Deck bridge. The Repeater Nation Stream Deck plugin runs a small server on this computer only;
// when "Stream Deck" is switched on in Settings, the app connects to it, sends its state (so the keys can
// show the channel, who is talking, and so on), and carries out the key presses the plugin sends back.
const PORT = 34580;

export function startDeck({ app, version, onCommand }) {
  let ws = null, timer = null, stopped = false, last = "", delay = 2000;
  const open = () => {
    if (stopped) return;
    try { ws = new WebSocket(`ws://127.0.0.1:${PORT}`); } catch { schedule(); return; }
    ws.onopen = () => { delay = 2000; ws.send(JSON.stringify({ t: "hello", app, version })); if (last) ws.send(last); };
    ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m?.t === "cmd") onCommand(m); } catch { /* ignore */ } };
    ws.onclose = () => { ws = null; schedule(); };
    ws.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
  };
  const schedule = () => { if (stopped) return; clearTimeout(timer); timer = setTimeout(open, delay); delay = Math.min(15000, Math.round(delay * 1.5)); };
  open();
  return {
    send(state) {
      const msg = JSON.stringify({ t: "state", app, state });
      if (msg === last) return;
      last = msg;
      if (ws && ws.readyState === 1) ws.send(msg);
    },
    stop() { stopped = true; clearTimeout(timer); try { ws?.close(); } catch { /* already closed */ } },
  };
}

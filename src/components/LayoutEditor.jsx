import { useState } from "react";
import { PALETTE, TAB_TYPES, newId } from "../lib/layout";
import { ICON_IDS, ICONS, Icon } from "../lib/icons";
import { playLocal } from "../lib/tones";

const Swatches = ({ onPick }) => (
  <span className="swatches">{PALETTE.map((p) => (
    <button key={p.name} type="button" title={p.name} className="swatch" style={{ background: p.tile, borderColor: p.accent }} onClick={() => onPick(p)} />
  ))}</span>
);

function Colors({ accent, tile, onChange }) {
  return (
    <div className="colorrow">
      <Swatches onPick={(p) => onChange({ accent: p.accent, tile: p.tile })} />
      <label>Header <input type="color" value={accent} onChange={(e) => onChange({ accent: e.target.value, tile })} /></label>
      <label>Tiles <input type="color" value={tile} onChange={(e) => onChange({ accent, tile: e.target.value })} /></label>
    </div>
  );
}

function ChannelPicker({ channels, picked, onChange }) {
  const byZone = [...new Set(channels.map((c) => c.zoneName))];
  const toggle = (id) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <details className="picker">
      <summary>{picked.length} channel{picked.length === 1 ? "" : "s"} picked</summary>
      {byZone.map((z) => (
        <div key={z}><strong>{z}</strong>
          {channels.filter((c) => c.zoneName === z).map((c) => (
            <label key={c.id} className="chk"><input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>
          ))}
        </div>
      ))}
    </details>
  );
}

function FoldersPane({ layout, setLayout, zones, channels }) {
  const [sel, setSel] = useState(null);

  if (layout.mode !== "custom") {
    return (
      <div>
        <p>Right now every zone is its own folder, and new zones appear by themselves. You can change each zone's colours here, or build your own folders and tabs.</p>
        {zones.map((z, i) => {
          const st = layout.zoneStyle?.[z.id] || {};
          const p = PALETTE[i % 6];
          return (
            <div key={z.id} className="edrow"><strong>{z.name}</strong>
              <Colors accent={st.accent || p.accent} tile={st.tile || p.tile} onChange={(c) => setLayout({ ...layout, zoneStyle: { ...layout.zoneStyle, [z.id]: c } })} />
            </div>
          );
        })}
        <button className="on" onClick={() => setLayout({
          ...layout, mode: "custom",
          folders: zones.map((z, i) => { const st = layout.zoneStyle?.[z.id] || {}; const p = PALETTE[i % 6]; return { id: newId(), name: z.name, accent: st.accent || p.accent, tile: st.tile || p.tile, tabs: [{ id: newId(), name: z.name, type: "zone", zoneId: z.id }] }; }),
        })}>Build my own folders and tabs</button>
      </div>
    );
  }

  const folders = layout.folders;
  const upd = (id, patch) => setLayout({ ...layout, folders: folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const move = (i, d) => { const a = [...folders]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setLayout({ ...layout, folders: a }); };
  const f = folders.find((x) => x.id === sel) || folders[0];
  const updTab = (tid, patch) => upd(f.id, { tabs: f.tabs.map((t) => (t.id === tid ? { ...t, ...patch } : t)) });

  return (
    <div className="edsplit">
      <div className="edlist">
        {folders.map((x, i) => (
          <div key={x.id} className={"edfolder" + (x.id === f?.id ? " on" : "")} onClick={() => setSel(x.id)}>
            <span className="dot" style={{ background: x.accent }} />{x.name}
            <span className="grow" />
            <button onClick={(e) => { e.stopPropagation(); move(i, -1); }}>↑</button>
            <button onClick={(e) => { e.stopPropagation(); move(i, 1); }}>↓</button>
          </div>
        ))}
        <button onClick={() => { const id = newId(); setLayout({ ...layout, folders: [...folders, { id, name: "New folder", accent: PALETTE[0].accent, tile: PALETTE[0].tile, tabs: [{ id: newId(), name: "Tab 1", type: "channels", channelIds: [] }] }] }); setSel(id); }}>+ Add folder</button>
        <button onClick={() => confirm("Go back to one folder per zone? Your custom folders will be removed.") && setLayout({ ...layout, mode: "zones", folders: [] })}>Back to zone folders</button>
      </div>
      {f && (
        <div className="eddetail">
          <label>Folder name <input value={f.name} onChange={(e) => upd(f.id, { name: e.target.value })} /></label>
          <Colors accent={f.accent} tile={f.tile} onChange={(c) => upd(f.id, c)} />
          <h4>Tabs</h4>
          {f.tabs.map((t) => (
            <div key={t.id} className="edtab">
              <input value={t.name} onChange={(e) => updTab(t.id, { name: e.target.value })} />
              <select value={t.type} onChange={(e) => updTab(t.id, { type: e.target.value })}>{TAB_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
              {t.type === "zone" && <select value={t.zoneId || ""} onChange={(e) => updTab(t.id, { zoneId: e.target.value })}><option value="">Zone…</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>}
              {t.type === "recent" && <label>last <input type="number" min="1" max="120" value={t.minutes || 5} onChange={(e) => updTab(t.id, { minutes: Number(e.target.value) })} /> min</label>}
              {t.type === "channels" && <ChannelPicker channels={channels} picked={t.channelIds || []} onChange={(ids) => updTab(t.id, { channelIds: ids })} />}
              <button disabled={f.tabs.length < 2} onClick={() => upd(f.id, { tabs: f.tabs.filter((x) => x.id !== t.id) })}>Remove tab</button>
            </div>
          ))}
          <button onClick={() => upd(f.id, { tabs: [...f.tabs, { id: newId(), name: `Tab ${f.tabs.length + 1}`, type: "channels", channelIds: [] }] })}>+ Add tab</button>
          <button className="danger" onClick={() => confirm(`Delete folder "${f.name}"?`) && (setSel(null), setLayout({ ...layout, folders: folders.filter((x) => x.id !== f.id) }))}>Delete folder</button>
        </div>
      )}
    </div>
  );
}

function ChannelsPane({ layout, setLayout, channels, tones }) {
  const set = (id, patch) => setLayout({ ...layout, channels: { ...layout.channels, [id]: { ...(layout.channels?.[id] || {}), ...patch } } });
  return (
    <div>
      <p>Pick a colour, icon, name and alert tone for each channel. Leave a colour unset to use its folder's colour.</p>
      <table className="edtable"><thead><tr><th>Channel</th><th>Name on tile</th><th>Colour</th><th>Icon</th><th>Alert when heard</th></tr></thead>
        <tbody>{channels.map((c) => {
          const cfg = layout.channels?.[c.id] || {};
          return (
            <tr key={c.id}>
              <td>{c.label}</td>
              <td><input value={cfg.label || ""} placeholder={c.name} onChange={(e) => set(c.id, { label: e.target.value })} /></td>
              <td><input type="color" value={cfg.color || "#14416b"} onChange={(e) => set(c.id, { color: e.target.value })} />{cfg.color && <button onClick={() => set(c.id, { color: "" })}>Reset</button>}</td>
              <td><select value={cfg.icon || "none"} onChange={(e) => set(c.id, { icon: e.target.value })}>{ICON_IDS.map((i) => <option key={i} value={i}>{ICONS[i].label}</option>)}</select> <Icon id={cfg.icon} size={16} /></td>
              <td><select value={cfg.alert || ""} onChange={(e) => set(c.id, { alert: e.target.value })}><option value="">None</option>{tones.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function TonesPane({ tones, setTones }) {
  const upd = (id, patch) => setTones(tones.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const num = (v) => Number(v) || 0;
  return (
    <div>
      <p>A tone plays the first pitch, then the second (if set), for the time shown, then waits, and repeats. Send tones onto channels with the TONE button, or use them as the alert when a channel is heard.</p>
      <table className="edtable"><thead><tr><th>Name</th><th>Pitch 1 (Hz)</th><th>Pitch 2 (Hz)</th><th>Each (ms)</th><th>Gap (ms)</th><th>Repeats</th><th /></tr></thead>
        <tbody>{tones.map((t) => (
          <tr key={t.id}>
            <td><input value={t.name} onChange={(e) => upd(t.id, { name: e.target.value })} /></td>
            <td><input type="number" value={t.f1} onChange={(e) => upd(t.id, { f1: num(e.target.value) })} /></td>
            <td><input type="number" value={t.f2} onChange={(e) => upd(t.id, { f2: num(e.target.value) })} /></td>
            <td><input type="number" value={t.onMs} onChange={(e) => upd(t.id, { onMs: num(e.target.value) })} /></td>
            <td><input type="number" value={t.offMs} onChange={(e) => upd(t.id, { offMs: num(e.target.value) })} /></td>
            <td><input type="number" value={t.repeat} onChange={(e) => upd(t.id, { repeat: Math.max(1, num(e.target.value)) })} /></td>
            <td><button onClick={() => playLocal(t)}>▶ Play</button><button disabled={tones.length < 2} onClick={() => setTones(tones.filter((x) => x.id !== t.id))}>Delete</button></td>
          </tr>
        ))}</tbody>
      </table>
      <button onClick={() => setTones([...tones, { id: newId(), name: "New tone", f1: 1000, f2: 0, onMs: 300, offMs: 150, repeat: 2 }])}>+ Add tone</button>
    </div>
  );
}

export default function LayoutEditor({ layout, setLayout, tones, setTones, zones, channels, onClose }) {
  const [tab, setTab] = useState("folders");
  return (
    <div className="modal" onClick={onClose}>
      <div className="modalbox" onClick={(e) => e.stopPropagation()}>
        <header className="modalhead">
          <strong>Configure console</strong>
          <nav>{[["folders", "Folders & tabs"], ["channels", "Channel look & alerts"], ["tones", "Tones"]].map(([id, label]) => <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
          <span className="grow" />
          <button className="on" onClick={onClose}>Done</button>
        </header>
        <div className="modalbody">
          {tab === "folders" && <FoldersPane layout={layout} setLayout={setLayout} zones={zones} channels={channels} />}
          {tab === "channels" && <ChannelsPane layout={layout} setLayout={setLayout} channels={channels} tones={tones} />}
          {tab === "tones" && <TonesPane tones={tones} setTones={setTones} />}
        </div>
        <small className="modalfoot">Changes save automatically on this computer.</small>
      </div>
    </div>
  );
}

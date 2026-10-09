const REPO = "WSIQ838/repeater-nation-Comms";
const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
// Looks at the latest published dispatch release and says whether it is newer than this app.
export async function checkForUpdate() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`Could not check for updates (${res.status}).`);
  const r = await res.json();
  const latest = String(r.tag_name || "").replace(/^dispatch-v/, "");
  const installer = (r.assets || []).find((a) => /x64-setup\.exe$/.test(a.name));
  return { current: __APP_VERSION__, latest, available: !!latest && newer(latest, __APP_VERSION__), page: r.html_url, download: installer?.browser_download_url || r.html_url };
}
export async function openLink(url) {
  if (window.__TAURI_INTERNALS__) { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); }
  else window.open(url, "_blank", "noopener");
}

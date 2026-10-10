import { createClient } from "@base44/sdk";
import { config } from "./config";

let base44Client = null;
function client() {
  if (!base44Client) {
    base44Client = createClient({
      appId: config.base44AppId,
      serverUrl: config.appUrl,
      requiresAuth: false,
      appBaseUrl: config.base44AppBaseUrl,
      options: { onError: (err) => console.error("[Base44 SDK]", err?.status, err?.message) },
    });
  }
  return base44Client;
}

const TOKEN_KEY = "base44_access_token";

// Dispatch access is decided by the account, not by the app: the account's role (or an
// explicit dispatch flag) must be allowed. The Base44 functions and entity rules must
// enforce the same check; this only decides whether the console is shown at all.
export function isDispatcher(member) {
  if (!member) return false;
  if (member.dispatch === true || member.is_dispatcher === true) return true;
  return config.dispatchRoles.includes(String(member.role || "").toLowerCase());
}

export async function restoreSession() {
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* storage unavailable */ }
  if (!token) return null;
  try {
    client().auth.setToken(token);
    const member = await client().auth.me();
    return member ? { member } : null;
  } catch (err) {
    const status = err?.status ?? err?.response?.status;
    if (status === 401 || status === 403) await clearSession();
    return null;
  }
}

const inDesktopApp = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
export const googleSignInAvailable = () => true;

// Google refuses sign-in inside an embedded window, so the desktop app opens the system browser
// and the website hands the result back through a repeaternation-dispatch:// link (its own link
// type, so the radio app is never opened by mistake). The web build just redirects.
export async function loginWithGoogle() {
  const base = config.base44AppBaseUrl;
  const login = (from) => `${base}/api/apps/auth/login?app_id=${encodeURIComponent(config.base44AppId)}&from_url=${encodeURIComponent(from)}`;
  if (inDesktopApp()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(login(`${config.appUrl}/oauth/dispatch-callback`));
    return;
  }
  window.location.href = login(window.location.origin + window.location.pathname);
}

async function sessionFromToken(token) {
  client().auth.setToken(token);
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
  const member = await client().auth.me();
  return member ? { member } : null;
}

// Web: picks up the token Base44 returns in the address after Google sign-in.
export async function restoreSessionFromRedirect() {
  try {
    const u = new URL(window.location.href);
    const token = u.searchParams.get("access_token") || new URLSearchParams(u.hash.replace(/^#/, "")).get("access_token");
    if (!token) return null;
    window.history.replaceState({}, "", u.pathname);
    return await sessionFromToken(token);
  } catch { return null; }
}

// Desktop: the repeaternation-dispatch://oauth/callback?access_token=... link from the browser.
export async function restoreSessionFromLink(url) {
  const token = new URL(url).searchParams.get("access_token");
  if (!token) throw new Error("The sign-in link had no token. Try signing in again.");
  const s = await sessionFromToken(token);
  if (!s) throw new Error("Signed in, but the account could not be loaded.");
  return s;
}

export async function loginWithPassword(email, password) {
  const e = email.trim();
  if (!e || !password) throw new Error("Enter your Repeater Nation email and password.");
  await client().auth.loginViaEmailPassword(e, password);
  const member = await client().auth.me();
  if (!member) throw new Error("Signed in, but the account could not be loaded.");
  return { member };
}

export async function clearSession() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem("token"); } catch { /* ignore */ }
  try { base44Client?.cleanup?.(); } catch { /* ignore */ }
  base44Client = null;
}

async function invoke(name, payload) {
  try {
    const result = await client().functions.invoke(name, payload);
    return result?.data || result;
  } catch (err) {
    const data = err?.response?.data || err?.data;
    const detail = data?.error || data?.message || data?.detail;
    if (detail) throw Object.assign(new Error(String(detail)), { status: err?.response?.status ?? err?.status });
    throw err;
  }
}

// Direct calls. The radio app's "list" and "token" actions only cover a member's own calls;
// dispatch needs the server to also accept { all: true } on "list" and
// { mode: "listen" | "talk" } on "token" for dispatch accounts, and to grant publish rights
// only in talk mode. Until the backend does, these calls come back refused.
export const listAllDirectCalls = () => invoke("radio-direct-call", { action: "list", all: true });
export const directCallToken = (callId, mode) => invoke("radio-direct-call", { action: "token", call_id: callId, mode });

export const issueMonitorSession = (channel) =>
  invoke("issue-radio-session", {
    channel_id: channel.id,
    zone_id: channel.zoneId || "",
    channel_number: channel.number ?? null,
    session_type: "monitor",
  });

// Channels and zones are plain entities: Base44's own rules decide who may write them.
export async function listZonesAndChannels() {
  const e = client().entities;
  const [zones, channels] = await Promise.all([
    e.RadioZone.list("display_order", 200),
    e.RadioChannel.list("number", 500),
  ]);
  return { zones: zones || [], channels: channels || [] };
}
export const createZone = (data) => client().entities.RadioZone.create(data);
export const updateZone = (id, data) => client().entities.RadioZone.update(id, data);
export const deleteZone = (id) => client().entities.RadioZone.delete(id);
export const createChannel = (data) => client().entities.RadioChannel.create(data);
export const updateChannel = (id, data) => client().entities.RadioChannel.update(id, data);
export const deleteChannel = (id) => client().entities.RadioChannel.delete(id);

// Talking on a channel uses the same radio session and floor control as the radio app.
export const issueRadioSession = (channel, radioSessionId = "") =>
  invoke("issue-radio-session", {
    channel_id: channel.id,
    zone_id: channel.zoneId || "",
    channel_number: channel.number ?? null,
    radio_session_id: radioSessionId,
    session_type: "radio",
  });
export const radioPTT = (channel, action, radioSessionId, radioCallsign) =>
  invoke("radio-ptt", {
    action,
    channel_id: channel.id,
    zone_id: channel.zoneId || "",
    channel_number: channel.number ?? null,
    radio_session_id: radioSessionId || "",
    radio_callsign: radioCallsign || "",
  });

// Dispatch-only server actions (the server refuses anyone who isn't staff).
export const dispatchRoster = () => invoke("radio-dispatch", { action: "roster" });
export const dispatchLocations = () => invoke("radio-dispatch", { action: "locations" });
export const dispatchMove = (identity, fromChannelId, toChannelId) =>
  invoke("radio-dispatch", { action: "move", identity, from_channel_id: fromChannelId, to_channel_id: toChannelId });

// Dispatcher-only text chat (backend: dispatch-chat).
export const chatPoll = (since) => invoke("dispatch-chat", { action: "poll", since: since || "" });
export const chatSend = (text) => invoke("dispatch-chat", { action: "send", text });

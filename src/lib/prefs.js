// Per-computer choices (microphone, speaker), kept in local storage.
const get = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
export const getMicId = () => get("dispatch-mic");
export const getSpeakerId = () => get("dispatch-speaker");
export const setMicId = (v) => set("dispatch-mic", v);
export const setSpeakerId = (v) => set("dispatch-speaker", v);
// Send an audio element to the chosen speaker (not every system supports choosing one).
export const applySink = (el) => { const id = getSpeakerId(); if (el?.setSinkId && id) el.setSinkId(id).catch(() => {}); };

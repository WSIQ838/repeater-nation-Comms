// Recorded messages live in this browser/app (IndexedDB) on the dispatcher's computer.
const DB = "dispatch-messages", STORE = "messages";
const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result); tx.onerror = () => reject(tx.error);
  });
};
export const listMessages = async () => ((await run("readonly", (s) => s.getAll())) || []).sort((a, b) => b.at - a.at);
export const saveMessage = (name, blob) => run("readwrite", (s) => s.put({ id: crypto.randomUUID(), name, blob, at: Date.now() }));
export const deleteMessage = (id) => run("readwrite", (s) => s.delete(id));

export async function recordMessage() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream), chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" })); };
      rec.stop();
    }),
  };
}

// Turns a stored message into a live audio track to publish, and says when it has finished.
export async function playableTrack(blob) {
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource();
  src.buffer = buffer; src.connect(dest);
  const done = new Promise((resolve) => { src.onended = resolve; });
  return { track: dest.stream.getAudioTracks()[0], start: () => src.start(), done, close: () => ctx.close() };
}

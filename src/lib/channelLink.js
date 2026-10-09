import { Room, RoomEvent, createLocalAudioTrack } from "livekit-client";
import { issueRadioSession, radioPTT } from "./auth";

const RENEW_MS = 8000;

// One radio connection to a channel that can transmit: it joins like a radio, asks the
// server for the floor before sending audio, keeps the floor renewed, and hands it back.
export class ChannelLink {
  constructor(channel) { this.channel = channel; this.room = null; this.session = null; this.timer = null; this.held = false; }

  async connect() {
    const s = await issueRadioSession(this.channel);
    if (!s?.ok) throw new Error(s?.error || "Could not start a radio session.");
    this.session = s;
    this.room = new Room();
    this.audio = new Map();
    this.room.on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
      if (track.kind !== "audio") return;
      const el = track.attach(); el.autoplay = true; el.style.display = "none"; document.body.appendChild(el); this.audio.set(p.identity, el);
    });
    this.room.on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => { track.detach().forEach((e) => e.remove()); this.audio.delete(p.identity); });
    await this.room.connect(s.liveKitUrl, s.liveKitToken);
    return s;
  }

  get canTransmit() { return !!this.session?.canTransmit; }

  // Ask for the floor. Throws with the server's reason when it isn't granted.
  async begin() {
    if (!this.canTransmit) throw new Error("This account has no verified callsign, so it can't transmit.");
    const r = await radioPTT(this.channel, "request", this.session.radioSessionId, this.session.radioCallsign);
    if (!r?.granted) {
      const why = { busy: "The channel is busy.", muted: "This account is muted.", not_authorized: "Not authorized to transmit here." }[r?.reason];
      throw new Error(why || r?.error || "The channel didn't grant the floor.");
    }
    this.held = true;
    this.timer = setInterval(() => radioPTT(this.channel, "renew", this.session.radioSessionId, this.session.radioCallsign).catch(() => {}), RENEW_MS);
    // The server grants publish rights a moment after it grants the floor.
    for (let i = 0; i < 20 && this.room.localParticipant.permissions?.canPublish === false; i++) await new Promise((r) => setTimeout(r, 100));
  }

  async publish(track) { await this.room.localParticipant.publishTrack(track, { name: "radio-microphone", dtx: true }); }
  async unpublish(track) { try { await this.room.localParticipant.unpublishTrack(track, true); } catch { /* already gone */ } }

  async end() {
    clearInterval(this.timer); this.timer = null;
    if (!this.held) return;
    this.held = false;
    await radioPTT(this.channel, "release", this.session.radioSessionId, this.session.radioCallsign).catch(() => {});
  }

  async disconnect() {
    await this.end();
    for (const el of this.audio?.values() || []) el.remove();
    try { await this.room?.disconnect(); } catch { /* already gone */ }
    this.room = null;
  }
}

export const openMic = () => createLocalAudioTrack();

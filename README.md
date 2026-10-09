# Repeater Nation Dispatch

Dispatch console for Repeater Nation Radio. A separate app from the radio client; it signs in
with the same Repeater Nation account and is only shown to accounts with dispatch access.

## Access control

`isDispatcher()` in `src/lib/auth.js` allows accounts whose `role` is in `VITE_DISPATCH_ROLES`
(default `admin,dispatcher`) or that carry a `dispatch` flag. This only hides the console. The
Repeater Nation Base44 backend must enforce the same rule on every dispatch action: entity
rules on `RadioZone`/`RadioChannel`, and checks inside any dispatch function.

## Done

- Sign-in and dispatch-only gate
- Create / enable / remove zones and channels
- Monitor many channels at once (receive-only) with volume, mute, who is on air

## Planned

- Dispatch talk (PTT) and direct calls
- Recorded-message playback
- Live GPS map of radio users
- Move users between channels (needs a Base44 function using the LiveKit admin API)

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

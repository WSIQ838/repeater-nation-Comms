# Repeater Nation Dispatch

Dispatch console for Repeater Nation Radio. A separate app from the radio client; it signs in
with the same Repeater Nation account and is only shown to accounts with dispatch access.

## Access control

`isDispatcher()` in `src/lib/auth.js` allows accounts whose `role` is in `VITE_DISPATCH_ROLES`
(default `admin,super_admin`, the roles the server allows to change channels) or that carry a `dispatch` flag. This only hides the console. The
Repeater Nation Base44 backend must enforce the same rule on every dispatch action: entity
rules on `RadioZone`/`RadioChannel`, and checks inside any dispatch function.

## Features

- Sign-in with email/password or Google (the desktop app opens your browser and comes back through a `repeaternation-dispatch://` link) and a dispatch-only gate
- **Monitor**: listen to many channels at once, volume and mute per channel
- **Talk**: join a channel and hold to talk (same floor control as the radio); record, store and play messages onto a channel (messages are kept on the dispatcher's computer)
- **Roster**: everyone on the radio by channel, and send any radio to another channel
- **Map**: live positions of radios that opted in to sharing location
- **Calls**: every direct call in progress; listen silently or join and talk
- **Channels**: create, rename, renumber, reorder, move, enable/disable and remove zones and channels
- **Console look**: zone folders with tabs (including dynamic ones), coloured tiles, General Transmit, Activity Log, Online roster with status, alert tones and tone sending, colours and icons, saved per computer (Settings can copy/import them)
- **Stream Deck** (desktop app, off by default): the Repeater Nation Stream Deck plugin (see the radio repo's `streamdeck/`) presses channel keys, push to talk, General Transmit, tones and messages and shows live channel state on the keys
- **Settings**: installed version, check for updates (and an Update button when a newer release exists), microphone and speaker choice, account and sign out

## Server side

The dispatch features need these changes in the Repeater Nation Base44 app:
`radio-direct-call` (list all / join any call), `radio-dispatch` (roster, locations, move),
`radio-location` (radios report position) and the `RadioLocation` entity. Dispatch access is
enforced there for `admin` and `super_admin` accounts.

## Not built

- Emergency alerts: the radio apps' emergency button is not wired up, so there is nothing to alert on.
- Messages shared between dispatchers (they are stored per computer).
- Phone version of the dispatch console (it is a desktop/web console).

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

## Desktop build

`npm run tauri:build` (Windows installer via `.github/workflows/windows.yml`, manual run).

# Achievement Leaderboard

A single-file points game for a school group.

- Everyone signs up with an email address or phone number (format-validated only — no verification code is sent), then creates a display name and profile picture. Re-entering the same email/phone on another device signs back into the existing profile. Contact details are shown only to their owner, never to other players.
- The first person to open it creates the game, sets a join code, and is the only one who can finalize the achievement list.
- During the draft phase anyone can suggest achievements, but only the creator approves them onto the list (players can edit or withdraw their own pending suggestions); finalizing locks the list permanently and discards unapproved suggestions.
- In play there are two tabs: a Leaderboard (tap a player to see their profile and every achievement they've ticked off) and an Achievements checklist where players tick and untick what they've completed on the honour system — each achievement counts once, and unticking removes its points. A recent-activity feed sits under the leaderboard.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The website: GitHub Pages + **Firebase Realtime Database** backend with live sync. Needs your Firebase config pasted in (see below). |
| `achievement-leaderboard.html` | Claude-artifact build using `window.storage` shared keys. |

Both are generated from the same source; React, ReactDOM, and htm are inlined. Without a backend the page runs in a clearly-labelled local demo mode.

## Hosting on GitHub Pages with Firebase — setup walkthrough

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** (any name, e.g. `achievement-leaderboard`). Google Analytics can be off.
3. In the left sidebar: **Build → Realtime Database → Create database**. Pick the location closest to you (e.g. `asia-southeast1` for Australia) and start in **test mode**.
4. Go to **Project settings** (gear icon) → **Your apps** → click the **`</>` (Web)** icon → register the app (no hosting needed) → copy the `firebaseConfig` object it shows.
5. Make sure the config includes `databaseURL`. If it doesn't, copy the URL shown at the top of the Realtime Database page (like `https://YOUR-PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app`) and add it as `databaseURL: "..."`.

### 2. Paste the config into `index.html`

1. On GitHub, open `index.html` and click the pencil (Edit) icon.
2. Near the top there is a marked block: `window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || null;`
3. Replace it with your config, e.g.

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIzaSy...",
     authDomain: "my-game.firebaseapp.com",
     databaseURL: "https://my-game-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "my-game",
     appId: "1:1234567890:web:abc123"
   };
   ```

4. Commit the change. (The config is safe to publish — it identifies the project, it isn't a secret. Access is controlled by database rules.)

### 3. Turn on GitHub Pages

1. Repo → **Settings → Pages**.
2. Under **Build and deployment**: Source = **Deploy from a branch**, Branch = this branch, folder = **/ (root)** → Save.
3. After a minute the site is live at `https://<user>.github.io/achievements/`. Share that link plus the join code with the group.

### 4. Lock the database rules down a bit

Test mode expires after 30 days and is wide open. In **Realtime Database → Rules**, replace with:

```json
{
  "rules": {
    "alg": { ".read": true, ".write": true },
    "$other": { ".read": false, ".write": false }
  }
}
```

This limits the app to its own `alg/` branch and never expires. Note the honest limit of this setup: anyone who has the page URL can technically write to the game data — fine for a classroom honour-system game, but real accounts would need Firebase Authentication.

## How storage works

The app picks a backend at boot:

- `window.FIREBASE_CONFIG` set → Firebase Realtime Database at `alg/game`, `alg/players`, `alg/logs` (JSON strings), with `on('value')` listeners for live updates; device identity in `localStorage`.
- `window.storage` available (Claude artifact) → the same three keys as shared storage; identity in a private key; manual Refresh.
- Neither → in-page demo mode with a warning banner.

Profile photos are resized client-side to 128×128 JPEG thumbnails to keep the roster small.

## Development

Source lives in `src/` (`page-top.html` styles/skeleton, `app.js`, `fb-config.html`, vendored React/htm) and is assembled by `sh src/build.sh`; Playwright smoke tests (`smoke.js` for the artifact build, `smoke-fb.js` for the Firebase build with a stubbed database) cover the full multi-device flow.

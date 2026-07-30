# Achievement Leaderboard

A single-file points game for a school group.

- **Title page.** The site opens on the house rules — $5 buy-in each, most points wins the whole pot, no penalty for losing beyond the buy-in, honour system. Shown once per device, and reachable any time from the **Rules** button in the header.
- **Accounts.** On the hosted site everyone signs up with an email address and password (Firebase Authentication), then creates a display name and profile picture. Logging in on any other browser or device restores the same profile, points and history — the account, not the device, is the identity. Includes password reset by email and a log out button. Email addresses are shown only to their owner, never to other players.
- The first person to open it creates the game, sets a join code, and is the only one who can finalize the achievement list.
- During the draft phase anyone can suggest achievements, but only the creator approves them onto the list (players can edit or withdraw their own pending suggestions); finalizing locks the list permanently and discards unapproved suggestions.
- **Two tabs in every phase.** *Leaderboard* lists every player with their profile picture — while the list is being drafted it is a roster with everyone on zero, newest joiner first; once finalized it ranks by points and gains a recent-activity feed. Tapping a player opens their profile and every achievement they've ticked off. *Achievements* is the draft/approval list before finalizing and a tick-and-untick checklist after — each achievement counts once, and unticking removes its points. The tab shown by default follows the phase.

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

### 3. Switch on email accounts

In the Firebase console: **Build → Authentication → Get started → Email/Password → Enable → Save**.
(Leave "Email link / passwordless" off.) Without this the login screen shows a message saying
email sign-in isn't switched on yet.

Player accounts appear under **Authentication → Users**. You can delete an account there if
someone needs to start over — their leaderboard entry stays until you clear it from the database.

### 4. Turn on GitHub Pages

1. Repo → **Settings → Pages**.
2. Under **Build and deployment**: Source = **Deploy from a branch**, Branch = this branch, folder = **/ (root)** → Save.
3. After a minute the site is live at `https://<user>.github.io/achievements/`. Share that link plus the join code with the group.

### 5. Lock the database rules down

Test mode expires after 30 days and lets anyone read and write. Now that accounts exist, restrict
the data to logged-in players. In **Realtime Database → Rules**, replace everything with:

```json
{
  "rules": {
    "alg": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

Click **Publish**. These rules never expire, and someone who finds the page URL sees only the login
screen — no game data — unless they have an account.

Honest limit: any logged-in player can write to any part of the game data, so the creator-only
controls (approving achievements, finalizing) are enforced by the app, not the database. That suits
an honour-system game for a class. Making it tamper-proof would mean splitting the data per player
and writing per-path rules — worth doing only if someone actually starts cheating.

## How storage works

The app picks a backend at boot:

- `window.FIREBASE_CONFIG` set → Firebase Realtime Database with `on('value')` listeners for live updates. The game document lives at `alg/game`; players and logs are stored **one record per child** (`alg/players/<uid>`, `alg/logs/<logId>`) and written with `update()`, so simultaneous joins or ticks never overwrite each other. Legacy single-blob rosters/logs are migrated on first write.
- `window.storage` available (Claude artifact) → the same three keys as shared storage; identity in a private key; manual Refresh.
- Neither → in-page demo mode with a warning banner.

Profile photos are resized client-side to 128×128 JPEG thumbnails to keep the roster small.

## Development

Source lives in `src/` (`page-top.html` styles/skeleton, `app.js`, `fb-config.html`, vendored React/htm) and is assembled by `sh src/build.sh`; Playwright smoke tests (`smoke.js` for the artifact build, `smoke-fb.js` for the Firebase build with a stubbed database) cover the full multi-device flow.

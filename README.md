# Achievement Leaderboard

A single-file points game for a school group. Open `achievement-leaderboard.html` as a Claude artifact.

- The first person to open it creates the game, sets a join code, and is the only one who can finalize the achievement list.
- During the draft phase anyone can suggest achievements, but only the creator approves them onto the list (players can edit or withdraw their own pending suggestions); finalizing locks the list permanently and discards unapproved suggestions.
- In play, players log achievements on the honour system (repeatable, one tap, undo last log) and compete on a shared leaderboard with profile pictures, per-player stats, and an activity feed.
- Game state lives in `window.storage` shared keys (`alg:game`, `alg:players`, `alg:logs`); device identity is a private key. Profile photos are resized client-side to 128×128 JPEG thumbnails to stay well under the 5MB-per-key limit. If `window.storage` is unavailable, the app runs in a clearly-labelled local demo mode.

React 18, ReactDOM, and htm are inlined so the file is fully self-contained (no CDN access needed).

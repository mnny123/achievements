# Achievement Leaderboard

A single-file points game for a school group. Open `achievement-leaderboard.html` as a Claude artifact.

- Everyone signs up with an email address or phone number (format-validated only — there is no server, so no verification code is sent), then creates a display name and profile picture. Re-entering the same email/phone on another device signs back into the existing profile instead of creating a duplicate. Contact details are shown only to their owner, never to other players.
- The first person to open it creates the game, sets a join code, and is the only one who can finalize the achievement list.
- During the draft phase anyone can suggest achievements, but only the creator approves them onto the list (players can edit or withdraw their own pending suggestions); finalizing locks the list permanently and discards unapproved suggestions.
- In play there are two tabs: a Leaderboard (tap a player to see their profile and every achievement they've ticked off) and an Achievements checklist where players tick and untick what they've completed on the honour system — each achievement counts once, and unticking removes its points. A recent-activity feed sits under the leaderboard.
- Game state lives in `window.storage` shared keys (`alg:game`, `alg:players`, `alg:logs`); device identity is a private key. Profile photos are resized client-side to 128×128 JPEG thumbnails to stay well under the 5MB-per-key limit. If `window.storage` is unavailable, the app runs in a clearly-labelled local demo mode.

React 18, ReactDOM, and htm are inlined so the file is fully self-contained (no CDN access needed).

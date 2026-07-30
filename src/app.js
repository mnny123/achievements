/* Achievement Leaderboard — app code (React 18 + htm, no build step) */
(function () {
  'use strict';

  var h = React.createElement;
  var html = htm.bind(h);
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;

  /* ---------------- storage layer ----------------
   * Shared game data lives under three batched keys (config+achievements,
   * roster, logs). Backend is picked at boot:
   *   - 'firebase': window.FIREBASE_CONFIG is set -> Firebase Realtime
   *     Database at alg/<key>, with live listeners. Device identity goes
   *     to localStorage.
   *   - 'storage':  window.storage exists (Claude artifact runtime) ->
   *     shared keys there; identity in a private (non-shared) key.
   *   - 'memory':   neither available -> in-page demo mode with a banner.
   * Everything is wrapped in try/catch; a missing key reads as null.
   */
  var KEY_GAME = 'alg:game';
  var KEY_PLAYERS = 'alg:players';
  var KEY_LOGS = 'alg:logs';
  var KEY_ME = 'alg:me';

  var MODE = 'memory';
  var FB = null;
  var FBA = null;
  var FB_ERR = null;
  (function () {
    if (window.FIREBASE_CONFIG) {
      try {
        if (!window.firebase || !window.firebase.initializeApp) {
          throw new Error('the Firebase SDK did not load (check your network / the script tags)');
        }
        if (!window.FIREBASE_CONFIG.databaseURL) {
          throw new Error('your config has no databaseURL — create a Realtime Database in the Firebase console, then add its URL to the config');
        }
        window.firebase.initializeApp(window.FIREBASE_CONFIG);
        FB = window.firebase.database();
        FBA = (window.firebase.auth && window.firebase.auth()) || null;
        MODE = 'firebase';
      } catch (e) {
        FB_ERR = String((e && e.message) || e);
      }
    }
    if (MODE !== 'firebase' && window.storage &&
        typeof window.storage.get === 'function' && typeof window.storage.set === 'function') {
      MODE = 'storage';
    }
  })();

  function fbPath(key) { return 'alg/' + key.replace('alg:', ''); }

  var memStore = {};

  function unwrap(res) {
    if (res === null || res === undefined) return null;
    if (typeof res === 'object' && res !== null && 'value' in res) return res.value;
    return res;
  }

  async function rawGet(key, shared) {
    if (MODE === 'firebase') {
      if (!shared) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
      }
      var snap = await FB.ref(fbPath(key)).once('value');
      return snap.val();
    }
    if (MODE === 'storage') {
      try {
        return unwrap(await window.storage.get(key, { shared: shared }));
      } catch (errA) {
        /* some runtimes take a boolean instead of an options object */
        return unwrap(await window.storage.get(key, shared));
      }
    }
    return Object.prototype.hasOwnProperty.call(memStore, key) ? memStore[key] : null;
  }

  async function rawSet(key, str, shared) {
    if (MODE === 'firebase') {
      if (!shared) {
        try { localStorage.setItem(key, str); } catch (e) { /* private browsing: identity won't survive reload */ }
        return;
      }
      await FB.ref(fbPath(key)).set(str);
      return;
    }
    if (MODE === 'storage') {
      try {
        await window.storage.set(key, str, { shared: shared });
      } catch (errA) {
        await window.storage.set(key, str, shared);
      }
      return;
    }
    memStore[key] = str;
  }

  /* -> { ok, value } ; a key that does not exist yet is ok:true, value:null */
  async function storeGet(key, shared) {
    if (shared === undefined) shared = true;
    try {
      var v = await rawGet(key, shared);
      if (v === null || v === undefined) return { ok: true, value: null };
      if (typeof v === 'string') {
        try { return { ok: true, value: JSON.parse(v) }; }
        catch (e) { return { ok: true, value: null }; }
      }
      return { ok: true, value: v };
    } catch (err) {
      var msg = String((err && err.message) || err).toLowerCase();
      if (msg.indexOf('not found') >= 0 || msg.indexOf('no such') >= 0 || msg.indexOf('404') >= 0 || msg.indexOf('does not exist') >= 0) {
        return { ok: true, value: null };
      }
      return { ok: false, value: null, error: String((err && err.message) || err) };
    }
  }

  /* -> { ok, error? } ; warns before the 5MB-per-key ceiling */
  async function storeSet(key, value, shared) {
    if (shared === undefined) shared = true;
    var str;
    try { str = JSON.stringify(value); }
    catch (e) { return { ok: false, error: 'Could not serialize data' }; }
    if (str.length > 4.5 * 1024 * 1024) {
      return { ok: false, error: 'This game’s data is close to the storage limit for "' + key + '". Ask players to keep pictures small.' };
    }
    try {
      await rawSet(key, str, shared);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* read-modify-write against the freshest copy of a key */
  async function mutate(key, init, fn) {
    var got = await storeGet(key);
    if (!got.ok) return { ok: false, error: got.error };
    var base = got.value === null ? init : got.value;
    var next;
    try { next = fn(JSON.parse(JSON.stringify(base))); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    if (next && next.__abort) return { ok: false, error: next.__abort, aborted: true };
    var set = await storeSet(key, next);
    return set.ok ? { ok: true, value: next } : set;
  }

  /* ---------------- small utilities ---------------- */
  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function makeJoinCode() {
    var alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var out = '';
    for (var i = 0; i < 5; i++) out += alpha[Math.floor(Math.random() * alpha.length)];
    return out;
  }
  function timeAgo(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    if (s < 90) return '1 min ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    var hrs = Math.floor(m / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(hrs / 24);
    if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(ts).toLocaleDateString();
  }
  function fmtPts(n) { return n.toLocaleString(); }

  /* accepts an email address or a phone number; returns null if it is neither */
  function parseContact(raw) {
    var v = (raw || '').trim();
    if (!v) return null;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
      return { type: 'email', norm: v.toLowerCase(), display: v.toLowerCase() };
    }
    var digits = v.replace(/[\s\-().]/g, '');
    if (/^\+?\d{7,15}$/.test(digits)) {
      return { type: 'phone', norm: digits, display: v };
    }
    return null;
  }
  /* ---------------- accounts (Firebase Authentication) ---------------- */
  var AUTH_MESSAGES = {
    'auth/invalid-email': 'That doesn’t look like a valid email address.',
    'auth/user-not-found': 'No account with that email yet. Check the spelling, or sign up instead.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-login-credentials': 'Wrong email or password.',
    'auth/missing-password': 'Enter your password.',
    'auth/email-already-in-use': 'An account with that email already exists — log in instead.',
    'auth/weak-password': 'Passwords need to be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'Couldn’t reach the server. Check your connection and try again.',
    'auth/operation-not-allowed': 'Email sign-in isn’t switched on for this game yet. Whoever set it up needs to enable Email/Password in the Firebase console under Authentication → Sign-in method.'
  };
  function authMessage(err) {
    var code = (err && err.code) || '';
    return AUTH_MESSAGES[code] || String((err && err.message) || err);
  }
  async function authSignUp(email, password) {
    try {
      var cred = await FBA.createUserWithEmailAndPassword(email.trim(), password);
      return { ok: true, user: cred.user };
    } catch (err) { return { ok: false, error: authMessage(err) }; }
  }
  async function authSignIn(email, password) {
    try {
      var cred = await FBA.signInWithEmailAndPassword(email.trim(), password);
      return { ok: true, user: cred.user };
    } catch (err) { return { ok: false, error: authMessage(err) }; }
  }
  async function authReset(email) {
    try {
      await FBA.sendPasswordResetEmail(email.trim());
      return { ok: true };
    } catch (err) { return { ok: false, error: authMessage(err) }; }
  }

  function findByContact(playersMap, norm) {
    var ids = Object.keys(playersMap);
    for (var i = 0; i < ids.length; i++) {
      var p = playersMap[ids[i]];
      if (p && p.contact && p.contact.norm === norm) return p;
    }
    return null;
  }

  /* resize an uploaded photo to a 128x128 JPEG data URI on the client */
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) { reject(new Error('That file is not an image.')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read the file.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Could not open that image.')); };
        img.onload = function () {
          try {
            var S = 128;
            var c = document.createElement('canvas');
            c.width = S; c.height = S;
            var ctx = c.getContext('2d');
            var m = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
            var data = c.toDataURL('image/jpeg', 0.72);
            if (!data || data.length < 100) throw new Error('Could not encode the image.');
            if (data.length > 60 * 1024) data = c.toDataURL('image/jpeg', 0.5);
            resolve(data);
          } catch (e) { reject(e); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- shared presentational bits ---------------- */
  function Avatar(props) {
    var p = props.player;
    var size = props.size || 40;
    var style = { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' };
    if (p && p.avatar) {
      return html`<img className="avatar" style=${style} src=${p.avatar} alt="" />`;
    }
    var name = (p && p.name) || '?';
    var seed = 0;
    var id = (p && p.id) || name;
    for (var i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) % 997;
    style.background = 'hsl(240, 4%, ' + (26 + (seed % 5) * 7) + '%)';
    return html`<div className="avatar avatar-fallback" style=${style}>${name.trim().charAt(0).toUpperCase() || '?'}</div>`;
  }

  function Pts(props) {
    return html`<span className=${'pts' + (props.big ? ' pts-big' : '')}>${props.plus ? '+' : ''}${fmtPts(props.value)}<span className="pts-unit"> pts</span></span>`;
  }

  function Banner(props) {
    return html`<div className=${'banner banner-' + (props.kind || 'info')} role="alert">
      <span>${props.children}</span>
      ${props.onClose ? html`<button className="banner-x" onClick=${props.onClose} aria-label="Dismiss">×</button>` : null}
    </div>`;
  }

  /* profile form used by create / join / edit */
  function ProfileFields(props) {
    var fileRef = useRef(null);
    function pick() { if (fileRef.current) fileRef.current.click(); }
    async function onFile(e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      props.onImgStatus && props.onImgStatus('working');
      try {
        var data = await resizeImage(f);
        props.onAvatar(data);
        props.onImgStatus && props.onImgStatus(null);
      } catch (err) {
        props.onImgStatus && props.onImgStatus(String((err && err.message) || 'Image upload failed.'));
      }
    }
    return html`<div className="profile-fields">
      <div className="photo-stack">
        <button type="button" className="photo-target" onClick=${pick} aria-label=${props.avatar ? 'Change photo' : 'Add a photo'}>
          <${Avatar} player=${{ id: props.idHint || 'x', name: props.name, avatar: props.avatar }} size=${96} />
          <span className="photo-fab" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </span>
        </button>
        ${props.imgStatus === 'working'
          ? html`<div className="hint photo-hint">Shrinking your photo…</div>`
          : props.imgStatus
            ? html`<div className="hint hint-error photo-hint">${props.imgStatus} Your picture was not changed — try another photo.</div>`
            : html`<div className="hint photo-hint">${props.avatar ? 'Tap your photo to change it.' : 'Tap to add a photo — stored as a tiny 128×128 thumbnail.'}</div>`}
        ${props.avatar ? html`<button type="button" className="link-btn" onClick=${function () { props.onAvatar(null); props.onImgStatus && props.onImgStatus(null); }}>Remove photo</button>` : null}
        <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${onFile} />
      </div>
      <label className="field">
        <span className="field-label">Display name</span>
        <input className="input" type="text" maxLength="30" value=${props.name}
          placeholder="e.g. Sam K" onInput=${function (e) { props.onName(e.target.value); }} />
      </label>
    </div>`;
  }

  /* ---------------- main app ---------------- */
  function App() {
    var _a = useState('loading'), status = _a[0], setStatus = _a[1]; // loading | ready | loadError
    var _b = useState(null), game = _b[0], setGame = _b[1];
    var _c = useState({}), players = _c[0], setPlayers = _c[1];
    var _d = useState([]), logs = _d[0], setLogs = _d[1];
    var _e = useState(null), localId = _e[0], setLocalId = _e[1];
    var _m = useState(null), authUser = _m[0], setAuthUser = _m[1];
    /* non-Firebase builds have no accounts, so auth is "ready" immediately */
    var _n = useState(MODE !== 'firebase'), authReady = _n[0], setAuthReady = _n[1];
    var _f = useState(false), refreshing = _f[0], setRefreshing = _f[1];
    var _g = useState(null), errorBanner = _g[0], setErrorBanner = _g[1];
    var _h = useState('board'), tab = _h[0], setTab = _h[1];
    var _i = useState(null), statsFor = _i[0], setStatsFor = _i[1];
    var _j = useState(false), editingProfile = _j[0], setEditingProfile = _j[1];
    var _k = useState(null), toast = _k[0], setToast = _k[1];
    var _l = useState(false), busy = _l[0], setBusy = _l[1];
    var toastTimer = useRef(null);

    function showToast(t) {
      setToast(t);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(function () { setToast(null); }, 4000);
    }

    async function loadAll(isRefresh) {
      if (isRefresh) setRefreshing(true);
      var results = await Promise.all([
        storeGet(KEY_GAME),
        storeGet(KEY_PLAYERS),
        storeGet(KEY_LOGS),
        storeGet(KEY_ME, false)
      ]);
      var g = results[0], p = results[1], l = results[2], me = results[3];
      var failed = [g, p, l].some(function (r) { return !r.ok; });
      if (failed) {
        if (isRefresh || status === 'ready') {
          setErrorBanner('Couldn’t reach shared storage. Showing the last data loaded — tap Refresh to retry.');
        } else {
          setStatus('loadError');
        }
      } else {
        setGame(g.value);
        setPlayers((p.value && p.value.players) || {});
        setLogs((l.value && l.value.logs) || []);
        if (me.ok && me.value && me.value.playerId) setLocalId(me.value.playerId);
        setStatus('ready');
        if (isRefresh) setErrorBanner(null);
      }
      setRefreshing(false);
    }

    /* accounts: watch sign-in state; Firebase keeps the session across reloads
       and devices, so signing in anywhere restores the same player */
    useEffect(function () {
      if (MODE !== 'firebase' || !FBA) return;
      var off = FBA.onAuthStateChanged(function (u) {
        setAuthUser(u ? { uid: u.uid, email: u.email } : null);
        setAuthReady(true);
      }, function (err) {
        setErrorBanner(authMessage(err));
        setAuthReady(true);
      });
      return function () { if (typeof off === 'function') off(); };
    }, []);

    /* game data is only read once signed in (database rules require auth) */
    useEffect(function () {
      if (MODE === 'firebase' && !authUser) return;
      loadAll(false);
    }, [authUser]);

    /* Firebase pushes changes live — subscribe and mirror into state */
    useEffect(function () {
      if (MODE !== 'firebase' || !FB || !authUser) return;
      function parse(v) {
        if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } }
        return (v && typeof v === 'object') ? v : null;
      }
      function sub(key, apply) {
        var ref = FB.ref(fbPath(key));
        var cb = function (snap) {
          apply(parse(snap.val()));
          setStatus(function (s) { return s === 'ready' ? s : 'ready'; });
        };
        ref.on('value', cb, function (err) {
          setErrorBanner('Live sync lost: ' + String((err && err.message) || err) + ' — tap Refresh to retry.');
        });
        return function () { ref.off('value', cb); };
      }
      var offs = [
        sub(KEY_GAME, function (g) { setGame(g); }),
        sub(KEY_PLAYERS, function (p) { setPlayers((p && p.players) || {}); }),
        sub(KEY_LOGS, function (l) { setLogs((l && l.logs) || []); })
      ];
      return function () { offs.forEach(function (off) { off(); }); };
    }, [authUser]);

    /* with accounts, the Firebase uid *is* the player id */
    var myId = MODE === 'firebase' ? ((authUser && authUser.uid) || null) : localId;
    var me = myId && players[myId] ? players[myId] : null;
    var isCreator = !!(me && game && game.creatorId === me.id);

    var achById = useMemo(function () {
      var m = {};
      if (game) game.achievements.forEach(function (a) { m[a.id] = a; });
      return m;
    }, [game]);

    var scores = useMemo(function () {
      var totals = {};
      var done = {};
      logs.forEach(function (lg) {
        var a = achById[lg.achId];
        if (!a) return;
        if (!done[lg.playerId]) done[lg.playerId] = {};
        if (done[lg.playerId][lg.achId]) return; /* count each achievement once per player */
        done[lg.playerId][lg.achId] = true;
        totals[lg.playerId] = (totals[lg.playerId] || 0) + a.points;
      });
      var counts = {};
      Object.keys(done).forEach(function (pid) { counts[pid] = Object.keys(done[pid]).length; });
      return { totals: totals, counts: counts, done: done };
    }, [logs, achById]);

    var ranking = useMemo(function () {
      var list = Object.keys(players).map(function (id) {
        return { player: players[id], points: scores.totals[id] || 0, logs: scores.counts[id] || 0 };
      });
      list.sort(function (a, b) {
        return (b.points - a.points) || a.player.name.localeCompare(b.player.name);
      });
      var rank = 0, prevPts = null;
      list.forEach(function (row, i) {
        if (row.points !== prevPts) { rank = i + 1; prevPts = row.points; }
        row.rank = rank;
      });
      return list;
    }, [players, scores]);

    /* ------------ mutations ------------ */
    async function withBusy(fn) {
      if (busy) return;
      setBusy(true);
      try { await fn(); }
      finally { setBusy(false); }
    }

    async function saveProfile(profile, isNew) {
      var res = await mutate(KEY_PLAYERS, { players: {} }, function (d) {
        var existing = d.players[profile.id] || {};
        d.players[profile.id] = {
          id: profile.id,
          name: profile.name,
          avatar: profile.avatar !== undefined ? profile.avatar : (existing.avatar || null),
          contact: profile.contact || existing.contact || null,
          joinedAt: existing.joinedAt || Date.now(),
          updatedAt: Date.now()
        };
        return d;
      });
      if (!res.ok) return res;
      if (isNew && MODE !== 'firebase') {
        /* without accounts, identity is remembered per device */
        var idRes = await storeSet(KEY_ME, { playerId: profile.id }, false);
        if (!idRes.ok) return idRes;
        setLocalId(profile.id);
      }
      setPlayers((res.value && res.value.players) || {});
      return { ok: true };
    }

    /* the signed-in account, as a profile contact record */
    function myContact() {
      if (MODE === 'firebase' && authUser && authUser.email) {
        return { type: 'email', norm: authUser.email.toLowerCase(), display: authUser.email };
      }
      return null;
    }

    async function createGame(form) {
      return withBusy(async function () {
        var playerId = MODE === 'firebase' ? authUser.uid : uid();
        var gameDoc = {
          version: 1,
          joinCode: form.joinCode.trim().toUpperCase(),
          creatorId: playerId,
          phase: 'draft',
          createdAt: Date.now(),
          finalizedAt: null,
          achievements: []
        };
        var res = await mutate(KEY_GAME, null, function (existing) {
          if (existing) return { __abort: 'A game already exists here — refresh and join it instead.' };
          return gameDoc;
        });
        if (!res.ok) { setErrorBanner(res.error); if (res.aborted) loadAll(true); return; }
        var pr = await saveProfile({ id: playerId, name: form.name.trim(), avatar: form.avatar, contact: myContact() || form.contact }, true);
        if (!pr.ok) { setErrorBanner('The game was created but saving your profile failed: ' + pr.error); return; }
        setGame(res.value);
        setErrorBanner(null);
      });
    }

    async function joinGame(form) {
      return withBusy(async function () {
        var fresh = await storeGet(KEY_GAME);
        if (!fresh.ok || !fresh.value) { setErrorBanner('Couldn’t load the game to join. Tap Refresh and try again.'); return; }
        if (form.joinCode.trim().toUpperCase() !== fresh.value.joinCode) {
          setErrorBanner('That join code doesn’t match this game. Check it with the person who set the game up.');
          return;
        }
        var playerId;
        if (MODE === 'firebase') {
          playerId = authUser.uid;
        } else {
          /* no accounts here: same email/phone as an existing player signs back
             into that profile instead of creating a duplicate */
          var roster = await storeGet(KEY_PLAYERS);
          var rosterMap = (roster.ok && roster.value && roster.value.players) || {};
          var existing = form.contact ? findByContact(rosterMap, form.contact.norm) : null;
          if (existing) {
            var idRes = await storeSet(KEY_ME, { playerId: existing.id }, false);
            if (!idRes.ok) { setErrorBanner('Signing in failed: ' + idRes.error); return; }
            setPlayers(rosterMap);
            setLocalId(existing.id);
            setGame(fresh.value);
            setErrorBanner(null);
            showToast({ msg: 'Welcome back, ' + existing.name + ' — signed in to your existing profile.' });
            return;
          }
          playerId = uid();
        }
        var pr = await saveProfile({ id: playerId, name: form.name.trim(), avatar: form.avatar, contact: myContact() || form.contact }, true);
        if (!pr.ok) { setErrorBanner('Joining failed: ' + pr.error); return; }
        setGame(fresh.value);
        setErrorBanner(null);
        setTab('board');
      });
    }

    async function logOut() {
      try {
        await FBA.signOut();
        setEditingProfile(false);
        setStatsFor(null);
        setGame(null);
        setPlayers({});
        setLogs([]);
        setStatus('loading');
        setErrorBanner(null);
      } catch (err) {
        setErrorBanner('Couldn’t log out: ' + authMessage(err));
      }
    }

    async function updateMyProfile(form) {
      return withBusy(async function () {
        var pr = await saveProfile({ id: myId, name: form.name.trim(), avatar: form.avatar }, false);
        if (!pr.ok) { setErrorBanner('Saving your profile failed: ' + pr.error); return; }
        setEditingProfile(false);
        showToast({ msg: 'Profile updated.' });
      });
    }

    /* achievements added before the approval feature count as approved */
    function achStatus(a) { return a.status || 'approved'; }

    async function addOrEditAchievement(data, editId) {
      return withBusy(async function () {
        var wasPending = false;
        var res = await mutate(KEY_GAME, null, function (g) {
          if (!g) return { __abort: 'The game vanished — tap Refresh.' };
          if (g.phase !== 'draft') return { __abort: 'The list has been finalized — it can’t be changed any more.' };
          var amCreator = g.creatorId === myId;
          if (editId) {
            var t = g.achievements.find(function (a) { return a.id === editId; });
            if (!t) return { __abort: 'That achievement was deleted by someone else. Refresh to see the latest list.' };
            if (!amCreator && !(achStatus(t) === 'pending' && t.createdBy === myId)) {
              return { __abort: 'Only the creator can change approved achievements. You can only edit your own pending suggestions.' };
            }
            t.title = data.title; t.desc = data.desc; t.points = data.points;
          } else {
            wasPending = !amCreator;
            g.achievements.push({
              id: uid(), title: data.title, desc: data.desc, points: data.points,
              status: amCreator ? 'approved' : 'pending',
              createdBy: myId, createdAt: Date.now()
            });
          }
          return g;
        });
        if (!res.ok) { setErrorBanner(res.error); if (res.aborted) loadAll(true); return; }
        setGame(res.value);
        if (wasPending) showToast({ msg: 'Suggestion sent — waiting for the creator’s OK.' });
      });
    }

    async function deleteAchievement(id) {
      return withBusy(async function () {
        var res = await mutate(KEY_GAME, null, function (g) {
          if (!g) return { __abort: 'The game vanished — tap Refresh.' };
          if (g.phase !== 'draft') return { __abort: 'The list has been finalized — it can’t be changed any more.' };
          var amCreator = g.creatorId === myId;
          var t = g.achievements.find(function (a) { return a.id === id; });
          if (t && !amCreator && !(achStatus(t) === 'pending' && t.createdBy === myId)) {
            return { __abort: 'Only the creator can remove approved achievements. You can only withdraw your own pending suggestions.' };
          }
          g.achievements = g.achievements.filter(function (a) { return a.id !== id; });
          return g;
        });
        if (!res.ok) { setErrorBanner(res.error); if (res.aborted) loadAll(true); return; }
        setGame(res.value);
      });
    }

    async function approveAchievement(id) {
      return withBusy(async function () {
        var res = await mutate(KEY_GAME, null, function (g) {
          if (!g) return { __abort: 'The game vanished — tap Refresh.' };
          if (g.phase !== 'draft') return { __abort: 'The list has been finalized — it can’t be changed any more.' };
          if (g.creatorId !== myId) return { __abort: 'Only the game creator can approve suggestions.' };
          var t = g.achievements.find(function (a) { return a.id === id; });
          if (!t) return { __abort: 'That suggestion was withdrawn. Refresh to see the latest list.' };
          t.status = 'approved';
          return g;
        });
        if (!res.ok) { setErrorBanner(res.error); if (res.aborted) loadAll(true); return; }
        setGame(res.value);
      });
    }

    async function finalizeGame() {
      return withBusy(async function () {
        var res = await mutate(KEY_GAME, null, function (g) {
          if (!g) return { __abort: 'The game vanished — tap Refresh.' };
          if (g.creatorId !== myId) return { __abort: 'Only the game creator can finalize.' };
          if (g.phase === 'play') return { __abort: 'Already finalized.' };
          var approved = g.achievements.filter(function (a) { return achStatus(a) === 'approved'; });
          if (!approved.length) return { __abort: 'Approve or add at least one achievement before finalizing.' };
          g.achievements = approved;
          g.phase = 'play';
          g.finalizedAt = Date.now();
          return g;
        });
        if (!res.ok) { setErrorBanner(res.error); if (res.aborted) loadAll(true); return; }
        setGame(res.value);
        setTab('board');
        showToast({ msg: 'List finalized — the game is on!' });
      });
    }

    /* tick = mark done (+points), untick = take it back off */
    async function toggleAchievement(ach) {
      return withBusy(async function () {
        var ticked = { current: false };
        var res = await mutate(KEY_LOGS, { logs: [] }, function (d) {
          var mine = function (lg) { return lg.playerId === myId && lg.achId === ach.id; };
          if (d.logs.some(mine)) {
            d.logs = d.logs.filter(function (lg) { return !mine(lg); });
          } else {
            ticked.current = true;
            d.logs.push({ id: uid(), playerId: myId, achId: ach.id, at: Date.now() });
          }
          return d;
        });
        if (!res.ok) { setErrorBanner('Couldn’t save that: ' + res.error); return; }
        setLogs(res.value.logs);
        showToast({
          msg: ticked.current
            ? '“' + ach.title + '” ticked — +' + fmtPts(ach.points) + ' pts'
            : '“' + ach.title + '” unticked — −' + fmtPts(ach.points) + ' pts'
        });
      });
    }

    /* ------------ screens ------------ */
    if (!authReady) {
      return html`<div className="shell center-screen">
        <div className="spinner" aria-hidden="true"></div>
        <p className="muted">Checking your account…</p>
      </div>`;
    }

    /* accounts available but nobody signed in */
    if (MODE === 'firebase' && !authUser) {
      return html`<div className="shell">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">Achievement</span>
            <h1 className="h1">Leaderboard</h1>
          </div>
        </header>
        ${errorBanner ? html`<${Banner} kind="error" onClose=${function () { setErrorBanner(null); }}>${errorBanner}<//>` : null}
        <${AuthScreen} />
      </div>`;
    }

    if (status === 'loading') {
      return html`<div className="shell center-screen">
        <div className="spinner" aria-hidden="true"></div>
        <p className="muted">Loading the game…</p>
      </div>`;
    }

    if (status === 'loadError') {
      return html`<div className="shell center-screen">
        <h1 className="h1">Achievement Leaderboard</h1>
        <p className="muted">Couldn’t reach shared storage, so the game can’t load right now.</p>
        <button className="btn btn-primary" onClick=${function () { setStatus('loading'); loadAll(false); }}>Try again</button>
      </div>`;
    }

    var headerBar = html`<header className="topbar">
      <div className="topbar-title">
        <span className="eyebrow">Achievement</span>
        <h1 className="h1">Leaderboard</h1>
      </div>
      <div className="topbar-actions">
        ${me ? html`<button className="topbar-avatar" onClick=${function () { setEditingProfile(true); }} aria-label="Edit my profile">
          <${Avatar} player=${me} size=${38} />
        </button>` : null}
        <button className=${'btn btn-refresh' + (refreshing ? ' spinning' : '')}
          onClick=${function () { loadAll(true); }} disabled=${refreshing} aria-label="Refresh">
          <span className="refresh-icon" aria-hidden="true">↻</span>
        </button>
      </div>
    </header>`;

    var banners = html`<${React.Fragment}>
      ${MODE === 'memory' ? html`<${Banner} kind="warn">
        ${FB_ERR
          ? 'Firebase couldn’t start: ' + FB_ERR + '. Running in local demo mode — nothing is shared and it resets when the page closes.'
          : 'No backend is configured, so the game is running in local demo mode — nothing here is shared with other players and it resets when the page closes.'}
      <//>` : null}
      ${errorBanner ? html`<${Banner} kind="error" onClose=${function () { setErrorBanner(null); }}>${errorBanner}<//>` : null}
    <//>`;

    /* not set up yet */
    if (!game) {
      return html`<div className="shell">
        ${headerBar}${banners}
        <${SetupScreen} busy=${busy} authEmail=${authUser && authUser.email} onCreate=${createGame} />
      </div>`;
    }

    /* game exists but this account has no profile in it yet */
    if (!me) {
      return html`<div className="shell">
        ${headerBar}${banners}
        <${JoinScreen} busy=${busy} phase=${game.phase} players=${players}
          authEmail=${authUser && authUser.email} onJoin=${joinGame} />
      </div>`;
    }

    var body;
    if (game.phase === 'draft') {
      body = html`<${DraftScreen}
        game=${game} players=${players} me=${me} isCreator=${isCreator} busy=${busy}
        onSave=${addOrEditAchievement} onDelete=${deleteAchievement}
        onApprove=${approveAchievement} onFinalize=${finalizeGame} />`;
    } else {
      body = html`<${React.Fragment}>
        <nav className="segmented" role="tablist">
          ${[['board', 'Leaderboard'], ['ach', 'Achievements']].map(function (t) {
            return html`<button key=${t[0]} role="tab" aria-selected=${tab === t[0]}
              className=${'seg-btn' + (tab === t[0] ? ' seg-btn-active' : '')}
              onClick=${function () { setTab(t[0]); }}>${t[1]}</button>`;
          })}
        </nav>
        ${tab === 'ach'
          ? html`<${AchievementsTab} game=${game} busy=${busy} myDone=${scores.done[myId] || {}}
              myPoints=${scores.totals[myId] || 0} onToggle=${toggleAchievement} />`
          : html`<${BoardTab} ranking=${ranking} myId=${myId} game=${game} onOpen=${setStatsFor}
              logs=${logs} players=${players} achById=${achById} />`}
      <//>`;
    }

    return html`<div className="shell">
      ${headerBar}${banners}
      ${body}
      ${statsFor ? html`<${Sheet} onClose=${function () { setStatsFor(null); }}>
        <${StatsView} player=${players[statsFor]} logs=${logs} achById=${achById} scores=${scores} isMe=${statsFor === myId} />
      <//>` : null}
      ${editingProfile ? html`<${Sheet} onClose=${function () { setEditingProfile(false); }}>
        <${EditProfile} me=${me} busy=${busy} onSave=${updateMyProfile} onLogOut=${logOut} />
      <//>` : null}
      ${toast ? html`<div className="toast" role="status">
        <span>${toast.msg}</span>
        ${toast.undoId ? html`<button className="toast-undo" onClick=${function () { undoLog(toast.undoId); }}>Undo</button>` : null}
      </div>` : null}
    </div>`;
  }

  /* ---------------- onboarding screens ---------------- */
  function PrivacyNote() {
    return html`<div className="privacy-note">
      <strong>Everything in the game is public to the group.</strong>${' '}
      Your name, picture, score and activity are visible to everyone in the game.
      Your email or phone number is used only to sign you in and is never shown to other players.
    </div>`;
  }

  /* log in / sign up — only used when Firebase accounts are available */
  function AuthScreen(props) {
    var _a = useState('login'), mode = _a[0], setMode = _a[1];
    var _b = useState(''), email = _b[0], setEmail = _b[1];
    var _c = useState(''), pw = _c[0], setPw = _c[1];
    var _d = useState(''), pw2 = _d[0], setPw2 = _d[1];
    var _e = useState(null), err = _e[0], setErr = _e[1];
    var _f = useState(null), note = _f[0], setNote = _f[1];
    var _g = useState(false), busy = _g[0], setBusy = _g[1];
    var isSignUp = mode === 'signup';

    async function submit(e) {
      if (e) e.preventDefault();
      setErr(null); setNote(null);
      if (!email.trim()) { setErr('Enter your email address.'); return; }
      if (!pw) { setErr('Enter your password.'); return; }
      if (isSignUp) {
        if (pw.length < 6) { setErr('Passwords need to be at least 6 characters.'); return; }
        if (pw !== pw2) { setErr('Those passwords don’t match.'); return; }
      }
      setBusy(true);
      var res = isSignUp ? await authSignUp(email, pw) : await authSignIn(email, pw);
      setBusy(false);
      if (!res.ok) setErr(res.error);
      /* on success the auth listener swaps the screen out */
    }

    async function forgot() {
      setErr(null); setNote(null);
      if (!email.trim()) { setErr('Enter your email address first, then tap Forgot password.'); return; }
      setBusy(true);
      var res = await authReset(email);
      setBusy(false);
      if (res.ok) setNote('Password reset email sent to ' + email.trim() + '. Check your inbox (and spam).');
      else setErr(res.error);
    }

    return html`<main className="card">
      <span className="eyebrow">${isSignUp ? 'New account' : 'Welcome back'}</span>
      <h2 className="h2">${isSignUp ? 'Create your account' : 'Log in'}</h2>
      <p className="muted">${isSignUp
        ? 'Your account works on any phone, tablet or computer — log in and your profile, points and history come with you.'
        : 'Log in with the email and password you signed up with.'}</p>

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected=${!isSignUp} className=${'seg-btn' + (!isSignUp ? ' seg-btn-active' : '')}
          onClick=${function () { setMode('login'); setErr(null); setNote(null); }}>Log in</button>
        <button role="tab" aria-selected=${isSignUp} className=${'seg-btn' + (isSignUp ? ' seg-btn-active' : '')}
          onClick=${function () { setMode('signup'); setErr(null); setNote(null); }}>Sign up</button>
      </div>

      <form onSubmit=${submit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" autoComplete="email" inputMode="email" autoCapitalize="none"
            value=${email} placeholder="you@example.com"
            onInput=${function (ev) { setEmail(ev.target.value); }} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input className="input" type="password"
            autoComplete=${isSignUp ? 'new-password' : 'current-password'}
            value=${pw} placeholder=${isSignUp ? 'At least 6 characters' : ''}
            onInput=${function (ev) { setPw(ev.target.value); }} />
        </label>
        ${isSignUp ? html`<label className="field">
          <span className="field-label">Confirm password</span>
          <input className="input" type="password" autoComplete="new-password" value=${pw2}
            onInput=${function (ev) { setPw2(ev.target.value); }} />
        </label>` : null}
        ${err ? html`<div className="hint hint-error">${err}</div>` : null}
        ${note ? html`<div className="hint hint-good">${note}</div>` : null}
        <button className="btn btn-primary btn-block" type="submit" disabled=${busy}>
          ${busy ? (isSignUp ? 'Creating account…' : 'Logging in…') : (isSignUp ? 'Create account' : 'Log in')}
        </button>
      </form>
      ${!isSignUp ? html`<button className="link-btn link-btn-center" disabled=${busy} onClick=${forgot}>Forgot password?</button>` : null}
      <${PrivacyNote} />
    </main>`;
  }

  function ContactField(props) {
    return html`<label className="field">
      <span className="field-label">Email or mobile number</span>
      <input className="input" type="text" inputMode="email" autoCapitalize="none" maxLength="60"
        value=${props.value} placeholder="you@example.com or 0400 000 000"
        onInput=${function (e) { props.onChange(e.target.value); }} />
      ${props.error ? html`<div className="hint hint-error">${props.error}</div>` : null}
    </label>`;
  }

  function SetupScreen(props) {
    var _a = useState(1), step = _a[0], setStep = _a[1];
    var _b = useState(''), contactRaw = _b[0], setContactRaw = _b[1];
    var _c = useState(null), contactErr = _c[0], setContactErr = _c[1];
    var _d = useState(makeJoinCode), joinCode = _d[0], setJoinCode = _d[1];
    var _e = useState(''), name = _e[0], setName = _e[1];
    var _f = useState(null), avatar = _f[0], setAvatar = _f[1];
    var _g = useState(null), imgStatus = _g[0], setImgStatus = _g[1];

    function next() {
      if (!props.authEmail) {
        var c = parseContact(contactRaw);
        if (!c) { setContactErr('Enter a valid email address or mobile number.'); return; }
      }
      if (joinCode.trim().length < 3) { setContactErr('The join code needs at least 3 characters.'); return; }
      setContactErr(null);
      setStep(2);
    }

    if (step === 1) {
      return html`<main className="card">
        <span className="eyebrow">New game · Step 1 of 2</span>
        <h2 className="h2">${props.authEmail ? 'Set up the game' : 'Sign up'}</h2>
        <p className="muted">No game exists here yet. Whoever sets it up becomes the <strong>game creator</strong> —
          the only person who can approve achievements and finalize the list.</p>
        ${props.authEmail
          ? null
          : html`<${ContactField} value=${contactRaw} error=${contactErr} onChange=${setContactRaw} />`}
        <label className="field">
          <span className="field-label">Join code (share this with your group)</span>
          <input className="input input-code" type="text" maxLength="10" value=${joinCode}
            onInput=${function (e) { setJoinCode(e.target.value.toUpperCase()); }} />
          ${props.authEmail && contactErr ? html`<div className="hint hint-error">${contactErr}</div>` : null}
        </label>
        <${PrivacyNote} />
        <button className="btn btn-primary btn-block" onClick=${next}>Continue</button>
      </main>`;
    }
    return html`<main className="card">
      <span className="eyebrow">New game · Step 2 of 2</span>
      <h2 className="h2">Create your profile</h2>
      <p className="muted">This is how you’ll appear on the leaderboard and in the activity feed.</p>
      <${ProfileFields} name=${name} avatar=${avatar} imgStatus=${imgStatus}
        onName=${setName} onAvatar=${setAvatar} onImgStatus=${setImgStatus} />
      <div className="form-actions form-actions-split">
        <button className="btn btn-secondary" onClick=${function () { setStep(1); }}>Back</button>
        <button className="btn btn-primary" disabled=${!name.trim() || props.busy}
          onClick=${function () { props.onCreate({ name: name, avatar: avatar, joinCode: joinCode, contact: parseContact(contactRaw) }); }}>
          ${props.busy ? 'Creating…' : 'Create game'}
        </button>
      </div>
    </main>`;
  }

  function JoinScreen(props) {
    var _a = useState(1), step = _a[0], setStep = _a[1];
    var _b = useState(''), contactRaw = _b[0], setContactRaw = _b[1];
    var _c = useState(null), contactErr = _c[0], setContactErr = _c[1];
    var _d = useState(''), code = _d[0], setCode = _d[1];
    var _e = useState(''), name = _e[0], setName = _e[1];
    var _f = useState(null), avatar = _f[0], setAvatar = _f[1];
    var _g = useState(null), imgStatus = _g[0], setImgStatus = _g[1];

    function next() {
      if (!code.trim()) { setContactErr('Enter the game’s join code.'); return; }
      if (!props.authEmail) {
        var c = parseContact(contactRaw);
        if (!c) { setContactErr('Enter a valid email address or mobile number.'); return; }
        setContactErr(null);
        /* already signed up on another device? go straight back in */
        if (findByContact(props.players || {}, c.norm)) {
          props.onJoin({ joinCode: code, contact: c, name: '', avatar: undefined });
          return;
        }
      }
      setContactErr(null);
      setStep(2);
    }

    if (step === 1) {
      return html`<main className="card">
        <span className="eyebrow">Join · Step 1 of 2</span>
        <h2 className="h2">Join the game</h2>
        ${props.phase === 'play'
          ? html`<p className="muted">The achievement list is already locked — you’ll get the list as it stands and start on zero points.</p>`
          : html`<p className="muted">The group is still drafting achievements. Join in to suggest your ideas.</p>`}
        ${props.authEmail
          ? null
          : html`<p className="muted">Already signed up on another device? Enter the same email or number to get your profile back.</p>`}
        <label className="field">
          <span className="field-label">Join code</span>
          <input className="input input-code" type="text" maxLength="10" value=${code} placeholder="ABCDE"
            onInput=${function (e) { setCode(e.target.value.toUpperCase()); }} />
          ${props.authEmail && contactErr ? html`<div className="hint hint-error">${contactErr}</div>` : null}
        </label>
        ${props.authEmail
          ? null
          : html`<${ContactField} value=${contactRaw} error=${contactErr} onChange=${setContactRaw} />`}
        <${PrivacyNote} />
        <button className="btn btn-primary btn-block" disabled=${props.busy} onClick=${next}>
          ${props.busy ? 'Signing in…' : 'Continue'}
        </button>
      </main>`;
    }
    return html`<main className="card">
      <span className="eyebrow">Join · Step 2 of 2</span>
      <h2 className="h2">Create your profile</h2>
      <p className="muted">This is how you’ll appear on the leaderboard and in the activity feed.</p>
      <${ProfileFields} name=${name} avatar=${avatar} imgStatus=${imgStatus}
        onName=${setName} onAvatar=${setAvatar} onImgStatus=${setImgStatus} />
      <div className="form-actions form-actions-split">
        <button className="btn btn-secondary" onClick=${function () { setStep(1); }}>Back</button>
        <button className="btn btn-primary" disabled=${!name.trim() || props.busy}
          onClick=${function () { props.onJoin({ name: name, avatar: avatar, joinCode: code, contact: parseContact(contactRaw) }); }}>
          ${props.busy ? 'Joining…' : 'Join game'}
        </button>
      </div>
    </main>`;
  }

  function EditProfile(props) {
    var _a = useState(props.me.name), name = _a[0], setName = _a[1];
    var _b = useState(props.me.avatar), avatar = _b[0], setAvatar = _b[1];
    var _c = useState(null), imgStatus = _c[0], setImgStatus = _c[1];
    return html`<div>
      <span className="eyebrow">My profile</span>
      <h2 className="h2">Edit profile</h2>
      <${ProfileFields} idHint=${props.me.id} name=${name} avatar=${avatar} imgStatus=${imgStatus}
        onName=${setName} onAvatar=${setAvatar} onImgStatus=${setImgStatus} />
      ${props.me.contact ? html`<div className="contact-line">
        <span className="field-label">${MODE === 'firebase' ? 'Logged in as' : 'Signed up with'}</span>
        <span className="contact-value">${props.me.contact.display}</span>
      </div>` : null}
      <button className="btn btn-primary btn-block" disabled=${!name.trim() || props.busy}
        onClick=${function () { props.onSave({ name: name, avatar: avatar }); }}>
        ${props.busy ? 'Saving…' : 'Save changes'}
      </button>
      ${MODE === 'firebase' ? html`<button className="btn btn-block" disabled=${props.busy} onClick=${props.onLogOut}>
        Log out
      </button>` : null}
    </div>`;
  }

  /* ---------------- draft phase ---------------- */
  function AchievementForm(props) {
    var init = props.initial || {};
    var _a = useState(init.title || ''), title = _a[0], setTitle = _a[1];
    var _b = useState(init.desc || ''), desc = _b[0], setDesc = _b[1];
    var _c = useState(init.points != null ? String(init.points) : ''), pts = _c[0], setPts = _c[1];
    var n = parseInt(pts, 10);
    var valid = title.trim().length > 0 && !isNaN(n) && n >= 1 && n <= 100000;
    return html`<div className="ach-form">
      <label className="field">
        <span className="field-label">Title</span>
        <input className="input" type="text" maxLength="60" value=${title} placeholder="e.g. Aced the spelling quiz"
          onInput=${function (e) { setTitle(e.target.value); }} />
      </label>
      <label className="field">
        <span className="field-label">Description <span className="optional">optional</span></span>
        <input className="input" type="text" maxLength="120" value=${desc} placeholder="Short note about how to earn it"
          onInput=${function (e) { setDesc(e.target.value); }} />
      </label>
      <label className="field field-points">
        <span className="field-label">Points</span>
        <input className="input" type="number" inputMode="numeric" min="1" max="100000" value=${pts} placeholder="10"
          onInput=${function (e) { setPts(e.target.value); }} />
      </label>
      <div className="form-actions">
        ${props.onCancel ? html`<button className="btn btn-secondary" onClick=${props.onCancel}>Cancel</button>` : null}
        <button className="btn btn-primary" disabled=${!valid || props.busy}
          onClick=${function () {
            props.onSave({ title: title.trim(), desc: desc.trim(), points: n });
            if (!props.initial) { setTitle(''); setDesc(''); setPts(''); }
          }}>
          ${props.initial ? 'Save changes' : 'Add achievement'}
        </button>
      </div>
    </div>`;
  }

  function DraftScreen(props) {
    var game = props.game, players = props.players;
    var _a = useState(null), editingId = _a[0], setEditingId = _a[1];
    var _b = useState(null), deletingId = _b[0], setDeletingId = _b[1];
    var _c = useState(false), confirmingFinalize = _c[0], setConfirming = _c[1];
    var creator = players[game.creatorId];
    var creatorName = (creator && creator.name) || 'the creator';

    function statusOf(a) { return a.status || 'approved'; }
    var approved = game.achievements.filter(function (a) { return statusOf(a) === 'approved'; });
    var pending = game.achievements.filter(function (a) { return statusOf(a) === 'pending'; });
    var totalPts = approved.reduce(function (s, a) { return s + a.points; }, 0);

    function achRow(a) {
      var by = players[a.createdBy];
      var isPending = statusOf(a) === 'pending';
      /* approved items: creator only; pending items: creator or the player who suggested it */
      var canModify = props.isCreator || (isPending && a.createdBy === props.me.id);
      if (editingId === a.id) {
        return html`<li key=${a.id} className="ach-row ach-row-editing">
          <${AchievementForm} initial=${a} busy=${props.busy}
            onSave=${function (data) { props.onSave(data, a.id); setEditingId(null); }}
            onCancel=${function () { setEditingId(null); }} />
        </li>`;
      }
      return html`<li key=${a.id} className=${'ach-row' + (isPending ? ' ach-row-pending' : '')}>
        <div className="ach-main">
          <div className="ach-title">${a.title}</div>
          ${a.desc ? html`<div className="ach-desc">${a.desc}</div>` : null}
          <div className="ach-by">
            ${isPending ? 'suggested by ' : 'added by '}${(by && by.name) || 'a former player'}
            ${isPending && !props.isCreator ? html`<span className="pending-badge">waiting for ${creatorName}’s OK</span>` : null}
          </div>
        </div>
        <div className="ach-side">
          <${Pts} value=${a.points} />
          <div className="ach-actions">
            ${isPending && props.isCreator ? html`<button className="btn btn-mini btn-approve" disabled=${props.busy}
              onClick=${function () { props.onApprove(a.id); }}>Approve</button>` : null}
            ${canModify ? html`<button className="btn btn-mini" onClick=${function () { setEditingId(a.id); setDeletingId(null); }}>Edit</button>` : null}
            ${canModify ? (deletingId === a.id
              ? html`<button className="btn btn-mini btn-danger" disabled=${props.busy}
                  onClick=${function () { props.onDelete(a.id); setDeletingId(null); }}>${isPending && props.isCreator ? 'Really decline?' : 'Really delete?'}</button>`
              : html`<button className="btn btn-mini" onClick=${function () { setDeletingId(a.id); }}>${isPending && props.isCreator ? 'Decline' : isPending ? 'Withdraw' : 'Delete'}</button>`) : null}
          </div>
        </div>
      </li>`;
    }

    return html`<main>
      ${props.isCreator
        ? html`<div className="status-line status-creator">You’re the game creator. Approve or decline suggestions, and when the list is ready, finalize it below — that locks it for good and starts the game.</div>`
        : html`<div className="status-line">The achievement list is still open — ${creatorName} hasn’t finalized it yet. Suggest your ideas; ${creatorName} gives each one the OK before it joins the list.</div>`}

      ${pending.length ? html`<section className="card">
        <span className="eyebrow">${props.isCreator ? 'Needs your OK' : 'Waiting for the OK'}</span>
        <h2 className="h2">Suggestions <span className="count-chip">${pending.length}</span></h2>
        ${props.isCreator ? html`<p className="muted">Approve to put a suggestion on the list, or decline to drop it.</p>` : null}
        <ul className="ach-list">${pending.map(achRow)}</ul>
      </section>` : null}

      <section className="card">
        <span className="eyebrow">The list</span>
        <h2 className="h2">Achievements <span className="count-chip">${approved.length}</span></h2>
        ${approved.length === 0
          ? html`<p className="muted">${props.isCreator ? 'Nothing on the list yet. Add achievements below, or approve suggestions as they come in.' : 'Nothing approved yet. Suggest the first achievement below!'}</p>`
          : html`<ul className="ach-list">${approved.map(achRow)}</ul>`}
      </section>

      <section className="card">
        <span className="eyebrow">Contribute</span>
        <h2 className="h2">${props.isCreator ? 'Add an achievement' : 'Suggest an achievement'}</h2>
        ${props.isCreator
          ? null
          : html`<p className="muted">Your idea goes to ${creatorName} for an OK before it joins the list.</p>`}
        <${AchievementForm} busy=${props.busy} onSave=${function (data) { props.onSave(data, null); }} />
      </section>

      ${props.isCreator ? html`<section className="card card-finalize">
        <span className="eyebrow">Creator only</span>
        <h2 className="h2">Finalize the list</h2>
        <div className="summary-row">
          <div className="summary-stat"><div className="summary-num">${approved.length}</div><div className="summary-label">achievements</div></div>
          <div className="summary-stat"><div className="summary-num">${fmtPts(totalPts)}</div><div className="summary-label">points per full sweep</div></div>
        </div>
        <p className="muted">Review the full list above. Finalizing is <strong>permanent</strong>: nobody — including you —
          can add, edit or remove achievements or change point values afterwards.</p>
        ${pending.length ? html`<p className="muted"><strong>${pending.length}</strong> suggestion${pending.length === 1 ? ' is' : 's are'} still waiting for your OK — finalizing now discards ${pending.length === 1 ? 'it' : 'them'}.</p>` : null}
        ${confirmingFinalize
          ? html`<div className="confirm-box">
              <p><strong>Lock the list forever and start the game?</strong>${pending.length ? ' Unapproved suggestions will be discarded.' : ''}</p>
              <div className="form-actions">
                <button className="btn btn-secondary" onClick=${function () { setConfirming(false); }}>Cancel</button>
                <button className="btn btn-primary" disabled=${props.busy} onClick=${props.onFinalize}>
                  ${props.busy ? 'Finalizing…' : 'Yes, finalize'}
                </button>
              </div>
            </div>`
          : html`<button className="btn btn-primary btn-block" disabled=${approved.length === 0}
              onClick=${function () { setConfirming(true); }}>Finalize…</button>`}
      </section>` : null}
    </main>`;
  }

  /* ---------------- play phase tabs ---------------- */
  function BoardTab(props) {
    var recent = props.logs.slice(-25).reverse();
    return html`<main>
      <section className="card">
        <span className="eyebrow">Standings</span>
        <h2 className="h2">Leaderboard</h2>
        ${props.ranking.length === 0 ? html`<p className="muted">Nobody has joined yet.</p>` : null}
        <ol className="board">
          ${props.ranking.map(function (row) {
            var isMe = row.player.id === props.myId;
            return html`<li key=${row.player.id}>
              <button className=${'board-row' + (isMe ? ' board-row-me' : '')}
                onClick=${function () { props.onOpen(row.player.id); }}>
                <span className=${'board-rank' + (row.rank <= 3 && row.points > 0 ? ' board-rank-top' : '')}>${row.rank}</span>
                <${Avatar} player=${row.player} size=${44} />
                <span className="board-name">
                  ${row.player.name}${isMe ? html`<span className="me-tag"> (you)</span>` : null}
                  ${props.game.creatorId === row.player.id ? html`<span className="creator-tag">creator</span>` : null}
                </span>
                <${Pts} value=${row.points} big=${true} />
              </button>
            </li>`;
          })}
        </ol>
        <p className="hint">Tap a player to see their profile and every achievement they’ve ticked off.</p>
      </section>
      <section className="card">
        <span className="eyebrow">Recent activity</span>
        ${recent.length === 0 ? html`<p className="muted" style=${{ marginTop: '8px' }}>Nothing ticked off yet — be the first on the board.</p>` : null}
        <ul className="feed" style=${{ marginTop: '10px' }}>
          ${recent.map(function (lg) {
            var p = props.players[lg.playerId];
            var a = props.achById[lg.achId];
            return html`<li key=${lg.id} className="feed-row">
              <${Avatar} player=${p} size=${36} />
              <div className="feed-main">
                <div><strong>${(p && p.name) || 'A former player'}</strong> ticked off “${(a && a.title) || 'an achievement'}”</div>
                <div className="feed-time">${timeAgo(lg.at)}</div>
              </div>
              ${a ? html`<${Pts} value=${a.points} plus=${true} />` : null}
            </li>`;
          })}
        </ul>
      </section>
    </main>`;
  }

  function AchievementsTab(props) {
    var total = props.game.achievements.length;
    var doneCount = props.game.achievements.filter(function (a) { return props.myDone[a.id]; }).length;
    return html`<main>
      <section className="card">
        <span className="eyebrow">Honour system — tick what you’ve done</span>
        <h2 className="h2">Achievements</h2>
        <p className="muted">You’ve ticked ${doneCount} of ${total} · ${fmtPts(props.myPoints)} pts. Tap to tick, tap again to untick.</p>
        <ul className="ach-list">
          ${props.game.achievements.map(function (a) {
            var done = !!props.myDone[a.id];
            return html`<li key=${a.id}>
              <button className=${'log-row' + (done ? ' log-row-done' : '')} disabled=${props.busy}
                role="checkbox" aria-checked=${done}
                onClick=${function () { props.onToggle(a); }}>
                <span className=${'check' + (done ? ' check-on' : '')} aria-hidden="true">
                  ${done ? html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` : null}
                </span>
                <div className="ach-main">
                  <div className="ach-title">${a.title}</div>
                  ${a.desc ? html`<div className="ach-desc">${a.desc}</div>` : null}
                </div>
                <${Pts} value=${a.points} big=${done} />
              </button>
            </li>`;
          })}
        </ul>
      </section>
    </main>`;
  }

  /* stats card: also used as the "Me" tab */
  function StatsView(props) {
    var p = props.player;
    if (!p) return html`<p className="muted">This player is no longer in the game.</p>`;
    var when = {};
    props.logs.forEach(function (lg) {
      if (lg.playerId === p.id && !when[lg.achId]) when[lg.achId] = lg.at;
    });
    var doneSet = props.scores.done[p.id] || {};
    var rows = Object.keys(doneSet).map(function (achId) {
      var a = props.achById[achId];
      return a ? { title: a.title, pts: a.points, at: when[achId] } : null;
    }).filter(Boolean).sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
    var total = props.scores.totals[p.id] || 0;
    var totalAch = Object.keys(props.achById).length;
    return html`<main>
      <section className="card">
        <div className="stats-head">
          <${Avatar} player=${p} size=${88} />
          <h2 className="h2 stats-name">${p.name}${props.isMe ? html`<span className="me-tag"> (you)</span>` : null}</h2>
          <div className="stats-meta">
            <span>Joined ${timeAgo(p.joinedAt)}</span>
            ${props.isMe && p.contact ? html`<span className="stats-meta-dot">·</span><span>${p.contact.display}</span>` : null}
          </div>
          ${props.onEdit ? html`<button className="btn btn-secondary btn-mini" onClick=${props.onEdit}>Edit profile</button>` : null}
        </div>
        <div className="summary-row">
          <div className="summary-stat"><div className="summary-num">${fmtPts(total)}</div><div className="summary-label">total points</div></div>
          <div className="summary-stat"><div className="summary-num">${rows.length}<span className="summary-of">/${totalAch}</span></div><div className="summary-label">ticked off</div></div>
        </div>
        <h3 className="h3">Achievements ticked off</h3>
        ${rows.length === 0 ? html`<p className="muted">Nothing ticked off yet.</p>` : null}
        <ul className="breakdown">
          ${rows.map(function (r) {
            return html`<li key=${r.title} className="breakdown-row">
              <span className="breakdown-title">${r.title}</span>
              ${r.at ? html`<span className="breakdown-count">${timeAgo(r.at)}</span>` : null}
              <${Pts} value=${r.pts} />
            </li>`;
          })}
        </ul>
      </section>
    </main>`;
  }

  /* bottom sheet overlay */
  function Sheet(props) {
    useEffect(function () {
      function onKey(e) { if (e.key === 'Escape') props.onClose(); }
      document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('keydown', onKey); };
    }, []);
    return html`<div className="sheet-backdrop" onClick=${function (e) { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true">
        <button className="sheet-close" onClick=${props.onClose} aria-label="Close">×</button>
        ${props.children}
      </div>
    </div>`;
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();

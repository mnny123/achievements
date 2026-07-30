const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const db = {};       // stub Realtime Database: path -> value
  const accounts = {}; // stub Auth: email -> {uid, password}
  let uidSeq = 0;
  const NAME = 'input[placeholder="e.g. Sam K"]';

  // shared stub backend, exposed to every page
  const api = {
    __fbGet: (p) => (db[p] === undefined ? null : db[p]),
    __fbSet: (p, v) => { db[p] = v; },
    __fbUpdate: (p, patch) => {
      if (typeof db[p] !== 'object' || db[p] === null) db[p] = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete db[p][k];
        else db[p][k] = v;
      }
      db[p] = { ...db[p] }; // new identity so pollers see the change
    },
    __authSignUp: (email, password) => {
      const e = email.toLowerCase();
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(e)) return { error: 'auth/invalid-email' };
      if (accounts[e]) return { error: 'auth/email-already-in-use' };
      if ((password || '').length < 6) return { error: 'auth/weak-password' };
      accounts[e] = { uid: 'uid' + (++uidSeq), password };
      return { uid: accounts[e].uid, email: e };
    },
    __authSignIn: (email, password) => {
      const e = email.toLowerCase();
      if (!accounts[e]) return { error: 'auth/user-not-found' };
      if (accounts[e].password !== password) return { error: 'auth/wrong-password' };
      return { uid: accounts[e].uid, email: e };
    }
  };

  async function newDevice(opts) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('**://www.gstatic.com/**', r => r.abort()); // stub replaces the real SDK
    const page = await ctx.newPage();
    page.on('console', m => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
    });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    for (const [name, fn] of Object.entries(api)) await page.exposeFunction(name, fn);
    await page.addInitScript(`
      window.FIREBASE_CONFIG = { apiKey: 'stub', databaseURL: 'https://stub.firebaseio.com' };
      (function () {
        var authCbs = [];
        var current = null;
        try { current = JSON.parse(localStorage.getItem('stubUser') || 'null'); } catch (e) {}
        function persist(u) {
          current = u;
          try { u ? localStorage.setItem('stubUser', JSON.stringify(u)) : localStorage.removeItem('stubUser'); } catch (e) {}
          authCbs.forEach(function (cb) { cb(current); });
        }
        function fail(code) { var e = new Error(code); e.code = code; return e; }
        window.firebase = {
          initializeApp: function () {},
          auth: function () {
            return {
              onAuthStateChanged: function (cb) {
                authCbs.push(cb);
                setTimeout(function () { cb(current); }, 0);
                return function () { authCbs = authCbs.filter(function (x) { return x !== cb; }); };
              },
              createUserWithEmailAndPassword: async function (email, pw) {
                var r = await window.__authSignUp(email, pw);
                if (r.error) throw fail(r.error);
                persist(r);
                return { user: r };
              },
              signInWithEmailAndPassword: async function (email, pw) {
                var r = await window.__authSignIn(email, pw);
                if (r.error) throw fail(r.error);
                persist(r);
                return { user: r };
              },
              signOut: async function () { persist(null); },
              sendPasswordResetEmail: async function () {}
            };
          },
          database: function () {
            return {
              ref: function (p) {
                return {
                  _timers: [],
                  once: async function () { const v = await window.__fbGet(p); return { val: () => v }; },
                  set: async function (v) { await window.__fbSet(p, v); },
                  update: async function (patch) { await window.__fbUpdate(p, patch); },
                  on: function (evt, cb) {
                    let last;
                    const tick = async () => {
                      const v = await window.__fbGet(p);
                      const s = JSON.stringify(v);
                      if (s !== last) { last = s; cb({ val: () => v }); }
                    };
                    tick();
                    this._timers.push(setInterval(tick, 200));
                    return cb;
                  },
                  off: function () { this._timers.forEach(clearInterval); this._timers = []; }
                };
              }
            };
          }
        };
      })();
    `);
    await page.goto(url);
    await page.waitForSelector('.title-page', { timeout: 8000 });
    if (!(opts && opts.keepTitle)) await page.click('button:has-text("let\u2019s play")');
    return page;
  }

  const step = async (name, fn) => {
    try { await fn(); console.log('PASS', name); }
    catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); process.exitCode = 1; }
  };

  async function signUp(page, email, pw) {
    await page.click('.seg-btn:has-text("Sign up")');
    await page.fill('input[type="email"]', email);
    await page.fill('input[autocomplete="new-password"] >> nth=0', pw);
    await page.fill('input[autocomplete="new-password"] >> nth=1', pw);
    await page.click('button:has-text("Create account")');
  }

  // the title page is checked on a raw page before any device helper dismisses it
  await step('TITLE: rules page shows first, all five rules, then dismisses', async () => {
    const p = await newDevice({ keepTitle: true });
    if (await p.locator('.rule').count() !== 5) throw new Error('expected 5 rules');
    const txt = await p.textContent('.rules');
    for (const frag of ['$5', 'most points', 'punishment for losing', 'honour']) {
      if (!txt.toLowerCase().includes(frag.toLowerCase())) throw new Error('rules missing: ' + frag);
    }
    if (await p.locator('.board, .seg-btn').count() > 0) throw new Error('game visible behind title page');
    await p.click('button:has-text("let’s play")');
    await p.waitForSelector('.title-page', { state: 'detached' });
    await p.reload();                       // stays dismissed on this device
    await p.waitForSelector('button:has-text("Log in")', { timeout: 8000 });
    if (await p.locator('.title-page').count() > 0) throw new Error('title page shown again after reload');
    await p.click('.btn-ghost:has-text("Rules")');   // reachable on demand
    await p.waitForSelector('.title-page');
    await p.click('button:has-text("Back to the game")');
    await p.waitForSelector('button:has-text("Log in")');
  });

  const a = await newDevice();
  let joinCode = '';

  await step('AUTH: login screen gates the app', async () => {
    await a.waitForSelector('button:has-text("Log in")', { timeout: 8000 });
    if (await a.locator('text=No game exists here yet').count() > 0) throw new Error('game reachable while logged out');
  });
  await step('AUTH: short password rejected on sign up', async () => {
    await a.click('.seg-btn:has-text("Sign up")');
    await a.fill('input[type="email"]', 'ada@example.com');
    await a.fill('input[autocomplete="new-password"] >> nth=0', '123');
    await a.fill('input[autocomplete="new-password"] >> nth=1', '123');
    await a.click('button:has-text("Create account")');
    await a.waitForSelector('text=at least 6 characters');
  });
  await step('AUTH: mismatched confirmation rejected', async () => {
    await a.fill('input[autocomplete="new-password"] >> nth=0', 'secret123');
    await a.fill('input[autocomplete="new-password"] >> nth=1', 'secret999');
    await a.click('button:has-text("Create account")');
    await a.waitForSelector('text=don’t match');
  });
  await step('A: sign up -> profile -> create game', async () => {
    await a.fill('input[autocomplete="new-password"] >> nth=1', 'secret123');
    await a.click('button:has-text("Create account")');
    await a.waitForSelector('text=No game exists here yet', { timeout: 8000 });
    joinCode = await a.inputValue('.input-code');
    await a.click('button:has-text("Continue")');
    await a.fill(NAME, 'Ada');
    await a.click('button:has-text("Create game")');
    await a.waitForSelector('text=You’re the game creator', { timeout: 8000 });
    await a.fill('input[placeholder="e.g. Aced the spelling quiz"]', 'Read a book');
    await a.fill('input[type="number"]', '10');
    await a.click('button:has-text("Add achievement")');
    await a.waitForSelector('.ach-title:has-text("Read a book")');
  });

  const b = await newDevice();
  await step('B: sign up + join without re-entering email', async () => {
    await b.waitForSelector('button:has-text("Log in")', { timeout: 8000 });
    await signUp(b, 'ben@example.com', 'benpass1');
    await b.waitForSelector('text=Join the game', { timeout: 8000 });
    if (await b.locator('input[placeholder="you@example.com or 0400 000 000"]').count() > 0) {
      throw new Error('asked for contact again despite being logged in');
    }
    await b.fill('.input-code', joinCode);
    await b.click('button:has-text("Continue")');
    await b.fill(NAME, 'Ben');
    await b.click('button:has-text("Join game")');
    await b.waitForSelector('text=hasn’t finalized it yet');
  });
  await step('DRAFT BOARD: both tabs, all players, zero points, newest first', async () => {
    // Ada joined first, Ben second -> Ben on top while drafting
    await a.click('.seg-btn:has-text("Leaderboard")');
    await a.waitForSelector('.board-row:has-text("Ben")', { timeout: 6000 });
    const rows = await a.locator('.board-row').allTextContents();
    if (rows.length !== 2) throw new Error('expected both players, got ' + rows.length);
    if (!/Ben/.test(rows[0]) || !/Ada/.test(rows[1])) throw new Error('not newest-first: ' + JSON.stringify(rows));
    if (!rows.every(r => /0\s*pts/.test(r))) throw new Error('someone has points during draft: ' + JSON.stringify(rows));
    if (await a.locator('.board-rank').count() > 0) throw new Error('rank numbers shown before scoring starts');
    if (await a.locator('.board .avatar').count() !== 2) throw new Error('missing profile pictures');
    await a.waitForSelector('text=Scoring starts when the achievement list is finalized');
    // the draft list is still reachable from the other tab
    await a.click('.seg-btn:has-text("Achievements")');
    await a.waitForSelector('text=You’re the game creator');
  });
  await step('DRAFT BOARD: player sees the same roster', async () => {
    await b.click('.seg-btn:has-text("Leaderboard")');
    await b.waitForSelector('.board-row:has-text("Ada")', { timeout: 6000 });
    if (await b.locator('.board-row').count() !== 2) throw new Error('player sees a different roster');
    await b.click('.seg-btn:has-text("Achievements")');
    await b.waitForSelector('text=hasn’t finalized it yet');
  });
  await step('A: approve + finalize; B flips live', async () => {
    await b.fill('input[placeholder="e.g. Aced the spelling quiz"]', 'Tidy desk');
    await b.fill('input[type="number"]', '5');
    await b.click('button:has-text("Add achievement")');
    await a.waitForSelector('.ach-row-pending:has-text("Tidy desk")', { timeout: 6000 });
    await a.click('.ach-row-pending:has-text("Tidy desk") >> text=Approve');
    await a.click('text=Finalize…');
    await a.click('text=Yes, finalize');
    await b.waitForSelector('.log-row', { timeout: 6000 });  // draft list becomes the tickable checklist
  });
  await step('B ticks; A board updates live to 10', async () => {
    await b.click('.seg-btn:has-text("Achievements")');
    await b.click('.log-row:has-text("Read a book")');
    await b.waitForSelector('.log-row-done');
    await a.waitForSelector('.board li:first-child .board-row:has-text("Ben")', { timeout: 6000 });
    const first = await a.textContent('.board li:first-child .board-row');
    if (!/10/.test(first)) throw new Error('got: ' + first);
  });
  await step('B: session survives reload', async () => {
    await b.reload();
    await b.waitForSelector('.seg-btn:has-text("Leaderboard")', { timeout: 8000 });
    if (!/Ben/.test(await b.textContent('.board-row-me'))) throw new Error('logged out after reload');
  });

  await step('RACE: two players joining at once both appear', async () => {
    const [d, e] = await Promise.all([newDevice(), newDevice()]);
    async function join(p, email, name) {
      await signUp(p, email, 'pass' + name);
      await p.waitForSelector('text=Join the game', { timeout: 8000 });
      await p.fill('.input-code', joinCode);
      await p.click('button:has-text("Continue")');
      await p.fill(NAME, name);
      await p.click('button:has-text("Join game")');
    }
    await Promise.all([join(d, 'dana@example.com', 'Dana'), join(e, 'eli@example.com', 'Eli')]);
    // everyone must survive on A's live board: Ada, Ben, Dana, Eli
    await a.waitForSelector('.board-row:has-text("Dana")', { timeout: 6000 });
    await a.waitForSelector('.board-row:has-text("Eli")', { timeout: 6000 });
    if (await a.locator('.board-row').count() !== 4) {
      throw new Error('players lost in concurrent join: ' + JSON.stringify(await a.locator('.board-row').allTextContents()));
    }
  });
  await step('RACE: two players ticking at once both count', async () => {
    const pages = await Promise.all([newDevice(), newDevice()]);
    await Promise.all(pages.map(async (p, i) => {
      const email = i === 0 ? 'dana@example.com' : 'eli@example.com';
      await p.fill('input[type="email"]', email);
      await p.fill('input[autocomplete="current-password"]', 'pass' + (i === 0 ? 'Dana' : 'Eli'));
      await p.click('button[type="submit"]');
      await p.waitForSelector('.seg-btn:has-text("Achievements")', { timeout: 8000 });
      await p.click('.seg-btn:has-text("Achievements")');
      await p.waitForSelector('.log-row:has-text("Read a book")');
    }));
    await Promise.all(pages.map(p => p.click('.log-row:has-text("Read a book")')));
    await Promise.all(pages.map(p => p.waitForSelector('.log-row-done', { timeout: 6000 })));
    // both ticks must survive: Dana and Eli each on 10 on A's live board
    await a.waitForSelector('.board-row:has-text("Dana") >> text=10', { timeout: 6000 });
    await a.waitForSelector('.board-row:has-text("Eli") >> text=10', { timeout: 6000 });
  });

  // Device C = a different browser entirely: log in as Ben, get Ben's profile back
  const c = await newDevice();
  await step('C: wrong password rejected', async () => {
    await c.waitForSelector('button:has-text("Log in")', { timeout: 8000 });
    await c.fill('input[type="email"]', 'ben@example.com');
    await c.fill('input[autocomplete="current-password"]', 'wrongpass');
    await c.click('button[type="submit"]');
    await c.waitForSelector('text=Wrong email or password');
  });
  await step('C: unknown account rejected', async () => {
    await c.fill('input[type="email"]', 'nobody@example.com');
    await c.fill('input[autocomplete="current-password"]', 'whatever1');
    await c.click('button[type="submit"]');
    await c.waitForSelector('text=No account with that email');
  });
  await step('C: correct login restores Ben on a new browser', async () => {
    await c.fill('input[type="email"]', 'ben@example.com');
    await c.fill('input[autocomplete="current-password"]', 'benpass1');
    await c.click('button[type="submit"]');
    await c.waitForSelector('.seg-btn:has-text("Leaderboard")', { timeout: 8000 });
    if (await c.locator('text=Join the game').count() > 0) throw new Error('asked to re-join');
    const meRow = await c.textContent('.board-row-me');
    if (!/Ben/.test(meRow)) throw new Error('not Ben: ' + meRow);
    if (!/10/.test(meRow)) throw new Error('points did not follow the account: ' + meRow);
  });
  await step('C: log out returns to the login screen', async () => {
    await c.click('.topbar-avatar');
    await c.waitForSelector('.contact-value:has-text("ben@example.com")');
    await c.click('button:has-text("Log out")');
    await c.waitForSelector('button:has-text("Log in")', { timeout: 8000 });
    if (await c.locator('.board').count() > 0) throw new Error('game still visible after logout');
  });

  if (errors.length) { console.log('ERRORS:'); errors.forEach(e => console.log(' ', e)); process.exitCode = 1; }
  else console.log('No console/page errors.');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

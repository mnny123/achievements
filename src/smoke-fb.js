const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const db = {}; // stub Realtime Database: path -> value
  const CONTACT = 'input[placeholder="you@example.com or 0400 000 000"]';
  const NAME = 'input[placeholder="e.g. Sam K"]';

  async function newDevice() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('**://www.gstatic.com/**', r => r.abort()); // stub replaces the real SDK
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.exposeFunction('__fbGet', (p) => db[p] === undefined ? null : db[p]);
    await page.exposeFunction('__fbSet', (p, v) => { db[p] = v; });
    await page.addInitScript(`
      window.FIREBASE_CONFIG = { apiKey: 'stub', databaseURL: 'https://stub.firebaseio.com' };
      window.firebase = {
        initializeApp: function () {},
        database: function () {
          return {
            ref: function (p) {
              return {
                _timers: [],
                once: async function () { const v = await window.__fbGet(p); return { val: () => v }; },
                set: async function (v) { await window.__fbSet(p, v); },
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
    `);
    await page.goto(url);
    return page;
  }

  const step = async (name, fn) => {
    try { await fn(); console.log('PASS', name); }
    catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); process.exitCode = 1; }
  };

  const a = await newDevice();
  let joinCode = '';
  await step('FB A: no demo-mode banner (firebase active)', async () => {
    await a.waitForSelector('text=No game exists here yet', { timeout: 8000 });
    if (await a.locator('.banner-warn').count() > 0) throw new Error('demo banner shown in firebase mode');
  });
  await step('FB A: create game + achievement', async () => {
    await a.fill(CONTACT, 'ada@example.com');
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
  await step('FB B: joins during draft', async () => {
    await b.waitForSelector('text=Sign up', { timeout: 8000 });
    await b.fill('.input-code', joinCode);
    await b.fill(CONTACT, 'ben@example.com');
    await b.click('button:has-text("Continue")');
    await b.fill(NAME, 'Ben');
    await b.click('button:has-text("Join game")');
    await b.waitForSelector('text=hasn’t finalized it yet');
  });
  await step('FB A: sees Ben suggest live (no refresh)', async () => {
    await b.fill('input[placeholder="e.g. Aced the spelling quiz"]', 'Tidy desk');
    await b.fill('input[type="number"]', '5');
    await b.click('button:has-text("Add achievement")');
    await a.waitForSelector('.ach-row-pending:has-text("Tidy desk")', { timeout: 6000 });
  });
  await step('FB A: approve + finalize; B flips to play live', async () => {
    await a.click('.ach-row-pending:has-text("Tidy desk") >> text=Approve');
    await a.click('text=Finalize…');
    await a.click('text=Yes, finalize');
    await b.waitForSelector('.seg-btn:has-text("Leaderboard")', { timeout: 6000 });
  });
  await step('FB B ticks; A board updates live to 10', async () => {
    await b.click('.seg-btn:has-text("Achievements")');
    await b.click('.log-row:has-text("Read a book")');
    await b.waitForSelector('.log-row-done');
    await a.waitForSelector('.board li:first-child .board-row:has-text("Ben")', { timeout: 6000 });
    const first = await a.textContent('.board li:first-child .board-row');
    if (!/10/.test(first)) throw new Error('got: ' + first);
    await a.waitForSelector('text=ticked off “Read a book”');
  });
  await step('FB B: identity survives reload (localStorage)', async () => {
    await b.reload();
    await b.waitForSelector('.seg-btn:has-text("Leaderboard")', { timeout: 8000 });
    const board = await b.textContent('.board-row-me');
    if (!/Ben/.test(board)) throw new Error('not signed in after reload: ' + board);
  });

  if (errors.length) { console.log('ERRORS:'); errors.forEach(e => console.log(' ', e)); process.exitCode = 1; }
  else console.log('No console/page errors.');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

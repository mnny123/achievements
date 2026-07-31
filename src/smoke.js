const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const url = 'file://' + path.resolve(__dirname, '..', 'achievement-leaderboard.html');
  const sharedStore = {};
  const CONTACT = 'input[placeholder="you@example.com or 0400 000 000"]';
  const NAME = 'input[placeholder="e.g. Sam K"]';

  async function newDevice() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.exposeFunction('__setShared', (k, v) => { sharedStore[k] = v; });
    await page.exposeFunction('__getShared', (k) => sharedStore[k] === undefined ? null : sharedStore[k]);
    await page.addInitScript(`
      window.__priv = {};
      window.storage = {
        async get(key, opts) {
          const shared = opts && opts.shared;
          if (shared) { const v = await window.__getShared(key); return v === null ? null : { key, value: v }; }
          return Object.prototype.hasOwnProperty.call(window.__priv, key) ? { key, value: window.__priv[key] } : null;
        },
        async set(key, value, opts) {
          const shared = opts && opts.shared;
          if (shared) await window.__setShared(key, value);
          else window.__priv[key] = value;
        }
      };
    `);
    await page.goto(url);
    await page.waitForSelector('.title-page', { timeout: 8000 });
    await page.click('button:has-text("let\u2019s play")');
    return page;
  }

  const step = async (name, fn) => {
    try { await fn(); console.log('PASS', name); }
    catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); process.exitCode = 1; }
  };

  // Device A: creator
  const a = await newDevice();
  let joinCode = '';
  await step('A: signup step 1 shows', () => a.waitForSelector('text=No game exists here yet', { timeout: 8000 }));
  await step('A: invalid contact rejected', async () => {
    await a.fill(CONTACT, 'not-an-email');
    await a.click('button:has-text("Continue")');
    await a.waitForSelector('text=Enter a valid email address or mobile number');
  });
  await step('A: sign up then create profile', async () => {
    await a.fill(CONTACT, 'ada@example.com');
    joinCode = await a.inputValue('.input-code');
    await a.click('button:has-text("Continue")');
    await a.waitForSelector('text=Create your profile');
    await a.fill(NAME, 'Ada');
    await a.click('button:has-text("Create game")');
    await a.waitForSelector('text=Your contribution', { timeout: 8000 });
    await a.fill('.sheet input[type="number"]', '15');
    await a.click('button:has-text("Save contribution")');
    await a.waitForSelector('.sheet', { state: 'detached' });
    await a.waitForSelector('text=You’re the game creator', { timeout: 8000 });
  });
  await step('A: add two achievements (auto-approved)', async () => {
    await a.fill('input[placeholder="e.g. Aced the spelling quiz"]', 'Read a book');
    await a.fill('input[placeholder="Short note about how to earn it"]', 'Any book, cover to cover');
    await a.fill('input[type="number"]', '10');
    await a.click('button:has-text("Add achievement")');
    await a.waitForSelector('.ach-title:has-text("Read a book")');
    await a.fill('input[placeholder="e.g. Aced the spelling quiz"]', 'Helped a classmate');
    await a.fill('input[type="number"]', '25');
    await a.check('input[type="checkbox"]');
    await a.click('button:has-text("Add achievement")');
    await a.waitForSelector('.ach-title:has-text("Helped a classmate")');
    if (await a.locator('.ach-row-pending').count() > 0) throw new Error('creator additions should not be pending');
  });

  // Device B: player joins during draft
  const b = await newDevice();
  await step('B: wrong join code rejected at submit', async () => {
    await b.waitForSelector('text=Join the game', { timeout: 8000 });
    await b.fill('.input-code', 'XXXXX');
    await b.fill(CONTACT, 'ben@example.com');
    await b.click('button:has-text("Continue")');
    await b.waitForSelector('text=Create your profile');
    await b.fill(NAME, 'Ben');
    await b.click('button:has-text("Join game")');
    await b.waitForSelector('text=doesn’t match');
  });
  await step('B: joins with right code', async () => {
    await b.click('button:has-text("Back")');
    await b.fill('.input-code', joinCode);
    await b.click('button:has-text("Continue")');
    await b.click('button:has-text("Join game")');
    await b.waitForSelector('text=Your contribution', { timeout: 8000 });
    await b.fill('.sheet input[type="number"]', '5');
    await b.click('button:has-text("Save contribution")');
    await b.waitForSelector('.sheet', { state: 'detached' });
    await b.waitForSelector('text=hasn’t finalized it yet');
    await b.click('.seg-btn:has-text("Leaderboard")');
    await b.waitForSelector('.pool-num:has-text("$20")');   // 15 + 5, summed live
    await b.waitForSelector('.board-row:has-text("Ada") .contrib-tag:has-text("$15")');
    await b.waitForSelector('.board-row:has-text("Ben") .contrib-tag:has-text("$5")');
    await b.click('.seg-btn:has-text("Achievements")');
  });
  await step('B: cannot edit approved achievements', async () => {
    await b.waitForSelector('.ach-title:has-text("Read a book")');
    if (await b.locator('.ach-row:has-text("Read a book") >> text=Edit').count() > 0) {
      throw new Error('player sees Edit on approved item');
    }
  });
  await step('B: suggests an achievement -> pending', async () => {
    await b.fill('input[placeholder="e.g. Aced the spelling quiz"]', 'Cleaned the whiteboard');
    await b.fill('input[type="number"]', '5');
    await b.click('button:has-text("Add achievement")');
    await b.waitForSelector('.toast:has-text("waiting for the creator")');
    await b.waitForSelector('.ach-row-pending:has-text("Cleaned the whiteboard")');
    await b.waitForSelector('text=suggested by Ben');
  });
  await step('B: can edit own pending suggestion', async () => {
    await b.click('.ach-row-pending:has-text("Cleaned the whiteboard") >> text=Edit');
    await b.fill('.ach-row-editing input[type="number"]', '7');
    await b.click('text=Save changes');
    await b.waitForSelector('.ach-row-pending:has-text("Cleaned the whiteboard") >> text=7');
  });
  await step('B: no Approve button, no finalize', async () => {
    if (await b.locator('.btn-approve').count() > 0) throw new Error('player sees Approve');
    if (await b.locator('text=Finalize the list').count() > 0) throw new Error('player sees finalize');
  });
  await step('B: suggests a second (to be declined)', async () => {
    await b.fill('input[placeholder="e.g. Aced the spelling quiz"]', 'Silly one');
    await b.fill('input[type="number"]', '3');
    await b.click('button:has-text("Add achievement")');
    await b.waitForSelector('.ach-row-pending:has-text("Silly one")');
  });

  await step('A: approves one, declines one', async () => {
    await a.click('.btn-refresh');
    await a.waitForSelector('text=Needs your OK', { timeout: 8000 });
    await a.click('.ach-row-pending:has-text("Cleaned the whiteboard") >> text=Approve');
    await a.waitForSelector('section:has-text("The list") .ach-row:has-text("Cleaned the whiteboard")');
    await a.click('.ach-row-pending:has-text("Silly one") >> text=Decline');
    await a.click('.ach-row-pending:has-text("Silly one") >> text=Really decline?');
    await a.waitForSelector('.ach-row:has-text("Silly one")', { state: 'detached' });
  });
  await step('A: summary approved only (3 / 42) + finalize', async () => {
    await a.waitForSelector('.summary-num:has-text("3")');
    await a.waitForSelector('.summary-num:has-text("42")');
    await a.click('text=Finalize…');
    await a.waitForSelector('text=Lock the list and start logging');
    await a.click('text=Yes, finalize');
    await a.waitForSelector('text=Leaderboard', { timeout: 8000 });
  });

  await step('B: refresh -> play, multi-log with counts -> 35', async () => {
    await b.click('.btn-refresh');
    await b.waitForSelector('.seg-btn:has-text("Leaderboard")', { timeout: 8000 });
    await b.click('.seg-btn:has-text("Achievements")');
    await b.waitForSelector('.log-row:has-text("Cleaned the whiteboard")');
    if (await b.locator('.log-row:has-text("Silly one")').count() > 0) throw new Error('declined item is listed');
    await b.click('.log-item:has-text("Helped a classmate") .step-plus');
    await b.waitForSelector('.adj-panel');
    await b.click('.adj-panel button:has-text("Log +25")');   // without the school bonus
    await b.waitForSelector('.toast:has-text("logged 1×")');
    await b.click('.log-item:has-text("Read a book") .step-plus');
    await b.waitForSelector('.log-item:has-text("Read a book") .step-count:has-text("1")');
    await b.click('.log-item:has-text("Read a book") .step-plus');
    await b.waitForSelector('.log-item:has-text("Read a book") .step-count:has-text("2")');
    await b.click('.log-item:has-text("Read a book") .step-minus');
    await b.waitForSelector('.toast:has-text("one removed")');
    await b.click('.seg-btn:has-text("Leaderboard")');
    const first = await b.textContent('.board li:first-child .board-row');
    if (!/Ben/.test(first) || !/35/.test(first)) throw new Error('got: ' + first);
  });
  await step('B: edit profile via header avatar shows contact', async () => {
    await b.click('.topbar-avatar');
    await b.waitForSelector('.contact-value:has-text("ben@example.com")');
    await b.fill('.sheet input[placeholder="e.g. Sam K"]', 'Ben H');
    await b.click('.sheet >> text=Save changes');
    await b.waitForSelector('.toast:has-text("Profile updated")');
  });
  await step('A: board feed + stats sheet, no contact leak', async () => {
    await a.click('.btn-refresh');
    await a.waitForSelector('text=logged \u201CHelped a classmate\u201D', { timeout: 8000 });

    await a.click('.board-row:has-text("Ben")');
    await a.waitForSelector('.sheet >> text=total points');
    await a.waitForSelector('.sheet >> text=Point history');
    const sheet = await a.textContent('.sheet');
    if (/ben@example\.com/.test(sheet)) throw new Error('contact leaked to other players');
    if (!/Helped a classmate/.test(sheet)) throw new Error('breakdown missing achievement');
    await a.click('.sheet-close');
  });

  // Device C: joins after finalization
  const c = await newDevice();
  await step('C: late joiner gets locked list at zero', async () => {
    await c.waitForSelector('text=already locked');
    await c.fill('.input-code', joinCode);
    await c.fill(CONTACT, '0400 123 456');
    await c.click('button:has-text("Continue")');
    await c.fill(NAME, 'Cleo');
    await c.click('button:has-text("Join game")');
    await c.waitForSelector('text=Your contribution', { timeout: 8000 });
    await c.click('.sheet-close');
    await c.waitForSelector('.seg-btn:has-text(\"Leaderboard\")', { timeout: 8000 });
    const board = await c.textContent('.board');
    if (!/Cleo/.test(board)) throw new Error('Cleo not on board');
  });

  // Device D: Ben signs back in on a new device with the same email
  const d = await newDevice();
  await step('D: same email signs back into Ben’s profile', async () => {
    await d.waitForSelector('text=Join the game');
    await d.fill('.input-code', joinCode);
    await d.fill(CONTACT, 'BEN@example.com');
    await d.click('button:has-text("Continue")');
    await d.waitForSelector('.toast:has-text("Welcome back")');
    await d.waitForSelector('.seg-btn:has-text(\"Leaderboard\")', { timeout: 8000 });
    const board = await d.textContent('.board');
    if (!/Ben H[\s\S]*\(you\)|\(you\)/.test(board) || !/Ben H/.test(board)) throw new Error('not signed in as Ben: ' + board);
    const meRow = await d.textContent('.board-row-me');
    if (!/Ben H/.test(meRow)) throw new Error('me-row is not Ben: ' + meRow);
  });

  await a.screenshot({ path: 'shot-board.png' });
  await b.click('.seg-btn:has-text("Achievements")');
  await b.screenshot({ path: 'shot-ach.png' });

  if (errors.length) { console.log('ERRORS:'); errors.forEach(e => console.log(' ', e)); process.exitCode = 1; }
  else console.log('No console/page errors.');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

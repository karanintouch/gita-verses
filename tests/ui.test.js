"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/server");
const { extractTags } = require("./helpers/extractTags");

let server, baseUrl, browser, page;

before(async () => {
  const started = await startServer();
  server = started.server;
  baseUrl = started.url;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  // Set this before the app's own boot() ever runs (not after), or its
  // 700ms auto-start guided tour can fire mid-test and interfere — e.g. it
  // force-closes the mobile sidebar as its first step.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("gita-tour-done", "1");
    } catch (e) {}
  });
});

after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

async function goto(query) {
  // Track uncaught exceptions in the app's own JS, not network/resource
  // noise (blocked font CDNs, missing favicon, etc. vary by environment
  // and aren't a regression in the app itself).
  const pageErrors = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.goto(`${baseUrl}/index.html${query || ""}`);
  await page.waitForSelector("#sanskrit");
  return pageErrors;
}

async function openSettings() {
  await page.click("#settings-btn-d");
  await page.waitForSelector("#settings-panel.open");
}

async function closeSettings() {
  await page.click("#settings-close");
  await page.waitForTimeout(150);
}

async function isLangOn(key) {
  return (await page.getAttribute(`[data-lang="${key}"]`, "aria-pressed")) === "true";
}

// The app refuses to switch off the last active language (by design), so
// flip any language ON first, then switch the others OFF — never the
// reverse order, or a same-language toggle silently no-ops.
async function setLangs({ en, hi }) {
  await openSettings();
  if (en && !(await isLangOn("en"))) await page.click('[data-lang="en"]');
  if (hi && !(await isLangOn("hi"))) await page.click('[data-lang="hi"]');
  if (!en && (await isLangOn("en"))) await page.click('[data-lang="en"]');
  if (!hi && (await isLangOn("hi"))) await page.click('[data-lang="hi"]');
  await closeSettings();
}

test("page boots on verse 2.47 with no console errors", async () => {
  const errors = await goto("?c=2&v=47");
  assert.deepEqual(errors, []);
  const title = await page.textContent("#verse-title");
  assert.equal(title, "Bhagavad Gita 2.47");
  const sanskrit = await page.textContent("#sanskrit");
  assert.ok(sanskrit.includes("कर्मण्येवाधिकारस्ते"));
});

test("a verse tagged as both instruction and promise renders two distinct, non-overlapping dots", async () => {
  const { instructions, promises } = extractTags();
  const both = instructions.filter((ref) => promises.includes(ref));
  assert.ok(both.length > 0, "expected at least one verse tagged as both instruction and promise");
  const [c, v] = both[0].split(".");

  await goto(`?c=1&v=1`); // land on an unselected verse so the dual-tag verse isn't highlighted
  const chBtn = await page.$(`.chapter[data-chapter="${c}"] .chapter-btn`);
  await chBtn.click();
  const vBtn = await page.waitForSelector(`.v-btn[data-ref="${c}.${v}"]`);
  await vBtn.scrollIntoViewIfNeeded();

  const dots = await vBtn.$$(".dot");
  assert.equal(dots.length, 2, `expected 2 dots on ${c}.${v}, found ${dots.length}`);

  const boxes = await Promise.all(dots.map((d) => d.boundingBox()));
  assert.ok(boxes.every(Boolean), "dot bounding boxes should be measurable");
  const xs = boxes.map((b) => Math.round(b.x));
  assert.notEqual(xs[0], xs[1], `dots overlap at the same x position (${xs.join(", ")})`);
});

test("switching to Hindi-only updates chapter name + meaning in the sidebar", async () => {
  await goto("?c=2&v=47");
  const before_ = await page.textContent('.chapter[data-chapter="1"] .chapter-btn .sk');
  assert.equal(before_.trim(), "Arjun Viṣhād Yog");

  await setLangs({ en: false, hi: true });

  const sk = await page.textContent('.chapter[data-chapter="1"] .chapter-btn .sk');
  const en = await page.textContent('.chapter[data-chapter="1"] .chapter-btn .en');
  assert.equal(sk.trim(), "अर्जुनविषादयोग");
  assert.equal(en.trim(), "अर्जुन की दुविधा");

  const eyebrow = await page.textContent("#chap-eyebrow");
  assert.ok(eyebrow.includes("दिव्य ज्ञान"), `eyebrow should show Hindi meaning, got: ${eyebrow}`);

  // restore default so later tests aren't affected by saved prefs
  await setLangs({ en: true, hi: false });
  const skRestored = await page.textContent('.chapter[data-chapter="1"] .chapter-btn .sk');
  assert.equal(skRestored.trim(), "Arjun Viṣhād Yog");
});

test("dark theme actually changes the background color (not a no-op)", async () => {
  await goto("?c=2&v=47");
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await openSettings();
  await page.click('[data-theme-opt="dark"]');
  await closeSettings();
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  assert.notEqual(lightBg, darkBg);

  // reset to auto for subsequent tests
  await openSettings();
  await page.click('[data-theme-opt="auto"]');
  await closeSettings();
});

test("Instructions filter shows exactly as many verses as the INSTRUCTIONS array", async () => {
  const { instructions } = extractTags();
  await goto("?c=2&v=47");
  await page.click('.tab[data-filter="instruction"]');
  await page.waitForTimeout(150);
  const center = await page.textContent("#topbar-center");
  const match = center.match(/of\s+(\d+)/);
  assert.ok(match, `could not parse total from "${center}"`);
  assert.equal(parseInt(match[1], 10), instructions.length);
});

test("jump-to-verse form navigates directly to the requested verse", async () => {
  await goto("?c=2&v=47");
  await page.fill("#jump-input", "5.10");
  await page.press("#jump-input", "Enter");
  await page.waitForFunction(() => document.getElementById("verse-title").textContent.includes("5.10"));
  const title = await page.textContent("#verse-title");
  assert.equal(title, "Bhagavad Gita 5.10");
});

test("mobile: the menu button opens the sidebar and isn't blocked by the off-canvas close button", async () => {
  // Regression test: #sidebar-close used to be display:inline-flex at all
  // times on mobile, positioned just off the sidebar's right edge. At
  // narrow viewports the sidebar shrinks to its min-width, which shifted
  // the close button back on-screen, directly on top of #menu-btn, and
  // silently swallowed every tap on it.
  await page.setViewportSize({ width: 320, height: 640 });
  await goto("?c=2&v=47");

  const menuBox = await page.$eval("#menu-btn", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const hitsMenuBtn = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!(el && el.closest("#menu-btn"));
    },
    { x: menuBox.x + menuBox.w / 2, y: menuBox.y + menuBox.h / 2 }
  );
  assert.ok(hitsMenuBtn, "a tap at the menu button's center should hit the menu button, not a hidden overlay");

  await page.click("#menu-btn", { force: true });
  await page.waitForSelector("#sidebar.open");
  await page.click("#sidebar-close");
  // wait for the .28s slide-out CSS transition to actually finish, not just
  // for the "open" class to be removed — otherwise the sidebar is still
  // mid-animation and legitimately overlaps menu-btn, which is a timing
  // artifact of this test, not the bug being guarded against here
  await page.waitForFunction(() => document.getElementById("sidebar").getBoundingClientRect().right <= 0);
  // the actual regression only shows up on a *second* open, once the
  // sidebar has been closed once already
  await page.click("#menu-btn", { force: true });
  await page.waitForSelector("#sidebar.open");

  await page.setViewportSize({ width: 1400, height: 900 });
});

test("instructions/promises info popover opens on tap and defines both terms", async () => {
  await goto("?c=2&v=47");
  await page.click("#filter-tabs .tab-info");
  await page.waitForSelector("#info-popover.show");
  const text = await page.textContent("#info-popover");
  assert.match(text, /Instructions/);
  assert.match(text, /Promises/);

  await page.click("#info-scrim", { position: { x: 5, y: 5 } });
  await page.waitForSelector("#info-popover", { state: "hidden" });
});

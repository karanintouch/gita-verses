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
  await page.evaluate(() => {
    try {
      localStorage.setItem("gita-tour-done", "1");
    } catch (e) {}
  });
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

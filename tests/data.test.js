"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { extractTags } = require("./helpers/extractTags");

const ROOT = path.join(__dirname, "..");
const chapters = JSON.parse(fs.readFileSync(path.join(ROOT, "data/chapters.json"), "utf-8"));
const verses = JSON.parse(fs.readFileSync(path.join(ROOT, "data/verses.json"), "utf-8"));

test("chapters.json has 18 chapters, each fully populated", () => {
  assert.equal(chapters.length, 18);
  const requiredFields = ["n", "sk", "tr", "translit", "meaning", "meaning_hi", "count"];
  chapters.forEach((ch) => {
    requiredFields.forEach((field) => {
      assert.ok(
        ch[field] !== undefined && ch[field] !== null && ch[field] !== "",
        `chapter ${ch.n} is missing "${field}"`
      );
    });
  });
});

test("chapter verse counts sum to 701 and verses.json has exactly that many entries", () => {
  const total = chapters.reduce((sum, ch) => sum + ch.count, 0);
  assert.equal(total, 701);
  assert.equal(Object.keys(verses).length, total);
});

test("every chapter.verse ref implied by chapters.json exists in verses.json, and vice versa", () => {
  const expected = new Set();
  chapters.forEach((ch) => {
    for (let v = 1; v <= ch.count; v++) expected.add(`${ch.n}.${v}`);
  });
  const actual = new Set(Object.keys(verses));

  const missing = [...expected].filter((ref) => !actual.has(ref));
  const unexpected = [...actual].filter((ref) => !expected.has(ref));

  assert.deepEqual(missing, [], `verses.json is missing refs: ${missing.join(", ")}`);
  assert.deepEqual(unexpected, [], `verses.json has refs not accounted for by chapters.json: ${unexpected.join(", ")}`);
});

test("every verse has non-empty Sanskrit, transliteration, English and Hindi text", () => {
  const requiredFields = ["sk", "tr", "en", "src", "hi", "hisrc"];
  const bad = [];
  Object.entries(verses).forEach(([ref, v]) => {
    requiredFields.forEach((field) => {
      if (!v[field]) bad.push(`${ref} missing "${field}"`);
    });
  });
  assert.deepEqual(bad, []);
});

test("every verse key matches its own c/v fields", () => {
  const bad = Object.entries(verses).filter(([ref, v]) => ref !== `${v.c}.${v.v}`);
  assert.deepEqual(bad.map(([ref]) => ref), []);
});

test("word-for-word entries are [word, meaning] pairs with a non-empty meaning", () => {
  const bad = [];
  Object.entries(verses).forEach(([ref, v]) => {
    (v.wm || []).forEach((pair, i) => {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair[1]) {
        bad.push(`${ref} wm[${i}]`);
      }
    });
  });
  assert.deepEqual(bad, []);
});

test("every INSTRUCTIONS/PROMISES ref in index.html points at a real verse", () => {
  const { instructions, promises } = extractTags();
  const validRefs = new Set(Object.keys(verses));
  const badInstr = instructions.filter((ref) => !validRefs.has(ref));
  const badPromise = promises.filter((ref) => !validRefs.has(ref));
  assert.deepEqual(badInstr, [], `unknown instruction refs: ${badInstr.join(", ")}`);
  assert.deepEqual(badPromise, [], `unknown promise refs: ${badPromise.join(", ")}`);
});

test("INSTRUCTIONS/PROMISES arrays have no duplicate refs", () => {
  const { instructions, promises } = extractTags();
  assert.equal(new Set(instructions).size, instructions.length, "duplicate ref in INSTRUCTIONS");
  assert.equal(new Set(promises).size, promises.length, "duplicate ref in PROMISES");
});

test("filter tab labels (\"Instructions (N)\", \"Promises (N)\") match the actual array lengths", () => {
  const { instructions, promises, labelInstructionCount, labelPromiseCount } = extractTags();
  assert.equal(
    labelInstructionCount,
    instructions.length,
    `tab label says ${labelInstructionCount} but INSTRUCTIONS has ${instructions.length} — update the hardcoded label in buildFilterTabs()`
  );
  assert.equal(
    labelPromiseCount,
    promises.length,
    `tab label says ${labelPromiseCount} but PROMISES has ${promises.length} — update the hardcoded label in buildFilterTabs()`
  );
});

test("manifest.json is valid and its icon files exist", () => {
  const manifestPath = path.join(ROOT, "manifest.json");
  assert.ok(fs.existsSync(manifestPath), "manifest.json should exist at the repo root");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest.json should declare icons");
  manifest.icons.forEach((icon) => {
    const iconPath = path.join(ROOT, icon.src);
    assert.ok(fs.existsSync(iconPath), `manifest icon file missing: ${icon.src}`);
  });
});

test("index.html references manifest.json and an apple-touch-icon that both exist", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
  const manifestLink = html.match(/<link rel="manifest" href="([^"]+)">/);
  assert.ok(manifestLink, "index.html should link a web app manifest");
  assert.ok(fs.existsSync(path.join(ROOT, manifestLink[1])), `linked manifest missing: ${manifestLink[1]}`);

  const touchIconLink = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
  assert.ok(touchIconLink, "index.html should link an apple-touch-icon for iOS home screen support");
  assert.ok(fs.existsSync(path.join(ROOT, touchIconLink[1])), `linked apple-touch-icon missing: ${touchIconLink[1]}`);
});

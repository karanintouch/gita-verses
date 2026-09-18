"use strict";
const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.join(__dirname, "..", "..", "index.html");

// Pulls the INSTRUCTIONS/PROMISES verse-ref arrays and the tab label counts
// straight out of index.html's source, so tests always check what's actually
// shipped rather than a copy that can drift out of sync.
function extractTags() {
  const html = fs.readFileSync(INDEX_PATH, "utf-8");

  const instrMatch = html.match(/var INSTRUCTIONS = \[(.*?)\];/);
  const promiseMatch = html.match(/var PROMISES = \[(.*?)\];/);
  if (!instrMatch || !promiseMatch) {
    throw new Error("Could not find INSTRUCTIONS/PROMISES arrays in index.html");
  }
  const instructions = Array.from(instrMatch[1].matchAll(/"([\d.]+)"/g)).map((m) => m[1]);
  const promises = Array.from(promiseMatch[1].matchAll(/"([\d.]+)"/g)).map((m) => m[1]);

  const labelMatch = html.match(
    /\{key:"instruction", label:"Instructions \((\d+)\)"\},\s*\{key:"promise", label:"Promises \((\d+)\)"\}/
  );
  if (!labelMatch) {
    throw new Error("Could not find filter tab label counts in index.html");
  }
  const labelInstructionCount = parseInt(labelMatch[1], 10);
  const labelPromiseCount = parseInt(labelMatch[2], 10);

  return { instructions, promises, labelInstructionCount, labelPromiseCount };
}

module.exports = { extractTags: extractTags };

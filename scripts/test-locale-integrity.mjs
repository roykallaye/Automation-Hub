/*
  Locale integrity.

  Typecheck, build and every test can pass while the shipped Italian reads as
  "SÃ¬, funziona cosÃ¬". Mojibake is valid text as far as the toolchain is
  concerned, so nothing else in the pipeline can catch it — it has escaped into
  a screenshot twice, once from a PowerShell read/write round-trip and once from
  a bad decode in a patch script.

  This checks three things a dictionary can get wrong without failing to
  compile:

    1. mojibake — UTF-8 that was decoded as a single-byte codepage and rewritten;
    2. key parity — a language silently missing or inventing a key;
    3. placeholder parity — {count} present in one language and not the other,
       which renders as a literal brace in the product.
*/

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const I18N = fileURLToPath(new URL("../src/i18n/", import.meta.url));

/*
  A UTF-8 file read as cp1252 and written back turns every accented character
  into a two-character sequence starting with one of these. None of them can
  legitimately appear in English or Italian copy: Ã, Â, â, Ð and Ñ are simply
  not letters either language uses.
*/
const MOJIBAKE_LEADS = ["Ã", "Â", "â€", "Ð", "Ñ"];

/** What the two languages are actually allowed to contain beyond ASCII. */
const ALLOWED_NON_ASCII = new Set([
  ...["à", "á", "è", "é", "ì", "í", "ò", "ó", "ù", "ú"],
  ...["À", "Á", "È", "É", "Ì", "Í", "Ò", "Ó", "Ù", "Ú"],
  "—",
  "–",
  "’",
  "“",
  "”",
  "…",
  "·",
  "→",
  "↓",
  "€",
  "✓",
]);

const files = (await readdir(I18N)).filter((name) => name.endsWith(".ts") && name !== "index.tsx");
const dictionaries = new Map();
let checks = 0;

function check(condition, label) {
  assert.ok(condition, label);
  checks += 1;
}

for (const name of files) {
  const text = await readFile(path.join(I18N, name), "utf8");

  for (const lead of MOJIBAKE_LEADS) {
    check(
      !text.includes(lead),
      `${name} contains the mojibake signature ${JSON.stringify(lead)} — the file was written through a non-UTF-8 round trip`,
    );
  }

  const unexpected = [
    ...new Set([...text].filter((ch) => ch.charCodeAt(0) > 127 && !ALLOWED_NON_ASCII.has(ch))),
  ];
  check(
    unexpected.length === 0,
    `${name} contains unexpected non-ASCII characters: ${unexpected
      .map((ch) => `${JSON.stringify(ch)} (U+${ch.charCodeAt(0).toString(16).padStart(4, "0")})`)
      .join(", ")}`,
  );

  const entries = new Map();
  for (const match of text.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
    entries.set(match[1], match[2]);
  }
  check(entries.size > 0, `${name} defines at least one key`);
  dictionaries.set(name, entries);
}

/** English is the reference; every other language must match it exactly. */
function compare(referenceName, otherName) {
  const reference = dictionaries.get(referenceName);
  const other = dictionaries.get(otherName);
  if (!reference || !other) return;

  const missing = [...reference.keys()].filter((key) => !other.has(key));
  check(missing.length === 0, `${otherName} is missing keys: ${missing.join(", ")}`);

  const extra = [...other.keys()].filter((key) => !reference.has(key));
  check(extra.length === 0, `${otherName} defines unknown keys: ${extra.join(", ")}`);

  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, value] of reference) {
    const counterpart = other.get(key);
    if (counterpart === undefined) continue;
    assert.deepEqual(
      placeholders(counterpart),
      placeholders(value),
      `${otherName} key "${key}" has different placeholders from ${referenceName}`,
    );
    checks += 1;
  }
}

compare("product.en.ts", "product.it.ts");
compare("en.ts", "it.ts");

/*
  User-visible copy is not only in the dictionaries.

  The Rust sources carry the strings the assistant and the review screens see,
  and they turned out to contain four mojibake em dashes and a mojibake middle
  dot that had shipped unnoticed — the toolchain has no opinion about them.
  Scanning here means one check covers everywhere copy actually lives.
*/
const RUST = fileURLToPath(new URL("../src-tauri/src/", import.meta.url));

async function rustFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await rustFiles(full)));
    else if (entry.name.endsWith(".rs")) found.push(full);
  }
  return found;
}

const sources = await rustFiles(RUST);
for (const file of sources) {
  const text = await readFile(file, "utf8");
  for (const lead of MOJIBAKE_LEADS) {
    check(
      !text.includes(lead),
      `${path.relative(RUST, file)} contains the mojibake signature ${JSON.stringify(lead)}`,
    );
  }
}

console.log(
  `Locale integrity: ${checks}/${checks} checks passed across ${files.length} dictionaries and ${sources.length} Rust sources`,
);

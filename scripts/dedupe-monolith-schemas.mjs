#!/usr/bin/env node
/**
 * One-shot dedupe pass: replace every
 *
 *   const XxxSchema = Type.Object(
 *     ...multi-line body...
 *   );
 *
 * in src/tool-monolith.ts with
 *
 *   const XxxSchema = SharedSchemas.XxxSchema;
 *
 * provided that XxxSchema is also exported from src/tool-schemas.ts. We use
 * an alias rather than a global rename so existing references inside the
 * monolith (including `Static<typeof XxxSchema>` aliases and
 * `parameters: XxxSchema` keys) keep working without any further edits.
 *
 * The script is idempotent: blocks that already use `SharedSchemas.` are
 * skipped.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const monolithPath = path.join(repoRoot, "src/tool-monolith.ts");
const schemasPath = path.join(repoRoot, "src/tool-schemas.ts");

const monolithSrc = await readFile(monolithPath, "utf8");
const schemasSrc = await readFile(schemasPath, "utf8");

// Names exported from tool-schemas.ts.
const exportedNames = new Set(
  Array.from(schemasSrc.matchAll(/^export const (\w+Schema) = Type\./gm), (m) => m[1]),
);

const lines = monolithSrc.split("\n");
const startRe = /^const (\w+Schema) = Type\./;

const replaced = [];
const skipped = [];

let i = 0;
const out = [];
while (i < lines.length) {
  const line = lines[i];
  const m = line.match(startRe);
  if (!m) {
    out.push(line);
    i += 1;
    continue;
  }
  const name = m[1];
  if (!exportedNames.has(name)) {
    skipped.push(`${name} (no shared counterpart)`);
    out.push(line);
    i += 1;
    continue;
  }

  // Find the closing `);` line at column 0. The block is:
  //   const FooSchema = Type.Object(
  //     ...
  //   );
  // The closer line is exactly `);` (start-of-line, followed by newline).
  let end = -1;
  for (let j = i + 1; j < lines.length; j += 1) {
    if (lines[j] === ");") {
      end = j;
      break;
    }
  }
  if (end === -1) {
    throw new Error(`could not find closing \`);\` for ${name} starting at line ${i + 1}`);
  }

  out.push(`const ${name} = SharedSchemas.${name};`);
  replaced.push(name);
  i = end + 1;
}

const result = out.join("\n");
if (result === monolithSrc) {
  console.log("no changes");
} else {
  await writeFile(monolithPath, result, "utf8");
  console.log(`replaced ${replaced.length} schemas with SharedSchemas aliases:`);
  for (const n of replaced) console.log(`  - ${n}`);
  if (skipped.length > 0) {
    console.log(`skipped ${skipped.length} names:`);
    for (const n of skipped) console.log(`  - ${n}`);
  }
}

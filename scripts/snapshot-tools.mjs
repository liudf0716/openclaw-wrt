#!/usr/bin/env node
/**
 * Snapshot the public tool contract surface of @openclaw/openclaw-wrt.
 *
 * For every tool returned by createClawWRTTools(), record:
 *   - name
 *   - description
 *   - parameters (the TypeBox/JSON-Schema-shaped object passed to the SDK)
 *
 * The output is sorted by name and written to docs/baseline-tools.json so
 * refactor PRs can diff their post-build output against this snapshot and
 * prove zero behavioural drift on the tool-contract surface.
 *
 * Usage:
 *   pnpm build && node scripts/snapshot-tools.mjs
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const { createClawWRTTools } = await import(path.join(repoRoot, "dist/esm/index.js"));

// Minimal stub bridge so factories that capture it from closure still work.
// We only inspect the static (name, description, parameters) surface; we never
// invoke .execute(), so callDevice never runs.
const stubBridge = {
  listDevices() {
    return [];
  },
  getDevice() {
    return null;
  },
  async callDevice() {
    throw new Error("snapshot bridge: callDevice should not be invoked");
  },
};

const tools = createClawWRTTools({ bridge: stubBridge });

if (!Array.isArray(tools)) {
  throw new Error("createClawWRTTools did not return an array");
}

const snapshot = tools
  .map((tool) => ({
    name: tool.name,
    description: tool.description ?? null,
    parameters: tool.parameters ?? null,
  }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const outputPath = path.join(repoRoot, "docs/baseline-tools.json");
await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

console.log(`wrote ${snapshot.length} tool contracts to docs/baseline-tools.json`);

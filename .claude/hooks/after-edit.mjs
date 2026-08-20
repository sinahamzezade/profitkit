#!/usr/bin/env node
/**
 * PostToolUse hook: warns about edits whose effects the dev server won't pick up,
 * and nudges toward the reconcile check when reporting code changes.
 *
 * Reads the hook payload from stdin rather than relying on an environment variable,
 * because the payload shape is stable across tools (Edit / Write / MultiEdit all
 * carry tool_input.file_path) while the env vars are not guaranteed to be present.
 *
 * Always exits 0. This hook advises; it must never block an edit.
 */

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let filePath = "";
  try {
    filePath = JSON.parse(raw)?.tool_input?.file_path ?? "";
  } catch {
    // Malformed or empty payload: say nothing rather than printing noise.
    process.exit(0);
  }

  const notes = [];

  // These two modules are captured at import time — the Prisma client is cached on
  // globalThis and the Shopify app config is built once at module scope — so editing
  // them leaves the running dev server serving stale code. The symptom is a page that
  // renders its heading but an empty body, which reads exactly like a code bug and
  // cost several debugging cycles before the cause was identified.
  if (/prisma\/schema\.prisma$|app\/shopify\.server\.ts$/.test(filePath)) {
    notes.push(
      "Restart the dev server: shopify app dev --config profitkit\n" +
        "  This file is captured at module scope, so HMR will not pick it up. If pages\n" +
        "  render their heading but an empty body, that is a stale server, not broken code.",
    );
  }

  if (/prisma\/schema\.prisma$/.test(filePath)) {
    notes.push(
      "Schema changed — run: npx prisma migrate dev --name <change>\n" +
        "  Then add the new field to every ProductMarginRow test fixture; a required\n" +
        "  field breaks app/reports/*.test.ts in three files at once.",
    );
  }

  // Unit tests cover the arithmetic; reconcile is what catches data-level drift,
  // such as aggregates that no longer tie back to the raw rows.
  if (/app\/reports\//.test(filePath) && !/\.test\.ts$/.test(filePath)) {
    notes.push(
      "Reports changed — verify totals still tie back to raw rows:\n" +
        "  npm run reconcile -- first-test-zenmt2u1.myshopify.com",
    );
  }

  if (notes.length > 0) {
    console.log(notes.map((n) => `• ${n}`).join("\n"));
  }
  process.exit(0);
});

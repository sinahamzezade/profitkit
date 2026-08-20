import { readFileSync, writeFileSync } from "node:fs";

import prisma from "../app/db.server";
import { parseCsv } from "../app/import/csv";
import {
  buildErrorReportCsv,
  suggestColumnMapping,
  validateImport,
} from "../app/import/cogsImport";
import { commitCogsImport, loadCatalogForMatching } from "../app/import/commit";

/**
 * CLI counterpart of the rung-3 import screen: same parse → map → validate →
 * commit path the UI will drive, so both share one implementation.
 *
 *   npm run import-cogs -- <file.csv> [--dry-run]
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));
  const [filePath, domain] = positional;

  if (!filePath) {
    console.error("Usage: npm run import-cogs -- <file.csv> [shop-domain] [--dry-run]");
    process.exit(1);
  }

  // Explicit domain when given. More than one shop exists as soon as seed data
  // has been loaded under a real dev store, and findFirst would pick arbitrarily —
  // which silently writes a merchant's costs onto the wrong store.
  const shop = domain
    ? await prisma.shop.findUnique({ where: { domain } })
    : await prisma.shop.findFirst();
  if (!shop) {
    console.error(
      domain
        ? `No shop with domain ${domain}.`
        : "No shop in the database. Run `npm run load-seed` first.",
    );
    process.exit(1);
  }

  const shopCount = await prisma.shop.count();
  if (!domain && shopCount > 1) {
    console.error(
      `${shopCount} shops exist and no domain was given. Pass one explicitly so ` +
        `costs land on the right store.`,
    );
    process.exit(1);
  }
  console.log(`Importing into ${shop.domain}`);

  const text = readFileSync(filePath, "utf8");
  const { headers, rows, delimiter } = parseCsv(text);
  const mapping = suggestColumnMapping(headers);

  console.log(`Delimiter: ${JSON.stringify(delimiter)}`);
  console.log(`Headers:   ${headers.join(" | ")}`);
  console.log(
    "Mapping:   " +
      `sku=${mapping.sku != null ? headers[mapping.sku] : "(none)"}, ` +
      `variantId=${mapping.variantId != null ? headers[mapping.variantId] : "(none)"}, ` +
      `cost=${mapping.cost != null ? headers[mapping.cost] : "(none)"}`,
  );

  if (mapping.cost == null || (mapping.sku == null && mapping.variantId == null)) {
    console.error(
      "\nCouldn't identify the required columns. In the app this is where the merchant " +
        "maps them by hand — the suggestion is never applied on its own.",
    );
    process.exit(1);
  }

  const catalog = await loadCatalogForMatching(shop.id);
  const summary = validateImport(rows, mapping, catalog, headers.length);

  console.log(
    `\n${summary.matched} matched · ${summary.skipped} blank · ${summary.errored} errored`,
  );
  console.log(
    `${summary.unmatchedCatalogCount}/${catalog.length} catalog variants not covered by this file`,
  );

  const report = buildErrorReportCsv(summary, headers);
  if (report) {
    const reportPath = filePath.replace(/\.csv$/i, "") + ".errors.csv";
    writeFileSync(reportPath, report);
    console.log(`\nError report: ${reportPath}`);
    for (const row of summary.rows.filter((r) => r.status === "error").slice(0, 10)) {
      console.log(`  line ${row.line}: ${row.message}`);
    }
  }

  if (dryRun) {
    console.log("\nDry run — nothing written.");
  } else {
    const { written } = await commitCogsImport(shop.id, summary);
    console.log(`\nWrote ${written} variant-level cost entries.`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

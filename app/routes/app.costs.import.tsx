import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  buildErrorReportCsv,
  suggestColumnMapping,
  validateImport,
  type ColumnMapping,
} from "../import/cogsImport";
import { commitCogsImport, loadCatalogForMatching } from "../import/commit";
import {
  countProblems,
  describeDelimiter,
  describeProblems,
  mappingError,
  prepareImport,
  readMapping,
  type ImportProblem,
} from "../import/request";

/**
 * Rung 3 of the cost ladder, reachable without a terminal.
 *
 * The parse → map → validate → commit engine already existed in `app/import/`,
 * built for this screen and driven until now only by `npm run import-cogs`. The
 * listing promises "import exact costs from a spreadsheet"; this is the promise
 * being kept. Nothing in the engine changed.
 *
 * Deliberately free rather than gated behind Pro. Almost no store has Shopify's
 * native cost field populated, so estimates are the normal case and every figure
 * in the app carries an "this is a guess" caveat until real costs arrive. Charging
 * for the one screen that removes the caveat would be charging for correctness.
 *
 * ## Why the file is sent as text
 *
 * The browser reads the file and posts its contents in an ordinary form field.
 * Multipart bodies through the embedded admin's authenticated fetch are the one
 * part of this that could not be verified without a live install, and sending text
 * removes the question entirely. Cost sheets are small; `MAX_TEXT_BYTES` keeps an
 * accidental 50 MB export from becoming a request.
 *
 * ## Why nothing is stored between steps
 *
 * `parseCsv` and `validateImport` are pure, so each step re-derives everything from
 * the text plus the mapping. No temp files, no session state, nothing to clean up
 * or leak between merchants. Re-parsing a cost sheet costs microseconds.
 *
 * The commit step re-validates from the same text rather than trusting a list of
 * costs from the client — the browser must not be able to name a variant and a cost
 * directly, and re-deriving means what gets written is exactly what was previewed.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ready: false as const, variantCount: 0 };

  const variantCount = await prisma.variant.count({
    where: { product: { shopId: shop.id } },
  });
  return { ready: true as const, variantCount };
};

type ActionResult =
  | { error: string }
  | {
      step: "map";
      headers: string[];
      delimiter: string;
      rowCount: number;
      mapping: ColumnMapping;
    }
  | {
      step: "review";
      mapping: ColumnMapping;
      headers: string[];
      matched: number;
      skipped: number;
      errored: number;
      unmatchedCatalogCount: number;
      catalogCount: number;
      problems: ImportProblem[];
      /** Uncapped total, so the count above the table is not the truncated one. */
      problemCount: number;
      reportCsv: string | null;
    }
  | { step: "done"; written: number };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const text = String(form.get("text") ?? "");

  const prepared = prepareImport(text);
  if (!prepared.ok) return { error: prepared.error } satisfies ActionResult;
  const { headers, rows, delimiter } = prepared;

  if (intent === "parse") {
    return {
      step: "map",
      headers,
      delimiter,
      rowCount: rows.length,
      // A suggestion only. The merchant confirms it on the next screen — a file
      // with columns in an unexpected order must not import silently wrong.
      mapping: suggestColumnMapping(headers),
    } satisfies ActionResult;
  }

  const mapping = readMapping({
    sku: form.get("sku")?.toString(),
    variantId: form.get("variantId")?.toString(),
    cost: form.get("cost")?.toString(),
  });
  const badMapping = mappingError(mapping);
  if (badMapping) return { error: badMapping } satisfies ActionResult;

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "No data for this store yet." } satisfies ActionResult;

  const catalog = await loadCatalogForMatching(shop.id);
  const summary = validateImport(rows, mapping, catalog, headers.length);

  if (intent === "commit") {
    if (summary.matched === 0) {
      return { error: "Nothing to import — no row matched a product." } satisfies ActionResult;
    }
    const { written } = await commitCogsImport(shop.id, summary);
    return { step: "done", written } satisfies ActionResult;
  }

  return {
    step: "review",
    mapping,
    headers,
    matched: summary.matched,
    skipped: summary.skipped,
    errored: summary.errored,
    unmatchedCatalogCount: summary.unmatchedCatalogCount,
    catalogCount: catalog.length,
    problems: describeProblems(summary),
    problemCount: countProblems(summary),
    reportCsv: buildErrorReportCsv(summary, headers),
  } satisfies ActionResult;
};

export default function CostImport() {
  const { ready, variantCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState("");

  const result = fetcher.data;
  const busy = fetcher.state !== "idle";
  const step =
    result && "step" in result ? result.step : text === "" ? "upload" : "upload";

  if (!ready) {
    return (
      <s-page heading="Import costs">
        <s-section accessibilityLabel="No products yet">
          <s-banner tone="info" heading="No products yet">
            Once this store has products, you can match a cost sheet against them.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  // `s-drop-zone` hands over a plain `File[]`, not a `FileList` — confirmed against
  // the component's own types rather than assumed from the input-like props.
  const onFile = (event: { currentTarget: { files: File[] } }) => {
    const file = event.currentTarget.files[0];
    if (!file) return;
    setReadError("");
    setFileName(file.name);

    const reader = new FileReader();
    reader.onerror = () =>
      setReadError("That file could not be read. Try re-saving it as CSV.");
    reader.onload = () => {
      const contents = typeof reader.result === "string" ? reader.result : "";
      setText(contents);
      // Straight into parsing: the merchant chose a file, they should not then have
      // to press a second button to see what is in it.
      fetcher.submit({ intent: "parse", text: contents }, { method: "POST" });
    };
    reader.readAsText(file);
  };

  return (
    <s-page heading="Import costs">
      <style>{IMPORT_STYLES}</style>

      {step === "upload" && (
        <s-section accessibilityLabel="Choose a file">
          <s-paragraph>
            A CSV with one row per product and a column for its cost. Rows are
            matched on SKU, or on variant ID — never on product title, because
            titles repeat and a wrong match writes a wrong cost silently.
          </s-paragraph>
          <s-paragraph>
            <s-text tone="neutral">
              {variantCount.toLocaleString()} product variants in this store to
              match against. Column names are read from your file — nothing needs
              renaming first.
            </s-text>
          </s-paragraph>
          <div className="pk-import-drop">
            <s-drop-zone
              label="Cost sheet"
              accept=".csv,text/csv"
              onChange={onFile}
            />
          </div>
          {readError !== "" && <s-banner tone="critical">{readError}</s-banner>}
        </s-section>
      )}

      {result && "error" in result && (
        <s-section accessibilityLabel="Problem with the file">
          <s-banner tone="critical" heading="Could not read that file">
            <s-paragraph>{result.error}</s-paragraph>
          </s-banner>
          <s-button onClick={() => reset(setText, setFileName, fetcher)}>
            Choose another file
          </s-button>
        </s-section>
      )}

      {result && "step" in result && result.step === "map" && (
        <MapStep
          result={result}
          text={text}
          fileName={fileName}
          busy={busy}
          submit={fetcher.submit}
        />
      )}

      {result && "step" in result && result.step === "review" && (
        <ReviewStep
          result={result}
          text={text}
          busy={busy}
          submit={fetcher.submit}
          onStartOver={() => reset(setText, setFileName, fetcher)}
        />
      )}

      {result && "step" in result && result.step === "done" && (
        <s-section accessibilityLabel="Import complete">
          <s-banner tone="success" heading="Costs imported">
            <s-paragraph>
              {result.written.toLocaleString()} product{" "}
              {result.written === 1 ? "cost" : "costs"} saved. These now outrank
              every estimate, so the margin figures use them from here.
            </s-paragraph>
          </s-banner>
          <s-stack direction="inline" gap="small-300">
            <s-button variant="primary" href="/app/products">
              See the updated margins
            </s-button>
            <s-button onClick={() => reset(setText, setFileName, fetcher)}>
              Import another file
            </s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

function reset(
  setText: (v: string) => void,
  setFileName: (v: string) => void,
  fetcher: { load: (href: string) => void },
) {
  setText("");
  setFileName("");
  // Clears the fetcher's data so the wizard returns to the upload step.
  fetcher.load("/app/costs/import");
}

type Submit = (
  target: Record<string, string>,
  options: { method: "POST" },
) => void;

/**
 * Column mapping. Pre-filled from the header names and always confirmable —
 * `suggestColumnMapping` is explicitly a suggestion, and a file whose columns sit
 * in an unexpected order has to land here rather than import wrong.
 */
function MapStep({
  result,
  text,
  fileName,
  busy,
  submit,
}: {
  result: Extract<ActionResult, { step: "map" }>;
  text: string;
  fileName: string;
  busy: boolean;
  submit: Submit;
}) {
  const [sku, setSku] = useState(str(result.mapping.sku));
  const [variantId, setVariantId] = useState(str(result.mapping.variantId));
  const [cost, setCost] = useState(str(result.mapping.cost));

  const options = result.headers.map((header, index) => ({
    value: String(index),
    label: header === "" ? `Column ${index + 1}` : header,
  }));

  return (
    <s-section accessibilityLabel="Match the columns">
      <s-paragraph>
        <strong>{fileName || "Your file"}</strong> — {result.rowCount.toLocaleString()}{" "}
        {result.rowCount === 1 ? "row" : "rows"}, {result.headers.length} columns,
        separated by {describeDelimiter(result.delimiter)}.
      </s-paragraph>
      <s-paragraph>
        <s-text tone="neutral">
          Check these are the right columns. Nothing is written until the next
          screen.
        </s-text>
      </s-paragraph>

      <div className="pk-import-map">
        <ColumnSelect
          label="Cost per item"
          value={cost}
          onChange={setCost}
          options={options}
          required
        />
        <ColumnSelect
          label="SKU"
          value={sku}
          onChange={setSku}
          options={options}
        />
        <ColumnSelect
          label="Variant ID"
          value={variantId}
          onChange={setVariantId}
          options={options}
        />
      </div>
      <s-paragraph>
        <s-text tone="neutral">
          A SKU is enough on its own. Variant ID is the fallback for rows whose SKU
          is blank or does not match.
        </s-text>
      </s-paragraph>

      <s-button
        variant="primary"
        {...(busy ? { loading: true } : {})}
        onClick={() =>
          submit({ intent: "validate", text, sku, variantId, cost }, { method: "POST" })
        }
      >
        Check the file
      </s-button>
    </s-section>
  );
}

function ColumnSelect({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  return (
    <s-select
      label={label}
      value={value}
      {...(required ? { required: true } : {})}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <s-option value="">{required ? "Choose a column" : "Not in this file"}</s-option>
      {options.map((option) => (
        <s-option key={option.value} value={option.value}>
          {option.label}
        </s-option>
      ))}
    </s-select>
  );
}

/**
 * What the file will do, before it does it.
 *
 * Partial import is the engine's default — bad rows are skipped, the rest are
 * written — so the counts here have to make the split obvious rather than reading
 * as a pass/fail.
 */
function ReviewStep({
  result,
  text,
  busy,
  submit,
  onStartOver,
}: {
  result: Extract<ActionResult, { step: "review" }>;
  text: string;
  busy: boolean;
  submit: Submit;
  onStartOver: () => void;
}) {
  const { mapping } = result;
  const covered = result.catalogCount - result.unmatchedCatalogCount;

  return (
    <>
      <s-section accessibilityLabel="What this file will do">
        <div className="pk-import-counts">
          <Count value={result.matched} label="will be imported" />
          <Count value={result.errored} label="could not be read" tone="bad" />
          <Count value={result.skipped} label="blank rows skipped" />
        </div>
        <s-paragraph>
          Covers <strong>{covered.toLocaleString()}</strong> of{" "}
          {result.catalogCount.toLocaleString()} variants in your store. The rest keep
          whatever cost they have now — importing never clears a cost it does not
          mention.
        </s-paragraph>

        {result.errored > 0 && (
          <s-banner tone="warning" heading="Some rows will be skipped">
            <s-paragraph>
              The {result.matched.toLocaleString()} good rows still import. Fix the
              rest and upload again — costs are matched per variant, so re-importing
              only updates what the second file mentions.
            </s-paragraph>
          </s-banner>
        )}

        <s-stack direction="inline" gap="small-300">
          <s-button
            variant="primary"
            {...(busy ? { loading: true } : {})}
            {...(result.matched === 0 ? { disabled: true } : {})}
            onClick={() =>
              submit(
                {
                  intent: "commit",
                  text,
                  sku: str(mapping.sku),
                  variantId: str(mapping.variantId),
                  cost: str(mapping.cost),
                },
                { method: "POST" },
              )
            }
          >
            {result.matched === 0
              ? "Nothing to import"
              : `Import ${result.matched.toLocaleString()} costs`}
          </s-button>
          <s-button onClick={onStartOver}>Start over</s-button>
        </s-stack>
      </s-section>

      {result.problems.length > 0 && (
        <s-section accessibilityLabel="Rows needing attention">
          <s-paragraph>
            {result.problemCount.toLocaleString()}{" "}
            {result.problemCount === 1 ? "row needs" : "rows need"} attention
            {result.problems.length < result.problemCount
              ? `, showing the first ${result.problems.length}`
              : ""}
            .
          </s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="kicker">Line</s-table-header>
              <s-table-header listSlot="secondary">Outcome</s-table-header>
              <s-table-header listSlot="primary">What is wrong</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {result.problems.map((problem) => (
                <s-table-row key={`${problem.line}-${problem.status}`}>
                  <s-table-cell>
                    <span className="num">{problem.line}</span>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={problem.status === "error" ? "critical" : "warning"}>
                      {problem.status === "error" ? "Skipped" : "Imported"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{problem.detail}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </>
  );
}

function Count({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "bad";
}) {
  return (
    <div className="pk-import-count">
      <p className={`pk-import-count-value${tone === "bad" && value > 0 ? " pk-down" : ""}`}>
        {value.toLocaleString()}
      </p>
      <p className="pk-import-count-label">{label}</p>
    </div>
  );
}

function str(index: number | null): string {
  return index == null ? "" : String(index);
}

const IMPORT_STYLES = `
  .pk-import-drop { margin-block: 1rem; }

  .pk-import-map {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.75rem 1rem;
    margin-block: 1rem;
  }

  .pk-import-counts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .pk-import-count-value {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.1;
    color: var(--pk-ink);
    font-variant-numeric: tabular-nums;
  }
  .pk-import-count-label { margin: 0.15rem 0 0; font-size: 0.78rem; color: var(--pk-muted); }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

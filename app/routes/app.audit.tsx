import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const MARGIN_FIELD_AUDIT_QUERY = `#graphql
  query MarginFieldAudit {
    orders(first: 5, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          currencyCode
          test
          currentSubtotalPriceSet { shopMoney { amount currencyCode } }
          currentTotalPriceSet    { shopMoney { amount } }
          currentTotalTaxSet      { shopMoney { amount } }
          netPaymentSet           { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          shippingLines(first: 5) {
            nodes { title carrierIdentifier originalPriceSet { shopMoney { amount } } }
          }
          currentTotalDiscountsSet { shopMoney { amount } }
          discountApplications(first: 10) {
            nodes {
              allocationMethod
              targetSelection
              targetType
              value {
                ... on MoneyV2 { amount currencyCode }
                ... on PricingPercentageValue { percentage }
              }
            }
          }
          lineItems(first: 25) {
            nodes {
              id
              title
              sku
              quantity
              currentQuantity
              originalTotalSet   { shopMoney { amount } }
              discountedTotalSet { shopMoney { amount } }
              discountAllocations { allocatedAmountSet { shopMoney { amount } } }
              taxLines { title rate priceSet { shopMoney { amount } } }
              variant {
                id
                sku
                price
                inventoryItem { id unitCost { amount currencyCode } }
              }
            }
          }
          refunds(first: 10) {
            id
            createdAt
            totalRefundedSet { shopMoney { amount } }
            refundLineItems(first: 25) {
              nodes {
                quantity
                subtotalSet { shopMoney { amount } }
                lineItem { id sku }
              }
            }
          }
          transactions(first: 10) {
            id
            kind
            status
            gateway
            amountSet { shopMoney { amount } }
            fees {
              id
              type
              rate
              rateName
              flatFee { amount currencyCode }
              amount  { amount currencyCode }
            }
          }
        }
      }
    }
  }
`;

const COGS_FILL_RATE_QUERY = `#graphql
  query CogsFillRate($cursor: String) {
    productVariants(first: 250, after: $cursor) {
      nodes {
        id
        sku
        price
        product { title vendor }
        inventoryItem { unitCost { amount } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type FieldStatus = "present" | "null" | "no-data";

function summarize(values: unknown[]): FieldStatus {
  if (values.length === 0) return "no-data";
  return values.some((v) => v !== null && v !== undefined) ? "present" : "null";
}

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const auditResponse = await admin.graphql(MARGIN_FIELD_AUDIT_QUERY);
  const auditJson = (await auditResponse.json()) as {
    data?: unknown;
    errors?: unknown;
  };
  const orders = arr(get(auditJson.data, "orders.edges")).map((e) =>
    get(e, "node"),
  );

  const lineItems = orders.flatMap((o) => arr(get(o, "lineItems.nodes")));
  const refunds = orders.flatMap((o) => arr(get(o, "refunds")));
  const refundLineItems = refunds.flatMap((r) =>
    arr(get(r, "refundLineItems.nodes")),
  );
  const transactions = orders.flatMap((o) => arr(get(o, "transactions")));
  const fees = transactions.flatMap((t) => arr(get(t, "fees")));

  const fieldRows: Array<{
    input: string;
    field: string;
    status: FieldStatus;
    note?: string;
  }> = [
    {
      input: "Line revenue",
      field: "lineItem.discountedTotalSet",
      status: summarize(
        lineItems.map((li) => get(li, "discountedTotalSet.shopMoney.amount")),
      ),
    },
    {
      input: "Discount allocation",
      field: "lineItem.discountAllocations",
      status: summarize(
        lineItems.flatMap((li) =>
          arr(get(li, "discountAllocations")).map((a) =>
            get(a, "allocatedAmountSet.shopMoney.amount"),
          ),
        ),
      ),
    },
    {
      input: "Refunds (line level)",
      field: "refunds.refundLineItems",
      status: summarize(
        refundLineItems.map((rli) => get(rli, "subtotalSet.shopMoney.amount")),
      ),
    },
    {
      input: "Shipping charged",
      field: "totalShippingPriceSet",
      status: summarize(
        orders.map((o) => get(o, "totalShippingPriceSet.shopMoney.amount")),
      ),
    },
    {
      input: "Tax",
      field: "lineItem.taxLines",
      status: summarize(
        lineItems.flatMap((li) =>
          arr(get(li, "taxLines")).map((t) => get(t, "priceSet.shopMoney.amount")),
        ),
      ),
    },
    {
      input: "COGS",
      field: "inventoryItem.unitCost",
      status: summarize(
        lineItems.map((li) => get(li, "variant.inventoryItem.unitCost.amount")),
      ),
    },
    {
      input: "Gateway fees",
      field: "transactions.fees",
      status: summarize(fees.map((f) => get(f, "amount.amount"))),
      note: "Empty for non-Shopify-Payments gateways (Telr, PayTabs, Tap, COD).",
    },
    {
      input: "Shipping ACTUAL cost",
      field: "— does not exist —",
      status: "no-data",
      note: "Confirmed absent from schema by design. Always a merchant input.",
    },
  ];

  // COGS fill rate across the catalog, paginated.
  let cursor: string | null = null;
  let totalVariants = 0;
  let variantsWithCost = 0;
  do {
    const cogsResponse = await admin.graphql(COGS_FILL_RATE_QUERY, {
      variables: { cursor },
    });
    const cogsJson = (await cogsResponse.json()) as { data?: unknown };
    const page = get(cogsJson.data, "productVariants");
    const nodes = arr(get(page, "nodes"));
    totalVariants += nodes.length;
    variantsWithCost += nodes.filter(
      (v) => get(v, "inventoryItem.unitCost.amount") != null,
    ).length;
    const hasNextPage = get(page, "pageInfo.hasNextPage");
    cursor = hasNextPage ? (get(page, "pageInfo.endCursor") as string) : null;
  } while (cursor);

  const cogsFillRate =
    totalVariants === 0 ? null : Math.round((variantsWithCost / totalVariants) * 100);

  return {
    ordersFetched: orders.length,
    fieldRows,
    cogs: { totalVariants, variantsWithCost, cogsFillRate },
    graphQLErrors: auditJson.errors ?? null,
    rawOrders: orders,
  };
};

const STATUS_LABEL: Record<FieldStatus, string> = {
  present: "PRESENT",
  null: "NULL",
  "no-data": "NO DATA",
};

const STATUS_TONE: Record<FieldStatus, "success" | "critical" | "neutral"> = {
  present: "success",
  null: "critical",
  "no-data": "neutral",
};

export default function Audit() {
  const { ordersFetched, fieldRows, cogs, graphQLErrors, rawOrders } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Margin field audit">
      <s-section heading={`Order fields (${ordersFetched} orders sampled)`}>
        {ordersFetched === 0 && (
          <s-banner tone="warning" heading="No orders found">
            Create test orders in Orders → Create order before this table
            means anything: one multi-line, one with a discount code, one
            with shipping charged, one partially refunded.
          </s-banner>
        )}
        {graphQLErrors && (
          <s-banner tone="critical" heading="GraphQL errors">
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(graphQLErrors, null, 2)}
            </pre>
          </s-banner>
        )}
        <s-table>
          <s-table-header-row>
            <s-table-header>Input</s-table-header>
            <s-table-header>Field</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Note</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {fieldRows.map((row) => (
              <s-table-row key={row.field}>
                <s-table-cell>{row.input}</s-table-cell>
                <s-table-cell>
                  <code>{row.field}</code>
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={STATUS_TONE[row.status]}>
                    {STATUS_LABEL[row.status]}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>{row.note ?? ""}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="COGS fill rate (catalog-wide)">
        <s-paragraph>
          {cogs.variantsWithCost} / {cogs.totalVariants} variants have
          non-null <code>inventoryItem.unitCost</code>
          {cogs.cogsFillRate !== null ? ` — ${cogs.cogsFillRate}% filled.` : "."}
        </s-paragraph>
        <s-paragraph>
          {cogs.cogsFillRate !== null && cogs.cogsFillRate < 50
            ? "Rung 0 is decorative for this store — the estimate path (global %, then collection/vendor override) carries onboarding."
            : "Meaningful native COGS coverage — still build the ladder, but rung 0 pulls real weight here."}
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Raw response">
        <s-paragraph>
          Full JSON for the first {ordersFetched} orders, for spot-checking
          the table above.
        </s-paragraph>
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <code>{JSON.stringify(rawOrders, null, 2)}</code>
          </pre>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

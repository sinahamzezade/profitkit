import type { RawLineItemNode, RawOrderNode, RawProductNode } from "../ingestion/types";
import {
  BACKFILL_ORDERS_QUERY,
  BACKFILL_ORDERS_QUERY_NO_RETURNS,
  BACKFILL_PRODUCTS_QUERY,
  ORDER_BY_ID_QUERY,
  ORDER_BY_ID_QUERY_NO_RETURNS,
  ORDER_LINE_ITEMS_QUERY,
  PRODUCT_BY_ID_QUERY,
  PRODUCT_IMAGES_QUERY,
  REFUND_LIMIT,
  TRANSACTION_LIMIT,
} from "./queries";

/**
 * The Shopify boundary. Everything below this file speaks `RawOrderNode` /
 * `RawProductNode`; nothing above it knows Shopify exists. That separation is
 * deliberate — the margin engine was built and tested against seeded data for
 * eight days before this file existed, and it must stay possible to swap this
 * out without touching the engine.
 */

/** The one method this layer needs from Shopify's client, so tests can supply a fake. */
export interface GraphqlClient {
  (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<{ json: () => Promise<unknown> }>;
}

/** Backfill window. `read_orders` cannot see past 60 days without extra approval. */
export const BACKFILL_WINDOW_DAYS = 60;

/** Guards against a pagination bug turning into an unbounded loop against the API. */
const MAX_PAGES = 200;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    readonly errors: unknown,
  ) {
    super(message);
    this.name = "ShopifyGraphqlError";
  }
}

async function run(
  graphql: GraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const response = await graphql(query, variables ? { variables } : undefined);
  const body = (await response.json()) as { data?: unknown; errors?: unknown };

  // Shopify returns 200 with an `errors` array for things like ACCESS_DENIED.
  // Treating that as success is how a scope problem turns into silent empty data.
  if (body.errors) {
    const message =
      typeof body.errors === "string"
        ? body.errors
        : JSON.stringify(body.errors).slice(0, 500);
    throw new ShopifyGraphqlError(`Shopify GraphQL error: ${message}`, body.errors);
  }
  return body.data;
}

/** Shopify's search syntax wants a date literal, not an ISO timestamp with millis. */
export function backfillQueryString(since: Date): string {
  return `created_at:>=${since.toISOString().slice(0, 10)}`;
}

export async function* paginate(
  graphql: GraphqlClient,
  query: string,
  connectionPath: string,
  variables: Record<string, unknown> = {},
): AsyncGenerator<unknown[], void, undefined> {
  let cursor: string | null = null;
  let pages = 0;

  do {
    const data = await run(graphql, query, { ...variables, cursor });
    const connection = get(data, connectionPath);
    const nodes = get(connection, "nodes");
    yield Array.isArray(nodes) ? nodes : [];

    const hasNext = get(connection, "pageInfo.hasNextPage") === true;
    cursor = hasNext ? ((get(connection, "pageInfo.endCursor") as string) ?? null) : null;
    pages++;
  } while (cursor && pages < MAX_PAGES);
}

/**
 * True when Shopify refused the query specifically because the Returns selection
 * needs a scope this shop hasn't granted.
 *
 * Deliberately narrow. A blanket "retry without returns on any access error" would
 * mask a missing `read_orders` — the failure that actually matters — by quietly
 * succeeding with an empty result. The library raises its own `GraphqlQueryError`
 * before our `run` inspects the body, so this has to match on the message.
 */
export function isReturnsAccessDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /read_returns|read_marketplace_returns/.test(message) ||
    (/access denied/i.test(message) && /\breturn\b/i.test(message))
  );
}

/**
 * Fills in line items past the first page.
 *
 * `Order.lineItems` is a real connection, so an order with more lines than
 * `LINE_ITEM_PAGE` is completable: follow the cursor until it runs out. Before
 * this, the query asked for the first 100 and the 101st simply did not exist as
 * far as the rest of the app was concerned — the order's revenue, cost and margin
 * were all quietly computed from a partial basket, with nothing anywhere saying so.
 *
 * Only pays for itself when needed: an order inside the page limit makes no extra
 * request at all.
 */
async function completeLineItems(
  graphql: GraphqlClient,
  order: RawOrderNode,
): Promise<RawOrderNode> {
  const connection = get(order, "lineItems");
  if (get(connection, "pageInfo.hasNextPage") !== true) return order;

  const nodes = [...((get(connection, "nodes") as RawLineItemNode[]) ?? [])];
  let cursor: string | null = (get(connection, "pageInfo.endCursor") as string) ?? null;
  let pages = 0;

  while (cursor && pages < MAX_PAGES) {
    const data = await run(graphql, ORDER_LINE_ITEMS_QUERY, { id: order.id, cursor });
    const page = get(data, "order.lineItems");
    const pageNodes = get(page, "nodes");
    if (Array.isArray(pageNodes)) nodes.push(...(pageNodes as RawLineItemNode[]));

    const hasNext = get(page, "pageInfo.hasNextPage") === true;
    cursor = hasNext ? ((get(page, "pageInfo.endCursor") as string) ?? null) : null;
    pages++;
  }

  return { ...order, lineItems: { nodes } };
}

/**
 * Warns when a list that cannot be paginated came back exactly full.
 *
 * `Order.refunds` and `Order.transactions` are plain lists — `first` truncates
 * them and there is no cursor to ask for the rest, so this cannot be fixed the way
 * line items were. An array of exactly the requested length is therefore either
 * complete by coincidence or silently short, and the two are indistinguishable
 * from here.
 *
 * Raising the limits is the obvious next step and is deliberately not done blind:
 * these sit inside a 50-order page, Shopify prices queries by requested size, and
 * inflating them risks trading a rare truncation for a backfill that fails
 * outright on cost. That wants measuring against a real store first.
 */
function warnIfTruncated(order: RawOrderNode): void {
  if (order.refunds?.length === REFUND_LIMIT) {
    console.warn(
      `[shopify] order ${order.name} returned exactly ${REFUND_LIMIT} refunds, ` +
        `the maximum this query asks for. Refund totals for it may be incomplete.`,
    );
  }
  if (order.transactions?.length === TRANSACTION_LIMIT) {
    console.warn(
      `[shopify] order ${order.name} returned exactly ${TRANSACTION_LIMIT} ` +
        `transactions, the maximum this query asks for. Gateway fees for it may be ` +
        `incomplete.`,
    );
  }
}

/** Completes an order's line items and reports what could not be completed. */
async function hydrate(
  graphql: GraphqlClient,
  order: RawOrderNode,
): Promise<RawOrderNode> {
  warnIfTruncated(order);
  return completeLineItems(graphql, order);
}

export async function fetchOrdersSince(
  graphql: GraphqlClient,
  since: Date,
): Promise<RawOrderNode[]> {
  const variables = { query: backfillQueryString(since) };

  const collect = async (query: string) => {
    const orders: RawOrderNode[] = [];
    for await (const page of paginate(graphql, query, "orders", variables)) {
      // Sequential on purpose. Shopify's leaky bucket is per shop, and firing a
      // top-up per order concurrently is how a large page turns into a throttle.
      for (const order of page as RawOrderNode[]) {
        orders.push(await hydrate(graphql, order));
      }
    }
    return orders;
  };

  try {
    return await collect(BACKFILL_ORDERS_QUERY);
  } catch (error) {
    if (!isReturnsAccessDenied(error)) throw error;
    // Refund reasons are an enrichment; margin does not depend on them. Losing the
    // whole ingest over one refused field would leave the merchant an empty app.
    console.warn(
      "[shopify] returns access denied — backfilling without refund reasons. " +
        "Grant read_returns to see why refunds happened.",
    );
    return collect(BACKFILL_ORDERS_QUERY_NO_RETURNS);
  }
}

export async function fetchAllProducts(graphql: GraphqlClient): Promise<RawProductNode[]> {
  const products: RawProductNode[] = [];
  for await (const page of paginate(graphql, BACKFILL_PRODUCTS_QUERY, "products")) {
    products.push(...(page as unknown[]).map(toProductNode));
  }
  return products;
}

export async function fetchOrder(
  graphql: GraphqlClient,
  id: string,
): Promise<RawOrderNode | null> {
  // Same fallback as the backfill: webhooks must keep ingesting on a shop without
  // `read_returns`, or live orders would stop arriving for that shop entirely.
  let data: unknown;
  try {
    data = await run(graphql, ORDER_BY_ID_QUERY, { id });
  } catch (error) {
    if (!isReturnsAccessDenied(error)) throw error;
    data = await run(graphql, ORDER_BY_ID_QUERY_NO_RETURNS, { id });
  }
  const order = (get(data, "order") as RawOrderNode) ?? null;
  // Webhooks go through the same completion as the backfill. An order edited to
  // more than one page of lines would otherwise be re-ingested truncated, which is
  // worse than the backfill case: it would overwrite complete rows with partial ones.
  return order ? hydrate(graphql, order) : null;
}

export async function fetchProduct(
  graphql: GraphqlClient,
  id: string,
): Promise<RawProductNode | null> {
  const data = await run(graphql, PRODUCT_BY_ID_QUERY, { id });
  const raw = get(data, "product");
  return raw ? toProductNode(raw) : null;
}

/**
 * Products arrive with variants as a connection and cost as a money string;
 * ingestion wants a flat array and cents. Converting here keeps the unit
 * boundary at the edge, where every other Shopify string is parsed.
 */
function toProductNode(raw: unknown): RawProductNode {
  const variantNodes = (get(raw, "variants.nodes") as unknown[]) ?? [];
  const imageUrl =
    (get(raw, "featuredMedia.preview.image.url") as string | undefined) || null;
  return {
    id: get(raw, "id") as string,
    title: get(raw, "title") as string,
    vendor: (get(raw, "vendor") as string) || null,
    imageUrl,
    variants: variantNodes.map((variant) => {
      const unitCost = get(variant, "inventoryItem.unitCost.amount") as string | undefined;
      return {
        id: get(variant, "id") as string,
        sku: (get(variant, "sku") as string) || null,
        price: (get(variant, "price") as string) ?? "0",
        nativeCogsCents: unitCost != null ? Math.round(parseFloat(unitCost) * 100) : null,
      };
    }),
  };
}

/**
 * Featured-image URLs for products already in the catalog. Used to fill rows
 * ingested before imageUrl existed; a GID Shopify does not know comes back as
 * a null node and is skipped, which is how seed placeholders stay imageless
 * rather than erroring the dashboard.
 */
export async function fetchProductImageUrls(
  graphql: GraphqlClient,
  ids: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (ids.length === 0) return urls;

  const data = await run(graphql, PRODUCT_IMAGES_QUERY, { ids });
  const nodes = (get(data, "nodes") as unknown[]) ?? [];
  for (const node of nodes) {
    if (node == null) continue;
    const id = get(node, "id") as string | undefined;
    const url = get(node, "featuredMedia.preview.image.url") as string | undefined;
    if (id && url) urls.set(id, url);
  }
  return urls;
}

export function backfillSince(now: Date): Date {
  return new Date(now.getTime() - BACKFILL_WINDOW_DAYS * 86_400_000);
}

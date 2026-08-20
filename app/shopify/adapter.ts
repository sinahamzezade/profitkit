import type { RawOrderNode, RawProductNode } from "../ingestion/types";
import {
  BACKFILL_ORDERS_QUERY,
  BACKFILL_PRODUCTS_QUERY,
  ORDER_BY_ID_QUERY,
  PRODUCT_BY_ID_QUERY,
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

export async function fetchOrdersSince(
  graphql: GraphqlClient,
  since: Date,
): Promise<RawOrderNode[]> {
  const orders: RawOrderNode[] = [];
  for await (const page of paginate(graphql, BACKFILL_ORDERS_QUERY, "orders", {
    query: backfillQueryString(since),
  })) {
    orders.push(...(page as RawOrderNode[]));
  }
  return orders;
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
  const data = await run(graphql, ORDER_BY_ID_QUERY, { id });
  return (get(data, "order") as RawOrderNode) ?? null;
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
  return {
    id: get(raw, "id") as string,
    title: get(raw, "title") as string,
    vendor: (get(raw, "vendor") as string) || null,
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

export function backfillSince(now: Date): Date {
  return new Date(now.getTime() - BACKFILL_WINDOW_DAYS * 86_400_000);
}

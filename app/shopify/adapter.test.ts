import { describe, expect, it, vi } from "vitest";
import {
  backfillQueryString,
  backfillSince,
  fetchAllProducts,
  fetchOrder,
  fetchOrdersSince,
  fetchProduct,
  fetchProductImageUrls,
  isReturnsAccessDenied,
  paginate,
  ShopifyGraphqlError,
  type GraphqlClient,
} from "./adapter";
import { REFUND_LIMIT } from "./queries";

/** Builds a fake client that replays recorded response bodies in order. */
function mockGraphql(...bodies: unknown[]): GraphqlClient & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  let index = 0;
  const client = ((query: string, options?: { variables?: Record<string, unknown> }) => {
    calls.push([query, options?.variables]);
    const body = bodies[Math.min(index, bodies.length - 1)];
    index++;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  }) as GraphqlClient & { calls: unknown[][] };
  client.calls = calls;
  return client;
}

/** A recorded order payload, trimmed to the fields the adapter actually reads. */
const RECORDED_ORDER = {
  id: "gid://shopify/Order/1001",
  name: "#1001",
  createdAt: "2026-08-01T10:00:00Z",
  currencyCode: "USD",
  test: false,
  totalShippingPriceSet: { shopMoney: { amount: "9.99" } },
  currentTotalDiscountsSet: { shopMoney: { amount: "5.00" } },
  discountApplications: { nodes: [{ code: "SAVE10" }, {}] },
  lineItems: {
    nodes: [
      {
        id: "gid://shopify/LineItem/1",
        title: "Wool Blanket",
        sku: "WB-1",
        quantity: 2,
        originalTotalSet: { shopMoney: { amount: "100.00" } },
        discountAllocations: [{ allocatedAmountSet: { shopMoney: { amount: "5.00" } } }],
        variant: {
          id: "gid://shopify/ProductVariant/11",
          sku: "WB-1",
          price: "50.00",
          inventoryItem: { unitCost: { amount: "20.00" } },
        },
      },
    ],
  },
  refunds: [],
  transactions: [{ gateway: "shopify_payments", fees: [{ amount: { amount: "3.19" } }] }],
};

const RECORDED_PRODUCT = {
  id: "gid://shopify/Product/500",
  title: "Wool Blanket",
  vendor: "Northline",
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/11",
        sku: "WB-1",
        price: "50.00",
        inventoryItem: { unitCost: { amount: "20.00" } },
      },
      {
        id: "gid://shopify/ProductVariant/12",
        sku: null,
        price: "60.00",
        inventoryItem: { unitCost: null },
      },
    ],
  },
};

describe("error handling", () => {
  it("throws on a GraphQL errors array even though the HTTP call succeeded", async () => {
    const graphql = mockGraphql({
      errors: [{ message: "Access denied for orders field.", extensions: { code: "ACCESS_DENIED" } }],
    });
    await expect(fetchOrdersSince(graphql, new Date("2026-06-01"))).rejects.toThrow(
      ShopifyGraphqlError,
    );
  });

  it("surfaces a string error body too", async () => {
    const graphql = mockGraphql({ errors: "Invalid API key or access token" });
    await expect(fetchOrder(graphql, "gid://shopify/Order/1")).rejects.toThrow(
      /Invalid API key/,
    );
  });
});

describe("pagination", () => {
  it("follows cursors until the connection says stop", async () => {
    const graphql = mockGraphql(
      { data: { orders: { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: "c1" } } } },
      { data: { orders: { nodes: [3], pageInfo: { hasNextPage: false, endCursor: null } } } },
    );
    const pages: unknown[][] = [];
    for await (const page of paginate(graphql, "Q", "orders")) pages.push(page);

    expect(pages).toEqual([[1, 2], [3]]);
    expect(graphql.calls).toHaveLength(2);
    expect((graphql.calls[1][1] as Record<string, unknown>).cursor).toBe("c1");
  });

  it("stops rather than looping forever if a cursor never clears", async () => {
    const graphql = mockGraphql({
      data: { orders: { nodes: [1], pageInfo: { hasNextPage: true, endCursor: "same" } } },
    });
    let pages = 0;
    for await (const _page of paginate(graphql, "Q", "orders")) {
      void _page;
      pages++;
    }
    expect(pages).toBe(200);
  });

  it("treats a missing connection as an empty page instead of throwing", async () => {
    const graphql = mockGraphql({ data: {} });
    const pages: unknown[][] = [];
    for await (const page of paginate(graphql, "Q", "orders")) pages.push(page);
    expect(pages).toEqual([[]]);
  });
});

describe("backfill window", () => {
  it("asks for 60 days, the limit read_orders allows", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    expect(backfillSince(now)).toEqual(new Date("2026-06-21T00:00:00Z"));
  });

  it("formats the search query as a date, not a timestamp", () => {
    expect(backfillQueryString(new Date("2026-06-21T13:45:12.345Z"))).toBe(
      "created_at:>=2026-06-21",
    );
  });

  it("passes the window into the orders query", async () => {
    const graphql = mockGraphql({
      data: { orders: { nodes: [RECORDED_ORDER], pageInfo: { hasNextPage: false } } },
    });
    await fetchOrdersSince(graphql, new Date("2026-06-21T00:00:00Z"));
    expect((graphql.calls[0][1] as Record<string, unknown>).query).toBe(
      "created_at:>=2026-06-21",
    );
  });
});

describe("order shapes", () => {
  it("returns orders in the shape ingestion already consumes", async () => {
    const graphql = mockGraphql({
      data: { orders: { nodes: [RECORDED_ORDER], pageInfo: { hasNextPage: false } } },
    });
    const [order] = await fetchOrdersSince(graphql, new Date("2026-06-21"));

    // These are exactly the fields app/ingestion/upsert reads.
    expect(order.id).toBe("gid://shopify/Order/1001");
    expect(order.totalShippingPriceSet.shopMoney.amount).toBe("9.99");
    expect(order.lineItems.nodes[0].discountAllocations[0].allocatedAmountSet.shopMoney.amount).toBe(
      "5.00",
    );
    expect(order.transactions[0].fees[0].amount.amount).toBe("3.19");
  });

  it("keeps code discounts and leaves uncoded ones without a code", async () => {
    const graphql = mockGraphql({
      data: { orders: { nodes: [RECORDED_ORDER], pageInfo: { hasNextPage: false } } },
    });
    const [order] = await fetchOrdersSince(graphql, new Date("2026-06-21"));
    const codes = (order.discountApplications?.nodes ?? []).map((n) => n.code);
    expect(codes).toEqual(["SAVE10", undefined]);
  });

  it("returns null when an order is gone rather than throwing", async () => {
    const graphql = mockGraphql({ data: { order: null } });
    await expect(fetchOrder(graphql, "gid://shopify/Order/404")).resolves.toBeNull();
  });
});

describe("product shapes", () => {
  it("flattens variants and converts unit cost to cents at the boundary", async () => {
    const graphql = mockGraphql({
      data: { products: { nodes: [RECORDED_PRODUCT], pageInfo: { hasNextPage: false } } },
    });
    const [product] = await fetchAllProducts(graphql);

    expect(product).toEqual({
      id: "gid://shopify/Product/500",
      title: "Wool Blanket",
      vendor: "Northline",
      imageUrl: null,
      variants: [
        {
          id: "gid://shopify/ProductVariant/11",
          sku: "WB-1",
          price: "50.00",
          nativeCogsCents: 2000,
        },
        {
          id: "gid://shopify/ProductVariant/12",
          sku: null,
          price: "60.00",
          nativeCogsCents: null,
        },
      ],
    });
  });

  it("normalises an empty vendor to null so the ladder does not match on it", async () => {
    const graphql = mockGraphql({
      data: { product: { ...RECORDED_PRODUCT, vendor: "" } },
    });
    const product = await fetchProduct(graphql, "gid://shopify/Product/500");
    expect(product?.vendor).toBeNull();
  });

  it("reads the featured-image URL at the boundary", async () => {
    const graphql = mockGraphql({
      data: {
        product: {
          ...RECORDED_PRODUCT,
          featuredMedia: {
            preview: { image: { url: "https://cdn.shopify.com/blanket.jpg" } },
          },
        },
      },
    });
    const product = await fetchProduct(graphql, "gid://shopify/Product/500");
    expect(product?.imageUrl).toBe("https://cdn.shopify.com/blanket.jpg");
  });

  it("skips GIDs Shopify does not know rather than inventing an image", async () => {
    const graphql = mockGraphql({
      data: {
        nodes: [
          {
            id: "gid://shopify/Product/500",
            featuredMedia: {
              preview: { image: { url: "https://cdn.shopify.com/blanket.jpg" } },
            },
          },
          null,
        ],
      },
    });
    const urls = await fetchProductImageUrls(graphql, [
      "gid://shopify/Product/500",
      "gid://shopify/Product/9000000",
    ]);
    expect([...urls.keys()]).toEqual(["gid://shopify/Product/500"]);
  });

  it("returns null for a deleted product", async () => {
    const graphql = mockGraphql({ data: { product: null } });
    await expect(fetchProduct(graphql, "gid://shopify/Product/404")).resolves.toBeNull();
  });
});

describe("adapter boundary", () => {
  it("never asks Shopify for anything the margin engine did not need", async () => {
    const graphql = mockGraphql({
      data: { orders: { nodes: [], pageInfo: { hasNextPage: false } } },
    });
    await fetchOrdersSince(graphql, new Date("2026-06-21"));
    const query = graphql.calls[0][0] as string;

    // Customer identity is deliberately absent: not requesting it is what makes
    // the privacy webhooks answerable with "we hold none of it".
    expect(query).not.toMatch(/\bcustomer\b/i);
    expect(query).not.toMatch(/\bemail\b/i);
    expect(query).not.toMatch(/shippingAddress|billingAddress/i);
  });
});

describe("install backfill", () => {
  it("loads products before orders so lines resolve to real variants", async () => {
    const order = { ...RECORDED_ORDER, refunds: [] };
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: { products: { nodes: [RECORDED_PRODUCT], pageInfo: { hasNextPage: false } } },
          }),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: { orders: { nodes: [order], pageInfo: { hasNextPage: false } } },
          }),
      }) as unknown as GraphqlClient;

    const products = await fetchAllProducts(graphql);
    const orders = await fetchOrdersSince(graphql, new Date("2026-06-21"));

    expect(products).toHaveLength(1);
    expect(orders).toHaveLength(1);
  });
});

describe("returns scope fallback", () => {
  const DENIAL =
    "Access denied for return field. Required access: `read_returns` access " +
    "scope or `read_marketplace_returns` access scope.";

  it("recognises the returns denial and not other access errors", () => {
    expect(isReturnsAccessDenied(new Error(DENIAL))).toBe(true);
    // A missing read_orders must NOT look like a returns problem — retrying
    // without returns would turn the failure that matters into empty data.
    expect(isReturnsAccessDenied(new Error("Access denied for orders field."))).toBe(false);
    expect(isReturnsAccessDenied(new Error("Throttled"))).toBe(false);
  });

  it("retries the backfill without refund reasons and still returns orders", async () => {
    const calls: string[] = [];
    const graphql = ((query: string) => {
      calls.push(query);
      if (query.includes("returnReasonDefinition")) return Promise.reject(new Error(DENIAL));
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            data: { orders: { nodes: [RECORDED_ORDER], pageInfo: { hasNextPage: false } } },
          }),
      });
    }) as unknown as GraphqlClient;

    const orders = await fetchOrdersSince(graphql, new Date("2026-06-21"));

    expect(orders).toHaveLength(1);
    expect(calls[0]).toContain("returnReasonDefinition");
    expect(calls[1]).not.toContain("returnReasonDefinition");
  });

  it("still surfaces an unrelated access error rather than masking it", async () => {
    const graphql = (() =>
      Promise.reject(new Error("Access denied for orders field."))) as unknown as GraphqlClient;

    await expect(fetchOrdersSince(graphql, new Date("2026-06-21"))).rejects.toThrow(
      /orders field/,
    );
  });

  it("falls back on the webhook re-fetch path too", async () => {
    // Otherwise a shop without read_returns would stop ingesting live orders.
    const calls: string[] = [];
    const graphql = ((query: string) => {
      calls.push(query);
      if (query.includes("returnReasonDefinition")) return Promise.reject(new Error(DENIAL));
      return Promise.resolve({ json: () => Promise.resolve({ data: { order: RECORDED_ORDER } }) });
    }) as unknown as GraphqlClient;

    const order = await fetchOrder(graphql, "gid://shopify/Order/1001");

    expect(order?.id).toBe("gid://shopify/Order/1001");
    expect(calls).toHaveLength(2);
  });
});

/**
 * Per-order pagination.
 *
 * `Order.lineItems` is a connection, so an order with more lines than one page is
 * completable and these tests hold it to that. Refunds and transactions are plain
 * lists with no cursor, so the most that can be asserted there is that a full-looking
 * array is reported rather than passed off as complete.
 */
describe("per-order collections", () => {
  const lineItem = (n: number) => ({
    id: `gid://shopify/LineItem/${n}`,
    title: `Item ${n}`,
    sku: `SKU-${n}`,
    quantity: 1,
    originalTotalSet: { shopMoney: { amount: "10.00" } },
    discountAllocations: [],
    variant: null,
  });

  const orderWith = (
    nodes: ReturnType<typeof lineItem>[],
    pageInfo: { hasNextPage: boolean; endCursor?: string },
    extra: Record<string, unknown> = {},
  ) => ({ ...RECORDED_ORDER, lineItems: { nodes, pageInfo }, ...extra });

  const ordersBody = (order: unknown) => ({
    data: { orders: { nodes: [order], pageInfo: { hasNextPage: false } } },
  });

  const lineItemsBody = (
    nodes: ReturnType<typeof lineItem>[],
    pageInfo: { hasNextPage: boolean; endCursor?: string },
  ) => ({ data: { order: { lineItems: { nodes, pageInfo } } } });

  it("fetches the rest of an order's line items when the first page is not the last", async () => {
    // Before this, the 101st line simply did not exist as far as the app was
    // concerned, and the order's margin was computed from a partial basket.
    const graphql = mockGraphql(
      ordersBody(orderWith([lineItem(1)], { hasNextPage: true, endCursor: "c1" })),
      lineItemsBody([lineItem(2)], { hasNextPage: false }),
    );

    const orders = await fetchOrdersSince(graphql, new Date("2026-06-21"));

    expect(orders[0].lineItems.nodes.map((l) => l.id)).toEqual([
      "gid://shopify/LineItem/1",
      "gid://shopify/LineItem/2",
    ]);
    // The top-up asked for the right order, from the cursor the first page ended on.
    expect(graphql.calls[1][1]).toEqual({
      id: "gid://shopify/Order/1001",
      cursor: "c1",
    });
  });

  it("follows the cursor across several pages of line items", async () => {
    const graphql = mockGraphql(
      ordersBody(orderWith([lineItem(1)], { hasNextPage: true, endCursor: "c1" })),
      lineItemsBody([lineItem(2)], { hasNextPage: true, endCursor: "c2" }),
      lineItemsBody([lineItem(3)], { hasNextPage: false }),
    );

    const orders = await fetchOrdersSince(graphql, new Date("2026-06-21"));

    expect(orders[0].lineItems.nodes).toHaveLength(3);
    // Advancing, not re-requesting the same cursor — the bug that produces
    // duplicates and never terminates.
    expect(graphql.calls.map((c) => (c[1] as { cursor?: string })?.cursor)).toEqual([
      null,
      "c1",
      "c2",
    ]);
  });

  it("makes no extra request when the line items already fit in one page", async () => {
    const graphql = mockGraphql(
      ordersBody(orderWith([lineItem(1)], { hasNextPage: false })),
    );

    await fetchOrdersSince(graphql, new Date("2026-06-21"));

    expect(graphql.calls).toHaveLength(1);
  });

  it("completes line items on the webhook re-fetch path as well", async () => {
    // A truncated re-ingest is worse than a truncated backfill: it overwrites
    // complete rows with partial ones.
    const graphql = mockGraphql(
      { data: { order: orderWith([lineItem(1)], { hasNextPage: true, endCursor: "c1" }) } },
      lineItemsBody([lineItem(2)], { hasNextPage: false }),
    );

    const order = await fetchOrder(graphql, "gid://shopify/Order/1001");

    expect(order?.lineItems.nodes).toHaveLength(2);
  });

  it("reports refunds that came back exactly at the cap", async () => {
    // Plain list, no cursor: the array being exactly full is the only signal that
    // it may be short, so it is surfaced rather than assumed complete.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refunds = Array.from({ length: REFUND_LIMIT }, (_, i) => ({
      id: `gid://shopify/Refund/${i}`,
      createdAt: "2026-08-02T00:00:00Z",
      refundLineItems: { nodes: [] },
    }));
    const graphql = mockGraphql(
      ordersBody(orderWith([lineItem(1)], { hasNextPage: false }, { refunds })),
    );

    await fetchOrdersSince(graphql, new Date("2026-06-21"));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("#1001"));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/refunds/));
    warn.mockRestore();
  });

  it("stays quiet when refunds are below the cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const graphql = mockGraphql(
      ordersBody(orderWith([lineItem(1)], { hasNextPage: false }, { refunds: [] })),
    );

    await fetchOrdersSince(graphql, new Date("2026-06-21"));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

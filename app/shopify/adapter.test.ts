import { describe, expect, it, vi } from "vitest";
import {
  backfillQueryString,
  backfillSince,
  fetchAllProducts,
  fetchOrder,
  fetchOrdersSince,
  fetchProduct,
  paginate,
  ShopifyGraphqlError,
  type GraphqlClient,
} from "./adapter";

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

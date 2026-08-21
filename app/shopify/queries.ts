/**
 * Admin API documents for the backfill.
 *
 * Field selection here mirrors what the day-2 field audit proved is actually
 * returned, and what `app/ingestion/types` consumes — nothing speculative. The
 * margin engine never sees these shapes; the adapter maps them across.
 */

/**
 * The Returns selection, kept separable.
 *
 * This is the only part of the order selection that needs a scope beyond
 * `read_orders`, and Shopify refuses the *whole query* when it is not granted —
 * one denied field otherwise means no products and no orders at all. Splitting it
 * out lets the adapter retry without it, so a shop that cannot or will not grant
 * `read_returns` still gets margin, just without refund reasons.
 */
const RETURN_FIELDS = `
    return {
      returnLineItems(first: 100) {
        nodes {
          ... on ReturnLineItem {
            returnReasonDefinition { name }
            returnReasonNote
            fulfillmentLineItem { lineItem { id } }
          }
        }
      }
    }
`;

/** One page of line items. Reused by the order queries and the top-up query below. */
const LINE_ITEM_FIELDS = `
  id
  title
  sku
  quantity
  originalTotalSet { shopMoney { amount } }
  discountAllocations { allocatedAmountSet { shopMoney { amount } } }
  variant {
    id
    sku
    price
    inventoryItem { unitCost { amount } }
  }
`;

/**
 * How many of each nested collection one order page asks for.
 *
 * `LINE_ITEM_PAGE` is a page size, not a ceiling: `Order.lineItems` is a real
 * connection, so anything beyond this is fetched with a cursor (see
 * ORDER_LINE_ITEMS_QUERY) and nothing is lost.
 *
 * The other two are ceilings, and that is a Shopify constraint rather than a
 * choice. `Order.refunds` is `[Refund!]!` and `Order.transactions` is
 * `[OrderTransaction!]!` — plain lists, not connections. Their `first` argument
 * is documented as "truncate the array result to this size", and with no
 * `pageInfo` and no cursor there is no way to ask for the rest. The adapter
 * therefore checks whether a returned array came back exactly full and warns,
 * because a silently short list is the failure mode worth surfacing.
 */
export const LINE_ITEM_PAGE = 100;
export const REFUND_LIMIT = 20;
export const TRANSACTION_LIMIT = 20;

/** Line item and refund selections shared by the backfill and webhook re-fetch. */
const orderFields = (withReturns: boolean) => `
  id
  name
  createdAt
  currencyCode
  test
  totalShippingPriceSet { shopMoney { amount } }
  currentTotalDiscountsSet { shopMoney { amount } }
  discountApplications(first: 10) {
    nodes {
      ... on DiscountCodeApplication { code }
    }
  }
  lineItems(first: ${LINE_ITEM_PAGE}) {
    nodes {
      ${LINE_ITEM_FIELDS}
    }
    pageInfo { hasNextPage endCursor }
  }
  refunds(first: ${REFUND_LIMIT}) {
    id
    createdAt
    note
    refundLineItems(first: 100) {
      nodes {
        quantity
        subtotalSet { shopMoney { amount } }
        lineItem { id sku }
      }
    }
    ${withReturns ? RETURN_FIELDS : ""}
  }
  transactions(first: ${TRANSACTION_LIMIT}) {
    gateway
    fees { amount { amount } }
  }
`;

/**
 * The remaining line items for one order, after the first page.
 *
 * Deliberately selects nothing but line items. An order with more than
 * `LINE_ITEM_PAGE` lines is the rare case, so the top-up should not re-fetch
 * refunds, transactions and returns it already has — and keeping the Returns
 * selection out of it means this query needs no scope beyond `read_orders` and
 * cannot trip the read_returns fallback.
 */
export const ORDER_LINE_ITEMS_QUERY = `#graphql
  query OrderLineItems($id: ID!, $cursor: String) {
    order(id: $id) {
      lineItems(first: ${LINE_ITEM_PAGE}, after: $cursor) {
        nodes {
          ${LINE_ITEM_FIELDS}
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/**
 * `read_orders` only exposes the last 60 days. Anything older needs
 * `read_all_orders`, which requires a written application to Shopify — so the
 * backfill deliberately asks for a bounded window and history accumulates
 * forward through webhooks.
 */
const backfillOrdersQuery = (withReturns: boolean) => `#graphql
  query BackfillOrders($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT) {
      nodes {
        ${orderFields(withReturns)}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const BACKFILL_ORDERS_QUERY = backfillOrdersQuery(true);

/** Same query minus the Returns selection, for shops without `read_returns`. */
export const BACKFILL_ORDERS_QUERY_NO_RETURNS = backfillOrdersQuery(false);

/** Single order re-fetch, used by webhooks so every path ingests identical shapes. */
const orderByIdQuery = (withReturns: boolean) => `#graphql
  query OrderById($id: ID!) {
    order(id: $id) {
      ${orderFields(withReturns)}
    }
  }
`;

export const ORDER_BY_ID_QUERY = orderByIdQuery(true);
export const ORDER_BY_ID_QUERY_NO_RETURNS = orderByIdQuery(false);

/** Thumbnail-sized featured image. Preview covers image, video and 3D media. */
const PRODUCT_IMAGE_FIELDS = `
  featuredMedia {
    preview {
      image {
        url(transform: { maxWidth: 96, maxHeight: 96 })
      }
    }
  }
`;

export const BACKFILL_PRODUCTS_QUERY = `#graphql
  query BackfillProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      nodes {
        id
        title
        vendor
        ${PRODUCT_IMAGE_FIELDS}
        variants(first: 100) {
          nodes {
            id
            sku
            price
            inventoryItem { unitCost { amount } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PRODUCT_BY_ID_QUERY = `#graphql
  query ProductById($id: ID!) {
    product(id: $id) {
      id
      title
      vendor
      ${PRODUCT_IMAGE_FIELDS}
      variants(first: 100) {
        nodes {
          id
          sku
          price
          inventoryItem { unitCost { amount } }
        }
      }
    }
  }
`;

/**
 * Catch-up for products ingested before imageUrl existed. `nodes` returns null
 * for a GID Shopify does not know — seed placeholders — rather than erroring.
 */
export const PRODUCT_IMAGES_QUERY = `#graphql
  query ProductImages($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        ${PRODUCT_IMAGE_FIELDS}
      }
    }
  }
`;

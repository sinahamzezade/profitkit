/**
 * Admin API documents for the backfill.
 *
 * Field selection here mirrors what the day-2 field audit proved is actually
 * returned, and what `app/ingestion/types` consumes — nothing speculative. The
 * margin engine never sees these shapes; the adapter maps them across.
 */

/** Line item and refund selections shared by the backfill and webhook re-fetch. */
const ORDER_FIELDS = `
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
  lineItems(first: 100) {
    nodes {
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
    }
  }
  refunds(first: 20) {
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
  }
  transactions(first: 20) {
    gateway
    fees { amount { amount } }
  }
`;

/**
 * `read_orders` only exposes the last 60 days. Anything older needs
 * `read_all_orders`, which requires a written application to Shopify — so the
 * backfill deliberately asks for a bounded window and history accumulates
 * forward through webhooks.
 */
export const BACKFILL_ORDERS_QUERY = `#graphql
  query BackfillOrders($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT) {
      nodes {
        ${ORDER_FIELDS}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Single order re-fetch, used by webhooks so every path ingests identical shapes. */
export const ORDER_BY_ID_QUERY = `#graphql
  query OrderById($id: ID!) {
    order(id: $id) {
      ${ORDER_FIELDS}
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

export type SetupState = {
  ordersImported: boolean;
  costEstimate: boolean;
  paymentFees: boolean;
  gatewaysNeedingRule: number;
  shippingCost: boolean;
};

/**
 * The four steps that make the numbers trustworthy, in the order that does it:
 * orders arrive, then one cost estimate makes every figure meaningful, then the
 * two costs Shopify cannot supply remove the last guesses.
 *
 * Split out of the component because the page itself needs to know whether they
 * are all done — it demotes the guide to the foot of the page and lets the finding
 * lead once there is nothing left to do. Two separate completeness tests would
 * drift apart the first time a step was added.
 */
export function setupSteps(setup: SetupState) {
  return [
    {
      done: setup.ordersImported,
      title: "Import your orders",
      body: "Happens on install. Redline reads the 60 days Shopify allows, then keeps up through webhooks.",
      action: null,
    },
    {
      done: setup.costEstimate,
      title: "Set one cost estimate",
      body: "Roughly what a product costs you as a share of its price. This single number turns revenue into margin across the whole catalogue.",
      action: { label: "Set it below", href: null },
    },
    {
      done: setup.paymentFees,
      title: "Add your payment fee rates",
      /*
       * Three states, not two. A done step still has gateways that report no fee —
       * that is why a rate was needed — so reusing the outstanding wording once the
       * rates exist told the merchant their orders count as free to process while
       * the step sat ticked above it.
       */
      body:
        setup.gatewaysNeedingRule === 0
          ? "Nothing to do — Shopify reports the real fee for every gateway this store uses."
          : setup.paymentFees
            ? `Covered. ${setup.gatewaysNeedingRule} ${
                setup.gatewaysNeedingRule === 1
                  ? "gateway reports"
                  : "gateways report"
              } no fee of their own, and your rates now stand in for them.`
            : `${setup.gatewaysNeedingRule} ${
                setup.gatewaysNeedingRule === 1 ? "gateway" : "gateways"
              } ${setup.gatewaysNeedingRule === 1 ? "reports" : "report"} no fee, so those orders currently count as free to process.`,
      action: { label: "Open cost settings", href: "/app/settings" },
    },
    {
      done: setup.shippingCost,
      title: "Set your shipping cost",
      body: "Shopify's API does not carry what fulfilment costs you. Until you supply it, shipping counts as nothing rather than as profit.",
      action: { label: "Open cost settings", href: "/app/settings" },
    },
  ];
}

export function setupProgress(setup: SetupState) {
  const steps = setupSteps(setup);
  const done = steps.filter((s) => s.done).length;
  return { steps, done, complete: done === steps.length };
}

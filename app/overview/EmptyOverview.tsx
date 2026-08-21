import { SetupGuide } from "./SetupGuide";

export function EmptyOverview() {
  return (
    <s-page heading="Profit overview">
      <s-section accessibilityLabel="No orders yet">
        <s-banner tone="info" heading="No orders yet">
          Once this store has orders, your margin shows up here.
        </s-banner>
      </s-section>
      <SetupGuide
        setup={{
          ordersImported: false,
          costEstimate: false,
          paymentFees: false,
          gatewaysNeedingRule: 0,
          shippingCost: false,
        }}
      />
    </s-page>
  );
}

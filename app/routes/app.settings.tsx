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
  clearFeeRule,
  clearVendorCogs,
  listGateways,
  listVendors,
  loadCogsEntries,
  loadFeeRules,
  loadShippingCostConfig,
  setFeeRule,
  setGlobalCogsPercent,
  setGlobalShippingCostCents,
  setVendorCogsPercent,
} from "../costs/repository";
import {
  formatMoneyInput,
  formatPercent,
  parseMoneyInput,
  parseOptionalPercentInput,
  parsePercentInput,
} from "../costs/settingsForm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ready: false as const };

  const [cogsEntries, feeRules, shipping, gateways, vendors, anyOrder] = await Promise.all([
    loadCogsEntries(shop.id),
    loadFeeRules(shop.id),
    loadShippingCostConfig(shop.id),
    listGateways(shop.id),
    listVendors(shop.id),
    prisma.order.findFirst({ where: { shopId: shop.id }, select: { currencyCode: true } }),
  ]);

  const globalEntry = cogsEntries.find((e) => e.scope === "global");
  const vendorPercents: Record<string, string> = {};
  for (const entry of cogsEntries) {
    if (entry.scope === "vendor" && entry.scopeKey) {
      vendorPercents[entry.scopeKey] = formatPercent(entry.costPercent);
    }
  }

  return {
    ready: true as const,
    currency: anyOrder?.currencyCode ?? "USD",
    globalCogsPercent: formatPercent(globalEntry?.costPercent),
    vendors: vendors.map((v) => ({ ...v, percent: vendorPercents[v.vendor] ?? "" })),
    gateways: gateways.map((g) => {
      const rule = feeRules.find((r) => r.gatewayName.toLowerCase() === g.gateway.toLowerCase());
      return {
        ...g,
        percent: formatPercent(rule?.percent),
        flat: formatMoneyInput(rule?.flatCents),
      };
    }),
    shippingPerOrder: formatMoneyInput(shipping.globalPerOrderCents),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { error: "No data for this store yet." };

  if (intent === "cogs") {
    const global = parsePercentInput(String(form.get("globalPercent") ?? ""));
    if (!global.ok) return { error: global.error, intent };
    await setGlobalCogsPercent(shop.id, global.value);

    // Vendor rows arrive as vendor:<name>. A blank value clears the override rather
    // than being rejected — clearing is how a merchant undoes one.
    for (const [key, raw] of form.entries()) {
      if (!key.startsWith("vendor:")) continue;
      const vendor = key.slice("vendor:".length);
      const parsed = parseOptionalPercentInput(String(raw));
      if (!parsed.ok) return { error: `${vendor}: ${parsed.error}`, intent };
      if (parsed.value == null) await clearVendorCogs(shop.id, vendor);
      else await setVendorCogsPercent(shop.id, vendor, parsed.value);
    }
    return { ok: "Cost of goods saved.", intent };
  }

  if (intent === "fees") {
    for (const [key, raw] of form.entries()) {
      if (!key.startsWith("percent:")) continue;
      const gateway = key.slice("percent:".length);
      const percent = parseOptionalPercentInput(String(raw), { allowZero: true });
      if (!percent.ok) return { error: `${gateway}: ${percent.error}`, intent };

      const flat = parseMoneyInput(String(form.get(`flat:${gateway}`) ?? ""));
      if (!flat.ok) return { error: `${gateway}: ${flat.error}`, intent };

      // Both blank means no rule at all, which is different from a rule of zero.
      if (percent.value == null && flat.value == null) {
        await clearFeeRule(shop.id, gateway);
      } else {
        await setFeeRule(shop.id, gateway, percent.value ?? 0, flat.value ?? 0);
      }
    }
    return { ok: "Payment fees saved.", intent };
  }

  if (intent === "shipping") {
    const perOrder = parseMoneyInput(String(form.get("shippingPerOrder") ?? ""));
    if (!perOrder.ok) return { error: perOrder.error, intent };
    // Null would mean "unset", but the setter takes a number; zero is the honest
    // representation of "I absorb nothing", and clearing is done by entering 0.
    await setGlobalShippingCostCents(shop.id, perOrder.value ?? 0);
    return { ok: "Shipping cost saved.", intent };
  }

  return { error: "Unknown action." };
};

type ActionData = { ok?: string; error?: string; intent?: string };

/** Per-section save state, so saving fees doesn't flash a message on the COGS card. */
function useSection(intent: string) {
  const fetcher = useFetcher<ActionData>();
  // Withdraw the last message as soon as the merchant edits again: an error left
  // standing above a corrected value reads as though the correction was rejected too,
  // and a success message above unsaved edits claims they were saved.
  const [edited, setEdited] = useState(false);
  const data = !edited && fetcher.data?.intent === intent ? fetcher.data : undefined;

  return {
    /** Wraps a state setter so any edit clears this section's message. */
    onEdit<T>(set: (next: T) => void) {
      return (next: T) => {
        setEdited(true);
        set(next);
      };
    },
    submit: (fields: Record<string, string>) => {
      setEdited(false);
      fetcher.submit({ intent, ...fields }, { method: "POST" });
    },
    saving: fetcher.state !== "idle",
    ok: data?.ok,
    error: data?.error,
  };
}

function Feedback({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <s-banner tone="critical">{error}</s-banner>;
  if (ok) return <s-banner tone="success">{ok}</s-banner>;
  return null;
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();

  if (!data.ready) {
    return (
      <s-page heading="Cost settings">
        <s-section>
          <s-banner tone="info" heading="No orders yet">
            Once this store has orders, you can set the costs that turn revenue into
            margin.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  // Split so the hooks below never sit behind a conditional return.
  return <SettingsForm data={data} />;
}

type ReadyData = Extract<Awaited<ReturnType<typeof loader>>, { ready: true }>;

function SettingsForm({ data }: { data: ReadyData }) {
  const { currency, gateways, shippingPerOrder } = data;

  const cogs = useSection("cogs");
  const fees = useSection("fees");
  const shipping = useSection("shipping");

  const [globalPercent, setGlobalPercent] = useState(data.globalCogsPercent || "45");
  const [vendorPercents, setVendorPercents] = useState<Record<string, string>>(
    Object.fromEntries(data.vendors.map((v) => [v.vendor, v.percent])),
  );
  const [feeInputs, setFeeInputs] = useState<Record<string, { percent: string; flat: string }>>(
    Object.fromEntries(gateways.map((g) => [g.gateway, { percent: g.percent, flat: g.flat }])),
  );
  const [shippingInput, setShippingInput] = useState(shippingPerOrder);

  // Edit-aware setters, so typing withdraws the section's last save message.
  const editGlobalPercent = cogs.onEdit(setGlobalPercent);
  const editVendorPercents = cogs.onEdit(setVendorPercents);
  const editFeeInputs = fees.onEdit(setFeeInputs);
  const editShippingInput = shipping.onEdit(setShippingInput);

  // Orders Shopify gave no fee for, on gateways with no rule to fall back on. Those
  // orders are currently costing zero in payment fees, which is never true.
  const unpriced = gateways.filter(
    (g) => g.ordersMissingFee > 0 && !feeInputs[g.gateway]?.percent && !feeInputs[g.gateway]?.flat,
  );
  const unpricedOrders = unpriced.reduce((sum, g) => sum + g.ordersMissingFee, 0);

  return (
    <s-page heading="Cost settings">
      <style>{PK_STYLES}</style>

      <s-section heading="Cost of goods">
        <s-paragraph>
          Shopify has a cost field but almost nobody fills it in, so start with one
          number for everything and sharpen it per supplier when you want to.
        </s-paragraph>
        <s-paragraph>
          <s-text tone="neutral">
            Have the real figures in a spreadsheet? An exact cost per product
            outranks every estimate below.
          </s-text>
        </s-paragraph>
        <s-button variant="secondary" href="/app/costs/import">
          Import a cost sheet
        </s-button>

        <div className="pk-field-row">
          <div className="pk-field">
            <s-text-field
              label="Typical cost as % of price"
              value={globalPercent}
              onInput={(e) => editGlobalPercent(e.currentTarget.value)}
              onChange={(e) => editGlobalPercent(e.currentTarget.value)}
            />
          </div>
        </div>

        {data.vendors.length > 0 && (
          <>
            <h3 className="pk-sub">By supplier</h3>
            <p className="pk-hint">
              Leave a supplier blank to use the number above. Most stores have three or
              four cost tiers, not one per product.
            </p>
            <ul className="pk-rows">
              {data.vendors.map((vendor) => (
                <li className="pk-row" key={vendor.vendor}>
                  <span className="pk-row-name">
                    {vendor.vendor}
                    <span className="pk-row-meta">
                      {vendor.products} {vendor.products === 1 ? "product" : "products"}
                    </span>
                  </span>
                  <div className="pk-field pk-field-narrow">
                    <s-text-field
                      label={`${vendor.vendor} cost %`}
                      labelAccessibilityVisibility="exclusive"
                      placeholder={globalPercent || "45"}
                      value={vendorPercents[vendor.vendor] ?? ""}
                      onInput={(e) =>
                        editVendorPercents((p) => ({
                          ...p,
                          [vendor.vendor]: e.currentTarget.value,
                        }))
                      }
                      onChange={(e) =>
                        editVendorPercents((p) => ({
                          ...p,
                          [vendor.vendor]: e.currentTarget.value,
                        }))
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <Feedback ok={cogs.ok} error={cogs.error} />
        <s-button
          variant="primary"
          {...(cogs.saving ? { loading: true } : {})}
          onClick={() =>
            cogs.submit({
              globalPercent,
              ...Object.fromEntries(
                Object.entries(vendorPercents).map(([v, p]) => [`vendor:${v}`, p]),
              ),
            })
          }
        >
          Save cost of goods
        </s-button>
      </s-section>

      <s-section heading="Payment fees">
        <s-paragraph>
          Shopify reports the settled fee for Shopify Payments, and nothing for any
          other gateway. A rate here is the fallback for every order that arrives
          without one — without it those orders count as costing zero to take payment,
          and margin reads higher than it is.
        </s-paragraph>

        {gateways.length === 0 ? (
          <s-paragraph>
            <s-text tone="neutral">No payment gateways seen in your orders yet.</s-text>
          </s-paragraph>
        ) : (
          <>
            {unpriced.length > 0 && (
              <s-banner tone="warning">
                {`${unpricedOrders} ${unpricedOrders === 1 ? "order" : "orders"} on ` +
                  `${unpriced.map((g) => g.gateway).join(", ")} came with no fee from ` +
                  `Shopify and have no rate to fall back on, so their payment fees ` +
                  `count as zero.`}
              </s-banner>
            )}
            <ul className="pk-rows">
              {gateways.map((gateway) => (
                <li className="pk-row pk-row-fee" key={gateway.gateway}>
                  <span className="pk-row-name">
                    {gateway.gateway}
                    <span className="pk-row-meta">
                      {gateway.orders} {gateway.orders === 1 ? "order" : "orders"}
                      {gateway.ordersMissingFee === 0
                        ? " · Shopify reported every fee"
                        : ` · ${gateway.ordersMissingFee} with no fee from Shopify`}
                    </span>
                  </span>
                  <div className="pk-field pk-field-narrow">
                    <s-text-field
                      label={`${gateway.gateway} percent`}
                      labelAccessibilityVisibility="exclusive"
                      placeholder="2.9"
                      value={feeInputs[gateway.gateway]?.percent ?? ""}
                      onInput={(e) =>
                        editFeeInputs((f) => ({
                          ...f,
                          [gateway.gateway]: {
                            ...f[gateway.gateway],
                            percent: e.currentTarget.value,
                          },
                        }))
                      }
                      onChange={(e) =>
                        editFeeInputs((f) => ({
                          ...f,
                          [gateway.gateway]: {
                            ...f[gateway.gateway],
                            percent: e.currentTarget.value,
                          },
                        }))
                      }
                    />
                    <span className="pk-unit">% +</span>
                    <s-text-field
                      label={`${gateway.gateway} flat fee`}
                      labelAccessibilityVisibility="exclusive"
                      placeholder="0.30"
                      value={feeInputs[gateway.gateway]?.flat ?? ""}
                      onInput={(e) =>
                        editFeeInputs((f) => ({
                          ...f,
                          [gateway.gateway]: {
                            ...f[gateway.gateway],
                            flat: e.currentTarget.value,
                          },
                        }))
                      }
                      onChange={(e) =>
                        editFeeInputs((f) => ({
                          ...f,
                          [gateway.gateway]: {
                            ...f[gateway.gateway],
                            flat: e.currentTarget.value,
                          },
                        }))
                      }
                    />
                    <span className="pk-unit">{currency} an order</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <Feedback ok={fees.ok} error={fees.error} />
        <s-button
          variant="primary"
          {...(fees.saving ? { loading: true } : {})}
          onClick={() =>
            fees.submit(
              Object.fromEntries(
                Object.entries(feeInputs).flatMap(([g, v]) => [
                  [`percent:${g}`, v.percent ?? ""],
                  [`flat:${g}`, v.flat ?? ""],
                ]),
              ),
            )
          }
        >
          Save payment fees
        </s-button>
      </s-section>

      <s-section heading="Shipping cost">
        <s-paragraph>
          What shipping actually costs you is not in Shopify&apos;s API at all — not
          blank, absent. Until you supply it, the gap between what you charge and what
          you pay counts as zero.
        </s-paragraph>

        <div className="pk-field-row">
          <div className="pk-field pk-field-narrow">
            <s-text-field
              label={`Average cost to ship an order (${currency})`}
              value={shippingInput}
              placeholder="6.50"
              onInput={(e) => editShippingInput(e.currentTarget.value)}
              onChange={(e) => editShippingInput(e.currentTarget.value)}
            />
          </div>
        </div>
        <p className="pk-hint">
          One figure per order, spread evenly across its lines. Enter 0 if you never
          absorb shipping.
        </p>

        <Feedback ok={shipping.ok} error={shipping.error} />
        <s-button
          variant="primary"
          {...(shipping.saving ? { loading: true } : {})}
          onClick={() => shipping.submit({ shippingPerOrder: shippingInput })}
        >
          Save shipping cost
        </s-button>
      </s-section>
    </s-page>
  );
}

const PK_STYLES = `
  .pk-sub {
    margin: 1.4rem 0 0.2rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: #10160F;
  }
  .pk-hint { margin: 0 0 0.6rem; font-size: 0.8rem; color: #6B7367; max-width: 64ch; }

  .pk-field-row { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  .pk-field { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
  .pk-field-narrow > * { flex: 0 0 6rem; }
  .pk-unit { font-size: 0.8rem; color: #6B7367; white-space: nowrap; }

  .pk-rows { list-style: none; margin: 0 0 1rem; padding: 0; }
  .pk-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-block: 0.45rem;
    border-top: 1px solid #E4E9E0;
  }
  .pk-row:last-child { border-bottom: 1px solid #E4E9E0; }
  .pk-row-name {
    display: flex;
    flex-direction: column;
    font-size: 0.9rem;
    color: #10160F;
    min-width: 0;
    flex: 1 1 auto;
  }
  .pk-row-meta { font-size: 0.74rem; color: #96A08F; }
  .pk-row-fee .pk-field { flex: none; }

  @media (max-width: 40rem) {
    .pk-row { flex-wrap: wrap; }
    .pk-row-fee .pk-field { flex-wrap: wrap; }
  }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

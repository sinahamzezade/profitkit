import { useState } from "react";
import { useFetcher } from "react-router";

export type CostEstimateResult = { error: string } | { ok: true };

/**
 * The onboarding rung that makes the whole view work: one number, applied to
 * everything, so a merchant who has never entered a cost still gets a real answer.
 */
export function CostEstimatePrompt({ hasCostData }: { hasCostData: boolean }) {
  const fetcher = useFetcher<CostEstimateResult>();
  const [percent, setPercent] = useState("45");
  const saving = fetcher.state !== "idle";

  return (
    <s-section
      heading={hasCostData ? "Adjust your cost estimate" : "Start here"}
    >
      <s-paragraph>
        {hasCostData
          ? "This applies to every product without a cost of its own."
          : "Costs aren't in Shopify, so nothing below is real profit yet. Roughly what " +
            "percentage of a product's price does it cost you to buy or make?"}
      </s-paragraph>
      <div className="pk-estimate">
        <div className="pk-estimate-field">
          <s-text-field
            label="Typical cost as % of price"
            value={percent}
            onInput={(event) => setPercent(event.currentTarget.value)}
            onChange={(event) => setPercent(event.currentTarget.value)}
          />
        </div>
        <s-button
          variant="primary"
          {...(saving ? { loading: true } : {})}
          onClick={() => fetcher.submit({ percent }, { method: "POST" })}
        >
          {hasCostData ? "Update estimate" : "Show me what's losing money"}
        </s-button>
      </div>
      {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
        <s-banner tone="critical">{fetcher.data.error}</s-banner>
      )}
      <s-paragraph>
        <s-text tone="neutral">
          Once you&apos;ve seen the shape of the answer, refine it per supplier
          and add payment fees and shipping cost.
        </s-text>
      </s-paragraph>
      <s-button variant="secondary" href="/app/settings">
        Open cost settings
      </s-button>
    </s-section>
  );
}

import { useState } from "react";

import { GUIDE_URL, hasGuide, hasVideo, VIDEO_URL } from "../docs";
import { setupProgress, type SetupState } from "./setup";

/**
 * Setup guide, in the shape Shopify uses for onboarding: heading, one line of
 * purpose, "n / 4 completed" with a progress bar, an overflow menu and a collapse
 * chevron.
 *
 * The progress is real — every step is derived from store state in the loader, so
 * it cannot claim a step is done when it isn't, and it fills in by itself as the
 * merchant works.
 *
 * Collapse is session-only. Persisting it would mean either a schema column or
 * localStorage, and localStorage read during render is a hydration mismatch —
 * which on this app presents as a blank page, not a warning.
 */
export function SetupGuide({ setup }: { setup: SetupState }) {
  const { steps, done, complete } = setupProgress(setup);
  const pct = Math.round((done / steps.length) * 100);

  // Open while there is work left, shut once there isn't. A finished guide held
  // open is the largest thing on the page and says nothing; closed, it reads as a
  // receipt and the numbers get the room.
  const [open, setOpen] = useState(!complete);

  return (
    <s-section>
      <div className="pk-guide-head">
        <div className="pk-guide-title">
          <s-heading>Setup guide</s-heading>
          <s-text tone="neutral">
            {complete
              ? "Every step done. The figures above use your own costs, not defaults."
              : "Use this guide to get accurate profit numbers as quickly as possible."}
          </s-text>
        </div>
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-button
            variant="tertiary"
            icon="menu-horizontal"
            accessibilityLabel="More actions"
            commandFor="pk-setup-menu"
            command="--show"
          />
          <s-menu id="pk-setup-menu">
            <s-button href="/app/settings">Cost settings</s-button>
            <s-button onClick={() => setOpen(false)}>Collapse guide</s-button>
          </s-menu>
          <s-button
            variant="tertiary"
            icon={open ? "chevron-up" : "chevron-down"}
            accessibilityLabel={
              open ? "Collapse setup guide" : "Expand setup guide"
            }
            onClick={() => setOpen(!open)}
          />
        </s-stack>
      </div>

      <div className="pk-guide-progress">
        <span className="num pk-guide-count">
          {done} / {steps.length} completed
        </span>
        {/* Bar is drawn here because Polaris has no progress component. The
            accessible value lives on the element, not just in the fill width. */}
        <span
          className="pk-guide-bar"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-label={`${done} of ${steps.length} setup steps completed`}
        >
          {/* scaleX rather than width: a width transition lays out and repaints on
              every frame, a transform is composited. */}
          <span
            className="pk-guide-fill"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </span>
      </div>

      {open && (
        <ul className="pk-guide-steps">
          {steps.map((step) => (
            <li
              key={step.title}
              className={`pk-guide-step ${step.done ? "is-done" : ""}`}
            >
              <s-icon
                type={step.done ? "check-circle-filled" : "circle"}
                tone={step.done ? "success" : "neutral"}
              />
              <div className="pk-guide-step-body">
                <p className="pk-guide-step-title">{step.title}</p>
                <p className="pk-guide-step-note">{step.body}</p>
                {!step.done && step.action?.href && (
                  <s-button variant="secondary" href={step.action.href}>
                    {step.action.label}
                  </s-button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Links are gated: GUIDE_URL previously pointed at profitkit.app, which
          belongs to a different company. Nothing renders until app/docs.ts holds a
          confirmed domain. */}
      {open && (hasGuide || hasVideo) && (
        <div className="pk-guide-links">
          {hasGuide && (
            <s-button variant="tertiary" href={GUIDE_URL} target="_blank">
              Read the full walkthrough
            </s-button>
          )}
          {hasVideo && (
            <s-button variant="tertiary" href={VIDEO_URL} target="_blank">
              Watch the video
            </s-button>
          )}
        </div>
      )}
    </s-section>
  );
}

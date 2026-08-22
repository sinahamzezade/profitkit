import type { ReactNode } from "react";

/**
 * A section label that sits *outside* its card, with its controls on the right.
 *
 * This is the admin's own pattern — Growth reads "Performance" above the card row,
 * with the range control and a details link opposite it, and the cards below carry no
 * heading of their own. Previously these headings lived inside the card via
 * `s-section heading`, which reads as a card titled "Where the money goes" rather
 * than a labelled group of content.
 *
 * The label is an `h2` because it is the real heading for the content beneath, and
 * the sections it labels now pass `accessibilityLabel` instead of `heading` so the
 * name is not announced twice.
 *
 * `meta` is deliberately plain text where Growth has a date picker. Ours cannot be a
 * picker: the window is set by the plan, not the merchant, and drawing a control that
 * looks adjustable and is not would be worse than a label that tells the truth.
 */
export function SectionHead({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pk-section-head">
      <h2 className="pk-section-title">{title}</h2>
      {(meta || action) && (
        <div className="pk-section-tools">
          {meta && <span className="pk-section-meta">{meta}</span>}
          {action}
        </div>
      )}
    </div>
  );
}

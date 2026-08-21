import type { ReactNode } from "react";

/**
 * Preview → full page. Native Polaris button, not an in-place expand: the destination
 * is where the rest of the data already lives.
 */
export function ShowMore({
  href,
  accessibilityLabel,
}: {
  href: string;
  accessibilityLabel: string;
}) {
  return (
    <div className="pk-widget-action">
      <s-button href={href} variant="tertiary" accessibilityLabel={accessibilityLabel}>
        Show more
      </s-button>
    </div>
  );
}

/** Inner layout for a homepage widget: content up top, Show more pinned to the foot. */
export function WidgetBody({
  children,
  more,
}: {
  children: ReactNode;
  more?: { href: string; accessibilityLabel: string };
}) {
  return (
    <div className="pk-tile-body">
      <div className="pk-tile-main">{children}</div>
      {more && <ShowMore {...more} />}
    </div>
  );
}

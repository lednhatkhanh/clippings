import AxeBuilder from "@axe-core/playwright";
import { test, type Page } from "@playwright/test";

/** WCAG 2.0 and 2.1, levels A and AA: the bar the app holds itself to. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Every animation that ends has ended. Axe reads colors as they are drawn, so a scan during a
 * crossfade (the Settings tabs) sees half-transparent text and reports a contrast it never has at
 * rest. Animations that never end, such as a skeleton's pulse, are left running. (As a string:
 * this package has no DOM types.)
 */
const SETTLE_ANIMATIONS = `Promise.all(
  document
    .getAnimations()
    .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? 0))
    .map((animation) => animation.finished.catch(() => undefined)),
)`;

/**
 * The accessibility violations axe finds on the page as it is now, reduced to what a failure needs
 * to show: the rule, its impact and the elements it hit.
 */
export function wcagViolations(page: Page) {
  return test.step(
    "scan with axe",
    async () => {
      await page.evaluate(SETTLE_ANIMATIONS);
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      return violations.map(({ id, impact, help, nodes }) => ({
        id,
        impact,
        help,
        targets: nodes.map((node) => node.target.join(" ")),
      }));
    },
    { box: true },
  );
}

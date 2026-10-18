import { describe, expect, it } from "vitest";

import { renderSpringsCss } from "./springs.ts";

// Reads `--name: linear(0, ..., 1);` and `--name-duration: 220ms;` from generated CSS.
const readSpring = (css: string, name: string) => {
  const curve = new RegExp(`--${name}: linear\\(([^)]*)\\);`).exec(css)?.[1];
  const duration = new RegExp(`--${name}-duration: (\\d+)ms;`).exec(css)?.[1];
  expect(curve, `curve ${name}`).toBeDefined();
  expect(duration, `duration ${name}`).toBeDefined();
  return { stops: curve!.split(",").map(Number), durationMs: Number(duration) };
};

describe("renderSpringsCss", () => {
  const css = renderSpringsCss();

  it("emits a standard spatial spring that settles on 1 without overshoot ringing past 1%", () => {
    const { stops, durationMs } = readSpring(css, "md-sys-motion-spring-default-spatial");

    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
    expect(Math.max(...stops)).toBeLessThanOrEqual(1.01);
    // 0.9 damping at 700 stiffness settles in roughly a fifth of a second.
    expect(durationMs).toBeGreaterThan(150);
    expect(durationMs).toBeLessThan(350);
  });

  it("emits an effects spring that never overshoots", () => {
    const { stops } = readSpring(css, "md-sys-motion-spring-default-effects");

    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
    expect(Math.max(...stops)).toBeLessThanOrEqual(1);
    expect(stops).toEqual(stops.toSorted((a, b) => a - b));
  });

  it("emits an expressive spring that visibly overshoots before settling", () => {
    const { stops } = readSpring(css, "md-sys-motion-spring-expressive-spatial");

    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
    expect(Math.max(...stops)).toBeGreaterThan(1.005);
    expect(Math.max(...stops)).toBeLessThanOrEqual(1.05);
  });
});

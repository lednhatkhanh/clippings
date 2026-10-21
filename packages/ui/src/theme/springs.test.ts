import { describe, expect, it } from "vitest";

import { renderSpringsCss } from "./springs.ts";

// The springs as designed (Motion board). `scaled`: spatial springs travel, so reduced motion stops
// them; the fade spring only changes color and opacity.
const DESIGNED = [
  { token: "motion-spring-paper", damping: 0.85, stiffness: 400, scaled: true },
  { token: "motion-spring-snap", damping: 1, stiffness: 1400, scaled: true },
  { token: "motion-spring-pop", damping: 0.62, stiffness: 700, scaled: true },
  { token: "motion-spring-fade", damping: 1, stiffness: 1600, scaled: false },
];

const REST_TOLERANCE = 0.002;

/**
 * A unit-mass spring released at 0 toward 1, stepped numerically (RK4, 10 µs) rather than solved
 * in closed form, so it checks the generator's formula instead of repeating it. Returns its
 * position at every whole millisecond up to `untilMs`.
 */
function simulate(damping: number, stiffness: number, untilMs: number): number[] {
  const omega = Math.sqrt(stiffness);
  const accel = (x: number, v: number) => -stiffness * (x - 1) - 2 * damping * omega * v;
  const dt = 0.00001;
  const perMs = 100;
  let x = 0;
  let v = 0;
  const positions = [0];
  for (let ms = 1; ms <= untilMs; ms += 1) {
    for (let step = 0; step < perMs; step += 1) {
      const k1x = v;
      const k1v = accel(x, v);
      const k2x = v + (dt / 2) * k1v;
      const k2v = accel(x + (dt / 2) * k1x, v + (dt / 2) * k1v);
      const k3x = v + (dt / 2) * k2v;
      const k3v = accel(x + (dt / 2) * k2x, v + (dt / 2) * k2v);
      const k4x = v + dt * k3v;
      const k4v = accel(x + dt * k3x, v + dt * k3v);
      x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    }
    positions.push(x);
  }
  return positions;
}

// Reads `--name: linear(0, …, 1);` and its `--name-duration`, with or without the spatial factor.
function readSpring(css: string, token: string) {
  const curve = new RegExp(`--${token}: linear\\(([^)]*)\\);`).exec(css)?.[1];
  const duration = new RegExp(
    `--${token}-duration: (?:(\\d+)ms|calc\\((\\d+)ms \\* var\\(--motion-spatial-factor, 1\\)\\));`,
  ).exec(css);
  expect(curve, `curve ${token}`).toBeDefined();
  expect(duration, `duration ${token}`).not.toBeNull();
  return {
    stops: curve!.split(",").map(Number),
    durationMs: Number(duration![1] ?? duration![2]),
    scaled: duration![2] !== undefined,
  };
}

describe("renderSpringsCss", () => {
  const css = renderSpringsCss();

  describe.each(DESIGNED)("$token", ({ token, damping, stiffness, scaled }) => {
    const positions = simulate(damping, stiffness, 3000);

    it("samples the spring at even steps over its settle time", () => {
      const { stops, durationMs } = readSpring(css, token);
      const steps = stops.length - 1;
      expect(stops[0]).toBe(0);
      expect(stops.at(-1)).toBe(1);
      stops.slice(1, -1).forEach((stop, index) => {
        const t = (durationMs * (index + 1)) / steps;
        const at =
          positions[Math.floor(t)]! +
          (t % 1) * (positions[Math.ceil(t)]! - positions[Math.floor(t)]!);
        expect(stop, `stop ${index + 1}`).toBeCloseTo(at, 2);
      });
    });

    it("lasts until the spring stays within 0.2% of rest", () => {
      const { durationMs } = readSpring(css, token);
      const lastOutside = positions.findLastIndex((x) => Math.abs(x - 1) > REST_TOLERANCE);
      expect(Math.abs(durationMs - (lastOutside + 1))).toBeLessThanOrEqual(1);
    });

    // Reduced motion sets the factor to 0: what travels stops, what fades still fades.
    it(`${scaled ? "scales" : "does not scale"} its duration by the spatial factor`, () => {
      expect(readSpring(css, token).scaled).toBe(scaled);
    });
  });
});

import { describe, expect, it } from "vitest";

import { renderSpringsCss } from "./springs.ts";

// The M3 springs as published: StandardMotionTokens.kt and ExpressiveMotionTokens.kt (v0_14_0).
// `scaled`: spatial springs travel, so reduced motion stops them; effects springs only fade.
const PUBLISHED = [
  {
    token: "md-sys-motion-standard-spring-fast-spatial",
    damping: 0.9,
    stiffness: 1400,
    scaled: true,
  },
  {
    token: "md-sys-motion-standard-spring-default-spatial",
    damping: 0.9,
    stiffness: 700,
    scaled: true,
  },
  {
    token: "md-sys-motion-standard-spring-slow-spatial",
    damping: 0.9,
    stiffness: 300,
    scaled: true,
  },
  {
    token: "md-sys-motion-expressive-spring-fast-spatial",
    damping: 0.6,
    stiffness: 800,
    scaled: true,
  },
  {
    token: "md-sys-motion-expressive-spring-default-spatial",
    damping: 0.8,
    stiffness: 380,
    scaled: true,
  },
  {
    token: "md-sys-motion-expressive-spring-slow-spatial",
    damping: 0.8,
    stiffness: 200,
    scaled: true,
  },
  { token: "md-sys-motion-spring-fast-effects", damping: 1, stiffness: 3800, scaled: false },
  { token: "md-sys-motion-spring-default-effects", damping: 1, stiffness: 1600, scaled: false },
  { token: "md-sys-motion-spring-slow-effects", damping: 1, stiffness: 800, scaled: false },
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
    `--${token}-duration: (?:(\\d+)ms|calc\\((\\d+)ms \\* var\\(--md-sys-motion-spatial-factor, 1\\)\\));`,
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

  describe.each(PUBLISHED)("$token", ({ token, damping, stiffness, scaled }) => {
    const positions = simulate(damping, stiffness, 3000);

    it("samples the spring at 40 even steps over its settle time", () => {
      const { stops, durationMs } = readSpring(css, token);
      expect(stops).toHaveLength(41);
      expect(stops[0]).toBe(0);
      expect(stops.at(-1)).toBe(1);
      stops.slice(1, -1).forEach((stop, index) => {
        const t = (durationMs * (index + 1)) / 40;
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

  describe("emphasized easing", () => {
    // M3's path: M 0,0 C 0.05,0 0.133333,0.06 0.166666,0.4 C 0.208333,0.82 0.25,1 1,1.
    const SEGMENTS = [
      [0, 0, 0.05, 0, 0.133333, 0.06, 0.166666, 0.4],
      [0.166666, 0.4, 0.208333, 0.82, 0.25, 1, 1, 1],
    ] as const;
    const bezier = (a: number, b: number, c: number, d: number, t: number) =>
      (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
    /** The path's y at `x`, found by bisecting the segment's parameter (x rises monotonically). */
    const pathAt = (x: number) => {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = SEGMENTS[x <= 0.166666 ? 0 : 1];
      let low = 0;
      let high = 1;
      for (let step = 0; step < 50; step += 1) {
        const mid = (low + high) / 2;
        if (bezier(x0, x1, x2, x3, mid) < x) low = mid;
        else high = mid;
      }
      return bezier(y0, y1, y2, y3, low);
    };

    // `0, 0.003 2%, …, 1` as [x, y] points; the first and last stops sit at 0% and 100%.
    const readEasing = () => {
      const body = /--md-sys-motion-easing-emphasized: linear\(([^)]*)\);/.exec(css)?.[1];
      expect(body, "emphasized easing").toBeDefined();
      const stops = body!.split(",").map((stop) => stop.trim().split(" "));
      return stops.map(([y, at], index) => [
        at === undefined ? (index === 0 ? 0 : 1) : Number(at.replace("%", "")) / 100,
        Number(y),
      ]) as [number, number][];
    };

    it("passes through M3's control points", () => {
      const points = readEasing();
      expect(points[0]).toEqual([0, 0]);
      expect(points.at(-1)).toEqual([1, 1]);
      expect(points.some(([x, y]) => Math.abs(x - 0.166666) < 0.00001 && y === 0.4)).toBe(true);
    });

    it("stays within 1% of the path everywhere", () => {
      const points = readEasing();
      for (let x = 0; x <= 1; x += 0.001) {
        const right = points.findIndex(([px]) => px >= x);
        const [x0, y0] = points[Math.max(right - 1, 0)]!;
        const [x1, y1] = points[right]!;
        const y = x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
        expect(Math.abs(y - pathAt(x)), `at x = ${x.toFixed(3)}`).toBeLessThan(0.01);
      }
    });
  });
});

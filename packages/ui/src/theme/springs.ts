/** Damping ratio and stiffness as published for the M3 motion schemes. */
interface SpringSpec {
  /** The token without `--md-sys-motion-`: `standard-spring-fast-spatial`. */
  name: string;
  damping: number;
  stiffness: number;
}

/**
 * Both schemes' spatial springs, and the effects springs they share (StandardMotionTokens.kt and
 * ExpressiveMotionTokens.kt, v0_14_0). `tokens.css` picks a scheme through the
 * `--md-sys-motion-spring-*-spatial` aliases.
 */
export const SPRINGS: SpringSpec[] = [
  { name: "standard-spring-fast-spatial", damping: 0.9, stiffness: 1400 },
  { name: "standard-spring-default-spatial", damping: 0.9, stiffness: 700 },
  { name: "standard-spring-slow-spatial", damping: 0.9, stiffness: 300 },
  // Reserved for the "saved" check and the new-tag-chip pop.
  { name: "expressive-spring-fast-spatial", damping: 0.6, stiffness: 800 },
  { name: "expressive-spring-default-spatial", damping: 0.8, stiffness: 380 },
  { name: "expressive-spring-slow-spatial", damping: 0.8, stiffness: 200 },
  { name: "spring-fast-effects", damping: 1, stiffness: 3800 },
  { name: "spring-default-effects", damping: 1, stiffness: 1600 },
  { name: "spring-slow-effects", damping: 1, stiffness: 800 },
];

const REST_TOLERANCE = 0.002;
// 40 even stops keep the bounciest spring (expressive fast) within 0.6% of its true curve.
const STOPS = 40;

/** Position of a unit-mass damped oscillator released from 0 toward 1, `t` in seconds. */
const position = (damping: number, stiffness: number, t: number): number => {
  const omega = Math.sqrt(stiffness);
  if (damping >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const decay = damping * omega;
  const damped = omega * Math.sqrt(1 - damping * damping);
  return (
    1 - Math.exp(-decay * t) * (Math.cos(damped * t) + (decay / damped) * Math.sin(damped * t))
  );
};

/** First millisecond after which the spring stays within tolerance of its rest position. */
const settleTimeMs = (damping: number, stiffness: number): number => {
  let last = 0;
  for (let ms = 0; ms <= 3000; ms += 1) {
    if (Math.abs(position(damping, stiffness, ms / 1000) - 1) > REST_TOLERANCE) last = ms;
  }
  return last + 1;
};

const round = (value: number) => Number(value.toFixed(3));

const renderSpring = ({ name, damping, stiffness }: SpringSpec): string[] => {
  const duration = settleTimeMs(damping, stiffness);
  const stops = Array.from({ length: STOPS + 1 }, (_, index) =>
    index === 0
      ? 0
      : index === STOPS
        ? 1
        : round(position(damping, stiffness, (duration * index) / STOPS / 1000)),
  );
  return [
    `  --md-sys-motion-${name}: linear(${stops.join(", ")});`,
    // Reduced motion sets the factor to 0 (tokens.css), so what travels stops and fades still fade.
    name.endsWith("-spatial")
      ? `  --md-sys-motion-${name}-duration: calc(${duration}ms * var(--md-sys-motion-spatial-factor, 1));`
      : `  --md-sys-motion-${name}-duration: ${duration}ms;`,
  ];
};

type Cubic = readonly [number, number, number, number, number, number, number, number];

/**
 * M3's emphasized easing, a path of two cubic segments that `cubic-bezier()` can't express:
 * `M 0,0 C 0.05,0 0.133333,0.06 0.166666,0.4 C 0.208333,0.82 0.25,1 1,1` (easing tokens & specs).
 */
const EMPHASIZED: readonly Cubic[] = [
  [0, 0, 0.05, 0, 0.133333, 0.06, 0.166666, 0.4],
  [0.166666, 0.4, 0.208333, 0.82, 0.25, 1, 1, 1],
];

/** How far a straight stop-to-stop line may stray from the path before it is split. */
const PATH_TOLERANCE = 0.003;

const bezier = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

const pointOn = ([x0, y0, x1, y1, x2, y2, x3, y3]: Cubic, t: number): [number, number] => [
  bezier(x0, x1, x2, x3, t),
  bezier(y0, y1, y2, y3, t),
];

/** Points along a segment, after `from`, split wherever a straight line would stray from it. */
function samplePath(segment: Cubic, from = 0, to = 1): [number, number][] {
  const [x0, y0] = pointOn(segment, from);
  const [x1, y1] = pointOn(segment, to);
  const quarters = [0.25, 0.5, 0.75].map((share) => pointOn(segment, from + (to - from) * share));
  const strays = quarters.some(
    ([x, y]) => Math.abs(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0) - y) > PATH_TOLERANCE,
  );
  if (!strays) return [[x1, y1]];
  const mid = (from + to) / 2;
  return [...samplePath(segment, from, mid), ...samplePath(segment, mid, to)];
}

/** The emphasized path as `linear()`, its stops dense where it is steep. */
const renderEmphasized = (): string => {
  const inner = EMPHASIZED.flatMap((segment) => samplePath(segment)).slice(0, -1);
  const stops = inner.map(([x, y]) => `${round(y)} ${Number((x * 100).toFixed(4))}%`);
  return `  --md-sys-motion-easing-emphasized: linear(0, ${stops.join(", ")}, 1);`;
};

/**
 * CSS `linear()` approximations of the M3 springs, sampled from the damped-oscillator solution,
 * and of the emphasized easing path.
 */
export const renderSpringsCss = (): string =>
  [
    "/* Generated by packages/ui/scripts/generate-theme.ts. Do not edit. */",
    ":root {",
    ...SPRINGS.flatMap(renderSpring),
    renderEmphasized(),
    "}",
    "",
  ].join("\n");

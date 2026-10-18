import { createCn } from "cn/config";

import { TYPESCALE_NAMES } from "./tokens/typescale.ts";

const RADIUS_STEPS = ["lg-increased", "xl-increased", "xxl"];
const ELEVATIONS = ["0", "1", "2", "3", "4", "5", "card"];

/**
 * The only class helper. Registers the vocabulary that isn't in Tailwind's default config, so
 * `typescale-body-md` and `rounded-xl-increased` merge by group instead of being treated as
 * unknown classes or, worse, as a text color.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      typescale: [{ typescale: [...TYPESCALE_NAMES] }],
      rounded: [{ rounded: RADIUS_STEPS }],
      "rounded-t": [{ "rounded-t": RADIUS_STEPS }],
      "rounded-r": [{ "rounded-r": RADIUS_STEPS }],
      "rounded-b": [{ "rounded-b": RADIUS_STEPS }],
      "rounded-l": [{ "rounded-l": RADIUS_STEPS }],
      shadow: [{ shadow: ELEVATIONS }],
    },
  },
});

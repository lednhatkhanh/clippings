import { Literata, Roboto_Flex, Roboto_Mono } from "next/font/google";

// `variable` exposes each family as the token the design system reads (`--md-ref-typeface-*`).
export const serif = Literata({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--md-ref-typeface-brand",
});

export const sans = Roboto_Flex({
  subsets: ["latin"],
  axes: ["opsz", "GRAD"],
  variable: "--md-ref-typeface-plain",
});

export const mono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--md-ref-typeface-mono",
  preload: false,
});

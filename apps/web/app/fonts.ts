import { Fraunces, Geist, Geist_Mono } from "next/font/google";

// `variable` exposes each family as the token the design system reads (`--typeface-*`).
export const serif = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--typeface-brand",
});

export const sans = Geist({
  subsets: ["latin"],
  variable: "--typeface-plain",
});

export const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--typeface-mono",
  preload: false,
});

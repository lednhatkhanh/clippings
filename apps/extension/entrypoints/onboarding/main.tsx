import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { paintPalette } from "@/lib/paint.ts";

import { Onboarding } from "./onboarding.tsx";

import "@/entrypoints/popup/style.css";

// Before React renders, so the page's first paint is in the user's palette.
paintPalette();

const root = document.getElementById("root");
if (!root) throw new Error("The onboarding page has no root element");

createRoot(root).render(
  <StrictMode>
    <Onboarding />
  </StrictMode>,
);

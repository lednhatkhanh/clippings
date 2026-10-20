import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { paintPalette } from "@/lib/paint.ts";

import { Options } from "./options.tsx";

import "@/entrypoints/popup/style.css";

// Before React renders, so the first frame is in the user's palette, as the popup's is.
await paintPalette();

const root = document.getElementById("root");
if (!root) throw new Error("The options page has no root element");

createRoot(root).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { paintPalette } from "@/lib/paint.ts";

import { Popup } from "./popup.tsx";

import "./style.css";

// Before React renders: the page shows nothing until then, so its first visible frame is already
// in the user's palette.
await paintPalette();

const root = document.getElementById("root");
if (!root) throw new Error("The popup has no root element");

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);

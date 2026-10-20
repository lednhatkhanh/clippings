import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Options } from "./options.tsx";

import "../popup/style.css";

const root = document.getElementById("root");
if (!root) throw new Error("The options page has no root element");

createRoot(root).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);

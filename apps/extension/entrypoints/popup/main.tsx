import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Popup } from "./popup.tsx";

import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("The popup has no root element");

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);

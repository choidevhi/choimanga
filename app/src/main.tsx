import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./tokens.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Root } from "./App";

const root = document.getElementById("root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

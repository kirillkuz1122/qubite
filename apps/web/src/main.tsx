import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/unbounded";
import { consumeAuthLink } from "./auth/routes";
import { App } from "./App";
import "./styles.css";

const initialEntry = consumeAuthLink();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App initialEntry={initialEntry} />
  </StrictMode>,
);

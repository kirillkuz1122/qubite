import React from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import { Root } from "./Root";
import "./styles.css";
import "./milo/milo.css";
import "./flux/flux.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

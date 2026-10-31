import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startHeartbeat } from "./heartbeat";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
startHeartbeat();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { CatalogProvider } from "./lib/catalog";
import { SessionProvider } from "./lib/session";
import "./styles.css";

// Focus rings show only while navigating with the keyboard (see [data-pointer] in styles.css).
addEventListener("pointerdown", () => (document.documentElement.dataset.pointer = ""), true);
addEventListener("keydown", (e) => e.key === "Tab" && delete document.documentElement.dataset.pointer, true);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

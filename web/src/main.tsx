import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lib/install"; // catches the browser's install offer before React starts
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { CatalogProvider } from "./lib/catalog";
import { SessionProvider } from "./lib/session";
import "./styles.css";

// Focus rings show only while navigating with the keyboard (see [data-pointer] in styles.css).
addEventListener("pointerdown", () => (document.documentElement.dataset.pointer = ""), true);
addEventListener("keydown", (e) => e.key === "Tab" && delete document.documentElement.dataset.pointer, true);

// Installable as an app (and an offline page); only in production builds.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

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

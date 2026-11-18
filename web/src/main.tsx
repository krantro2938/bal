import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { CatalogProvider } from "./lib/catalog";
import { SessionProvider } from "./lib/session";
import "./styles.css";

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

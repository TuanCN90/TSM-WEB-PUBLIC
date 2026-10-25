import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { LiveProvider } from "./live";
import { SessionsProvider } from "./sessions";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LiveProvider>
      <SessionsProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionsProvider>
    </LiveProvider>
  </StrictMode>,
);

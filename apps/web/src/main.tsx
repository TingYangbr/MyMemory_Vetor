import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/global.css";

// A fila de narração (speechSynthesis) é do navegador e sobrevive ao refresh da página: num recarregamento o React
// não desmonta nada, então a limpeza das páginas não roda. Cancela ao abrir e ao sair (pagehide cobre refresh e fechar).
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.cancel();
  window.addEventListener("pagehide", () => window.speechSynthesis.cancel());
  window.addEventListener("beforeunload", () => window.speechSynthesis.cancel());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

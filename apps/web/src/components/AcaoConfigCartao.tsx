import { useState } from "react";
import type { AcaoConfig } from "@mymemory/shared";
import { apiPatchJson } from "../api";

/**
 * Configuração oferecida pelo Fale comigo ("como desabilito o autofalante?"): botões Sim/Não. Só muda com o toque;
 * grava pela mesma rota da tela Preferências.
 */
export function AcaoConfigCartao({ acao, onAplicada }: { acao: AcaoConfig; onAplicada: (a: AcaoConfig) => void }) {
  const [estado, setEstado] = useState<"pergunta" | "gravando" | "feito" | "nao">("pergunta");
  const [erro, setErro] = useState<string | null>(null);

  async function aplicar() {
    setEstado("gravando");
    setErro(null);
    try {
      await apiPatchJson("/api/me/preferences", { [acao.chave]: acao.valor });
      onAplicada(acao);
      setEstado("feito");
    } catch (e) {
      setEstado("pergunta");
      setErro(e instanceof Error ? e.message : "Não foi possível mudar.");
    }
  }

  if (estado === "feito") return <p style={{ margin: "8px 0 0", fontSize: 14 }} role="status">✓ {acao.feito}</p>;
  if (estado === "nao") return <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--mm-muted)" }}>Ok, nada mudou.</p>;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
      <button type="button" className="mm-btn mm-btn--primary" disabled={estado === "gravando"} onClick={() => void aplicar()}>
        {estado === "gravando" ? "Mudando…" : acao.rotulo}
      </button>
      <button type="button" className="mm-btn mm-btn--ghost" disabled={estado === "gravando"} onClick={() => setEstado("nao")}>
        Não
      </button>
      {erro ? <span className="mm-error">{erro}</span> : null}
    </div>
  );
}

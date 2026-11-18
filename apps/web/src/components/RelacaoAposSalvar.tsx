import { useEffect, useState } from "react";
import { apiPostJson } from "../api";

/** Pedido de ligação feito antes de abrir o Catalogar ("Concluir e registrar resultado"). */
export const CHAVE_RELACAO_PENDENTE = "mm_relacao_pendente";

export interface RelacaoPendente {
  destinoId: number;
  tipo: string;
  concluir: boolean;
  /** Date.now() do pedido; vale por 1 hora. */
  quando: number;
}

interface Sugestao {
  destinoId: number;
  categoria: string | null;
  resumo: string;
  tipo: string;
  podeConcluir: boolean;
  motivo: string;
}

function lerPendente(): RelacaoPendente | null {
  try {
    const raw = sessionStorage.getItem(CHAVE_RELACAO_PENDENTE);
    if (!raw) return null;
    const p = JSON.parse(raw) as RelacaoPendente;
    if (!p?.destinoId || Date.now() - Number(p.quando) > 60 * 60 * 1000) {
      sessionStorage.removeItem(CHAVE_RELACAO_PENDENTE);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/**
 * Logo depois de salvar um memo:
 *  - se ele veio de "Concluir e registrar resultado", liga ao compromisso e o conclui;
 *  - senão, pede à IA uma sugestão ("parece ser o resultado da reunião com Wilson") e pergunta.
 * Nada é ligado sem o pedido ou o "sim" do usuário.
 */
export function RelacaoAposSalvar({ memoId, onFim }: { memoId: number; onFim: () => void }) {
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    const pendente = lerPendente();
    if (pendente) {
      sessionStorage.removeItem(CHAVE_RELACAO_PENDENTE);
      apiPostJson<{ id: number; concluido: boolean }>(`/api/memos/${memoId}/relacoes`, {
        destinoId: pendente.destinoId,
        tipo: pendente.tipo,
        concluirDestino: pendente.concluir,
      })
        .then((r) => vivo && setMsg(`Ligado ao compromisso #${pendente.destinoId}${r.concluido ? " e marcado como concluído" : ""}.`))
        .catch(() => vivo && setMsg("Não foi possível ligar ao compromisso."));
      return () => {
        vivo = false;
      };
    }
    apiPostJson<{ sugestao: Sugestao | null }>(`/api/memos/${memoId}/sugerir-relacao`, {})
      .then((r) => {
        if (!vivo) return;
        if (r.sugestao) setSugestao(r.sugestao);
        else onFim();
      })
      .catch(() => vivo && onFim());
    return () => {
      vivo = false;
    };
  }, [memoId, onFim]);

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(onFim, 4000);
    return () => window.clearTimeout(t);
  }, [msg, onFim]);

  async function ligar(concluir: boolean) {
    if (!sugestao) return;
    setBusy(true);
    try {
      const r = await apiPostJson<{ id: number; concluido: boolean }>(`/api/memos/${memoId}/relacoes`, {
        destinoId: sugestao.destinoId,
        tipo: sugestao.tipo,
        concluirDestino: concluir,
      });
      setSugestao(null);
      setMsg(`Ligado ao compromisso #${sugestao.destinoId}${r.concluido ? " e marcado como concluído" : ""}.`);
    } catch {
      setMsg("Não foi possível ligar.");
    } finally {
      setBusy(false);
    }
  }

  if (!sugestao && !msg) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 80,
        transform: "translateX(-50%)",
        zIndex: 61,
        background: "var(--mm-card)",
        color: "var(--mm-text)",
        border: "1.5px solid var(--mm-primary)",
        borderRadius: 12,
        padding: "12px 14px",
        boxShadow: "0 12px 30px rgba(16,32,30,.25)",
        maxWidth: "min(560px, calc(100vw - 32px))",
        fontSize: 14,
      }}
    >
      {msg ? (
        <span>{msg}</span>
      ) : sugestao ? (
        <>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Este memo parece ser o resultado de:</div>
          <div style={{ marginBottom: 8 }}>
            {sugestao.categoria ? <b>{sugestao.categoria} #{sugestao.destinoId}</b> : <b>#{sugestao.destinoId}</b>} — {sugestao.resumo}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sugestao.podeConcluir ? (
              <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={() => void ligar(true)}>
                Ligar e concluir
              </button>
            ) : null}
            <button type="button" className={sugestao.podeConcluir ? "mm-btn mm-btn--ghost" : "mm-btn mm-btn--primary"} disabled={busy} onClick={() => void ligar(false)}>
              Só ligar
            </button>
            <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={onFim}>
              Não
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

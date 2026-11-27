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

type Ligado = { id: number; concluido: boolean; destino?: { categoria: string | null; resumo: string } };

/** "Ligado à Agenda: Reunião com Carlos do Global pet… — marcada como concluída." */
function textoLigado(r: Ligado, destinoId: number): string {
  const qual = r.destino?.resumo
    ? `${r.destino.categoria ? `${r.destino.categoria}: ` : ""}${r.destino.resumo}`
    : `compromisso #${destinoId}`;
  return `✓ Resultado ligado a ${qual}${r.concluido ? " — marcado como concluído" : ""}.`;
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
      apiPostJson<Ligado>(`/api/memos/${memoId}/relacoes`, {
        destinoId: pendente.destinoId,
        tipo: pendente.tipo,
        concluirDestino: pendente.concluir,
      })
        .then((r) => vivo && setMsg(textoLigado(r, pendente.destinoId)))
        .catch(
          () =>
            vivo &&
            setMsg("Não consegui ligar este memo ao compromisso. Abra o compromisso (✎) e use \"Concluir e registrar resultado\" de novo.")
        );
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
    // Tempo para ler a confirmação (some sozinha; um toque fecha antes)
    const t = window.setTimeout(onFim, 8000);
    return () => window.clearTimeout(t);
  }, [msg, onFim]);

  async function ligar(concluir: boolean) {
    if (!sugestao) return;
    setBusy(true);
    try {
      const r = await apiPostJson<Ligado>(`/api/memos/${memoId}/relacoes`, {
        destinoId: sugestao.destinoId,
        tipo: sugestao.tipo,
        concluirDestino: concluir,
      });
      setSugestao(null);
      setMsg(textoLigado(r, sugestao.destinoId));
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
        <span onClick={onFim} style={{ cursor: "pointer" }} title="Fechar">
          {msg}
        </span>
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

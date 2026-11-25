import { useState } from "react";
import type { FinComandoProposta, FinCorrecaoCandidato, FinCorrecaoEscolha } from "@mymemory/shared";
import { apiPostJson } from "../api";
import FinComandoCartao from "./FinComandoCartao";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function mensagemErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    return (JSON.parse(raw) as { message?: string }).message ?? raw;
  } catch {
    return raw;
  }
}

/** Abre o Form de correção de um lançamento (o mesmo da confirmação), com os valores atuais. */
async function abrirCorrecao(lancamentoId: number, novos?: FinCorrecaoEscolha["novos"]): Promise<FinComandoProposta> {
  return apiPostJson<FinComandoProposta>(`/api/fin/lancamentos/${lancamentoId}/correcao`, { novos: novos ?? null });
}

/** ✎ de uma linha da lista de lançamentos: abre o Form de correção daquele lançamento. */
export function FinCorrecaoLapis({ lancamentoId }: { lancamentoId: number }) {
  const [proposta, setProposta] = useState<FinComandoProposta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function abrir() {
    setOcupado(true);
    setErro(null);
    try {
      setProposta(await abrirCorrecao(lancamentoId));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        disabled={ocupado}
        title={erro ?? "Corrigir este lançamento"}
        aria-label="Corrigir este lançamento"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: erro ? "var(--mm-danger)" : "var(--mm-primary, #0d9488)" }}
      >
        {ocupado ? "…" : "✎"}
      </button>
      {erro ? <span style={{ display: "block", fontSize: 11, color: "var(--mm-danger)", maxWidth: 220 }}>{erro}</span> : null}
      {proposta ? <FinComandoCartao key={proposta.correcao?.lancamentoId} proposta={proposta} onCancelar={() => setProposta(null)} /> : null}
    </>
  );
}

/** "Corrigir a compra…" com mais de um lançamento possível: lista para escolher; o escolhido abre o Form. */
export function FinCorrecaoEscolher({ escolha }: { escolha: FinCorrecaoEscolha }) {
  const [proposta, setProposta] = useState<FinComandoProposta | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function escolher(c: FinCorrecaoCandidato) {
    setOcupado(c.lancamentoId);
    setErro(null);
    try {
      setProposta(await abrirCorrecao(c.lancamentoId, escolha.novos));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }
  if (proposta) return <FinComandoCartao key={proposta.correcao?.lancamentoId} proposta={proposta} onCancelar={() => setProposta(null)} />;
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ margin: "0 0 6px", fontSize: 14 }}>{escolha.mensagem}</p>
      <div style={{ display: "grid", gap: 6 }}>
        {escolha.candidatos.map((c) => (
          <button
            key={c.lancamentoId}
            type="button"
            className="mm-btn"
            disabled={ocupado != null}
            onClick={() => void escolher(c)}
            style={{ justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", height: "auto", padding: "8px 10px" }}
          >
            <span>
              ✎ {dataBr(c.data)} · <b>{c.descricao}</b> · {brl(c.valor)}
              <span style={{ color: "var(--mm-muted)", fontSize: 12 }}>
                {" "}· {c.conta}
                {c.grupo ? ` → ${c.grupo}` : ""}
              </span>
              {ocupado === c.lancamentoId ? " …" : ""}
            </span>
          </button>
        ))}
      </div>
      {erro ? <p className="mm-error">{erro}</p> : null}
    </div>
  );
}

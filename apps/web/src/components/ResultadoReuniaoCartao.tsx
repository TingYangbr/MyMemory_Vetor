import { useState } from "react";
import type { ResultadoReuniaoOferta } from "@mymemory/shared";
import { CHAVE_RELACAO_PENDENTE, type RelacaoPendente } from "./RelacaoAposSalvar";

/** Texto que o Catalogar abre já preenchido (lido uma vez pelo painel de registro). */
export const CHAVE_CATALOGAR_TEXTO = "mm_catalogar_texto";

/** Abre o Catalogar com o texto; com memoId, ao salvar liga à reunião como resultado e a conclui. */
export function abrirCatalogarComTexto(texto: string, memoId: number | null) {
  try {
    if (memoId) {
      const pendente: RelacaoPendente = { destinoId: memoId, tipo: "resultado", concluir: true, quando: Date.now() };
      sessionStorage.setItem(CHAVE_RELACAO_PENDENTE, JSON.stringify(pendente));
    }
    sessionStorage.setItem(CHAVE_CATALOGAR_TEXTO, JSON.stringify({ texto, quando: Date.now() }));
  } catch {
    /* sem sessionStorage: o Catalogar abre vazio */
  }
  window.dispatchEvent(new CustomEvent("mm:abrir-catalogar"));
}

/**
 * "Resultado da reunião com Carlos: …" — a reunião (ou as possíveis) para registrar o texto como resultado.
 * Um toque abre o Catalogar com o texto já preenchido e ligado à reunião.
 */
export function ResultadoReuniaoCartao({ oferta }: { oferta: ResultadoReuniaoOferta }) {
  const [feito, setFeito] = useState(false);
  if (feito) return <p style={{ fontSize: 13.5, margin: "8px 0 0" }}>Abri o Catalogar com o texto: confira e salve.</p>;
  const ir = (memoId: number | null) => {
    setFeito(true);
    abrirCatalogarComTexto(oferta.texto, memoId);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {oferta.opcoes.map((o) => (
        <button
          key={o.memoId}
          type="button"
          className={oferta.opcoes.length === 1 ? "mm-btn mm-btn--primary" : "mm-btn mm-btn--ghost"}
          style={{ textAlign: "left", justifyContent: "flex-start" }}
          onClick={() => ir(o.memoId)}
          title="Abre o Catalogar com o texto; ao salvar, liga a esta reunião e a marca como concluída"
        >
          📝 {o.titulo} · {o.quando}
        </button>
      ))}
      <button type="button" className="mm-btn mm-btn--ghost" style={{ alignSelf: "flex-start" }} onClick={() => ir(null)}>
        {oferta.opcoes.length ? "Guardar sem ligar a uma reunião" : "Guardar pelo Catalogar"}
      </button>
    </div>
  );
}

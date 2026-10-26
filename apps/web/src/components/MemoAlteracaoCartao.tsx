import { useEffect, useRef, useState } from "react";
import type { MemoAlteracaoResponse, MemoAlteravelCampo, MemoAlteravelResponse } from "@mymemory/shared";
import { situacaoEncerrada } from "@mymemory/shared";
import { apiGet, apiPostJson } from "../api";
import { capturarFalaCurta, vozDisponivel, type CapturaVoz } from "../lib/vozCurta";
import styles from "./MemoAlteracaoCartao.module.css";

/** AAAA-MM-DD → DD/MM/AAAA para editar; o resto como está. */
function paraTela(c: MemoAlteravelCampo): string {
  const m = c.tipo === "date" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(c.valor) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : c.valor;
}

/** Hora falada ("15 horas", "15h30", "15") → "15:00"/"15:30" nos campos de hora. */
function ajustarFalado(c: MemoAlteravelCampo, falado: string): string {
  const t = falado.trim().replace(/[.。]$/, "");
  if (!/hora|horario/i.test(c.nome.normalize("NFD").replace(/[̀-ͯ]/g, ""))) return t;
  const m = /^(\d{1,2})(?:\s*(?:h|:|horas?)\s*(\d{2})?)?(?:\s*(?:min|minutos))?$/i.exec(t.replace(/\s+e\s+/i, " "));
  if (!m) return t;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  return hh <= 23 && mm <= 59 ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : t;
}

function mensagemErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    return (JSON.parse(raw) as { message?: string }).message ?? raw;
  } catch {
    return raw;
  }
}

/**
 * Cartão de alteração de um memo de categoria atualizável, aberto pela resposta do Perguntar:
 * campos editáveis (com 🎤 que encerra no silêncio), Salvar sem confirmação extra (a proteção é o
 * "Desfazer" que aparece depois) e as ações de situação: Concluído, Cancelado ou Reativar.
 */
export function MemoAlteracaoCartao({
  memoId,
  onFechar,
  onAlterado,
}: {
  memoId: number;
  onFechar: () => void;
  onAlterado: (memoId: number, r: MemoAlteracaoResponse, texto: string) => void;
}) {
  const [dados, setDados] = useState<MemoAlteravelResponse | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ouvindo, setOuvindo] = useState<string | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  const capturaRef = useRef<CapturaVoz | null>(null);
  const comVoz = vozDisponivel();

  useEffect(() => {
    let vivo = true;
    apiGet<MemoAlteravelResponse>(`/api/memos/${memoId}/alteravel`)
      .then((r) => {
        if (!vivo) return;
        setDados(r);
        setValores(Object.fromEntries(r.campos.map((c) => [c.nome, paraTela(c)])));
      })
      .catch((e) => vivo && setErro(mensagemErro(e)));
    return () => {
      vivo = false;
      capturaRef.current?.parar();
    };
  }, [memoId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !salvando && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar, salvando]);

  async function falar(c: MemoAlteravelCampo) {
    if (ouvindo) {
      capturaRef.current?.parar();
      return;
    }
    setErro(null);
    setOuvindo(c.nome);
    const cap = capturarFalaCurta((parcial) => setValores((v) => ({ ...v, [c.nome]: parcial })));
    capturaRef.current = cap;
    try {
      const falado = (await cap.resultado).trim();
      if (falado) {
        setValores((v) => ({ ...v, [c.nome]: ajustarFalado(c, falado) }));
        setDestaque(c.nome);
        window.setTimeout(() => setDestaque((d) => (d === c.nome ? null : d)), 1500);
      } else {
        setErro("Não ouvi nada. Tente de novo.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro no microfone.");
    } finally {
      capturaRef.current = null;
      setOuvindo(null);
    }
  }

  async function salvar() {
    if (!dados) return;
    const mudados = Object.fromEntries(
      dados.campos.filter((c) => (valores[c.nome] ?? "").trim() !== paraTela(c).trim()).map((c) => [c.nome, valores[c.nome] ?? ""])
    );
    if (!Object.keys(mudados).length) {
      onFechar();
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/${memoId}/alterar`, { campos: mudados });
      const texto = r.mudancas.length
        ? `Alterado: ${r.mudancas.map((m) => `${m.campo} → ${m.depois || "(vazio)"}`).join(", ")}.`
        : "Nada mudou.";
      onAlterado(memoId, r, texto);
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  async function mudarSituacao(situacao: "Ativo" | "Concluído" | "Cancelado") {
    setSalvando(true);
    setErro(null);
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/${memoId}/situacao`, { situacao });
      const texto =
        situacao === "Cancelado" ? "Marcado como cancelado." : situacao === "Concluído" ? "Marcado como concluído." : "Reativado.";
      onAlterado(memoId, r, texto);
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  const encerrado = dados ? situacaoEncerrada(dados.situacao) : false;

  return (
    <div className={styles.overlay} onClick={() => !salvando && onFechar()}>
      <div className={styles.cartao} role="dialog" aria-label={`Alterar memo #${memoId}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.topo}>
          <div>
            <strong>{dados?.categoria ?? "Memo"}</strong> <span className={styles.id}>#{memoId}</span>
            {dados ? <span className={encerrado ? styles.situacaoEncerrada : styles.situacao}>{dados.situacao}</span> : null}
          </div>
          <button type="button" className={styles.fechar} onClick={onFechar} disabled={salvando} aria-label="Fechar sem alterar">
            ×
          </button>
        </div>

        {!dados && !erro ? <p className={styles.carregando}>Carregando…</p> : null}

        {dados ? (
          <>
            <div className={styles.campos}>
              {dados.campos.map((c) => (
                <div key={c.nome} className={styles.campo}>
                  <label htmlFor={`alt-${c.nome}`} title={c.descricao ?? undefined}>
                    {c.nome}
                  </label>
                  <div className={styles.linha}>
                    <input
                      id={`alt-${c.nome}`}
                      className={`mm-field ${ouvindo === c.nome ? styles.inputOuvindo : ""} ${destaque === c.nome ? styles.inputDestaque : ""}`}
                      value={valores[c.nome] ?? ""}
                      placeholder={c.tipo === "date" ? "dd/mm/aaaa" : ""}
                      onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && void salvar()}
                      disabled={salvando}
                    />
                    {comVoz ? (
                      <button
                        type="button"
                        className={`${styles.mic} ${ouvindo === c.nome ? styles.micAtivo : ""}`}
                        onClick={() => void falar(c)}
                        disabled={salvando || (ouvindo != null && ouvindo !== c.nome)}
                        title={ouvindo === c.nome ? "Parar" : "Falar (encerra sozinho quando você para de falar)"}
                        aria-label={`Falar ${c.nome}`}
                      >
                        {ouvindo === c.nome ? "⏸" : "🎤"}
                      </button>
                    ) : null}
                  </div>
                  {ouvindo === c.nome ? <div className={styles.dica}>Ouvindo… pode falar.</div> : null}
                </div>
              ))}
            </div>
            {erro ? <p className="mm-error">{erro}</p> : null}
            <button type="button" className={`mm-btn mm-btn--primary ${styles.salvar}`} onClick={() => void salvar()} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar alterações"}
            </button>
            <div className={styles.acoes}>
              {encerrado ? (
                <button type="button" className={styles.acao} onClick={() => void mudarSituacao("Ativo")} disabled={salvando}>
                  ↺ Reativar
                </button>
              ) : (
                <>
                  <button type="button" className={styles.acao} onClick={() => void mudarSituacao("Concluído")} disabled={salvando}>
                    ✓ Marcar como concluído
                  </button>
                  <button
                    type="button"
                    className={`${styles.acao} ${styles.acaoCancelar}`}
                    onClick={() => void mudarSituacao("Cancelado")}
                    disabled={salvando}
                  >
                    ✕ Marcar como cancelado
                  </button>
                </>
              )}
            </div>
          </>
        ) : erro ? (
          <p className="mm-error">{erro}</p>
        ) : null}
      </div>
    </div>
  );
}

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import type { PerguntaResultadoEstruturado, QueryCategoria } from "@mymemory/shared";
import { toParamName } from "@mymemory/shared";
import { apiPostJson } from "../../api";
import { msgErro } from "./util";
import s from "./ExecutarConsultaJanela.module.css";

interface Resposta {
  ok: boolean;
  resultado: PerguntaResultadoEstruturado;
  avisos: string[];
  ms: number;
}

const PARAMS_SISTEMA = new Set(["userid", "groupid"]);

/** Texto da célula: datas ISO viram dd/mm/aaaa; números ficam como vieram (o banco já devolve com ponto). */
function textoCelula(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleDateString("pt-BR");
  const t = typeof v === "object" ? JSON.stringify(v) : String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?Z?)?$/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Janela grande (redimensionável e maximizável) que roda UMA consulta da categoria com os filtros digitados,
 * sem IA, e mostra o resultado como a IA o receberia. Os filtros do topo são os parâmetros da consulta;
 * os de baixo de cada coluna só filtram o que já veio.
 */
export default function ExecutarConsultaJanela({ query, groupId, onFechar }: { query: QueryCategoria; groupId: number; onFechar: () => void }) {
  const params = useMemo(
    () =>
      query.params
        .filter((p) => p.isActive === 1 && !PARAMS_SISTEMA.has(toParamName(p.campo).toLowerCase()))
        .sort((a, b) => a.ordem - b.ordem)
        .map((p) => ({ nome: toParamName(p.campo), tipo: p.tipo, operador: p.operadorSql })),
    [query]
  );
  const [valores, setValores] = useState<Record<string, string>>({});
  const [res, setRes] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [filtrosCol, setFiltrosCol] = useState<Record<string, string>>({});
  const [max, setMax] = useState(false);
  const [copiado, setCopiado] = useState(false);
  /** Resultado sem filtros (roda ao abrir): dá o total do título e os valores sugeridos nos filtros */
  const [base, setBase] = useState<Resposta | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  // Ao abrir: roda sem filtros (total no título, valores para sugerir e a tabela inicial)
  useEffect(() => {
    let vivo = true;
    setRodando(true);
    apiPostJson<Resposta>(`/api/consultas-categoria/${query.id}/executar`, { groupId, valores: {} })
      .then((r) => {
        if (!vivo) return;
        setBase(r);
        setRes(r);
      })
      .catch((e) => vivo && setErro(msgErro(e, "Erro ao executar a consulta.")))
      .finally(() => vivo && setRodando(false));
    return () => {
      vivo = false;
    };
  }, [query.id, groupId]);

  /** Valores de cada filtro de texto, tirados da coluna de mesmo nome no resultado sem filtros. */
  const sugestoes = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (!base) return out;
    const norm = (t: string) => semAcento(t).replace(/[^a-z0-9]/g, "");
    for (const p of params) {
      if (p.tipo === "date" || p.tipo === "number") continue;
      const alvo = norm(p.nome.replace(/_(in|ini|fin)$/i, ""));
      const col = base.resultado.colunas.find((c) => norm(c) === alvo);
      if (!col) continue;
      const vals = new Set<string>();
      for (const l of base.resultado.linhas) {
        const v = textoCelula(l[col]).trim();
        if (v) vals.add(v);
        if (vals.size >= 200) break;
      }
      out[p.nome] = [...vals].sort((a, b) => a.localeCompare(b, "pt-BR"));
    }
    return out;
  }, [base, params]);

  async function executar() {
    setRodando(true);
    setErro(null);
    try {
      setRes(await apiPostJson<Resposta>(`/api/consultas-categoria/${query.id}/executar`, { groupId, valores }));
      setFiltrosCol({});
    } catch (e) {
      setRes(null);
      setErro(msgErro(e, "Erro ao executar a consulta."));
    } finally {
      setRodando(false);
    }
  }

  const colunas = res?.resultado.colunas ?? [];
  const linhas = useMemo(() => {
    const todas = res?.resultado.linhas ?? [];
    const ativos = Object.entries(filtrosCol).filter(([, v]) => v.trim());
    if (!ativos.length) return todas;
    return todas.filter((l) => ativos.every(([c, v]) => semAcento(textoCelula(l[c])).includes(semAcento(v.trim()))));
  }, [res, filtrosCol]);

  async function copiar() {
    const tsv = [colunas.join("\t"), ...linhas.map((l) => colunas.map((c) => textoCelula(l[c]).replace(/[\t\n]/g, " ")).join("\t"))].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      setErro("Não foi possível copiar (o navegador bloqueou a área de transferência).");
    }
  }

  return createPortal(
    <div className={s.fundo} role="presentation" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`${s.janela} ${max ? s.max : ""}`} role="dialog" aria-modal="true" aria-label={`Executar ${query.nome}`}>
        <div className={s.topo}>
          <strong className={s.titulo}>
            ▶ {query.nome}{" "}
            <span className={s.total} title="Registros sem nenhum filtro">
              ({base ? base.resultado.totalLinhas : "…"})
            </span>
          </strong>
          <button type="button" className={s.icone} onClick={() => setMax((m) => !m)} title={max ? "Restaurar o tamanho" : "Maximizar"}>
            {max ? "🗗" : "⛶"}
          </button>
          <button type="button" className={s.icone} onClick={onFechar} aria-label="Fechar" title="Fechar (Esc)">
            ×
          </button>
        </div>

        <div className={s.filtros}>
          {params.length ? (
            params.map((p) => (
              <label key={p.nome} className={s.filtro}>
                <span>
                  {p.nome} <small>{p.operador}</small>
                </span>
                <input
                  className="mm-field"
                  type={p.tipo === "date" ? "date" : p.tipo === "number" ? "number" : "text"}
                  list={sugestoes[p.nome]?.length ? `sug-${query.id}-${p.nome}` : undefined}
                  placeholder={sugestoes[p.nome]?.length ? `${sugestoes[p.nome]!.length} valores — digite ou escolha` : ""}
                  value={valores[p.nome] ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [p.nome]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && void executar()}
                />
                {sugestoes[p.nome]?.length ? (
                  <datalist id={`sug-${query.id}-${p.nome}`}>
                    {sugestoes[p.nome]!.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                ) : null}
              </label>
            ))
          ) : (
            <span className="mm-muted">Esta consulta não tem filtros.</span>
          )}
          <button type="button" className="mm-btn mm-btn--primary" disabled={rodando} onClick={() => void executar()}>
            {rodando ? "Executando…" : "▶ Executar"}
          </button>
        </div>
        <p className={s.dica}>Filtros vazios ficam de fora, como quando a pergunta não cita aquele dado. É o mesmo resultado que a IA recebe.</p>

        {erro ? <p className="mm-error">{erro}</p> : null}
        {res?.avisos.length ? (
          <ul className={s.avisos}>
            {res.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}

        <div className={s.tabelaWrap}>
          {res ? (
            colunas.length ? (
              <table className={s.tabela}>
                <thead>
                  <tr>
                    {colunas.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                  <tr>
                    {colunas.map((c) => (
                      <th key={c} className={s.thFiltro}>
                        <input
                          className={s.filtroCol}
                          placeholder="filtrar…"
                          value={filtrosCol[c] ?? ""}
                          onChange={(e) => setFiltrosCol((f) => ({ ...f, [c]: e.target.value }))}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={i}>
                      {colunas.map((c) => (
                        <td key={c}>{textoCelula(l[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mm-muted">Nenhuma linha.</p>
            )
          ) : (
            <p className="mm-muted">Preencha os filtros (ou deixe vazio) e toque em Executar.</p>
          )}
        </div>

        <div className={s.rodape}>
          <span>
            {res
              ? `${linhas.length}${linhas.length !== res.resultado.totalLinhas ? ` de ${res.resultado.totalLinhas}` : ""} linha(s) · ${(res.ms / 1000).toFixed(2)} s`
              : ""}
          </span>
          <span className={s.sp} />
          {res && colunas.length ? (
            <button type="button" className="mm-btn" onClick={() => void copiar()} title="Copia a tabela (como está filtrada) para colar no Excel">
              {copiado ? "✓ Copiado" : "Copiar"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

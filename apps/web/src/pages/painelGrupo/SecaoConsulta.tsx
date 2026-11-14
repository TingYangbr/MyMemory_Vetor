import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MemoContextStructureResponse, MemosListaResponse } from "@mymemory/shared";
import { apiGet, apiPostJson } from "../../api";
import { IconSearch } from "../../components/icons";
import { msgErro } from "./util";
import s from "./painel.module.css";

const POR_PAGINA = 50;
export const SEM_CATEGORIA = "__sem__";

const MIDIA: Record<string, string> = { text: "Texto", audio: "Áudio", image: "Imagem", video: "Vídeo", document: "Doc.", url: "URL" };

function celula(key: string, v: unknown): string {
  if (v == null) return "—";
  const t = String(v);
  if (key === "data_registro") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (key === "mediatype" || key === "mediaType") return MIDIA[t] ?? t;
  if (key === "mediatext" || key === "mediaText") return t.length > 150 ? `${t.slice(0, 150)}…` : t;
  return t || "—";
}

interface ConsultaProps {
  groupId: number;
  /** Categoria fixa (aba Memos da categoria). Sem ela, mostra o filtro de categoria. */
  categoriaFixa?: string;
  /** Escopo de categorias (null = globais). Padrão: o próprio grupo. */
  contextGroupId?: number | null;
  compacto?: boolean;
}

/** Consulta de memos do grupo: filtros, ordenação, filtro por coluna e link para abrir o memo. */
export function ConsultaMemos({ groupId, categoriaFixa, contextGroupId, compacto }: ConsultaProps) {
  const [categorias, setCategorias] = useState<string[]>([]);
  const [categoria, setCategoria] = useState(categoriaFixa ?? "");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [ordem, setOrdem] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "data_registro", dir: "desc" });
  const [offset, setOffset] = useState(0);
  const [res, setRes] = useState<MemosListaResponse | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ctx = contextGroupId === undefined ? groupId : contextGroupId;

  useEffect(() => {
    if (categoriaFixa !== undefined) return;
    apiGet<MemoContextStructureResponse>(`/api/memo-context/structure?groupId=${groupId}`)
      .then((r) => setCategorias(r.categories.filter((c) => c.isActive === 1).map((c) => c.name)))
      .catch(() => setCategorias([]));
  }, [groupId, categoriaFixa]);

  const consultar = useCallback(
    async (o?: { offset?: number; key?: string; dir?: "asc" | "desc" }) => {
      const novoOffset = o?.offset ?? 0;
      const key = o?.key ?? ordem.key;
      const dir = o?.dir ?? ordem.dir;
      setCarregando(true);
      setErro(null);
      try {
        const sem = categoria === SEM_CATEGORIA;
        const r = await apiPostJson<MemosListaResponse>("/api/memo-context/memos-lista", {
          categoryName: sem ? "" : categoria,
          semCategoria: sem,
          contextGroupId: ctx,
          workspaceGroupId: groupId,
          dataInicio: dataIni || null,
          dataFim: dataFim || null,
          campoFiltros: filtros,
          sortKey: key,
          sortDir: dir,
          limit: POR_PAGINA,
          offset: novoOffset,
        });
        setRes(r);
        setOffset(novoOffset);
        setOrdem({ key, dir });
      } catch (e) {
        setErro(msgErro(e, "Erro ao consultar."));
      } finally {
        setCarregando(false);
      }
    },
    [categoria, ctx, groupId, dataIni, dataFim, filtros, ordem]
  );

  // A aba Memos de uma categoria já abre com a lista.
  useEffect(() => {
    if (categoriaFixa !== undefined) void consultar({ offset: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaFixa, groupId]);

  return (
    <>
      <div className={compacto ? "" : s.card}>
        <div className={s.filters} style={compacto ? { padding: "0 0 10px" } : undefined}>
          {categoriaFixa === undefined ? (
            <label>
              Categoria
              <select
                className={`mm-field ${s.selectSm}`}
                value={categoria}
                onChange={(e) => {
                  setCategoria(e.target.value);
                  setFiltros({});
                  setRes(null);
                }}
              >
                <option value="">Todas</option>
                <option value={SEM_CATEGORIA}>Sem categoria</option>
                {categorias.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            De
            <input type="date" className={`mm-field ${s.selectSm}`} style={{ minWidth: 0 }} value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" className={`mm-field ${s.selectSm}`} style={{ minWidth: 0 }} value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </label>
          <button type="button" className={`mm-btn mm-btn--primary ${compacto ? s.btnSm : ""}`} disabled={carregando} onClick={() => void consultar({ offset: 0 })}>
            <IconSearch size={14} /> {carregando ? "Consultando…" : "Consultar"}
          </button>
        </div>
        {erro ? <p className={s.msgErr} style={{ padding: compacto ? 0 : "0 16px" }}>{erro}</p> : null}
      </div>

      {res ? (
        <div className={s.card} style={{ marginTop: 12 }}>
          <div className={s.tblWrap}>
            <table className={s.tbl}>
              <thead>
                <tr>
                  {res.colunas.map((c) => (
                    <th
                      key={c.key}
                      className={s.thSort}
                      onClick={() => void consultar({ key: c.key, dir: ordem.key === c.key && ordem.dir === "asc" ? "desc" : "asc", offset: 0 })}
                    >
                      {c.label} {ordem.key === c.key ? (ordem.dir === "asc" ? "▲" : "▼") : ""}
                    </th>
                  ))}
                </tr>
                {!compacto ? (
                  <tr>
                    {res.colunas.map((c) => (
                      <th key={c.key} style={{ paddingTop: 4 }}>
                        <input
                          className="mm-field"
                          style={{ padding: "3px 6px", fontSize: 12, minWidth: 70 }}
                          value={filtros[c.key] ?? ""}
                          placeholder="filtrar…"
                          onChange={(e) => setFiltros((f) => ({ ...f, [c.key]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void consultar({ offset: 0 });
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {res.linhas.length === 0 ? (
                  <tr>
                    <td colSpan={res.colunas.length} className="mm-muted">
                      Nenhum memo encontrado.
                    </td>
                  </tr>
                ) : (
                  res.linhas.map((l, i) => (
                    <tr key={String(l.id ?? i)}>
                      {res.colunas.map((c) => (
                        <td key={c.key}>
                          {c.key === "id" && l.id != null ? (
                            <Link to={`/memo/${String(l.id)}/editar`} title="Abrir o memo">
                              #{String(l.id)}
                            </Link>
                          ) : (
                            celula(c.key, l[c.key])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className={s.pager}>
            {res.totalLinhas} memo(s)
            {res.totalLinhas > POR_PAGINA ? (
              <>
                <span className={s.sp} />
                <button type="button" className={`mm-btn mm-btn--ghost ${s.btnSm}`} disabled={offset === 0 || carregando} onClick={() => void consultar({ offset: Math.max(0, offset - POR_PAGINA) })}>
                  ← Anterior
                </button>
                {offset + 1}–{Math.min(offset + POR_PAGINA, res.totalLinhas)}
                <button
                  type="button"
                  className={`mm-btn mm-btn--ghost ${s.btnSm}`}
                  disabled={offset + POR_PAGINA >= res.totalLinhas || carregando}
                  onClick={() => void consultar({ offset: offset + POR_PAGINA })}
                >
                  Próximo →
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function SecaoConsulta({ groupId }: { groupId: number }) {
  return (
    <>
      <div className={s.mh}>
        <h1>Consulta de memos</h1>
      </div>
      <p className={s.sub}>Para localizar um memo: escolha a categoria e o período. Clique no número do memo para abrir.</p>
      <ConsultaMemos groupId={groupId} />
    </>
  );
}

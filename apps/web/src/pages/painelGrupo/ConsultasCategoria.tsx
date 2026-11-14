import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type {
  DbConnection,
  DbConnectionListResponse,
  MemoContextCategory,
  QueryCategoria,
  QueryCategoriaParam,
  QueryCategoriaParamTipo,
} from "@mymemory/shared";
import { OPERADORES_SQL, gerarQueryPadraoMemos, queryPadraoDescricao, queryPadraoNome } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPatchJson, apiPostJson } from "../../api";
import { IconCheck, IconEdit, IconPlus, IconTrash, IconX } from "../../components/icons";
import { msgErro } from "./util";
import s from "./painel.module.css";

type ParamNovo = Omit<QueryCategoriaParam, "id" | "queryId" | "isActive" | "createdAt" | "updatedAt">;

const TIPOS: { v: QueryCategoriaParamTipo; nome: string }[] = [
  { v: "string", nome: "texto" },
  { v: "number", nome: "número" },
  { v: "date", nome: "data" },
  { v: "boolean", nome: "sim/não" },
  { v: "lista_texto", nome: "lista" },
];

const COMPARACAO: Record<string, string> = {
  "=": "igual",
  "!=": "diferente",
  LIKE: "contém",
  "NOT LIKE": "não contém",
  ">": "maior",
  ">=": "a partir de",
  "<": "menor",
  "<=": "até",
  IN: "está na lista",
  "NOT IN": "fora da lista",
  "IS NULL": "vazio",
  "IS NOT NULL": "preenchido",
  BETWEEN: "entre",
};

const nomeTipo = (t: string) => TIPOS.find((x) => x.v === t)?.nome ?? t;

/** Detecta :param (PostgreSQL) e @param (SQL Server) no SQL, com o operador de cada um. Mesma regra da tela antiga. */
function acharParametros(sql: string): ParamNovo[] {
  const SISTEMA = new Set(["userid", "groupid", "categoryid"]);
  const re = /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)|(?<!@)@([a-zA-Z][a-zA-Z0-9_]*)/g;
  const ops = new Map<string, string[]>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const nome = (m[1] ?? m[2]).toLowerCase();
    if (SISTEMA.has(nome)) continue;
    const antes = sql.slice(0, m.index).trimEnd();
    let op = "=";
    if (/\bNOT\s+IN\s*\(\s*$/i.test(antes)) op = "NOT IN";
    else if (/\bIN\s*\(\s*$/i.test(antes)) op = "IN";
    else if (/\bI?LIKE$/i.test(antes)) op = "LIKE";
    else if (/>=\s*$/.test(antes)) op = ">=";
    else if (/<=\s*$/.test(antes)) op = "<=";
    else if (/!=\s*$|<>\s*$/.test(antes)) op = "!=";
    else if (/>\s*$/.test(antes)) op = ">";
    else if (/<\s*$/.test(antes)) op = "<";
    if (!ops.has(nome)) ops.set(nome, []);
    ops.get(nome)!.push(op);
  }
  const lista: ParamNovo[] = [];
  let ordem = 0;
  for (const [nome, o] of ops) {
    const operadorSql = o.find((x) => x !== "=") ?? "=";
    let tipo: QueryCategoriaParamTipo = "string";
    if (/^(id$|.*_id$|userid|groupid)/.test(nome)) tipo = "number";
    else if (/data|date|lancamento|vencimento|emissao/.test(nome)) tipo = "date";
    else if (operadorSql === "IN" || operadorSql === "NOT IN") tipo = "lista_texto";
    lista.push({ campo: nome, tipo, obrigatorio: 0, operadorSql, normalizar: 0, ordem: ordem++ });
  }
  return lista;
}

interface Props {
  cat: MemoContextCategory;
  /** null = categorias globais. */
  groupId: number | null;
  isAdmin: boolean;
  podeEditar: boolean;
  recarregar: () => Promise<void>;
}

/** Aba Consultas: query padrão dos memos e queries do ERP da categoria, com edição no próprio painel. */
export default function ConsultasCategoria({ cat, groupId, isAdmin, podeEditar, recarregar }: Props) {
  const [editando, setEditando] = useState<number | "nova" | null>(null);
  const [conexoes, setConexoes] = useState<DbConnection[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [voltando, setVoltando] = useState<number | null>(null);

  useEffect(() => {
    setEditando(null);
    setOk(null);
    setErro(null);
  }, [cat.id]);

  useEffect(() => {
    const url = !isAdmin && groupId != null ? `/api/groups/${groupId}/db-connections` : "/api/admin/db-connections";
    apiGet<DbConnectionListResponse>(url)
      .then((r) => setConexoes(r.connections.filter((c) => c.isActive === 1 && (c.groupId == null || c.groupId === groupId || !isAdmin))))
      .catch(() => setConexoes([]));
  }, [groupId, isAdmin]);

  const nomeConexao = (q: QueryCategoria) => {
    if (q.conexaoPendente) return null;
    if (q.conexaoId == null) return "memos do proMemory";
    return conexoes.find((c) => c.id === q.conexaoId)?.nome ?? `conexão #${q.conexaoId}`;
  };

  async function voltarAoAutomatico(q: QueryCategoria) {
    if (!window.confirm("Gerar de novo a query padrão a partir dos campos? O SQL editado à mão será substituído.")) return;
    setVoltando(q.id);
    setErro(null);
    try {
      const { sql } = gerarQueryPadraoMemos(cat.name, cat.campos, { campoSituacao: cat.atualizavel ? cat.campoSituacao : null });
      await apiPatchJson(`/api/memo-context/queries/${q.id}`, { nome: q.nome, descricao: q.descricao, sentencaSql: sql, conexaoId: null });
      await recarregar();
      setOk("A query padrão voltou ao automático.");
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setVoltando(null);
    }
  }

  async function excluir(q: QueryCategoria) {
    if (!window.confirm(`Excluir a query "${q.nome}"?`)) return;
    try {
      await apiDeleteJson(`/api/memo-context/queries/${q.id}`);
      await recarregar();
    } catch (e) {
      setErro(msgErro(e));
    }
  }

  async function criarPadrao() {
    setErro(null);
    try {
      const { sql, params } = gerarQueryPadraoMemos(cat.name, cat.campos, { campoSituacao: cat.atualizavel ? cat.campoSituacao : null });
      const { id } = await apiPostJson<{ id: number }>(`/api/memo-context/categories/${cat.id}/queries`, {
        nome: queryPadraoNome(cat.name),
        descricao: queryPadraoDescricao(cat.name),
        sentencaSql: sql,
        conexaoId: null,
      });
      for (const p of params) await apiPostJson(`/api/memo-context/queries/${id}/params`, p);
      await recarregar();
      setOk("Query padrão criada.");
    } catch (e) {
      setErro(msgErro(e));
    }
  }

  const temPadrao = cat.queries.some((q) => q.autoGerada || q.autoEditada);

  return (
    <div>
      <div className={s.row} style={{ marginBottom: 10 }}>
        <span className="mm-muted" style={{ fontSize: 12.5 }}>
          Como o Perguntar busca os dados desta categoria.
        </span>
        <span className={s.sp} />
        {podeEditar && editando == null ? (
          <button type="button" className={`mm-btn mm-btn--primary ${s.btnSm}`} onClick={() => setEditando("nova")}>
            <IconPlus size={13} /> Nova query
          </button>
        ) : null}
      </div>
      {ok ? <p className={s.msgOk}>{ok}</p> : null}
      {erro ? <p className={s.msgErr}>{erro}</p> : null}

      {podeEditar && !temPadrao && cat.campos.some((c) => c.isActive === 1) && editando == null ? (
        <div className={s.q} style={{ borderStyle: "dashed" }}>
          <div className={s.qHead}>
            <b>Sem query padrão dos memos</b>
            <span className={s.sp} />
            <button type="button" className={`mm-btn ${s.btnSm}`} onClick={() => void criarPadrao()}>
              Criar query padrão
            </button>
          </div>
          <p className={s.qDesc}>O proMemory monta a consulta dos memos a partir dos campos e mantém atualizada sozinha.</p>
        </div>
      ) : null}

      {cat.queries.length === 0 && editando == null ? <p className="mm-muted">Nenhuma query nesta categoria.</p> : null}

      {cat.queries.map((q) => (
          <div key={q.id} className={s.q} style={q.autoEditada ? { background: "var(--mm-warning-bg)" } : undefined}>
            <div className={s.qHead}>
              <b>{q.nome}</b>
              {q.autoGerada ? <span className={`${s.tag} ${s.tagOk}`}>Automática</span> : null}
              {q.autoEditada ? <span className={`${s.tag} ${s.tagWarn}`}>Editada à mão</span> : null}
              {q.conexaoPendente ? (
                <span className={`${s.tag} ${s.tagWarn}`}>escolha a conexão</span>
              ) : (
                <span className={`${s.tag} ${q.conexaoId != null ? s.tagInd : ""}`}>{nomeConexao(q)}</span>
              )}
              <span className="mm-muted" style={{ fontSize: 12 }}>
                · {q.params.length} parâmetro(s)
              </span>
              <span className={s.sp} />
              {podeEditar ? (
                <>
                  {q.autoEditada ? (
                    <button type="button" className={`mm-btn ${s.btnSm}`} disabled={voltando === q.id} onClick={() => void voltarAoAutomatico(q)}>
                      Voltar ao automático
                    </button>
                  ) : null}
                  <button type="button" className={`mm-btn ${s.btnSm}`} onClick={() => setEditando(q.id)}>
                    <IconEdit size={13} /> Editar
                  </button>
                  <button type="button" className={`${s.iconBtn} ${s.iconBtnDanger}`} title="Excluir query" onClick={() => void excluir(q)}>
                    <IconTrash size={15} />
                  </button>
                </>
              ) : null}
            </div>
            {q.descricao ? <p className={s.qDesc}>{q.descricao}</p> : null}
            {q.autoGerada ? (
              <p className={s.qDesc}>Criada e atualizada sozinha quando os campos mudam. Se você editar o SQL, ela vira "Editada à mão" e deixa de atualizar.</p>
            ) : null}
            {podeEditar ? (
              <button type="button" className={s.sqlBtn} title="Editar esta query" onClick={() => setEditando(q.id)}>
                <pre className={s.sql}>{q.sentencaSql}</pre>
                <span className={s.sqlBtnIcon} aria-hidden="true">
                  <IconEdit size={15} />
                </span>
              </button>
            ) : (
              <pre className={s.sql}>{q.sentencaSql}</pre>
            )}
            {q.params.length > 0 ? (
              <div className={s.tblWrap} style={{ marginTop: 8 }}>
                <table className={`${s.tbl} ${s.ptbl}`}>
                  <thead>
                    <tr>
                      <th>Parâmetro</th>
                      <th>Tipo</th>
                      <th>Comparação</th>
                      <th>Obrigatório</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.params.map((p) => (
                      <tr key={p.id}>
                        <td>{p.campo}</td>
                        <td>{nomeTipo(p.tipo)}</td>
                        <td>{COMPARACAO[p.operadorSql] ?? p.operadorSql}</td>
                        <td>{p.obrigatorio ? "sim" : "não"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
      ))}

      {typeof editando === "number" && cat.queries.some((q) => q.id === editando) ? (
        <EditorQuery
          key={editando}
          cat={cat}
          query={cat.queries.find((q) => q.id === editando) ?? null}
          conexoes={conexoes}
          groupId={groupId}
          isAdmin={isAdmin}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await recarregar();
            setOk("Query salva.");
          }}
        />
      ) : null}

      {editando === "nova" ? (
        <EditorQuery
          cat={cat}
          query={null}
          conexoes={conexoes}
          groupId={groupId}
          isAdmin={isAdmin}
          onFechar={() => setEditando(null)}
          onSalvo={async (perfis) => {
            setEditando(null);
            await recarregar();
            setOk(perfis?.length ? `Query criada. Os perfis ${perfis.join(", ")} passam a usar também esta consulta.` : "Query criada.");
          }}
        />
      ) : null}
    </div>
  );
}

interface EditorProps {
  cat: MemoContextCategory;
  query: QueryCategoria | null;
  conexoes: DbConnection[];
  groupId: number | null;
  isAdmin: boolean;
  onFechar: () => void;
  onSalvo: (perfisAfetados?: string[]) => Promise<void>;
}

/** Edição de uma query no próprio painel: nome, para que serve, conexão, SQL e parâmetros. */
function EditorQuery({ cat, query, conexoes, groupId, isAdmin, onFechar, onSalvo }: EditorProps) {
  const [nome, setNome] = useState(query?.nome ?? "");
  const [descricao, setDescricao] = useState(query?.descricao ?? "");
  const [sql, setSql] = useState(query?.sentencaSql ?? "");
  const [conexaoId, setConexaoId] = useState<number | null>(query?.conexaoPendente ? null : query?.conexaoId ?? null);
  const [pendente, setPendente] = useState(query?.conexaoPendente ?? false);
  const [params, setParams] = useState<(ParamNovo & { id?: number; apagar?: boolean })[]>(
    query?.params.map((p) => ({ id: p.id, campo: p.campo, tipo: p.tipo, obrigatorio: p.obrigatorio, operadorSql: p.operadorSql, normalizar: p.normalizar, ordem: p.ordem })) ?? []
  );
  const [sintaxe, setSintaxe] = useState<{ ok: boolean; message: string } | "testando" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Editor de query existente + "Gerar SQL padrão": o servidor recria os parâmetros ao salvar. */
  const [padraoGerado, setPadraoGerado] = useState(false);

  function achar() {
    const achados = acharParametros(sql);
    const existentes = new Set(params.filter((p) => !p.apagar).map((p) => p.campo.toLowerCase()));
    const novos = achados.filter((p) => !existentes.has(p.campo));
    if (novos.length === 0) {
      setAviso(achados.length ? "Todos os parâmetros do SQL já estão na tabela." : "Nenhum :parametro ou @parametro no SQL.");
      return;
    }
    setParams((ps) => [...ps, ...novos.map((p, i) => ({ ...p, ordem: ps.length + i }))]);
    setAviso(`${novos.length} parâmetro(s) acrescentado(s). Confira e salve.`);
  }

  function gerarPadrao() {
    const g = gerarQueryPadraoMemos(cat.name, cat.campos, { campoSituacao: cat.atualizavel ? cat.campoSituacao : null });
    setSql(g.sql);
    setConexaoId(null);
    setPendente(false);
    if (!query) {
      setNome(queryPadraoNome(cat.name));
      setDescricao(queryPadraoDescricao(cat.name));
      setParams(g.params);
    } else {
      setPadraoGerado(true);
    }
    setAviso(query ? "SQL padrão gerado. Ao salvar, os parâmetros são recriados pelo sistema e a query volta a ser automática." : "SQL padrão gerado.");
  }

  async function testar() {
    setSintaxe("testando");
    try {
      const url = !conexaoId
        ? "/api/memo-context/syntax-check"
        : !isAdmin && groupId != null
          ? `/api/groups/${groupId}/db-connections/${conexaoId}/syntax-check`
          : `/api/admin/db-connections/${conexaoId}/syntax-check`;
      setSintaxe(await apiPostJson<{ ok: boolean; message: string }>(url, { sentencaSql: sql }));
    } catch (e) {
      setSintaxe({ ok: false, message: msgErro(e, "Erro ao verificar.") });
    }
  }

  async function salvar() {
    setErro(null);
    if (!nome.trim()) return setErro("Dê um nome para a query.");
    if (!sql.trim()) return setErro("Escreva o SQL.");
    if (pendente) return setErro("Escolha a conexão desta query.");
    setSalvando(true);
    try {
      const corpo = { nome: nome.trim(), descricao: descricao.trim() || null, sentencaSql: sql.trim(), conexaoId };
      let perfis: string[] | undefined;
      let qid: number;
      if (query) {
        await apiPatchJson(`/api/memo-context/queries/${query.id}`, corpo);
        qid = query.id;
      } else {
        const r = await apiPostJson<{ id: number; perfisAfetados?: string[] }>(`/api/memo-context/categories/${cat.id}/queries`, corpo);
        qid = r.id;
        perfis = r.perfisAfetados;
      }
      for (const p of padraoGerado ? [] : params) {
        const { id, apagar, ...dados } = p;
        if (id != null && apagar) {
          await apiDeleteJson(`/api/memo-context/queries-params/${id}`);
        } else if (id != null) {
          const orig = query?.params.find((x) => x.id === id);
          const mudou =
            !orig ||
            orig.campo !== dados.campo ||
            orig.tipo !== dados.tipo ||
            orig.obrigatorio !== dados.obrigatorio ||
            orig.operadorSql !== dados.operadorSql ||
            orig.normalizar !== dados.normalizar ||
            orig.ordem !== dados.ordem;
          if (mudou) await apiPatchJson(`/api/memo-context/queries-params/${id}`, dados);
        } else if (!apagar && dados.campo.trim()) {
          try {
            await apiPostJson(`/api/memo-context/queries/${qid}/params`, { ...dados, campo: dados.campo.trim() });
          } catch (e) {
            // Ao salvar a query padrão o servidor já recria os parâmetros
            if (!(e instanceof Error && e.message.includes("já existe nesta query"))) throw e;
          }
        }
      }
      await onSalvo(perfis);
    } catch (e) {
      setErro(msgErro(e, "Falha ao salvar."));
    } finally {
      setSalvando(false);
    }
  }

  const setParam = (i: number, mud: Partial<ParamNovo & { apagar?: boolean }>) => setParams((ps) => ps.map((p, j) => (j === i ? { ...p, ...mud } : p)));
  const grupoConexoes = conexoes.filter((c) => c.groupId != null);
  const globais = conexoes.filter((c) => c.groupId == null);

  return createPortal(
    <div className="mm-modal-overlay" role="presentation">
    <div className={`mm-modal ${s.modalQuery}`} role="dialog" aria-modal="true" aria-labelledby="q-tit">
      <div className={s.modalHead}>
        <h2 id="q-tit">{query ? `Editar query: ${query.nome}` : `Nova query em ${cat.name}`}</h2>
        <span className={s.sp} />
        <button type="button" className={s.iconBtn} aria-label="Fechar" onClick={onFechar}>
          <IconX />
        </button>
      </div>
      <div className={s.grid2}>
        <div>
          <label className={s.fieldLabel} htmlFor="q-nome">
            Nome
          </label>
          <input id="q-nome" className="mm-field" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div>
          <label className={s.fieldLabel} htmlFor="q-cx">
            Onde busca (conexão)
          </label>
          <select
            id="q-cx"
            className="mm-field"
            value={pendente ? "pendente" : conexaoId ?? ""}
            onChange={(e) => {
              setPendente(false);
              setConexaoId(e.target.value === "" || e.target.value === "pendente" ? null : Number(e.target.value));
            }}
          >
            {pendente ? <option value="pendente">— escolha a conexão —</option> : null}
            <option value="">Memos do proMemory</option>
            {grupoConexoes.length ? (
              <optgroup label="ERP deste grupo">
                {grupoConexoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {globais.length ? (
              <optgroup label="Conexões globais (admin)">
                {globais.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <p className={s.help}>Servidor, banco e senha ficam em Ligação com o ERP.</p>
        </div>
      </div>
      <label className={s.fieldLabel} htmlFor="q-desc">
        Para que serve (a IA lê para escolher esta query)
      </label>
      <input id="q-desc" className="mm-field" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      <div className={s.row} style={{ marginTop: 12 }}>
        <label className={s.fieldLabel} htmlFor="q-sql" style={{ margin: 0 }}>
          SQL
        </label>
        <span className={s.sp} />
        <button type="button" className={`mm-btn mm-btn--ghost ${s.btnSm}`} onClick={gerarPadrao} title="Monta o SQL dos memos a partir dos campos da categoria">
          Gerar SQL padrão dos memos
        </button>
      </div>
      <textarea
        id="q-sql"
        className={`mm-field ${s.sqlEdit}`}
        style={{ marginTop: 4 }}
        value={sql}
        spellCheck={false}
        onChange={(e) => {
          setSql(e.target.value);
          setSintaxe(null);
          setPadraoGerado(false);
        }}
        placeholder="SELECT … WHERE campo = :parametro"
      />
      <p className={s.help}>Use :nome (PostgreSQL) ou @nome (SQL Server) para os parâmetros que a IA preenche a partir da pergunta.</p>
      <div className={s.row} style={{ marginTop: 8 }}>
        <button type="button" className={`mm-btn ${s.btnSm}`} onClick={achar}>
          Achar parâmetros no SQL
        </button>
        <button type="button" className={`mm-btn ${s.btnSm}`} disabled={sintaxe === "testando" || !sql.trim()} onClick={() => void testar()}>
          <IconCheck size={13} /> {sintaxe === "testando" ? "Testando…" : "Testar o SQL"}
        </button>
        {sintaxe && sintaxe !== "testando" ? (
          <span className={`${s.tag} ${sintaxe.ok ? s.tagOk : s.tagWarn}`} style={{ whiteSpace: "normal" }}>
            {sintaxe.ok ? "SQL sem erro" : sintaxe.message}
          </span>
        ) : null}
      </div>
      {aviso ? <p className={s.help}>{aviso}</p> : null}

      <p className={s.fieldLabel}>Parâmetros</p>
      <div className={s.tblWrap}>
        <table className={`${s.tbl} ${s.ptbl}`}>
          <thead>
            <tr>
              <th>Parâmetro</th>
              <th>Tipo</th>
              <th>Comparação</th>
              <th>Obrig.</th>
              <th title="Padroniza o valor (sem acento e maiúsculas)">Normalizar</th>
              <th>Ordem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) =>
              p.apagar ? null : (
                <tr key={p.id ?? `n${i}`}>
                  <td>
                    <input className="mm-field" style={{ padding: "3px 6px", minWidth: 90 }} value={p.campo} onChange={(e) => setParam(i, { campo: e.target.value })} />
                  </td>
                  <td>
                    <select className="mm-field" style={{ padding: "3px 6px" }} value={p.tipo} onChange={(e) => setParam(i, { tipo: e.target.value as QueryCategoriaParamTipo })}>
                      {TIPOS.map((t) => (
                        <option key={t.v} value={t.v}>
                          {t.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="mm-field" style={{ padding: "3px 6px" }} value={p.operadorSql} onChange={(e) => setParam(i, { operadorSql: e.target.value })}>
                      {OPERADORES_SQL.map((o) => (
                        <option key={o} value={o}>
                          {COMPARACAO[o] ?? o} ({o})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" checked={p.obrigatorio === 1} onChange={(e) => setParam(i, { obrigatorio: e.target.checked ? 1 : 0 })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={p.normalizar === 1} onChange={(e) => setParam(i, { normalizar: e.target.checked ? 1 : 0 })} />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="mm-field"
                      style={{ padding: "3px 6px", width: 56 }}
                      value={p.ordem}
                      min={0}
                      onChange={(e) => setParam(i, { ordem: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                  <td>
                    <button type="button" className={`${s.iconBtn} ${s.iconBtnDanger}`} title="Tirar parâmetro" onClick={() => setParam(i, { apagar: true })}>
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              )
            )}
            {params.filter((p) => !p.apagar).length === 0 ? (
              <tr>
                <td colSpan={7} className="mm-muted">
                  Nenhum parâmetro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className={`mm-btn mm-btn--ghost ${s.btnSm}`}
        style={{ marginTop: 6 }}
        onClick={() => setParams((ps) => [...ps, { campo: "", tipo: "string", obrigatorio: 0, operadorSql: "=", normalizar: 0, ordem: ps.length }])}
      >
        <IconPlus size={13} /> Parâmetro
      </button>

      {erro ? <p className={s.msgErr}>{erro}</p> : null}
      <div className={s.actions}>
        <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar}>
          Cancelar
        </button>
        <button type="button" className="mm-btn mm-btn--primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
    </div>,
    document.body
  );
}

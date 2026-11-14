import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  MemoContextCampo,
  MemoContextCampoTipo,
  MemoContextCategory,
  MemoContextMediaType,
  MemoContextStructureResponse,
  PainelGrupoContagensResponse,
} from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPatchJson, apiPostJson } from "../../api";
import LembretesModal from "../../components/LembretesModal";
import { IconBell, IconCopy, IconEdit, IconPlus, IconSearch, IconTrash, IconX } from "../../components/icons";
import ConsultasCategoria from "./ConsultasCategoria";
import { ConsultaMemos, SEM_CATEGORIA } from "./SecaoConsulta";
import { msgErro } from "./util";
import s from "./painel.module.css";

const MIDIAS: { v: MemoContextMediaType | ""; nome: string }[] = [
  { v: "", nome: "Qualquer mídia" },
  { v: "text", nome: "Texto" },
  { v: "audio", nome: "Áudio" },
  { v: "image", nome: "Imagem" },
  { v: "video", nome: "Vídeo" },
  { v: "document", nome: "Documento" },
  { v: "url", nome: "URL" },
];

const TIPO_CAMPO: Record<MemoContextCampoTipo, string> = { text: "texto", date: "data", number: "número" };

type Aba = "campos" | "lembrete" | "memos" | "consultas";

interface Props {
  /** null = categorias globais (admin). */
  groupId: number | null;
  isAdmin: boolean;
  onTotal: (n: number | null) => void;
}

export default function SecaoCategorias({ groupId, isAdmin, onTotal }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cats, setCats] = useState<MemoContextCategory[] | null>(null);
  const [podeEditarGrupo, setPodeEditarGrupo] = useState(false);
  const [contagens, setContagens] = useState<PainelGrupoContagensResponse | null>(null);
  const [lembretesAtivos, setLembretesAtivos] = useState<Set<number>>(new Set());
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [modal, setModal] = useState<"nova" | "copiar" | null>(null);

  const selParam = searchParams.get("categoria");
  const selId = selParam === "sem" ? "sem" : selParam ? Number(selParam) : null;
  const [aba, setAba] = useState<Aba>("campos");

  const selecionar = (id: number | "sem" | null) => {
    const p = new URLSearchParams(searchParams);
    if (id == null) p.delete("categoria");
    else p.set("categoria", String(id));
    setSearchParams(p, { replace: true });
    setAba(id === "sem" ? "memos" : "campos");
  };

  const carregar = useCallback(async () => {
    try {
      const qs = groupId != null ? `?groupId=${groupId}` : "";
      const r = await apiGet<MemoContextStructureResponse>(`/api/memo-context/structure${qs}`);
      const ativas = r.categories.filter((c) => c.isActive === 1);
      setCats(ativas);
      setPodeEditarGrupo(r.capabilities.canEditStructure);
      onTotal(ativas.length);
      setErro(null);
    } catch (e) {
      setErro(msgErro(e, "Não foi possível carregar as categorias."));
    }
  }, [groupId, onTotal]);

  useEffect(() => {
    setCats(null);
    void carregar();
    if (groupId != null) {
      apiGet<PainelGrupoContagensResponse>(`/api/painel-grupo/${groupId}/contagens`)
        .then(setContagens)
        .catch(() => setContagens(null));
      apiGet<{ categoriasAtivas: number[] }>(`/api/memo-context/lembretes/resumo?groupId=${groupId}`)
        .then((r) => setLembretesAtivos(new Set(r.categoriasAtivas)))
        .catch(() => setLembretesAtivos(new Set()));
    } else {
      setContagens(null);
    }
  }, [groupId, carregar]);

  const podeEditar = (c: MemoContextCategory) => podeEditarGrupo && (c.groupId != null || isAdmin);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const lista = (cats ?? []).filter((c) => !t || c.name.toLowerCase().includes(t) || (c.description ?? "").toLowerCase().includes(t));
    // Do grupo primeiro, globais depois
    return lista.sort((a, b) => Number(a.groupId == null) - Number(b.groupId == null) || a.name.localeCompare(b.name, "pt-BR"));
  }, [cats, busca]);

  const sel = typeof selId === "number" ? cats?.find((c) => c.id === selId) ?? null : null;
  const drawerAberto = sel != null || selId === "sem";

  return (
    <>
      <div className={s.mh}>
        <h1>{groupId == null ? "Categorias globais" : "Categorias"}</h1>
        <span className={s.sp} />
        <label className={s.search}>
          <IconSearch />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar categoria" />
        </label>
        {isAdmin && groupId != null ? (
          <button type="button" className="mm-btn" onClick={() => setModal("copiar")}>
            <IconCopy /> Copiar das globais
          </button>
        ) : null}
        {podeEditarGrupo ? (
          <button type="button" className="mm-btn mm-btn--primary" onClick={() => setModal("nova")}>
            <IconPlus /> Nova categoria
          </button>
        ) : null}
      </div>
      <p className={s.sub}>
        {groupId == null
          ? "Valem para todos os grupos. Só o administrador do sistema edita."
          : "A IA usa as categorias para organizar os memos e extrair os campos. Clique num cartão para abrir e editar."}
      </p>
      {erro ? <p className={s.msgErr}>{erro}</p> : null}
      {!cats && !erro ? <p className="mm-muted">Carregando…</p> : null}

      {cats ? (
        <div className={`${s.split} ${!drawerAberto ? s.splitClosed : sel && aba === "consultas" ? s.splitWide : ""}`}>
          <div className={s.cats}>
            {groupId != null && contagens && contagens.semCategoria > 0 && !busca ? (
              <button type="button" className={`${s.cat} ${s.catNone} ${selId === "sem" ? s.catOn : ""}`} onClick={() => selecionar("sem")}>
                <span className={s.catTop}>
                  <b>Sem categoria</b>
                </span>
                <p className={s.catDesc}>Memos em que a IA não achou categoria. Clique para ver e abrir cada um.</p>
                <span className={s.catTags}>
                  <span className={`${s.tag} ${s.tagWarn}`}>{contagens.semCategoria} memos</span>
                </span>
              </button>
            ) : null}
            {filtradas.map((c) => {
              const nMemos = contagens?.porCategoria[c.name];
              const temErp = c.queries.some((q) => q.conexaoId != null || q.conexaoPendente);
              return (
                <button key={c.id} type="button" className={`${s.cat} ${sel?.id === c.id ? s.catOn : ""}`} onClick={() => selecionar(c.id)}>
                  <span className={s.catTop}>
                    <b>{c.name}</b>
                    <span className={s.sp} />
                    {lembretesAtivos.has(c.id) ? (
                      <span className={`${s.tag} ${s.tagWarn}`}>
                        <IconBell size={11} /> Lembrete
                      </span>
                    ) : null}
                    {temErp ? <span className={`${s.tag} ${s.tagInd}`}>ERP</span> : null}
                    {c.groupId == null && groupId != null ? <span className={`${s.tag} ${s.tagWarn}`}>Global</span> : null}
                  </span>
                  <p className={s.catDesc}>{c.description || "Sem descrição."}</p>
                  <span className={s.catTags}>
                    <span className={s.tag}>
                      {(() => {
                        const n = c.campos.filter((x) => x.isActive === 1).length;
                        return `${n} ${n === 1 ? "campo" : "campos"}`;
                      })()}
                    </span>
                    {nMemos != null ? <span className={s.tag}>{nMemos} memos</span> : groupId != null ? <span className={s.tag}>0 memos</span> : null}
                    {c.pessoal ? <span className={s.tag}>pessoal</span> : null}
                    {c.atualizavel ? <span className={s.tag}>atualizável</span> : null}
                    {!podeEditar(c) ? <span className={s.tag}>só leitura</span> : null}
                  </span>
                </button>
              );
            })}
            {filtradas.length === 0 ? <p className="mm-muted">Nenhuma categoria{busca ? " com esse nome" : ""}.</p> : null}
          </div>

          {selId === "sem" && groupId != null ? (
            <aside className={s.drawer}>
              <div className={s.drawerHead}>
                <h2>
                  Sem categoria <span className={s.sp} />
                  <button type="button" className={s.iconBtn} aria-label="Fechar" onClick={() => selecionar(null)}>
                    <IconX />
                  </button>
                </h2>
                <p>Abra o memo pelo número para escolher a categoria dele.</p>
              </div>
              <div className={s.drawerBody}>
                <ConsultaMemos groupId={groupId} categoriaFixa={SEM_CATEGORIA} compacto />
              </div>
            </aside>
          ) : null}

          {sel ? (
            <aside className={s.drawer}>
              <div className={s.drawerHead}>
                <h2>
                  {sel.name}
                  {lembretesAtivos.has(sel.id) ? (
                    <span className={`${s.tag} ${s.tagWarn}`}>
                      <IconBell size={11} /> Lembrete ligado
                    </span>
                  ) : null}
                  <span className={s.sp} />
                  <button type="button" className={s.iconBtn} aria-label="Fechar" onClick={() => selecionar(null)}>
                    <IconX />
                  </button>
                </h2>
                <p>{sel.description || "Sem descrição."}</p>
                {podeEditar(sel) ? (
                  <div className={s.row} style={{ marginTop: 8 }}>
                    <EditarCategoriaBotao cat={sel} recarregar={carregar} aoExcluir={() => selecionar(null)} />
                  </div>
                ) : (
                  <p className={s.help}>{sel.groupId == null ? "Categoria global: só o administrador do sistema edita." : "Só leitura."}</p>
                )}
              </div>
              <div className={s.tabs} role="tablist">
                {(
                  [
                    ["campos", "Campos"],
                    ["lembrete", "Lembrete"],
                    ["memos", "Memos"],
                    ["consultas", "Consultas"],
                  ] as [Aba, string][]
                ).map(([id, nome]) => (
                  <button key={id} type="button" role="tab" aria-selected={aba === id} className={`${s.tab} ${aba === id ? s.tabOn : ""}`} onClick={() => setAba(id)}>
                    {nome}
                  </button>
                ))}
              </div>
              <div className={s.drawerBody}>
                {aba === "campos" ? <CamposCategoria cat={sel} podeEditar={podeEditar(sel)} recarregar={carregar} /> : null}
                {aba === "lembrete" ? (
                  sel.groupId == null || groupId == null ? (
                    <p className="mm-muted">Lembretes só existem em categorias do grupo (esta é global).</p>
                  ) : !sel.campos.some((c) => c.isActive === 1) ? (
                    <p className="mm-muted">Crie um campo de data na categoria para ligar os lembretes.</p>
                  ) : podeEditar(sel) ? (
                    <LembretesModal
                      key={sel.id}
                      inline
                      categoryId={sel.id}
                      categoryName={sel.name}
                      campos={sel.campos}
                      onClose={() => {
                        /* inline: nada a fechar */
                      }}
                    />
                  ) : (
                    <p className="mm-muted">Só o dono do grupo configura os lembretes.</p>
                  )
                ) : null}
                {aba === "memos" ? (
                  groupId != null ? (
                    <ConsultaMemos key={sel.id} groupId={groupId} categoriaFixa={sel.name} compacto />
                  ) : (
                    <p className="mm-muted">Abra um grupo para ver os memos desta categoria.</p>
                  )
                ) : null}
                {aba === "consultas" ? (
                  <ConsultasCategoria cat={sel} groupId={groupId} isAdmin={isAdmin} podeEditar={podeEditar(sel)} recarregar={carregar} />
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}

      {modal === "nova" ? (
        <NovaCategoriaModal
          groupId={groupId}
          onFechar={() => setModal(null)}
          onCriada={async (id) => {
            setModal(null);
            await carregar();
            selecionar(id);
          }}
        />
      ) : null}
      {modal === "copiar" && groupId != null && cats ? (
        <CopiarGlobaisModal
          groupId={groupId}
          jaNoGrupo={new Set(cats.filter((c) => c.groupId != null).map((c) => c.name.toLowerCase()))}
          onFechar={() => setModal(null)}
          onCopiado={async () => {
            setModal(null);
            await carregar();
          }}
        />
      ) : null}
    </>
  );
}

/* ── Campos ───────────────────────────────────────────────────────── */

function CamposCategoria({ cat, podeEditar, recarregar }: { cat: MemoContextCategory; podeEditar: boolean; recarregar: () => Promise<void> }) {
  const [editando, setEditando] = useState<MemoContextCampo | "novo" | null>(null);
  const [subEditando, setSubEditando] = useState<{ id: number | null; name: string; description: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const campos = cat.campos.filter((c) => c.isActive === 1);
  const subs = cat.subcategories.filter((x) => x.isActive === 1);

  async function excluirCampo(c: MemoContextCampo) {
    if (!window.confirm(`Excluir o campo "${c.name}"? Os memos já gravados continuam com o valor.`)) return;
    try {
      await apiDeleteJson(`/api/memo-context/campos/${c.id}`);
      await recarregar();
    } catch (e) {
      setErro(msgErro(e));
    }
  }

  async function salvarSub() {
    if (!subEditando || !subEditando.name.trim()) return;
    try {
      const corpo = { name: subEditando.name.trim(), description: subEditando.description.trim() || null };
      if (subEditando.id == null) await apiPostJson(`/api/memo-context/categories/${cat.id}/subcategories`, corpo);
      else await apiPatchJson(`/api/memo-context/subcategories/${subEditando.id}`, corpo);
      setSubEditando(null);
      await recarregar();
    } catch (e) {
      setErro(msgErro(e));
    }
  }

  async function excluirSub(id: number, nome: string) {
    if (!window.confirm(`Excluir a subcategoria "${nome}"?`)) return;
    try {
      await apiDeleteJson(`/api/memo-context/subcategories/${id}`);
      await recarregar();
    } catch (e) {
      setErro(msgErro(e));
    }
  }

  return (
    <>
      <div className={s.row} style={{ marginBottom: 4 }}>
        <span className="mm-muted" style={{ fontSize: 12.5 }}>
          O que a IA tira de cada memo desta categoria
        </span>
        <span className={s.sp} />
        {podeEditar ? (
          <button type="button" className={`mm-btn ${s.btnSm}`} onClick={() => setEditando("novo")}>
            <IconPlus size={13} /> Campo
          </button>
        ) : null}
      </div>
      {erro ? <p className={s.msgErr}>{erro}</p> : null}
      {campos.length === 0 ? <p className="mm-muted">Nenhum campo ainda.</p> : null}
      {campos.map((c) => (
        <div key={c.id} className={s.fieldRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>
              {c.name} <span className={s.tag} style={{ marginLeft: 4 }}>{TIPO_CAMPO[c.tipo ?? "text"]}</span>
              {c.resolucaoNomeAbrev ? (
                <span className={`${s.tag} ${s.tagInd}`} style={{ marginLeft: 4 }}>
                  nome do ERP
                </span>
              ) : null}
            </b>
            {c.description ? <small>{c.description}</small> : null}
            {c.normalizedTerms ? <small>Valores: {c.normalizedTerms}</small> : null}
          </div>
          {podeEditar ? (
            <>
              <button type="button" className={s.iconBtn} title="Editar campo" onClick={() => setEditando(c)}>
                <IconEdit />
              </button>
              <button type="button" className={`${s.iconBtn} ${s.iconBtnDanger}`} title="Excluir campo" onClick={() => void excluirCampo(c)}>
                <IconTrash />
              </button>
            </>
          ) : null}
        </div>
      ))}

      <div className={s.row} style={{ marginTop: 18, marginBottom: 4 }}>
        <span className={s.sectionTitle} style={{ margin: 0 }}>
          Subcategorias
        </span>
        <span className={s.sp} />
        {podeEditar ? (
          <button type="button" className={`mm-btn mm-btn--ghost ${s.btnSm}`} onClick={() => setSubEditando({ id: null, name: "", description: "" })}>
            <IconPlus size={13} /> Subcategoria
          </button>
        ) : null}
      </div>
      {subs.length === 0 && !subEditando ? <p className="mm-muted" style={{ fontSize: 12.5 }}>Nenhuma.</p> : null}
      {subs.map((x) =>
        subEditando?.id === x.id ? null : (
          <div key={x.id} className={s.fieldRow}>
            <div style={{ flex: 1 }}>
              <b>{x.name}</b>
              {x.description ? <small>{x.description}</small> : null}
            </div>
            {podeEditar ? (
              <>
                <button type="button" className={s.iconBtn} title="Editar" onClick={() => setSubEditando({ id: x.id, name: x.name, description: x.description ?? "" })}>
                  <IconEdit />
                </button>
                <button type="button" className={`${s.iconBtn} ${s.iconBtnDanger}`} title="Excluir" onClick={() => void excluirSub(x.id, x.name)}>
                  <IconTrash />
                </button>
              </>
            ) : null}
          </div>
        )
      )}
      {subEditando ? (
        <div className={s.q} style={{ marginTop: 8 }}>
          <input className="mm-field" placeholder="Nome da subcategoria" value={subEditando.name} onChange={(e) => setSubEditando({ ...subEditando, name: e.target.value })} />
          <input
            className="mm-field"
            style={{ marginTop: 6 }}
            placeholder="Descrição (opcional)"
            value={subEditando.description}
            onChange={(e) => setSubEditando({ ...subEditando, description: e.target.value })}
          />
          <div className={s.actions} style={{ marginTop: 8 }}>
            <button type="button" className={`mm-btn mm-btn--ghost ${s.btnSm}`} onClick={() => setSubEditando(null)}>
              Cancelar
            </button>
            <button type="button" className={`mm-btn mm-btn--primary ${s.btnSm}`} disabled={!subEditando.name.trim()} onClick={() => void salvarSub()}>
              Salvar
            </button>
          </div>
        </div>
      ) : null}

      {editando ? (
        <CampoModal
          categoryId={cat.id}
          campo={editando === "novo" ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await recarregar();
          }}
        />
      ) : null}
    </>
  );
}

function CampoModal({ categoryId, campo, onFechar, onSalvo }: { categoryId: number; campo: MemoContextCampo | null; onFechar: () => void; onSalvo: () => Promise<void> }) {
  const [name, setName] = useState(campo?.name ?? "");
  const [desc, setDesc] = useState(campo?.description ?? "");
  const [tipo, setTipo] = useState<MemoContextCampoTipo>(campo?.tipo ?? "text");
  const [termos, setTermos] = useState(campo?.normalizedTerms ?? "");
  const [nomeErp, setNomeErp] = useState(campo?.resolucaoNomeAbrev ?? false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!name.trim()) return setErro("Informe o nome do campo.");
    setBusy(true);
    setErro(null);
    try {
      const corpo = { name: name.trim(), description: desc.trim() || null, tipo, normalizedTerms: termos.trim() || null, resolucaoNomeAbrev: nomeErp };
      if (campo) {
        const r = await apiPatchJson<{ renomeado?: { de: string; para: string; memos: number; queries: number } }>(`/api/memo-context/campos/${campo.id}`, corpo);
        if (r?.renomeado) {
          const x = r.renomeado;
          window.alert(`Campo "${x.de}" renomeado para "${x.para}". Atualizados: ${x.memos} memo(s) e ${x.queries} query(s) da categoria.`);
        }
      } else {
        await apiPostJson(`/api/memo-context/categories/${categoryId}/campos`, corpo);
      }
      await onSalvo();
    } catch (e) {
      setErro(msgErro(e, "Falha ao salvar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`mm-modal ${s.modal}`} role="dialog" aria-modal="true" aria-labelledby="campo-tit">
        <div className={s.modalHead}>
          <h2 id="campo-tit">{campo ? `Editar campo ${campo.name}` : "Novo campo"}</h2>
          <span className={s.sp} />
          <button type="button" className={s.iconBtn} onClick={onFechar} aria-label="Fechar">
            <IconX />
          </button>
        </div>
        <label className={s.fieldLabel} htmlFor="cp-nome">
          Nome
        </label>
        <input id="cp-nome" className="mm-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Com_Quem" />
        {campo && name.trim() && name.trim() !== campo.name ? (
          <p className={s.help}>Ao renomear, os memos já gravados e as queries da categoria são atualizados.</p>
        ) : null}
        <label className={s.fieldLabel} htmlFor="cp-desc">
          O que a IA deve extrair (descrição)
        </label>
        <textarea id="cp-desc" className="mm-field" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="ex.: pessoas ou empresas com quem é o compromisso" />
        <div className={s.grid2}>
          <div>
            <label className={s.fieldLabel} htmlFor="cp-tipo">
              Tipo
            </label>
            <select id="cp-tipo" className="mm-field" value={tipo} onChange={(e) => setTipo(e.target.value as MemoContextCampoTipo)}>
              <option value="text">texto</option>
              <option value="date">data</option>
              <option value="number">número</option>
            </select>
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="cp-termos">
              Valores padronizados (opcional)
            </label>
            <input id="cp-termos" className="mm-field" value={termos} onChange={(e) => setTermos(e.target.value)} placeholder="ex.: pago, pendente, cancelado" />
          </div>
        </div>
        <label className={s.row} style={{ marginTop: 12, fontSize: 13.5 }}>
          <input type="checkbox" checked={nomeErp} onChange={(e) => setNomeErp(e.target.checked)} />
          Procurar o nome oficial no ERP (cliente ou produto pela abreviação)
        </label>
        {erro ? <p className={s.msgErr}>{erro}</p> : null}
        <div className={s.actions}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={() => void salvar()}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Editar / nova / copiar ──────────────────────────────────────── */

function EditarCategoriaBotao({ cat, recarregar, aoExcluir }: { cat: MemoContextCategory; recarregar: () => Promise<void>; aoExcluir: () => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" className={`mm-btn ${s.btnSm}`} onClick={() => setAberto(true)}>
        <IconEdit size={13} /> Editar categoria
      </button>
      <span className="mm-muted" style={{ fontSize: 12 }}>
        nome, descrição, pessoal, atualizável
      </span>
      {aberto ? <EditarCategoriaModal cat={cat} onFechar={() => setAberto(false)} recarregar={recarregar} aoExcluir={aoExcluir} /> : null}
    </>
  );
}

function EditarCategoriaModal({
  cat,
  onFechar,
  recarregar,
  aoExcluir,
}: {
  cat: MemoContextCategory;
  onFechar: () => void;
  recarregar: () => Promise<void>;
  aoExcluir: () => void;
}) {
  const [name, setName] = useState(cat.name);
  const [desc, setDesc] = useState(cat.description ?? "");
  const [midia, setMidia] = useState<MemoContextMediaType | "">(cat.mediaType ?? "");
  const [pessoal, setPessoal] = useState(!!cat.pessoal);
  const [campoDono, setCampoDono] = useState(cat.campoDono ?? "");
  const [atualizavel, setAtualizavel] = useState(!!cat.atualizavel);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campos = cat.campos.filter((c) => c.isActive === 1);

  async function salvar() {
    if (!name.trim()) return setErro("Informe o nome.");
    setBusy(true);
    setErro(null);
    try {
      await apiPatchJson(`/api/memo-context/categories/${cat.id}`, {
        name: name.trim(),
        description: desc.trim() || null,
        mediaType: midia === "" ? null : midia,
        pessoal,
        campoDono: pessoal ? campoDono || null : null,
        atualizavel,
      });
      await recarregar();
      onFechar();
    } catch (e) {
      setErro(msgErro(e, "Falha ao salvar."));
    } finally {
      setBusy(false);
    }
  }

  async function excluir() {
    if (!window.confirm(`Excluir a categoria "${cat.name}"? Os memos continuam, mas ficam sem esta categoria para novas classificações.`)) return;
    try {
      await apiDeleteJson(`/api/memo-context/categories/${cat.id}`);
      onFechar();
      aoExcluir();
      await recarregar();
    } catch (e) {
      setErro(msgErro(e, "Falha ao excluir."));
    }
  }

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`mm-modal ${s.modal}`} role="dialog" aria-modal="true" aria-labelledby="cat-tit">
        <div className={s.modalHead}>
          <h2 id="cat-tit">Editar categoria</h2>
          <span className={s.sp} />
          <button type="button" className={s.iconBtn} onClick={onFechar} aria-label="Fechar">
            <IconX />
          </button>
        </div>
        <label className={s.fieldLabel} htmlFor="ec-nome">
          Nome
        </label>
        <input id="ec-nome" className="mm-field" value={name} onChange={(e) => setName(e.target.value)} />
        <label className={s.fieldLabel} htmlFor="ec-desc">
          Descrição (a IA lê para decidir a categoria)
        </label>
        <textarea id="ec-desc" className="mm-field" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <label className={s.fieldLabel} htmlFor="ec-midia">
          Tipo de mídia
        </label>
        <select id="ec-midia" className="mm-field" value={midia} onChange={(e) => setMidia(e.target.value as MemoContextMediaType | "")}>
          {MIDIAS.map((m) => (
            <option key={m.v} value={m.v}>
              {m.nome}
            </option>
          ))}
        </select>

        <div className={s.switchRow} style={{ padding: "14px 0 8px" }}>
          <label htmlFor="ec-pessoal" style={{ cursor: "pointer" }}>
            <b>Pessoal: cada memo é de uma pessoa</b>
            <p>"Minha agenda" mostra só os memos da própria pessoa (para ver todos, pergunte "de todos").</p>
          </label>
          <input id="ec-pessoal" type="checkbox" role="switch" className={`${s.switch} ${s.switchRight}`} checked={pessoal} onChange={(e) => setPessoal(e.target.checked)} />
        </div>
        {pessoal ? (
          <div className={s.row} style={{ marginBottom: 6 }}>
            <label htmlFor="ec-dono" className="mm-muted" style={{ fontSize: 12.5 }}>
              Quem é o dono do memo:
            </label>
            <select id="ec-dono" className={`mm-field ${s.selectSm}`} value={campoDono} onChange={(e) => setCampoDono(e.target.value)}>
              <option value="">— nenhum campo —</option>
              {campos.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className={s.help} style={{ width: "100%" }}>
              Na importação em lote, o memo passa a ser do membro cujo e-mail ou nome está neste campo.
            </p>
          </div>
        ) : null}
        <div className={s.switchRow} style={{ padding: "10px 0" }}>
          <label htmlFor="ec-atual" style={{ cursor: "pointer" }}>
            <b>Atualizável: o memo muda de situação</b>
            <p>Ativo, Concluído ou Cancelado. Concluído e Cancelado não geram lembrete e só aparecem quando pedidos.</p>
          </label>
          <input id="ec-atual" type="checkbox" role="switch" className={`${s.switch} ${s.switchRight}`} checked={atualizavel} onChange={(e) => setAtualizavel(e.target.checked)} />
        </div>
        {erro ? <p className={s.msgErr}>{erro}</p> : null}
        <div className={s.actions} style={{ justifyContent: "space-between" }}>
          <button type="button" className="mm-btn mm-btn--ghost" style={{ color: "var(--mm-danger)" }} onClick={() => void excluir()}>
            Excluir categoria
          </button>
          <div className={s.row}>
            <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar}>
              Cancelar
            </button>
            <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={() => void salvar()}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NovaCategoriaModal({ groupId, onFechar, onCriada }: { groupId: number | null; onFechar: () => void; onCriada: (id: number) => Promise<void> }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [midia, setMidia] = useState<MemoContextMediaType | "">("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    if (!name.trim()) return setErro("Informe o nome.");
    setBusy(true);
    setErro(null);
    try {
      const r = await apiPostJson<{ id: number }>("/api/memo-context/categories", {
        groupId,
        name: name.trim(),
        description: desc.trim() || null,
        mediaType: midia === "" ? null : midia,
      });
      await onCriada(r.id);
    } catch (e) {
      setErro(msgErro(e, "Falha ao criar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`mm-modal ${s.modal}`} role="dialog" aria-modal="true" aria-labelledby="nc-tit">
        <div className={s.modalHead}>
          <h2 id="nc-tit">{groupId == null ? "Nova categoria global" : "Nova categoria"}</h2>
          <span className={s.sp} />
          <button type="button" className={s.iconBtn} onClick={onFechar} aria-label="Fechar">
            <IconX />
          </button>
        </div>
        <label className={s.fieldLabel} htmlFor="nc-nome">
          Nome
        </label>
        <input id="nc-nome" className="mm-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Agenda" autoFocus />
        <label className={s.fieldLabel} htmlFor="nc-desc">
          Descrição (a IA lê para decidir a categoria)
        </label>
        <textarea id="nc-desc" className="mm-field" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="ex.: compromissos, reuniões e visitas com data marcada" />
        <label className={s.fieldLabel} htmlFor="nc-midia">
          Tipo de mídia
        </label>
        <select id="nc-midia" className="mm-field" value={midia} onChange={(e) => setMidia(e.target.value as MemoContextMediaType | "")}>
          {MIDIAS.map((m) => (
            <option key={m.v} value={m.v}>
              {m.nome}
            </option>
          ))}
        </select>
        <p className={s.help}>Depois de criar, acrescente os campos que a IA deve extrair.</p>
        {erro ? <p className={s.msgErr}>{erro}</p> : null}
        <div className={s.actions}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={() => void criar()}>
            {busy ? "Criando…" : "Criar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopiarGlobaisModal({
  groupId,
  jaNoGrupo,
  onFechar,
  onCopiado,
}: {
  groupId: number;
  jaNoGrupo: Set<string>;
  onFechar: () => void;
  onCopiado: () => Promise<void>;
}) {
  const [globais, setGlobais] = useState<MemoContextCategory[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiGet<MemoContextStructureResponse>("/api/memo-context/structure")
      .then((r) => setGlobais(r.categories.filter((c) => c.isActive === 1 && c.groupId == null)))
      .catch((e) => setErro(msgErro(e)));
  }, []);

  async function copiar() {
    setBusy(true);
    setErro(null);
    try {
      await apiPostJson("/api/admin/memo-context/clone-categories", { categoryIds: [...marcadas], targetGroupId: groupId });
      await onCopiado();
    } catch (e) {
      setErro(msgErro(e, "Falha ao copiar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`mm-modal ${s.modal}`} role="dialog" aria-modal="true" aria-labelledby="cp-tit">
        <div className={s.modalHead}>
          <h2 id="cp-tit">Copiar das categorias globais</h2>
          <span className={s.sp} />
          <button type="button" className={s.iconBtn} onClick={onFechar} aria-label="Fechar">
            <IconX />
          </button>
        </div>
        <p className={s.help} style={{ marginBottom: 10 }}>
          A cópia vira uma categoria do grupo, com os campos e as queries, e pode ser mudada sem afetar a global.
        </p>
        {!globais && !erro ? <p className="mm-muted">Carregando…</p> : null}
        {globais?.map((c) => {
          const ja = jaNoGrupo.has(c.name.toLowerCase());
          return (
            <label key={c.id} className={s.fieldRow} style={{ cursor: ja ? "default" : "pointer", opacity: ja ? 0.55 : 1 }}>
              <input
                type="checkbox"
                disabled={ja}
                checked={marcadas.has(c.id)}
                onChange={(e) =>
                  setMarcadas((m) => {
                    const n = new Set(m);
                    if (e.target.checked) n.add(c.id);
                    else n.delete(c.id);
                    return n;
                  })
                }
              />
              <div style={{ flex: 1 }}>
                <b>{c.name}</b>
                <small>{ja ? "já existe no grupo" : c.description ?? ""}</small>
              </div>
            </label>
          );
        })}
        {erro ? <p className={s.msgErr}>{erro}</p> : null}
        <div className={s.actions}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={busy || marcadas.size === 0} onClick={() => void copiar()}>
            {busy ? "Copiando…" : `Copiar ${marcadas.size || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { apiDeleteJson, apiPatchJson, apiPostJson, apiPutJson } from "../../api";
import { IconCopy, IconEdit, IconPlus, IconTrash, IconX } from "../../components/icons";
import type { Matriz, PerfilAcesso } from "./perfisApi";
import { msgPerfil } from "./perfisApi";
import { corDe, iniciais } from "./util";
import s from "./painel.module.css";

interface Props {
  groupId: number;
  matriz: Matriz | null;
  erroMatriz: string | null;
  recarregar: () => Promise<void>;
}

interface Rascunho {
  todas: boolean;
  incluiSemCategoria: boolean;
  categoriaIds: number[];
}

const rascunhoDe = (p: PerfilAcesso): Rascunho => ({ todas: p.todas, incluiSemCategoria: p.incluiSemCategoria, categoriaIds: [...p.categoriaIds] });

function mudou(p: PerfilAcesso, r: Rascunho): boolean {
  if (p.todas !== r.todas || p.incluiSemCategoria !== r.incluiSemCategoria) return true;
  return [...p.categoriaIds].sort((a, b) => a - b).join(",") !== [...r.categoriaIds].sort((a, b) => a - b).join(",");
}

function resumo(p: PerfilAcesso, totalCats: number): { texto: string; alerta: boolean } {
  if (p.todas) return { texto: "Tudo: todas as categorias.", alerta: false };
  const n = p.categoriaIds.length;
  if (n === 0 && !p.incluiSemCategoria) return { texto: "Nenhuma categoria: não responde nada.", alerta: true };
  const partes = [`${n} de ${totalCats} categorias`];
  if (p.incluiSemCategoria) partes.push("memos sem categoria");
  return { texto: `${partes.join(" + ")}.`, alerta: false };
}

/** Perfis de acesso: um perfil por vez, com as pessoas dele e as categorias que ele alcança. */
export default function SecaoPerfis({ groupId, matriz, erroMatriz, recarregar }: Props) {
  const [selId, setSelId] = useState<number | null>(null);
  const [rasc, setRasc] = useState<Rascunho | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  const base = `/api/groups/${groupId}/perfis`;
  const perfis = matriz?.perfis ?? [];
  const sel = perfis.find((p) => p.id === selId) ?? perfis.find((p) => p.padrao) ?? perfis[0] ?? null;

  useEffect(() => {
    if (sel) setRasc(rascunhoDe(sel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, matriz]);

  const pessoasDoPerfil = useMemo(() => (matriz && sel ? matriz.membros.filter((m) => m.perfilEfetivoId === sel.id) : []), [matriz, sel]);
  const outrasPessoas = useMemo(() => (matriz && sel ? matriz.membros.filter((m) => m.perfilEfetivoId !== sel.id) : []), [matriz, sel]);

  if (!matriz) return <p className={erroMatriz ? s.msgErr : "mm-muted"}>{erroMatriz ?? "Carregando perfis…"}</p>;

  const padrao = perfis.find((p) => p.padrao);
  const sujo = sel && rasc ? mudou(sel, rasc) : false;

  async function executar(acao: () => Promise<unknown>, sucesso?: string) {
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      await acao();
      if (sucesso) setOk(sucesso);
      await recarregar();
    } catch (e) {
      setErro(msgPerfil(e));
    } finally {
      setOcupado(false);
    }
  }

  async function salvar() {
    if (!sel || !rasc) return;
    if (sel.padrao && sel.pessoas > 0 && !window.confirm(`Mudar o perfil padrão "${sel.nome}" muda o acesso de ${sel.pessoas} pessoa(s) de uma vez. Continuar?`)) return;
    await executar(() => apiPatchJson(`${base}/${sel.id}`, { nome: sel.nome, ...rasc }), "Perfil salvo.");
  }

  async function novo() {
    const nome = window.prompt("Nome do novo perfil:");
    if (!nome?.trim()) return;
    await executar(async () => {
      const r = await apiPostJson<{ id: number }>(base, { nome: nome.trim(), categoriaIds: [] });
      setSelId(r.id);
    }, `Perfil "${nome.trim()}" criado. Marque as categorias e salve.`);
  }

  async function duplicar() {
    if (!sel || !rasc) return;
    const nome = window.prompt(`Nome do novo perfil (cópia de "${sel.nome}"):`, `${sel.nome} (cópia)`);
    if (!nome?.trim()) return;
    await executar(async () => {
      const r = await apiPostJson<{ id: number }>(base, { nome: nome.trim(), ...rasc });
      setSelId(r.id);
    }, `Perfil "${nome.trim()}" criado.`);
  }

  async function renomear() {
    if (!sel) return;
    const nome = window.prompt("Novo nome do perfil:", sel.nome);
    if (!nome?.trim() || nome.trim() === sel.nome) return;
    await executar(
      () => apiPatchJson(`${base}/${sel.id}`, { nome: nome.trim(), todas: sel.todas, incluiSemCategoria: sel.incluiSemCategoria, categoriaIds: sel.categoriaIds }),
      "Perfil renomeado."
    );
  }

  async function excluir() {
    if (!sel) return;
    if (!window.confirm(`Excluir o perfil "${sel.nome}"? ${sel.pessoas} pessoa(s) passam a usar o perfil padrão.`)) return;
    await executar(async () => {
      await apiDeleteJson(`${base}/${sel.id}`);
      setSelId(null);
    }, `Perfil "${sel.nome}" excluído.`);
  }

  async function tornarPadrao() {
    if (!sel) return;
    if (!window.confirm(`Tornar "${sel.nome}" o perfil padrão? Quem usa o padrão atual passa a usar este.`)) return;
    await executar(() => apiPostJson(`${base}/${sel.id}/padrao`, {}), `"${sel.nome}" agora é o perfil padrão.`);
  }

  const marcar = (id: number, v: boolean) =>
    setRasc((r) => (r ? { ...r, categoriaIds: v ? [...new Set([...r.categoriaIds, id])] : r.categoriaIds.filter((x) => x !== id) } : r));

  return (
    <>
      <div className={s.mh}>
        <h1>Perfis de acesso</h1>
        <span className={s.sp} />
        <button type="button" className="mm-btn mm-btn--primary" disabled={ocupado} onClick={() => void novo()}>
          <IconPlus /> Novo perfil
        </button>
      </div>
      <p className={s.sub}>
        Cada pessoa tem um perfil. O perfil diz sobre quais categorias ela pode perguntar.
        {!matriz.config.perfisAtivos ? " Hoje os perfis estão desligados em Configurações: todo mundo pergunta sobre tudo." : ""}
      </p>
      {ok ? <p className={s.msgOk}>{ok}</p> : null}
      {erro ? <p className={s.msgErr}>{erro}</p> : null}
      {matriz.avisos.map((a) => (
        <p key={a} className={s.msgErr} style={{ color: "var(--mm-warning)" }}>
          {a}
        </p>
      ))}

      <div className={s.profs}>
        {perfis.map((p) => {
          const r = resumo(p, matriz.categorias.length);
          return (
            <button key={p.id} type="button" className={`${s.prof} ${sel?.id === p.id ? s.profOn : ""}`} onClick={() => setSelId(p.id)}>
              <b>
                {p.nome} {p.padrao ? <span className={`${s.tag} ${s.tagBrand}`}>padrão</span> : null}
              </b>
              <small>
                {p.pessoas} {p.pessoas === 1 ? "pessoa" : "pessoas"}
              </small>
              <p className={r.alerta ? s.profWarn : ""}>{r.texto}</p>
            </button>
          );
        })}
      </div>

      {sel && rasc ? (
        <div className={s.card}>
          <div className={s.row} style={{ padding: "12px 14px", borderBottom: "1px solid var(--mm-border)" }}>
            <b style={{ fontSize: 15 }}>Perfil {sel.nome}</b>
            <span className={s.sp} />
            {!sel.padrao ? (
              <button type="button" className={`mm-btn ${s.btnSm}`} disabled={ocupado} onClick={() => void tornarPadrao()}>
                Tornar padrão
              </button>
            ) : null}
            <button type="button" className={`mm-btn ${s.btnSm}`} disabled={ocupado} onClick={() => void duplicar()}>
              <IconCopy size={13} /> Duplicar
            </button>
            <button type="button" className={`mm-btn ${s.btnSm}`} disabled={ocupado} onClick={() => void renomear()}>
              <IconEdit size={13} /> Renomear
            </button>
            {!sel.padrao ? (
              <button type="button" className={`${s.iconBtn} ${s.iconBtnDanger}`} title="Excluir perfil" disabled={ocupado} onClick={() => void excluir()}>
                <IconTrash />
              </button>
            ) : null}
          </div>

          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--mm-border)" }}>
            <p className={s.sectionTitle}>Pessoas com este perfil</p>
            <div className={s.row}>
              {pessoasDoPerfil.map((m) => (
                <span key={m.userId} className={s.chip}>
                  <span className={s.chipAv} style={{ background: corDe(m.userId) }}>
                    {iniciais(m.nome, m.email)}
                  </span>
                  {m.nome ?? m.email}
                  {m.perfilId == null ? <span className="mm-muted" style={{ fontWeight: 500 }}>(padrão)</span> : null}
                  {m.perfilId != null ? (
                    <button
                      type="button"
                      className={s.iconBtn}
                      title="Tirar deste perfil (volta ao padrão)"
                      disabled={ocupado}
                      onClick={() => void executar(() => apiPutJson(`${base}/membros/${m.userId}`, { perfilId: null }), `${m.nome ?? m.email} voltou ao perfil padrão.`)}
                    >
                      <IconX size={12} />
                    </button>
                  ) : null}
                </span>
              ))}
              {pessoasDoPerfil.length === 0 ? <span className="mm-muted" style={{ fontSize: 13 }}>Ninguém ainda.</span> : null}
              {adicionando ? (
                <select
                  className={`mm-field ${s.selectSm}`}
                  autoFocus
                  defaultValue=""
                  disabled={ocupado}
                  onBlur={() => setAdicionando(false)}
                  onChange={(e) => {
                    const uid = Number(e.target.value);
                    setAdicionando(false);
                    if (uid) void executar(() => apiPutJson(`${base}/membros/${uid}`, { perfilId: sel.id }), "Pessoa adicionada ao perfil.");
                  }}
                >
                  <option value="">— escolha a pessoa —</option>
                  {outrasPessoas.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.nome ?? m.email} ({perfis.find((p) => p.id === m.perfilEfetivoId)?.nome ?? "padrão"})
                    </option>
                  ))}
                </select>
              ) : outrasPessoas.length > 0 ? (
                <button type="button" className={`mm-btn ${s.btnSm}`} disabled={ocupado} onClick={() => setAdicionando(true)}>
                  <IconPlus size={13} /> Adicionar pessoa
                </button>
              ) : null}
            </div>
            <p className={s.help}>
              Quem já tem outro perfil muda para este. O x devolve a pessoa ao perfil padrão{padrao ? ` (${padrao.nome})` : ""}. Também dá para trocar em Pessoas.
            </p>
          </div>

          <div className={s.tblWrap}>
            <table className={s.tbl}>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Pode</th>
                  <th>Categoria</th>
                  <th>Responde com</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <input type="checkbox" checked={rasc.todas} onChange={(e) => setRasc({ ...rasc, todas: e.target.checked })} aria-label="Todas as categorias" />
                  </td>
                  <td colSpan={2}>
                    <b>Todas as categorias</b> <span className="mm-muted" style={{ fontSize: 12 }}>(inclusive as criadas depois)</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      checked={rasc.todas || rasc.incluiSemCategoria}
                      disabled={rasc.todas}
                      onChange={(e) => setRasc({ ...rasc, incluiSemCategoria: e.target.checked })}
                      aria-label="Memos sem categoria"
                    />
                  </td>
                  <td colSpan={2}>Memos sem categoria</td>
                </tr>
                {matriz.categorias.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={rasc.todas || rasc.categoriaIds.includes(c.id)}
                        disabled={rasc.todas}
                        onChange={(e) => marcar(c.id, e.target.checked)}
                        aria-label={c.nome}
                      />
                    </td>
                    <td>
                      {c.nome} {c.global ? <span className={`${s.tag} ${s.tagWarn}`}>global</span> : null}
                    </td>
                    <td>
                      <div className={s.row} style={{ gap: 4 }}>
                        <span className={s.tag}>memos</span>
                        {c.temSqlErp ? <span className={`${s.tag} ${s.tagInd}`}>ERP</span> : null}
                        {c.meusPorPadrao ? (
                          <span className={s.tag} title="Categoria Pessoal: cada pessoa vê os próprios memos, a menos que peça 'de todos'">
                            só os meus
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={s.actions} style={{ padding: "0 14px 14px", marginTop: 10 }}>
            {sujo ? (
              <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setRasc(rascunhoDe(sel))}>
                Desfazer
              </button>
            ) : null}
            <button type="button" className="mm-btn mm-btn--primary" disabled={!sujo || ocupado} onClick={() => void salvar()}>
              Salvar perfil
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

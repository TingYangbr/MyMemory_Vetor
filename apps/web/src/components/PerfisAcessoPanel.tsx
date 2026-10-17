import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDeleteJson, apiGet, apiPatchJson, apiPostJson, apiPutJson } from "../api";
import styles from "./PerfisAcessoPanel.module.css";

interface CategoriaDoGrupo {
  id: number;
  nome: string;
  descricao: string | null;
  global: boolean;
  meusPorPadrao: boolean;
  temSqlErp: boolean;
  temSqlMemos: boolean;
}

interface PerfilAcesso {
  id: number;
  nome: string;
  todas: boolean;
  incluiSemCategoria: boolean;
  padrao: boolean;
  categoriaIds: number[];
  pessoas: number;
}

interface IdentidadeExterna {
  id: number;
  sistema: string;
  banco: string;
  idExterno: string;
  ativo: boolean;
}

interface MembroDoGrupo {
  userId: number;
  nome: string | null;
  email: string | null;
  role: string;
  perfilId: number | null;
  perfilEfetivoId: number;
  identidades: IdentidadeExterna[];
}

interface Matriz {
  categorias: CategoriaDoGrupo[];
  perfis: PerfilAcesso[];
  membros: MembroDoGrupo[];
  config: { perfisAtivos: boolean; exigirCadastro: boolean; maxMembers: number | null; totalMembros: number };
  avisos: string[];
}

/** Rascunho de um perfil enquanto a pessoa marca a matriz (só vai ao servidor em "Salvar alterações"). */
interface Rascunho {
  todas: boolean;
  incluiSemCategoria: boolean;
  categoriaIds: number[];
}

const MENSAGENS: Record<string, string> = {
  nome_duplicado: "Já existe um perfil com esse nome neste grupo.",
  nome_obrigatorio: "Informe um nome.",
  perfil_padrao_nao_exclui: "O perfil padrão não pode ser excluído. Eleja outro como padrão antes.",
  id_externo_ja_ligado: "Esse id do ERP já está ligado a outra pessoa.",
  membro_ja_tem_id: "Essa pessoa já tem um id neste sistema/banco. Remova o atual antes de ligar outro.",
  categoria_so_sql_erp: "Esta categoria só tem SQL do ERP: não há memos para filtrar por autor.",
  categoria_global_so_admin: "Categoria global só pode ser alterada por um administrador do sistema.",
};

function msgErro(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  for (const [codigo, msg] of Object.entries(MENSAGENS)) if (texto.includes(codigo)) return msg;
  return texto;
}

function rascunhoDe(p: PerfilAcesso): Rascunho {
  return { todas: p.todas, incluiSemCategoria: p.incluiSemCategoria, categoriaIds: [...p.categoriaIds] };
}

function mudou(p: PerfilAcesso, r: Rascunho): boolean {
  if (p.todas !== r.todas || p.incluiSemCategoria !== r.incluiSemCategoria) return true;
  const a = [...p.categoriaIds].sort((x, y) => x - y).join(",");
  const b = [...r.categoriaIds].sort((x, y) => x - y).join(",");
  return a !== b;
}

function modos(c: CategoriaDoGrupo): string {
  const partes = ["texto"];
  if (c.temSqlErp) partes.push("SQL do ERP");
  if (c.temSqlMemos) partes.push("SQL dos memos");
  return partes.join(" e ");
}

/**
 * Aba "Perfis": matriz de categorias por perfil, pessoas e de-para com o ERP. Usada no painel
 * administrativo (o admin escolhe o grupo) e no painel do dono do grupo (só o grupo dele).
 */
export function PerfisAcessoPanel({ groupId }: { groupId: number }) {
  const [matriz, setMatriz] = useState<Matriz | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<number, Rascunho>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [novoId, setNovoId] = useState<Record<number, { sistema: string; banco: string; idExterno: string }>>({});

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const m = await apiGet<Matriz>(`/api/groups/${groupId}/perfis`);
      setMatriz(m);
      setRascunhos(Object.fromEntries(m.perfis.map((p) => [p.id, rascunhoDe(p)])));
    } catch (e) {
      setErro(msgErro(e));
    }
  }, [groupId]);

  useEffect(() => {
    setMatriz(null);
    void carregar();
  }, [carregar]);

  async function executar(acao: () => Promise<unknown>, sucesso?: string) {
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      await acao();
      if (sucesso) setOk(sucesso);
      await carregar();
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const perfisSujos = useMemo(
    () => (matriz ? matriz.perfis.filter((p) => rascunhos[p.id] && mudou(p, rascunhos[p.id])) : []),
    [matriz, rascunhos]
  );

  if (!matriz) return <p className="mm-muted">{erro ?? "Carregando perfis…"}</p>;

  const base = `/api/groups/${groupId}/perfis`;
  const { categorias, perfis, membros, config, avisos } = matriz;
  const padrao = perfis.find((p) => p.padrao);

  function alternar(perfilId: number, mudanca: (r: Rascunho) => Rascunho) {
    setRascunhos((prev) => ({ ...prev, [perfilId]: mudanca(prev[perfilId]) }));
  }

  function marcarCategoria(perfilId: number, categoryId: number, marcada: boolean) {
    alternar(perfilId, (r) => ({
      ...r,
      categoriaIds: marcada ? [...new Set([...r.categoriaIds, categoryId])] : r.categoriaIds.filter((x) => x !== categoryId),
    }));
  }

  async function salvarAlteracoes() {
    const afetandoPadrao = perfisSujos.find((p) => p.padrao);
    if (afetandoPadrao && afetandoPadrao.pessoas > 0) {
      const confirmou = window.confirm(
        `Mudar o perfil padrão "${afetandoPadrao.nome}" muda o acesso de ${afetandoPadrao.pessoas} pessoa(s) de uma vez. Continuar?`
      );
      if (!confirmou) return;
    }
    await executar(async () => {
      for (const p of perfisSujos) {
        const r = rascunhos[p.id];
        await apiPatchJson(`${base}/${p.id}`, {
          nome: p.nome,
          todas: r.todas,
          incluiSemCategoria: r.incluiSemCategoria,
          categoriaIds: r.categoriaIds,
        });
      }
    }, "Perfis salvos.");
  }

  async function salvarComoNovo(p: PerfilAcesso) {
    const nome = window.prompt("Nome do novo perfil (com a lista de categorias que está marcada nesta coluna):");
    if (!nome?.trim()) return;
    const r = rascunhos[p.id];
    await executar(
      () =>
        apiPostJson(base, {
          nome: nome.trim(),
          todas: r.todas,
          incluiSemCategoria: r.incluiSemCategoria,
          categoriaIds: r.categoriaIds,
        }),
      `Perfil "${nome.trim()}" criado.`
    );
  }

  async function novoPerfilVazio() {
    const nome = window.prompt("Nome do novo perfil:");
    if (!nome?.trim()) return;
    await executar(() => apiPostJson(base, { nome: nome.trim(), categoriaIds: [] }), `Perfil "${nome.trim()}" criado.`);
  }

  async function duplicar(p: PerfilAcesso) {
    const nome = window.prompt(`Nome da cópia de "${p.nome}":`, `${p.nome} (cópia)`);
    if (!nome?.trim()) return;
    await executar(() => apiPostJson(`${base}/${p.id}/duplicar`, { nome: nome.trim() }), `Perfil "${nome.trim()}" criado.`);
  }

  async function excluir(p: PerfilAcesso) {
    if (!window.confirm(`Excluir o perfil "${p.nome}"? ${p.pessoas} pessoa(s) passam a usar o perfil padrão.`)) return;
    await executar(() => apiDeleteJson(`${base}/${p.id}`), `Perfil "${p.nome}" excluído.`);
  }

  async function tornarPadrao(p: PerfilAcesso) {
    if (!window.confirm(`Tornar "${p.nome}" o perfil padrão? Quem usa o padrão atual (sem perfil escolhido) passa a usar este.`)) return;
    await executar(() => apiPostJson(`${base}/${p.id}/padrao`, {}), `"${p.nome}" é o perfil padrão.`);
  }

  async function alterarConfig(campo: "perfisAtivos" | "exigirCadastro", valor: boolean) {
    if (valor && campo === "perfisAtivos" && !window.confirm("Passar a aplicar os perfis nas perguntas deste grupo? Perfis com todas as categorias continuam sem restrição.")) return;
    if (valor && campo === "exigirCadastro" && !window.confirm("Recusar perguntas de quem não está ligado ao ERP no de-para? Ligue as pessoas antes, ou elas ficam bloqueadas.")) return;
    await executar(() => apiPatchJson(`${base}/config`, { [campo]: valor }));
  }

  const limite = config.maxMembers;

  return (
    <div className={styles.root}>
      {erro ? <p className="mm-error">{erro}</p> : null}
      {ok ? <p className={styles.ok}>{ok}</p> : null}

      <section className={styles.bloco}>
        <h3 className={styles.titulo}>Aplicação dos perfis</h3>
        <label className={styles.linha}>
          <input
            type="checkbox"
            checked={config.perfisAtivos}
            disabled={ocupado}
            onChange={(e) => void alterarConfig("perfisAtivos", e.target.checked)}
          />
          <span>
            Aplicar os perfis nas perguntas deste grupo
            <small> — desligado, todos perguntam com o acesso de hoje (o grupo inteiro).</small>
          </span>
        </label>
        <label className={styles.linha}>
          <input
            type="checkbox"
            checked={config.exigirCadastro}
            disabled={ocupado}
            onChange={(e) => void alterarConfig("exigirCadastro", e.target.checked)}
          />
          <span>
            Exigir cadastro no de-para para perguntar pelo ERP
            <small> — ligue só depois de ligar as pessoas abaixo, senão elas ficam bloqueadas.</small>
          </span>
        </label>
      </section>

      {avisos.length ? (
        <section className={styles.bloco}>
          <h3 className={styles.titulo}>Avisos</h3>
          <ul className={styles.avisos}>
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.bloco}>
        <div className={styles.cabecalho}>
          <h3 className={styles.titulo}>Categorias por perfil</h3>
          <button type="button" className="mm-btn" disabled={ocupado} onClick={() => void novoPerfilVazio()}>
            + Novo perfil
          </button>
        </div>
        <div className={styles.rolagem}>
          <table className={styles.matriz}>
            <thead>
              <tr>
                <th className={styles.colCategoria}>Categoria</th>
                {perfis.map((p) => (
                  <th key={p.id} className={styles.colPerfil}>
                    <div className={styles.nomePerfil}>
                      {p.nome}
                      {p.padrao ? <span className={styles.selo}>padrão</span> : null}
                    </div>
                    <div className={styles.pessoas}>{p.pessoas} pessoa(s)</div>
                    <div className={styles.acoes}>
                      <button type="button" disabled={ocupado} onClick={() => void salvarComoNovo(p)} title="Cria um perfil novo com a lista marcada nesta coluna">
                        Salvar como novo
                      </button>
                      <button type="button" disabled={ocupado} onClick={() => void duplicar(p)}>
                        Duplicar
                      </button>
                      {!p.padrao ? (
                        <>
                          <button type="button" disabled={ocupado} onClick={() => void tornarPadrao(p)}>
                            Tornar padrão
                          </button>
                          <button type="button" disabled={ocupado} onClick={() => void excluir(p)}>
                            Excluir
                          </button>
                        </>
                      ) : null}
                    </div>
                  </th>
                ))}
                <th className={styles.colMeus} title="Em categorias marcadas, a pergunta é sobre os memos da própria pessoa, a menos que ela peça &quot;de todos&quot;. Padrão de escopo, não barreira.">
                  Meus por padrão
                </th>
              </tr>
              <tr className={styles.linhaTodas}>
                <td>Todas as categorias</td>
                {perfis.map((p) => (
                  <td key={p.id}>
                    <input
                      type="checkbox"
                      checked={rascunhos[p.id]?.todas ?? false}
                      disabled={ocupado}
                      onChange={(e) => alternar(p.id, (r) => ({ ...r, todas: e.target.checked }))}
                    />
                  </td>
                ))}
                <td />
              </tr>
            </thead>
            <tbody>
              {categorias.map((c) => (
                <tr key={c.id}>
                  <td className={styles.colCategoria}>
                    <strong>{c.nome}</strong>
                    {c.global ? <span className={styles.etiqueta}>global</span> : null}
                    <span className={styles.etiqueta}>Texto</span>
                    {c.temSqlErp ? <span className={styles.etiqueta}>SQL ERP</span> : null}
                    {c.temSqlMemos ? <span className={styles.etiqueta}>SQL memos</span> : null}
                  </td>
                  {perfis.map((p) => {
                    const r = rascunhos[p.id];
                    return (
                      <td key={p.id}>
                        <input
                          type="checkbox"
                          checked={r?.todas || r?.categoriaIds.includes(c.id) || false}
                          disabled={ocupado || r?.todas}
                          onChange={(e) => marcarCategoria(p.id, c.id, e.target.checked)}
                        />
                      </td>
                    );
                  })}
                  <td>
                    <input
                      type="checkbox"
                      checked={c.meusPorPadrao}
                      disabled={ocupado || (c.temSqlErp && !c.temSqlMemos)}
                      onChange={(e) =>
                        void executar(() => apiPatchJson(`${base}/categorias/${c.id}`, { meusPorPadrao: e.target.checked }))
                      }
                    />
                  </td>
                </tr>
              ))}
              <tr>
                <td className={styles.colCategoria}>
                  <strong>(Sem categoria)</strong>
                  <span className={styles.etiqueta}>Texto</span>
                </td>
                {perfis.map((p) => {
                  const r = rascunhos[p.id];
                  return (
                    <td key={p.id}>
                      <input
                        type="checkbox"
                        checked={r?.todas || r?.incluiSemCategoria || false}
                        disabled={ocupado || r?.todas}
                        onChange={(e) => alternar(p.id, (x) => ({ ...x, incluiSemCategoria: e.target.checked }))}
                      />
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className={styles.rodape}>
          <button type="button" className="mm-btn" disabled={ocupado || !perfisSujos.length} onClick={() => void salvarAlteracoes()}>
            Salvar alterações{perfisSujos.length ? ` (${perfisSujos.length})` : ""}
          </button>
          <button
            type="button"
            className="mm-btn"
            disabled={ocupado || !perfisSujos.length}
            onClick={() => setRascunhos(Object.fromEntries(perfis.map((p) => [p.id, rascunhoDe(p)])))}
          >
            Descartar
          </button>
        </div>
      </section>

      <section className={styles.bloco}>
        <h3 className={styles.titulo}>O que cada perfil alcança</h3>
        <ul className={styles.avisos}>
          {perfis.map((p) => (
            <li key={p.id}>
              <strong>{p.nome}</strong>
              {p.padrao ? " (padrão)" : ""}: {p.pessoas} pessoa(s).{" "}
              {p.todas
                ? "Todas as categorias: texto e SQL, sem restrição."
                : [
                    ...categorias.filter((c) => p.categoriaIds.includes(c.id)).map((c) => `${c.nome}: ${modos(c)}`),
                    ...(p.incluiSemCategoria ? ["(Sem categoria): texto"] : []),
                  ].join("; ") || "Nenhuma categoria — este perfil não responde nada."}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.bloco}>
        <h3 className={styles.titulo}>
          Pessoas{" "}
          <small>
            {config.totalMembros}
            {limite != null ? ` de ${limite}` : ""} membro(s)
            {limite != null && config.totalMembros > limite ? " — acima do limite do plano" : ""}
          </small>
        </h3>
        <div className={styles.rolagem}>
          <table className={styles.pessoasTabela}>
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Perfil</th>
                <th>Ligação com o ERP (de-para)</th>
              </tr>
            </thead>
            <tbody>
              {membros.map((m) => {
                const form = novoId[m.userId] ?? { sistema: "softing-erp", banco: "", idExterno: "" };
                return (
                  <tr key={m.userId}>
                    <td>
                      <strong>{m.nome ?? m.email ?? `#${m.userId}`}</strong>
                      <div className="mm-muted">{m.email ?? ""} · {m.role}</div>
                    </td>
                    <td>
                      <select
                        className="mm-field"
                        value={m.perfilId ?? ""}
                        disabled={ocupado}
                        onChange={(e) =>
                          void executar(() =>
                            apiPutJson(`${base}/membros/${m.userId}`, { perfilId: e.target.value === "" ? null : Number(e.target.value) })
                          )
                        }
                      >
                        <option value="">Perfil padrão{padrao ? ` (${padrao.nome})` : ""}</option>
                        {perfis.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {m.identidades.map((i) => (
                        <div key={i.id} className={styles.identidade}>
                          {i.sistema}
                          {i.banco ? ` / ${i.banco}` : ""} → <strong>{i.idExterno}</strong>
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => void executar(() => apiDeleteJson(`${base}/identidades/${i.id}`))}
                          >
                            remover
                          </button>
                        </div>
                      ))}
                      <div className={styles.novoId}>
                        <input
                          className="mm-field"
                          placeholder="sistema"
                          value={form.sistema}
                          onChange={(e) => setNovoId((p) => ({ ...p, [m.userId]: { ...form, sistema: e.target.value } }))}
                        />
                        <input
                          className="mm-field"
                          placeholder="banco (opcional)"
                          value={form.banco}
                          onChange={(e) => setNovoId((p) => ({ ...p, [m.userId]: { ...form, banco: e.target.value } }))}
                        />
                        <input
                          className="mm-field"
                          placeholder="usuário no ERP"
                          title="Usuário com que a pessoa entra no ERP. No Softing-erp: o NOME do usuário (AGUSUAR.NOME), não o código interno."
                          value={form.idExterno}
                          onChange={(e) => setNovoId((p) => ({ ...p, [m.userId]: { ...form, idExterno: e.target.value } }))}
                        />
                        <button
                          type="button"
                          className="mm-btn"
                          disabled={ocupado || !form.sistema.trim() || !form.idExterno.trim()}
                          onClick={() =>
                            void executar(async () => {
                              await apiPutJson(`${base}/identidades`, { ...form, userId: m.userId });
                              setNovoId((p) => ({ ...p, [m.userId]: { ...form, idExterno: "" } }));
                            }, "Ligação gravada.")
                          }
                        >
                          Ligar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

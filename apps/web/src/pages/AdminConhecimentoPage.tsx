import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse, MemoContextGroupOption } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiGetOptional, apiPostJson } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";

type Categoria = { id: number; name: string; global: boolean };
type Importado = { category: string; origem: string; total: number; atualizadoEm: string; versao: string | null };
type Trecho = { id: string; texto: string; [k: string]: unknown };
type Resultado = { criados: number; desativados: number; erros: { id: string; erro: string }[] };

/** Lê um .jsonl (um trecho por linha) ou um .json com array de trechos. */
function lerTrechos(conteudo: string): Trecho[] {
  const t = conteudo.trim();
  if (t.startsWith("[")) return JSON.parse(t) as Trecho[];
  return t
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l) as Trecho;
      } catch {
        throw new Error(`Linha ${i + 1} não é JSON válido.`);
      }
    });
}

/**
 * Importa conhecimento em trechos (ex.: docs/manual-chunks/chunks.jsonl do Manual MyMemory) para um
 * grupo: cada trecho vira um memo de texto com categoria, campos e vetores, sem IA de extração.
 */
export default function AdminConhecimentoPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [grupos, setGrupos] = useState<MemoContextGroupOption[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [importados, setImportados] = useState<Importado[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [trechos, setTrechos] = useState<Trecho[] | null>(null);
  const [arquivo, setArquivo] = useState<string>("");
  const [origem, setOrigem] = useState<string>("");
  const [substituir, setSubstituir] = useState(true);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me")
      .then((r) => {
        if (!r.ok) {
          if (r.status === 401) setNeedLogin(true);
          else setErro(`Erro ao carregar o perfil (HTTP ${r.status}).`);
          return;
        }
        setMe(r.data);
      })
      .catch(() => setErro("Não foi possível conectar à API."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (me?.role !== "admin") return;
    apiGet<{ groups: MemoContextGroupOption[] }>("/api/memo-context/groups")
      .then((r) => setGrupos(r.groups))
      .catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar grupos."));
  }, [me?.role]);

  const carregarGrupo = useCallback(async (gid: number) => {
    const r = await apiGet<{ categorias: Categoria[]; importados: Importado[] }>(`/api/admin/conhecimento?groupId=${gid}`);
    setCategorias(r.categorias);
    setImportados(r.importados);
    setCategoryId((atual) => (r.categorias.some((c) => c.id === atual) ? atual
      : r.categorias.find((c) => /manual/i.test(c.name))?.id ?? null));
  }, []);

  useEffect(() => {
    if (groupId == null) return;
    setResultado(null);
    carregarGrupo(groupId).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar o grupo."));
  }, [groupId, carregarGrupo]);

  async function escolherArquivo(f: File | undefined) {
    setErro(null);
    setResultado(null);
    setTrechos(null);
    setArquivo("");
    setOrigem("");
    if (!f) return;
    try {
      const lista = lerTrechos(await f.text());
      const invalido = lista.findIndex((t) => !t || typeof t.id !== "string" || typeof t.texto !== "string");
      if (invalido >= 0) throw new Error(`Trecho ${invalido + 1} sem "id" ou "texto".`);
      setTrechos(lista);
      setArquivo(f.name);
      setOrigem((atual) => atual || f.name.replace(/\.(jsonl|json)$/i, ""));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Arquivo inválido.");
    }
  }

  async function importar() {
    if (groupId == null || categoryId == null || !trechos?.length || !origem.trim()) return;
    setImportando(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await apiPostJson<Resultado>("/api/admin/conhecimento/importar", {
        groupId,
        categoryId,
        substituir,
        origem: origem.trim(),
        trechos,
      });
      setResultado(r);
      await carregarGrupo(groupId);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      try { setErro((JSON.parse(raw) as { message?: string }).message ?? raw); } catch { setErro(raw); }
    } finally {
      setImportando(false);
    }
  }

  async function remover(category: string, origemRemover: string) {
    if (groupId == null) return;
    if (!window.confirm(`Desativar os trechos do manual "${origemRemover}" na categoria "${category}" deste grupo? Os de outros manuais da categoria não são afetados.`)) return;
    try {
      await apiDeleteJson(`/api/admin/conhecimento?groupId=${groupId}&category=${encodeURIComponent(category)}&origem=${encodeURIComponent(origemRemover)}`);
      await carregarGrupo(groupId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao remover.");
    }
  }

  if (loading) {
    return (
      <div className={adminStyles.shell}><Header /><main className={adminStyles.main}><p className="mm-muted">Carregando…</p></main></div>
    );
  }
  if (needLogin) {
    return (
      <div className={adminStyles.shell}><Header /><main className={adminStyles.main}>
        <h1 className={adminStyles.title}>Autenticação necessária</h1>
        <Link to="/login" className={adminStyles.back}>Ir ao login</Link>
      </main></div>
    );
  }
  if (me?.role !== "admin") {
    return (
      <div className={adminStyles.shell}><Header /><main className={adminStyles.main}>
        <h1 className={adminStyles.title}>Acesso negado</h1>
      </main></div>
    );
  }

  const categoria = categorias.find((c) => c.id === categoryId);
  const importadosDaCategoria = categoria ? importados.filter((i) => i.category === categoria.name) : [];
  const jaImportado = importadosDaCategoria.find((i) => i.origem === origem.trim());
  const outrosManuais = importadosDaCategoria.filter((i) => i.origem !== origem.trim());

  return (
    <div className={adminStyles.shell}>
      <Header />
      <main className={adminStyles.main}>
        <Link to="/admin" className={adminStyles.back}>← Painel admin</Link>
        <h1 className={adminStyles.title}>Importar conhecimento em trechos</h1>
        <p className={adminStyles.lead}>
          Cada trecho do arquivo vira um memo de texto no grupo escolhido, já com a categoria, os campos
          (Seção, Tela, Rota, Perfil, Tipo, Versão) e os vetores da busca semântica — sem IA de extração.
          Use o <code>docs/manual-chunks/chunks.jsonl</code> do Manual MyMemory ou outro arquivo no mesmo formato
          (um JSON por linha com <code>id</code> e <code>texto</code>).
        </p>
        {erro ? <p className="mm-error">{erro}</p> : null}

        <div style={{ display: "grid", gap: "0.9rem", maxWidth: 640, marginTop: "1rem" }}>
          <label style={{ display: "grid", gap: "0.3rem" }}>
            <strong>Grupo</strong>
            <select className="mm-field" value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— escolha o grupo —</option>
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>

          {groupId != null ? (
            <label style={{ display: "grid", gap: "0.3rem" }}>
              <strong>Categoria</strong>
              <select className="mm-field" value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— escolha a categoria —</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}{c.global ? " (global)" : ""}</option>)}
              </select>
              <span className="mm-muted" style={{ fontSize: "0.82rem" }}>
                Crie antes a categoria (ex.: "Manual MyMemory") com os campos Seção, Tela, Rota, Perfil, Tipo e Versão.
              </span>
            </label>
          ) : null}

          {groupId != null ? (
            <label style={{ display: "grid", gap: "0.3rem" }}>
              <strong>Arquivo de trechos (.jsonl)</strong>
              <input type="file" accept=".jsonl,.json,application/json" onChange={(e) => void escolherArquivo(e.target.files?.[0])} />
              {trechos ? <span className="mm-muted" style={{ fontSize: "0.85rem" }}>{arquivo}: {trechos.length} trechos.</span> : null}
            </label>
          ) : null}

          {groupId != null && trechos ? (
            <label style={{ display: "grid", gap: "0.3rem" }}>
              <strong>Nome do manual (origem)</strong>
              <input className="mm-field" value={origem} maxLength={200} onChange={(e) => setOrigem(e.target.value)} placeholder="Ex.: Manual e-Pedidos — Suporte" />
              <span className="mm-muted" style={{ fontSize: "0.82rem" }}>
                Identifica de qual manual são os trechos. "Substituir" só troca os trechos que tiverem exatamente este nome
                {" "}nesta categoria; use um nome diferente para cada manual.
              </span>
            </label>
          ) : null}

          {groupId != null ? (
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <input type="checkbox" checked={substituir} onChange={(e) => setSubstituir(e.target.checked)} />
              Substituir os trechos já importados deste manual nesta categoria
              {jaImportado ? <span className="mm-muted">({jaImportado.total} hoje)</span> : null}
            </label>
          ) : null}
          {groupId != null && categoria && origem.trim() && outrosManuais.length ? (
            <p className="mm-muted" style={{ fontSize: "0.85rem", margin: 0 }}>
              Esta categoria também tem {outrosManuais.map((i) => `"${i.origem}" (${i.total})`).join(", ")}, que não serão alterados.
            </p>
          ) : null}

          {groupId != null ? (
            <div>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={importando || categoryId == null || !trechos?.length || !origem.trim()}
                onClick={() => void importar()}
              >
                {importando ? `Importando ${trechos?.length ?? 0} trechos…` : "Importar"}
              </button>
              {importando ? <span className="mm-muted" style={{ marginLeft: "0.6rem" }}>Pode levar alguns minutos (gera os vetores de cada trecho).</span> : null}
            </div>
          ) : null}

          {resultado ? (
            <p className={resultado.erros.length ? "mm-error" : ""} role="status">
              {resultado.criados} trecho(s) importado(s)
              {resultado.desativados ? `, ${resultado.desativados} anterior(es) substituído(s)` : ""}
              {resultado.erros.length ? `, ${resultado.erros.length} erro(s): ${resultado.erros.slice(0, 3).map((e) => `${e.id} (${e.erro})`).join("; ")}` : "."}
            </p>
          ) : null}
        </div>

        {groupId != null ? (
          <>
            <h2 style={{ marginTop: "2rem", fontSize: "1.05rem" }}>Já importado neste grupo</h2>
            {importados.length === 0 ? (
              <p className="mm-muted">Nenhum conjunto de trechos importado.</p>
            ) : (
              <table className={adminStyles.table}>
                <thead><tr><th>Categoria</th><th>Manual (origem)</th><th>Trechos</th><th>Versão</th><th>Atualizado</th><th></th></tr></thead>
                <tbody>
                  {importados.map((i) => (
                    <tr key={`${i.category}||${i.origem}`}>
                      <td>{i.category}</td>
                      <td>{i.origem}</td>
                      <td>{i.total}</td>
                      <td>{i.versao ?? "—"}</td>
                      <td>{new Date(i.atualizadoEm).toLocaleString("pt-BR")}</td>
                      <td><button type="button" className="mm-btn mm-btn--ghost" onClick={() => void remover(i.category, i.origem)}>Remover</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}

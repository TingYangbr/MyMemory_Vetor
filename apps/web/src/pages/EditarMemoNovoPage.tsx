import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { MeResponse, MemoAuthorEditResponse, PatchMemoResponse, TextMemoProcessResponse } from "@mymemory/shared";
import { dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiGetOptional, apiPatchJson, apiPostJson, mensagemDeErro } from "../api";
import Header from "../components/Header";
import MemoFormulario, { useCategoriasCompletas } from "../components/catalogarNovo/MemoFormulario";
import { attachmentExt } from "../memo/memoCardDisplayUtils";
import { dadosParaJson, parseDadosEntries, type DadoCampo } from "../lib/revisaoNova";
import s from "./catalogarNovo.module.css";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const TIPO: Record<string, string> = {
  text: "Texto",
  audio: "Áudio",
  image: "Imagem",
  video: "Vídeo",
  document: "Documento",
  url: "Página web",
};

interface ItemHistorico {
  lote: string;
  quando: string;
  autor: string | null;
  origem: string;
  campos: Array<{ campo: string; antes: string | null; depois: string | null }>;
}

/** Evita open redirect: só caminhos internos. */
function voltarPara(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const t = raw.trim();
  return t.startsWith("/") && !t.startsWith("//") ? t : "/";
}

function dataHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function metadadosLegiveis(raw: string | null): string {
  if (!raw?.trim()) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function EditarMemoNovoPage() {
  const { id } = useParams();
  const memoId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const destino = voltarPara(
    (location.state as { returnTo?: string } | null)?.returnTo ?? new URLSearchParams(location.search).get("returnTo")
  );

  const [memo, setMemo] = useState<MemoAuthorEditResponse | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [historico, setHistorico] = useState<ItemHistorico[]>([]);
  const [resumo, setResumo] = useState("");
  const [keywords, setKeywords] = useState("");
  const [campos, setCampos] = useState<DadoCampo[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [assunto, setAssunto] = useState("");
  const assuntoOriginal = useRef("");
  const [catDosCampos, setCatDosCampos] = useState<number | null>(null);
  const camposIniciais = useRef<{ cat: number | null; campos: DadoCampo[] }>({ cat: null, campos: [] });
  const [avisoTroca, setAvisoTroca] = useState<{ nome: string } | null>(null);
  const [reextraindo, setReextraindo] = useState(false);
  const [erroReextr, setErroReextr] = useState<string | null>(null);
  const [originais, setOriginais] = useState<string | null>(null);
  const [custoExtra, setCustoExtra] = useState(0);
  const [aba, setAba] = useState<"memo" | "original">("memo");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const [me, setMe] = useState<{ showApiCost: boolean; mult: number }>({ showApiCost: false, mult: 100 });

  const categorias = useCategoriasCompletas(memo ? memo.groupId : undefined);

  useEffect(() => {
    if (!Number.isFinite(memoId) || memoId <= 0) {
      setErroCarga("Memo inválido.");
      return;
    }
    apiGet<MemoAuthorEditResponse>(`/api/memos/${memoId}`)
      .then((m) => {
        setMemo(m);
        setResumo(m.mediaText ?? "");
        setKeywords(dedupeMemoKeywordsCommaSeparated(m.keywords ?? ""));
        const c = parseDadosEntries(m.dadosEspecificosJson);
        setCampos(c);
        camposIniciais.current.campos = c;
        setAssunto(m.tituloCurto ?? "");
        assuntoOriginal.current = m.tituloCurto ?? "";
      })
      .catch((e) => {
        const t = e instanceof Error ? e.message : "";
        setErroCarga(
          t.includes("403") || t.includes("forbidden")
            ? "Você não tem permissão para editar este memo."
            : t.includes("404") || t.includes("not_found")
              ? "Memo não encontrado."
              : "Não foi possível carregar o memo."
        );
      });
    void apiGetOptional<{ itens: ItemHistorico[] }>(`/api/memos/${memoId}/historico`).then((r) => {
      if (r.ok) setHistorico(r.data.itens ?? []);
    });
    void apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) return;
      const m = r.data.usdToCreditsMultiplier;
      setMe({ showApiCost: r.data.showApiCost !== false, mult: typeof m === "number" && m > 0 ? m : 100 });
    });
  }, [memoId]);

  // Categoria gravada no memo (pelo nome)
  useEffect(() => {
    if (!memo || !categorias || camposIniciais.current.cat != null) return;
    const c = categorias.find((x) => x.name === memo.category);
    if (c) {
      camposIniciais.current.cat = c.id;
      setCategoryId(c.id);
      setCatDosCampos(c.id);
    }
  }, [memo, categorias]);

  const setDado = useCallback((key: string, value: string) => {
    setCampos((prev) => (prev.some((e) => e.key === key) ? prev.map((e) => (e.key === key ? { ...e, value } : e)) : [...prev, { key, value }]));
  }, []);

  const trocarCategoria = (cid: number | null) => {
    setCategoryId(cid);
    setErroReextr(null);
    if (cid === camposIniciais.current.cat) {
      setCampos(camposIniciais.current.campos);
      setCatDosCampos(cid);
      setAvisoTroca(null);
      return;
    }
    const nova = categorias?.find((c) => c.id === cid) ?? null;
    const antes = campos;
    setCampos((nova?.campos ?? []).map((c) => ({ key: c.name, value: antes.find((e) => e.key.toLowerCase() === c.name.toLowerCase())?.value ?? "" })));
    setAvisoTroca(nova ? { nome: nova.name } : null);
  };

  const preencherIA = async () => {
    if (categoryId == null || !memo) return;
    setReextraindo(true);
    setErroReextr(null);
    try {
      const r = await apiPostJson<TextMemoProcessResponse>("/api/memos/reextrair", {
        texto: resumo,
        groupId: memo.groupId,
        categoryId,
      });
      setKeywords(dedupeMemoKeywordsCommaSeparated(r.suggestedKeywords));
      setCampos(parseDadosEntries(r.dadosEspecificosJson));
      setOriginais(r.dadosEspecificosOriginaisJson ?? null);
      setCustoExtra((c) => c + (r.apiCost || 0));
      setCatDosCampos(categoryId);
      setAvisoTroca(null);
    } catch (e) {
      setErroReextr(mensagemDeErro(e, "Falha ao reprocessar."));
    } finally {
      setReextraindo(false);
    }
  };

  const sair = (salvou: boolean) => {
    if (destino.split("?")[0] === "/buscar") {
      try {
        sessionStorage.setItem("mm_buscar_restore_pending", "1");
      } catch {
        /* */
      }
    }
    navigate(destino, { replace: true, state: salvou && destino === "/" ? { memoSavedAt: Date.now() } : {} });
  };

  const salvar = async () => {
    if (!memo) return;
    if (!resumo.trim()) {
      setErro("Escreva o resumo do memo.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      const nomeCat = categorias?.find((c) => c.id === categoryId)?.name ?? null;
      await apiPatchJson<PatchMemoResponse>(`/api/memos/${memo.id}`, {
        mediaText: resumo.trim(),
        keywords: keywords.trim() || null,
        dadosEspecificosJson: dadosParaJson(campos.filter((c) => c.key.trim())),
        ...(originais ? { dadosEspecificosOriginaisJson: originais } : {}),
        ...(custoExtra > 0 ? { apiCostAdicional: custoExtra } : {}),
        ...(categoryId != null ? { matchedCategoryId: categoryId } : {}),
        category: categoryId != null ? nomeCat : null,
        ...(assunto.trim() !== assuntoOriginal.current.trim() ? { tituloCurto: assunto.trim() } : {}),
      });
      sair(true);
    } catch (e) {
      setErro(mensagemDeErro(e, "Falha ao salvar."));
    } finally {
      setBusy(false);
    }
  };

  const excluir = async () => {
    if (!memo) return;
    setBusy(true);
    try {
      await apiDeleteJson(`/api/memos/${memo.id}`);
      sair(true);
    } catch (e) {
      setErro(mensagemDeErro(e, "Falha ao excluir."));
      setConfirmarExcluir(false);
    } finally {
      setBusy(false);
    }
  };

  if (erroCarga || !memo) {
    return (
      <>
        <Header />
        <div className={s.page}>
          <p className={erroCarga ? s.erro : s.carregando}>{erroCarga ?? "Carregando…"}</p>
        </div>
      </>
    );
  }

  const arquivo = `${apiBase}/api/memos/${memo.id}/file`;
  const ext = attachmentExt(memo.mediaFileUrl) || attachmentExt(memo.originalFileName);
  const metadados = metadadosLegiveis(memo.mediaMetadata);
  const ultimaAlteracao = historico[0];
  const custo = memo.usedApiCred > 0 ? memo.usedApiCred : memo.apiCost * me.mult;

  let original: JSX.Element;
  if (memo.mediaType === "image" && memo.hasFile) {
    original = (
      <div className={s.midiaFundo}>
        <img src={arquivo} alt="Imagem original" onClick={() => window.open(arquivo, "_blank", "noopener")} />
      </div>
    );
  } else if (memo.mediaType === "audio" && memo.hasFile) {
    original = (
      <div className={s.midiaFundo}>
        <audio src={arquivo} controls preload="metadata" />
      </div>
    );
  } else if (memo.mediaType === "video" && memo.hasFile) {
    original = (
      <div className={s.midiaFundo}>
        <video src={arquivo} controls playsInline preload="metadata" />
      </div>
    );
  } else if (memo.mediaType === "document" && memo.hasFile && ext === "pdf") {
    original = (
      <div className={s.midiaFundo}>
        <iframe className={s.pdf} src={`${arquivo}#toolbar=0&view=FitH`} title={memo.originalFileName ?? "Documento"} />
      </div>
    );
  } else if (memo.mediaType === "url" && memo.mediaWebUrl) {
    original = (
      <div className={s.site}>
        <div className={s.siteTopo}>{memo.mediaWebUrl}</div>
      </div>
    );
  } else if (memo.hasFile) {
    original = <p className={s.semCampos}>Arquivo {ext ? `.${ext}` : ""} guardado. Use "Abrir o arquivo" para ver.</p>;
  } else {
    original = <p className={s.semCampos}>Memo de texto: o texto está no resumo ao lado.</p>;
  }

  return (
    <>
      <Header />
      <div className={s.page}>
        <div className={s.topo}>
          <button type="button" className={s.voltar} aria-label="Voltar" onClick={() => sair(false)}>
            ‹
          </button>
          <h1>
            Editar memo <span style={{ color: "var(--mm-muted)" }}>#{memo.id}</span>
          </h1>
          <span className={s.tipo}>{TIPO[memo.mediaType] ?? memo.mediaType}</span>
          <span className={s.sp} />
          <button
            type="button"
            className="mm-btn mm-btn--ghost"
            style={{ color: "var(--mm-danger)" }}
            disabled={busy}
            onClick={() => setConfirmarExcluir(true)}
          >
            🗑 Excluir memo
          </button>
        </div>
        <div className={s.meta}>
          <span>
            Catalogado em <b>{dataHora(memo.createdAt)}</b>
          </span>
          {ultimaAlteracao ? (
            <span>
              Alterado {ultimaAlteracao.autor ? <>por <b>{ultimaAlteracao.autor}</b> </> : null}em {dataHora(ultimaAlteracao.quando)}
            </span>
          ) : null}
        </div>

        <div className={s.abas} role="tablist">
          <button type="button" className={aba === "original" ? s.abaOn : ""} onClick={() => setAba("original")}>
            Original
          </button>
          <button type="button" className={aba === "memo" ? s.abaOn : ""} onClick={() => setAba("memo")}>
            Memo
          </button>
        </div>

        <div className={s.cols}>
          <div className={`${s.colEsq} ${aba === "memo" ? s.escondeCel : ""}`}>
            <div className={s.box}>
              <div className={s.bh}>
                Original<span className={s.sp} />
                {memo.hasFile ? (
                  <a className={s.bhLink} href={arquivo} target="_blank" rel="noreferrer">
                    Abrir o arquivo ↗
                  </a>
                ) : memo.mediaWebUrl ? (
                  <a className={s.bhLink} href={memo.mediaWebUrl} target="_blank" rel="noreferrer">
                    Abrir a página ↗
                  </a>
                ) : null}
              </div>
              <div className={s.bb}>{original}</div>
              {memo.originalFileName ? (
                <div className={s.arquivo}>
                  <b>{memo.originalFileName}</b>
                </div>
              ) : null}
            </div>

            <div className={s.box}>
              <div className={s.bh}>Histórico</div>
              <div className={`${s.bb} ${s.hist}`}>
                {historico.map((h) => (
                  <div key={h.lote}>
                    <span>✎</span>
                    <span>
                      {h.campos.length > 0
                        ? h.campos
                            .slice(0, 3)
                            .map((c) => `${c.campo}: ${c.antes || "(vazio)"} → ${c.depois || "(vazio)"}`)
                            .join(" · ")
                        : "Resumo reescrito"}
                      {h.autor ? (
                        <>
                          {" "}
                          por <b>{h.autor}</b>
                        </>
                      ) : null}
                    </span>
                    <small>{dataHora(h.quando)}</small>
                  </div>
                ))}
                <div>
                  <span>+</span>
                  <span>Catalogado ({TIPO[memo.mediaType] ?? memo.mediaType})</span>
                  <small>{dataHora(memo.createdAt)}</small>
                </div>
              </div>
            </div>

            <div className={s.box}>
              <details className={s.recolher} style={{ borderTop: 0 }}>
                <summary>
                  Detalhes do arquivo<small>armazenamento, metadados{me.showApiCost ? ", custo" : ""}</small>
                </summary>
                <div style={{ display: "grid", gap: 8, fontSize: 12.5, color: "var(--mm-text-secondary)" }}>
                  {memo.storageProvider ? <span>Armazenamento: {memo.storageProvider}</span> : null}
                  {memo.externalFileRef ? <span style={{ wordBreak: "break-all" }}>Local: {memo.externalFileRef}</span> : null}
                  {me.showApiCost ? (
                    <span>
                      Custo API (USD): {memo.apiCost.toFixed(6)} · Créditos: {custo.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
                    </span>
                  ) : null}
                  {metadados ? <pre className={s.metaPre}>{metadados}</pre> : <span>Nenhum metadado gravado.</span>}
                </div>
              </details>
            </div>
          </div>

          <div className={aba === "original" ? s.escondeCel : ""}>
            {categorias ? (
              <MemoFormulario
                categorias={categorias}
                categoryId={categoryId}
                onTrocarCategoria={trocarCategoria}
                avisoTroca={catDosCampos === categoryId ? null : avisoTroca}
                onPreencherIA={() => void preencherIA()}
                onDeixarEmBranco={() => {
                  setAvisoTroca(null);
                  setCatDosCampos(categoryId);
                }}
                reextraindo={reextraindo}
                erroReextrair={erroReextr}
                assunto={assunto}
                setAssunto={setAssunto}
                resumo={resumo}
                setResumo={setResumo}
                keywords={keywords}
                setKeywords={setKeywords}
                dados={campos}
                setDado={setDado}
              />
            ) : (
              <div className={s.carregando}>Carregando categorias…</div>
            )}
            {erro ? <p className={s.erro}>{erro}</p> : null}
          </div>
        </div>
      </div>

      <div className={s.rodape}>
        <div className={s.rodapeIn}>
          <span className={s.sp} />
          <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={() => sair(false)}>
            Cancelar
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={busy || !resumo.trim()} onClick={() => void salvar()}>
            {busy ? "Salvando…" : "✓ Salvar alterações"}
          </button>
        </div>
      </div>

      {confirmarExcluir ? (
        <div className={s.fundo} role="dialog" aria-modal="true" aria-labelledby="nm-excluir">
          <div className={s.cartao} style={{ borderLeftColor: "var(--mm-danger)" }}>
            <h2 id="nm-excluir">Excluir o memo #{memo.id}?</h2>
            <p>O memo sai das buscas e das respostas. Esta ação não pode ser desfeita por aqui.</p>
            <div className={s.cartaoBotoes}>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                style={{ background: "var(--mm-danger)", borderColor: "var(--mm-danger)" }}
                disabled={busy}
                onClick={() => void excluir()}
              >
                {busy ? "Excluindo…" : "Excluir"}
              </button>
              <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={() => setConfirmarExcluir(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

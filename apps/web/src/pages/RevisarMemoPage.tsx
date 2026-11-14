import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DocumentMemoProcessResponse, MeResponse, TextMemoProcessResponse, UserIaUseLevel } from "@mymemory/shared";
import { SEMIA_PLACEHOLDER_PREFIX, USER_IA_USE_LABELS, dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import { apiDeleteJson, apiGetOptional, apiPostJson, mensagemDeErro } from "../api";
import Header from "../components/Header";
import MemoProcessOverlay, { DOCUMENT_MEMO_PROCESS_STEPS } from "../components/MemoProcessOverlay";
import { formatReviewBytes, urlFileLabel } from "../components/MemoReviewChrome";
import MemoFormulario, { useCategoriasCompletas } from "../components/catalogarNovo/MemoFormulario";
import { useMemoReviewVoiceAssistant } from "../hooks/useMemoReviewVoiceAssistant";
import { urlMediaRevisao } from "../lib/mediaRevisao";
import {
  dadosParaJson,
  gravarMemoRevisado,
  parseDadosEntries,
  percentualPreenchido,
  type DadoCampo,
  type RevisaoBase,
  type RevisaoTipo,
} from "../lib/revisaoNova";
import s from "./catalogarNovo.module.css";

/** Rota antiga de onde a revisão veio (/revisao/memo-*). */
export type RotaRevisao = "texto" | "imagem" | "audio" | "video" | "documento";

const ROTULO: Record<RevisaoTipo, string> = {
  texto: "Texto",
  url: "Página web",
  imagem: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  documento: "Documento",
};

type Fase = "carregando" | "decidindo" | "pergunta" | "gravando" | "revisao" | "erro";

interface DocState {
  memoId: number;
  groupId: number | null;
  iaUseDocumento?: UserIaUseLevel;
  /** Já processado (guardado no histórico do navegador): não processa de novo. */
  processado?: DocumentMemoProcessResponse;
}

function lerEstado(rota: RotaRevisao, raw: unknown): { tipo: RevisaoTipo; dados: RevisaoBase | null; doc: DocState | null; groupId: number | null; semDecisao: boolean } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const groupId = typeof o.groupId === "number" ? o.groupId : null;
  const semDecisao = o.semDecisao === true || o.decidido === true;
  if (rota === "documento") {
    if (typeof o.memoId !== "number") return null;
    const processado = (o.processado ?? null) as DocumentMemoProcessResponse | null;
    return {
      tipo: "documento",
      dados: processado as unknown as RevisaoBase | null,
      doc: { memoId: o.memoId, groupId, iaUseDocumento: o.iaUseDocumento as UserIaUseLevel | undefined, processado: processado ?? undefined },
      groupId,
      semDecisao,
    };
  }
  if (typeof o.suggestedMediaText !== "string" || typeof o.originalText !== "string") return null;
  const tipo: RevisaoTipo =
    rota === "texto" ? (typeof o.mediaWebUrl === "string" && o.mediaWebUrl.trim() ? "url" : "texto") : rota;
  return { tipo, dados: o as unknown as RevisaoBase, doc: null, groupId, semDecisao };
}

export default function RevisarMemoPage({ rota }: { rota: RotaRevisao }) {
  const navigate = useNavigate();
  const location = useLocation();
  const entrada = useMemo(() => lerEstado(rota, location.state), [rota, location.state]);

  const [dados, setDadosBase] = useState<RevisaoBase | null>(entrada?.dados ?? null);
  const [fase, setFase] = useState<Fase>(entrada?.tipo === "documento" && !entrada.dados ? "carregando" : "decidindo");
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [docFaseIdx, setDocFaseIdx] = useState(0);
  const docAbort = useRef<AbortController | null>(null);

  const [resumo, setResumo] = useState("");
  const [keywords, setKeywords] = useState("");
  const [campos, setCampos] = useState<DadoCampo[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [assunto, setAssunto] = useState("");
  const assuntoMexido = useRef(false);
  const [custoExtra, setCustoExtra] = useState(0);
  const [originais, setOriginais] = useState<string | null | undefined>(undefined);
  /** Categoria dos campos que estão na tela (muda com "Preencher com a IA"). */
  const [catDosCampos, setCatDosCampos] = useState<number | null>(null);
  const camposIniciais = useRef<{ cat: number | null; campos: DadoCampo[] }>({ cat: null, campos: [] });
  const [avisoTroca, setAvisoTroca] = useState<{ nome: string } | null>(null);
  const [reextraindo, setReextraindo] = useState(false);
  const [erroReextr, setErroReextr] = useState<string | null>(null);
  const [aba, setAba] = useState<"memo" | "original">("memo");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [me, setMe] = useState<{ showApiCost: boolean; soundEnabled: boolean; mult: number }>({ showApiCost: false, soundEnabled: true, mult: 100 });
  const resumoRef = useRef<HTMLTextAreaElement | null>(null);
  const kwRef = useRef<HTMLTextAreaElement | null>(null);
  const dadosRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const decidiu = useRef(false);
  /** O formulário já recebeu o que a IA montou (a decisão espera por isso). */
  const [formPronto, setFormPronto] = useState(false);

  const groupId = entrada?.groupId ?? null;
  const tipo = entrada?.tipo ?? "texto";
  const categorias = useCategoriasCompletas(groupId);

  useEffect(() => {
    void apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) return;
      const m = r.data.usdToCreditsMultiplier;
      setMe({
        showApiCost: r.data.showApiCost !== false,
        soundEnabled: r.data.soundEnabled !== false,
        mult: typeof m === "number" && m > 0 ? m : 100,
      });
    });
  }, []);

  // Documento: processa aqui, a não ser que já venha processado
  useEffect(() => {
    const doc = entrada?.doc;
    if (!doc || doc.processado) return;
    const ac = new AbortController();
    docAbort.current = ac;
    let cancelado = false;
    setFase("carregando");
    void apiPostJson<DocumentMemoProcessResponse>(
      "/api/memos/document/process",
      { memoId: doc.memoId, groupId: doc.groupId, iaUseDocumento: doc.iaUseDocumento },
      { signal: ac.signal }
    )
      .then((out) => {
        if (cancelado) return;
        const texto =
          !out.suggestedMediaText.trim() && out.iaLevel === "semIA"
            ? `${SEMIA_PLACEHOLDER_PREFIX}\nArquivo importado sem processamento de IA.\nNome do arquivo: ${out.originalFilename ?? ""}`
            : out.suggestedMediaText;
        setDadosBase({ ...(out as unknown as RevisaoBase), suggestedMediaText: texto, memoId: out.memoId });
        // guarda o resultado no histórico: recarregar a página não processa de novo
        navigate(location.pathname, { replace: true, state: { ...(location.state as object), processado: { ...out, suggestedMediaText: texto } } });
        setFase("decidindo");
      })
      .catch((e) => {
        if (cancelado) return;
        setErroCarga(e instanceof Error && e.name === "AbortError" ? "Processamento cancelado." : mensagemDeErro(e, "Falha ao processar documento."));
        setFase("erro");
      });
    return () => {
      cancelado = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrada?.doc?.memoId]);

  useEffect(() => {
    if (fase !== "carregando") return;
    setDocFaseIdx(0);
    const id = window.setInterval(() => setDocFaseIdx((i) => Math.min(i + 1, DOCUMENT_MEMO_PROCESS_STEPS.length - 1)), 4200);
    return () => window.clearInterval(id);
  }, [fase]);

  // Preenche o formulário com o que a IA montou
  useEffect(() => {
    if (!dados) return;
    setResumo(dados.suggestedMediaText);
    setKeywords(dedupeMemoKeywordsCommaSeparated(dados.suggestedKeywords));
    const c = parseDadosEntries(dados.dadosEspecificosJson);
    setCampos(c);
    setCategoryId(dados.matchedCategoryId ?? null);
    setCatDosCampos(dados.matchedCategoryId ?? null);
    camposIniciais.current = { cat: dados.matchedCategoryId ?? null, campos: c };
    setFormPronto(true);
  }, [dados]);

  // Categoria pelo nome quando o processamento não trouxe o id
  useEffect(() => {
    if (!dados || categoryId != null || !categorias || !dados.category) return;
    const m = categorias.find((c) => c.name === dados.category);
    if (m) {
      setCategoryId(m.id);
      setCatDosCampos(m.id);
      camposIniciais.current.cat = m.id;
    }
  }, [dados, categorias, categoryId]);

  const categoria = categorias?.find((c) => c.id === categoryId) ?? null;

  const gravar = useCallback(
    async (opc: { aviso: string; comAssunto: boolean }) => {
      if (!entrada || !dados) return;
      setBusy(true);
      setErro(null);
      try {
        const catNome = categorias?.find((c) => c.id === categoryId)?.name ?? (categoryId == null ? null : dados.category ?? null);
        await gravarMemoRevisado(entrada.tipo, dados, groupId, {
          mediaText: resumo,
          keywords,
          dadosEspecificosJson: dadosParaJson(campos),
          dadosEspecificosOriginaisJson: originais !== undefined ? originais : dados.dadosEspecificosOriginaisJson ?? null,
          categoryId,
          categoryName: catNome,
          custoExtra,
          tituloCurto: opc.comAssunto ? assunto : null,
        });
        navigate("/", { replace: true, state: { memoSavedAt: Date.now(), memoAviso: opc.aviso } });
      } catch (e) {
        setErro(mensagemDeErro(e, "Falha ao salvar."));
        setFase("revisao");
      } finally {
        setBusy(false);
      }
    },
    [entrada, dados, categorias, categoryId, groupId, resumo, keywords, campos, originais, custoExtra, assunto, navigate]
  );

  // Regra da categoria: gravar direto, perguntar (abaixo do %) ou abrir a revisão
  useEffect(() => {
    if (fase !== "decidindo" || !dados || !categorias || !formPronto || decidiu.current) return;
    if (dados.matchedCategoryId == null && dados.category && categoryId == null && categorias.some((c) => c.name === dados.category)) return; // espera achar pelo nome
    decidiu.current = true;
    const cat = categorias.find((c) => c.id === categoryId) ?? null;
    const entries = parseDadosEntries(dados.dadosEspecificosJson);
    const p = percentualPreenchido(cat?.campos ?? [], entries);
    setPct(p);
    const marcar = () => navigate(location.pathname, { replace: true, state: { ...(location.state as object), decidido: true } });
    const precisaRevisar =
      entrada?.semDecisao ||
      !cat ||
      cat.revisaoSempre ||
      dados.iaLevel === "semIA" ||
      Boolean(dados.processingWarning?.trim()) ||
      dados.pipelineUsed === "skip_extract" ||
      !dados.suggestedMediaText.trim() ||
      dados.suggestedMediaText.length > dados.maxSummaryChars;
    if (precisaRevisar) {
      setFase("revisao");
      return;
    }
    if (p >= cat.revisaoMinPct) {
      setFase("gravando");
      void gravar({ aviso: `Memo salvo em ${cat.name} (${p}%)`, comAssunto: false });
      return;
    }
    marcar();
    setFase("pergunta");
  }, [fase, dados, categorias, formPronto, categoryId, entrada?.semDecisao, gravar, navigate, location.pathname, location.state]);

  // Sugestão de Assunto quando a revisão abre
  useEffect(() => {
    if (fase !== "revisao" || !dados || dados.iaLevel === "semIA" || !resumo.trim() || assunto) return;
    let vivo = true;
    void apiPostJson<{ titulo: string; costUsd: number }>("/api/memos/titulo-sugerido", {
      mediaType: tipo,
      mediaText: resumo,
      keywords,
      category: categoria?.name ?? null,
      originalFileName: dados.originalFilename ?? null,
    })
      .then((r) => {
        if (!vivo) return;
        if (r.costUsd > 0) setCustoExtra((c) => c + r.costUsd);
        if (!assuntoMexido.current && r.titulo) setAssunto(r.titulo);
      })
      .catch(() => {
        /* sem sugestão: a pessoa escreve ou o robô gera depois */
      });
    return () => {
      vivo = false;
    };
    // só uma vez, ao abrir a revisão
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase === "revisao"]);

  const setDado = useCallback((key: string, value: string) => {
    setCampos((prev) => (prev.some((e) => e.key === key) ? prev.map((e) => (e.key === key ? { ...e, value } : e)) : [...prev, { key, value }]));
  }, []);

  const trocarCategoria = (id: number | null) => {
    setCategoryId(id);
    setErroReextr(null);
    const nova = categorias?.find((c) => c.id === id) ?? null;
    if (id === camposIniciais.current.cat) {
      setCampos(camposIniciais.current.campos);
      setCatDosCampos(id);
      setAvisoTroca(null);
      setOriginais(undefined);
      return;
    }
    // Campos originais eram da categoria anterior: não valem para a nova (o ↻ Re-processar refaz).
    setOriginais(null);
    const antes = campos;
    setCampos((nova?.campos ?? []).map((c) => ({ key: c.name, value: antes.find((e) => e.key.toLowerCase() === c.name.toLowerCase())?.value ?? "" })));
    setAvisoTroca(nova ? { nome: nova.name } : null);
  };

  const preencherIA = async () => {
    if (!dados || categoryId == null) return;
    setReextraindo(true);
    setErroReextr(null);
    try {
      const r = await apiPostJson<TextMemoProcessResponse>("/api/memos/reextrair", {
        texto: dados.originalText.trim() || resumo,
        groupId,
        categoryId,
        maxSummaryChars: dados.maxSummaryChars,
      });
      setKeywords(dedupeMemoKeywordsCommaSeparated(r.suggestedKeywords));
      setCampos(parseDadosEntries(r.dadosEspecificosJson));
      setOriginais(r.dadosEspecificosOriginaisJson ?? null);
      setCustoExtra((c) => c + (r.apiCost || 0));
      setCatDosCampos(categoryId);
      setAvisoTroca(null);
    } catch (e) {
      setErroReextr(mensagemDeErro(e, "Falha ao re-processar."));
    } finally {
      setReextraindo(false);
    }
  };

  const descartar = useCallback(async () => {
    if (entrada?.tipo === "documento" && entrada.doc?.memoId) {
      try {
        await apiDeleteJson(`/api/memos/${entrada.doc.memoId}`);
      } catch {
        /* volta mesmo assim */
      }
    }
    navigate("/", { replace: true });
  }, [entrada, navigate]);

  const over = dados != null && resumo.length > dados.maxSummaryChars;
  const precisaTexto = tipo === "texto" || tipo === "url" || tipo === "documento";
  const podeSalvar = dados != null && !busy && !over && (!precisaTexto || resumo.trim().length > 0);

  const onSalvar = useCallback(() => {
    if (!dados) return;
    if (over) {
      setErro(`O resumo passou do máximo de ${dados.maxSummaryChars} caracteres.`);
      return;
    }
    if (precisaTexto && !resumo.trim()) {
      setErro("Escreva o resumo do memo.");
      return;
    }
    void gravar({ aviso: `Memo salvo${categoria ? ` em ${categoria.name}` : ""}`, comAssunto: true });
  }, [dados, over, precisaTexto, resumo, gravar, categoria]);

  const voice = useMemoReviewVoiceAssistant({
    soundEnabled: me.soundEnabled,
    active: fase === "revisao",
    suspenso: reextraindo,
    mediaText: resumo,
    setMediaText: setResumo,
    keywords,
    setKeywords,
    textAreaRef: resumoRef,
    keywordsAreaRef: kwRef,
    onSave: onSalvar,
    canSave: podeSalvar,
    setError: setErro,
    dadosEntries: campos,
    setDadosEntry: setDado,
    dadosInputRefs: dadosRefs,
  });

  if (!entrada) {
    return (
      <>
        <Header />
        <div className={s.page}>
          <p>Nada para revisar. Volte e catalogue um memo.</p>
        </div>
      </>
    );
  }

  if (fase === "carregando") {
    return (
      <>
        <Header />
        <MemoProcessOverlay
          title="Processando o documento"
          titleId="nm-doc-process"
          hint="Não feche a página."
          steps={DOCUMENT_MEMO_PROCESS_STEPS}
          activeStepIndex={docFaseIdx}
          onDiscard={() => {
            docAbort.current?.abort();
            void descartar();
          }}
        />
      </>
    );
  }
  if (fase === "erro" || !dados) {
    return (
      <>
        <Header />
        <div className={s.page}>
          <p className={s.erro}>{erroCarga ?? "Não foi possível abrir a revisão."}</p>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={() => void descartar()}>
            Voltar
          </button>
        </div>
      </>
    );
  }
  if (fase === "decidindo" || fase === "gravando") {
    return (
      <>
        <Header />
        <div className={s.carregando}>{fase === "gravando" ? "Salvando o memo…" : "Conferindo o memo…"}</div>
      </>
    );
  }

  const nomeArquivo =
    tipo === "url"
      ? urlFileLabel(dados.mediaWebUrl ?? "")
      : tipo === "texto"
        ? "Texto colado"
        : dados.originalFilename ?? "arquivo";
  const tamanho =
    tipo === "texto" || tipo === "url"
      ? `${dados.originalText.length.toLocaleString("pt-BR")} caracteres`
      : typeof dados.tamMediaUrl === "number"
        ? formatReviewBytes(dados.tamMediaUrl)
        : "";

  const avisoTopo = (() => {
    if (categoria?.revisaoSempre && categoryId === camposIniciais.current.cat) {
      return { texto: `${categoria.name}: sempre revisar antes de salvar.`, sub: " Esta categoria pede conferência em todo memo.", info: true };
    }
    if (dados.processingWarning?.trim()) return { texto: "Aviso do processamento", sub: ` ${dados.processingWarning.trim()}` };
    if (pct > 0 && categoria && pct < categoria.revisaoMinPct && !avisoTroca) {
      return { texto: `A IA preencheu ${pct}% dos campos (o mínimo de ${categoria.name} é ${categoria.revisaoMinPct}%).`, sub: " Confira e complete antes de salvar." };
    }
    return null;
  })();

  const custoTotal = dados.apiCost + custoExtra;

  return (
    <>
      <Header />
      <div className={s.page}>
        <div className={s.topo}>
          <button type="button" className={s.voltar} aria-label="Descartar e voltar" onClick={() => void descartar()}>
            ‹
          </button>
          <h1>Revisar antes de salvar</h1>
          <span className={s.tipo}>{ROTULO[tipo]}</span>
          <span className={s.sp} />
        </div>
        <div style={{ height: 10 }} />

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
            <Original tipo={tipo} d={dados} nomeArquivo={nomeArquivo} tamanho={tamanho} onZoom={() => setZoom(true)} />
          </div>
          <div className={aba === "original" ? s.escondeCel : ""}>
            {me.soundEnabled ? <div className={s.voz}>{voice.voiceBanner}</div> : null}
            {categorias ? (
              <MemoFormulario
                categorias={categorias}
                categoryId={categoryId}
                onTrocarCategoria={trocarCategoria}
                avisoTroca={catDosCampos === categoryId ? null : avisoTroca}
                onPreencherIA={() => void preencherIA()}
                reextraindo={reextraindo}
                erroReextrair={erroReextr}
                avisoTopo={avisoTopo}
                assunto={assunto}
                setAssunto={(v) => {
                  assuntoMexido.current = true;
                  setAssunto(v);
                }}
                assuntoPlaceholder={dados.iaLevel === "semIA" ? "ex.: Visita técnica na fazenda" : "a IA está sugerindo…"}
                resumo={resumo}
                setResumo={setResumo}
                maxChars={dados.maxSummaryChars}
                keywords={keywords}
                setKeywords={setKeywords}
                dados={campos}
                setDado={setDado}
                destacarVazios={pct > 0 && categoria != null && pct < categoria.revisaoMinPct}
                tituloIa={dados.iaLevel !== "semIA"}
                resumoRef={resumoRef}
                keywordsRef={kwRef}
                dadosRefs={dadosRefs}
                voz={voice}
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
          {me.showApiCost ? (
            <details className={`${s.detalhes} ${s.nota}`}>
              <summary>Uso de IA: {USER_IA_USE_LABELS[dados.iaLevel]} · Detalhes</summary>
              <p>
                Custo API (USD): {custoTotal.toFixed(6)} · Créditos estimados:{" "}
                {(custoTotal * me.mult).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
                {dados.pipelineUsed ? ` · Processamento: ${dados.pipelineUsed}` : ""}
                {dados.source ? ` · Origem do texto: ${dados.source}` : ""}
              </p>
            </details>
          ) : null}
          <span className={s.sp} />
          <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={() => void descartar()}>
            Descartar
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={!podeSalvar} onClick={onSalvar}>
            {busy ? "Salvando…" : "✓ Salvar memo"}
          </button>
        </div>
      </div>

      {fase === "pergunta" && categoria ? (
        <div className={s.fundo} role="dialog" aria-modal="true" aria-labelledby="nm-pergunta">
          <div className={s.cartao}>
            <h2 id="nm-pergunta">A IA preencheu {pct}% dos campos</h2>
            <p>
              <b>{categoria.name}</b>
              {dados.suggestedMediaText ? ` · ${dados.suggestedMediaText.slice(0, 90)}${dados.suggestedMediaText.length > 90 ? "…" : ""}` : ""}
            </p>
            <p>O mínimo desta categoria é {categoria.revisaoMinPct}%. O memo ainda não foi gravado.</p>
            <div className={s.barra}>
              <div>
                <i style={{ width: `${pct}%` }} />
              </div>
              <b>{pct}% preenchido</b>
            </div>
            <div className={s.cartaoBotoes}>
              <button type="button" className="mm-btn mm-btn--primary" onClick={() => setFase("revisao")}>
                Editar
              </button>
              <button
                type="button"
                className="mm-btn mm-btn--ghost"
                disabled={busy}
                onClick={() => {
                  setFase("gravando");
                  void gravar({ aviso: `Memo salvo em ${categoria.name} (${pct}%)`, comAssunto: false });
                }}
              >
                Gravar assim
              </button>
              <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={() => void descartar()}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {zoom && dados.mediaImageUrl ? (
        <div className={s.zoom} role="presentation" onClick={() => setZoom(false)}>
          <img src={urlMediaRevisao(dados.mediaImageUrl)} alt="Imagem original" />
        </div>
      ) : null}
    </>
  );
}

function Recolhido({ titulo, sub, texto, aberto }: { titulo: string; sub?: string; texto: string; aberto?: boolean }) {
  if (!texto.trim()) return null;
  return (
    <details className={s.recolher} open={aberto}>
      <summary>
        {titulo}
        {sub ? <small>{sub}</small> : null}
      </summary>
      <div className={s.textoOriginal}>{texto}</div>
    </details>
  );
}

function Original({
  tipo,
  d,
  nomeArquivo,
  tamanho,
  onZoom,
}: {
  tipo: RevisaoTipo;
  d: RevisaoBase;
  nomeArquivo: string;
  tamanho: string;
  onZoom: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const caracteres = `${d.originalText.length.toLocaleString("pt-BR")} caracteres`;
  const copiar = () => {
    void navigator.clipboard?.writeText(d.originalText).then(() => {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    });
  };
  const linkTopo = (href: string, rotulo: string) => (
    <a className={s.bhLink} href={href} target="_blank" rel="noreferrer">
      {rotulo} ↗
    </a>
  );

  let corpo: JSX.Element;
  let topo: JSX.Element | null = null;
  let extra: JSX.Element | null = null;
  if (tipo === "texto") {
    topo = (
      <button type="button" className={s.bhLink} onClick={copiar}>
        {copiado ? "Copiado" : "Copiar"}
      </button>
    );
    corpo = <div className={s.textoOriginal}>{d.originalText}</div>;
  } else if (tipo === "url") {
    const href = d.mediaWebUrl ?? "";
    topo = linkTopo(href, "Abrir a página");
    corpo = (
      <div className={s.site}>
        <div className={s.siteTopo}>{href}</div>
        <div className={s.siteRodape}>{caracteres} de texto lidos da página</div>
      </div>
    );
    extra = <Recolhido titulo="Texto da página" sub={caracteres} texto={d.originalText} />;
  } else if (tipo === "imagem") {
    const src = urlMediaRevisao(d.mediaImageUrl);
    topo = (
      <button type="button" className={s.bhLink} onClick={onZoom}>
        Ampliar
      </button>
    );
    const porOcr = d.source === "ocr_text";
    corpo = (
      <>
        <div className={s.midiaFundo}>
          <img src={src} alt={`Imagem: ${nomeArquivo}`} onClick={onZoom} />
        </div>
        {d.source && d.source !== "none" ? (
          <div className={s.leitura}>
            <span className={`${s.etq} ${porOcr ? s.etqOk : s.etqIa}`}>{porOcr ? "leitura boa" : "lida pela IA"}</span>
            {porOcr ? "Texto lido pelo OCR, sem precisar da IA de imagem" : "A IA de imagem descreveu e leu a imagem"}
          </div>
        ) : null}
      </>
    );
    extra = <Recolhido titulo="Texto lido na imagem" sub={caracteres} texto={d.originalText} />;
  } else if (tipo === "audio") {
    corpo = (
      <div className={s.midiaFundo}>
        <audio src={urlMediaRevisao(d.mediaAudioUrl)} controls preload="metadata" />
      </div>
    );
    extra = <Recolhido titulo="Transcrição" sub={caracteres} texto={d.originalText} aberto />;
  } else if (tipo === "video") {
    corpo = (
      <div className={s.midiaFundo}>
        <video src={urlMediaRevisao(d.mediaVideoUrl)} controls playsInline preload="metadata" />
      </div>
    );
    extra = <Recolhido titulo="Transcrição do vídeo" sub={caracteres} texto={d.originalText} />;
  } else {
    const href = urlMediaRevisao(d.mediaDocumentUrl ?? "");
    topo = linkTopo(href, "Abrir o arquivo");
    const ehPdf = (d.mime ?? "").includes("pdf") || /\.pdf$/i.test(d.originalFilename ?? "");
    corpo =
      d.pipelineUsed === "skip_extract" ? (
        <div className={s.aviso} style={{ margin: 0 }}>
          <span aria-hidden>ⓘ</span>
          <div>
            <b>Não deu para ler o texto deste arquivo.</b>
            Escreva o resumo e as palavras-chave ao lado.
          </div>
        </div>
      ) : ehPdf ? (
        <div className={s.midiaFundo}>
          <iframe className={s.pdf} src={`${href}#toolbar=0&view=FitH`} title={nomeArquivo} />
        </div>
      ) : (
        <div className={s.textoOriginal}>{d.originalText.slice(0, 1500) || "—"}</div>
      );
    extra = ehPdf ? <Recolhido titulo="Texto extraído do documento" sub={caracteres} texto={d.originalText} /> : null;
  }

  return (
    <div className={s.box}>
      <div className={s.bh}>
        Original<span className={s.sp} />
        {topo}
      </div>
      <div className={s.bb}>{corpo}</div>
      {extra}
      <div className={s.arquivo}>
        <b>{nomeArquivo}</b>
        {tamanho ? <span>· {tamanho}</span> : null}
      </div>
    </div>
  );
}

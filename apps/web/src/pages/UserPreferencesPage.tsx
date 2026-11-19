import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import type {
  MeResponse,
  PatchMePreferencesResponse,
  UserIaUseLevel,
  UserMemoPreferences,
  UserUsageDashboardResponse,
  UserUsageMetric,
} from "@mymemory/shared";
import { USER_IA_USE_LEVELS } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPatchJson, apiPostJson, mensagemDeErro } from "../api";
import Header from "../components/Header";
import styles from "./ContaPage.module.css";

/** Minha conta — lote 4 do redesenho: Perfil e senha, Preferências (salvas sozinhas) e Uso do plano. */

type Secao = "perfil" | "prefs" | "uso";

function prefsFromMe(me: MeResponse): UserMemoPreferences {
  return {
    confirmEnabled: me.confirmEnabled !== false,
    soundEnabled: me.soundEnabled !== false,
    allowFreeSpecificFieldsWithoutCategoryMatch: me.allowFreeSpecificFieldsWithoutCategoryMatch === true,
    iaUseTexto: me.iaUseTexto ?? "basico",
    iaUseImagem: me.iaUseImagem ?? "basico",
    iaUseVideo: me.iaUseVideo ?? "basico",
    iaUseAudio: me.iaUseAudio ?? "basico",
    iaUseDocumento: me.iaUseDocumento ?? "basico",
    iaUseUrl: me.iaUseUrl ?? "basico",
    imageOcrVisionMinConfidence: me.imageOcrVisionMinConfidence ?? null,
    ttsRate: me.ttsRate ?? null,
    pdfAbrirAba: me.pdfAbrirAba === true,
  };
}

/** Nomes curtos dos níveis de IA nesta tela. */
const NIVEL_IA: Record<UserIaUseLevel, string> = { semIA: "Sem IA", basico: "Básico", completo: "Completo" };

const TIPOS_IA = [
  ["iaUseTexto", "Texto"],
  ["iaUseImagem", "Imagem"],
  ["iaUseAudio", "Áudio"],
  ["iaUseVideo", "Vídeo"],
  ["iaUseDocumento", "Documento"],
  ["iaUseUrl", "Página da web"],
] as const;

function iniciais(nome: string | null | undefined, email: string | null | undefined): string {
  const base = (nome ?? "").trim() || (email ?? "").trim();
  const partes = base.split(/[\s@._-]+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "?") + (partes[1]?.[0] ?? "")).toUpperCase();
}

function fmt(n: number, dec: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function BarraUso(props: { titulo: string; metric: UserUsageMetric; dec?: number; unidade?: string; nota: string }) {
  const { titulo, metric, dec = 0, unidade = "", nota } = props;
  const pct = metric.limit != null && metric.limit > 0 ? Math.min(100, (metric.used / metric.limit) * 100) : 0;
  const perto = metric.limit != null && metric.limit > 0 && metric.used / metric.limit >= 0.8;
  const excedido = metric.limit != null && metric.limit > 0 && metric.used > metric.limit;
  return (
    <section className={`${styles.cartao} ${styles.uso} ${perto ? styles.usoPerto : ""}`}>
      <div className={styles.usoTopo}>
        <h2 className={styles.usoTitulo}>{titulo}</h2>
        <span className={styles.usoValor}>
          <b>
            {fmt(metric.used, dec)}
            {unidade}
          </b>{" "}
          {metric.limit != null ? `de ${fmt(metric.limit, dec)}${unidade}` : "· sem limite"}
        </span>
      </div>
      <div className={styles.barra} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={titulo}>
        <div className={styles.barraCheia} style={{ width: `${pct}%` }} />
      </div>
      <span className={perto ? styles.usoAviso : styles.usoNota}>
        {excedido
          ? "Passou do limite do plano. Por enquanto o uso continua liberado."
          : perto
            ? "Perto do limite. Passando dele, o uso continua liberado por enquanto."
            : nota}
      </span>
    </section>
  );
}

export default function UserPreferencesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const secao: Secao = rawTab === "uso" ? "uso" : rawTab === "perfil" ? "perfil" : "prefs";
  const irPara = useCallback(
    (s: Secao) => setSearchParams(s === "prefs" ? {} : { tab: s }, { replace: true }),
    [setSearchParams]
  );

  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [prefs, setPrefs] = useState<UserMemoPreferences | null>(null);
  const [hasPrefsColumns, setHasPrefsColumns] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [estadoSalvar, setEstadoSalvar] = useState<"" | "salvando" | "salvo" | "erro">("");
  const editadoRef = useRef(false);

  const [usage, setUsage] = useState<UserUsageDashboardResponse | null>(null);
  const [usageErr, setUsageErr] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [perfilMsg, setPerfilMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [senhaMsg, setSenhaMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGetOptional<MeResponse>("/api/me");
      if (cancelled) return;
      if (!r.ok) {
        if (r.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setErr(`Não foi possível carregar a conta (HTTP ${r.status}).`);
        setReady(true);
        return;
      }
      setMe(r.data);
      setNome(r.data.name ?? "");
      setPrefs(prefsFromMe(r.data));
      setHasPrefsColumns(r.data.iaUseTexto !== undefined);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (secao !== "uso" || !ready) return;
    let cancelled = false;
    setUsageErr(null);
    void apiGet<UserUsageDashboardResponse>("/api/me/usage")
      .then((d) => !cancelled && setUsage(d))
      .catch((e) => !cancelled && setUsageErr(mensagemDeErro(e, "Falha ao carregar o uso do plano.")));
    return () => {
      cancelled = true;
    };
  }, [secao, ready]);

  // Preferências salvas sozinhas, 0,6 s depois da última mudança
  useEffect(() => {
    if (!prefs || !editadoRef.current) return;
    setEstadoSalvar("salvando");
    const t = window.setTimeout(async () => {
      try {
        const body: Partial<UserMemoPreferences> = hasPrefsColumns
          ? prefs
          : { soundEnabled: prefs.soundEnabled, ttsRate: prefs.ttsRate, pdfAbrirAba: prefs.pdfAbrirAba };
        await apiPatchJson<PatchMePreferencesResponse>("/api/me/preferences", body);
        setEstadoSalvar("salvo");
      } catch (e) {
        setErr(mensagemDeErro(e, "Não foi possível salvar."));
        setEstadoSalvar("erro");
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [prefs, hasPrefsColumns]);

  const mudar = useCallback(<K extends keyof UserMemoPreferences>(key: K, value: UserMemoPreferences[K]) => {
    editadoRef.current = true;
    setErr(null);
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
  }, []);

  async function salvarNome() {
    setOcupado(true);
    setPerfilMsg(null);
    try {
      const r = await apiPatchJson<{ ok: boolean; name: string }>("/api/me/perfil", { name: nome });
      setMe((m) => (m ? { ...m, name: r.name } : m));
      setPerfilMsg({ ok: true, texto: "Nome salvo." });
    } catch (e) {
      setPerfilMsg({ ok: false, texto: mensagemDeErro(e, "Não foi possível salvar o nome.") });
    } finally {
      setOcupado(false);
    }
  }

  async function trocarSenha() {
    setOcupado(true);
    setSenhaMsg(null);
    try {
      await apiPostJson("/api/me/senha", { senhaAtual, senhaNova });
      setSenhaAtual("");
      setSenhaNova("");
      setSenhaMsg({ ok: true, texto: "Senha trocada." });
    } catch (e) {
      setSenhaMsg({ ok: false, texto: mensagemDeErro(e, "Não foi possível trocar a senha.") });
    } finally {
      setOcupado(false);
    }
  }

  // Aba antiga "Perguntas salvas": agora tem página própria
  if (rawTab === "perguntas") return <Navigate to="/perguntas-salvas" replace />;

  if (!ready || !prefs) {
    return (
      <>
        <Header />
        <main className={styles.pagina}>
          <p className="mm-muted">{err ?? "Carregando…"}</p>
        </main>
      </>
    );
  }

  const bloqueado = hasPrefsColumns === false;

  return (
    <>
      <Header meRefreshKey={0} />
      <div className={styles.pagina}>
        <nav className={styles.menu} aria-label="Minha conta">
          <div className={styles.quem}>
            <span className={styles.avatar} aria-hidden>
              {iniciais(me?.name, me?.email)}
            </span>
            <span className={styles.quemTexto}>
              <b>{me?.name || "Sem nome"}</b>
              <span>{me?.email}</span>
            </span>
          </div>
          {(
            [
              ["perfil", "Perfil e senha"],
              ["prefs", "Preferências"],
              ["uso", "Uso do plano"],
            ] as const
          ).map(([s, rotulo]) => (
            <button
              key={s}
              type="button"
              className={`${styles.item} ${secao === s ? styles.itemAtivo : ""}`}
              aria-current={secao === s ? "page" : undefined}
              onClick={() => irPara(s)}
            >
              {rotulo}
            </button>
          ))}
          <div className={styles.separador} />
          <Link to="/perguntas-salvas" className={styles.item}>
            Perguntas salvas ↗
          </Link>
          <Link to="/avisos" className={styles.item}>
            Avisos e lembretes ↗
          </Link>
        </nav>

        <main className={styles.conteudo}>
          {secao === "perfil" ? (
            <>
              <h1 className={styles.titulo}>Perfil e senha</h1>
              <section className={styles.cartao}>
                <h2 className={styles.cartaoTitulo}>Seu nome</h2>
                <div className={styles.linhaForm}>
                  <label htmlFor="conta-nome" className={styles.rotulo}>
                    Nome
                  </label>
                  <input id="conta-nome" className={styles.campo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
                  <button type="button" className="mm-btn mm-btn--primary" disabled={ocupado || nome.trim().length < 2 || nome.trim() === (me?.name ?? "")} onClick={() => void salvarNome()}>
                    Salvar
                  </button>
                </div>
                <p className={styles.nota}>
                  E-mail: <b>{me?.email}</b> (é o seu login; não dá para trocar aqui).
                </p>
                {perfilMsg ? <p className={perfilMsg.ok ? styles.ok : styles.erro}>{perfilMsg.texto}</p> : null}
              </section>
              <section className={styles.cartao}>
                <h2 className={styles.cartaoTitulo}>Trocar a senha</h2>
                <div className={styles.grade2}>
                  <div className={styles.coluna}>
                    <label htmlFor="conta-senha-atual" className={styles.rotulo}>
                      Senha atual
                    </label>
                    <input id="conta-senha-atual" type="password" autoComplete="current-password" className={styles.campo} value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
                  </div>
                  <div className={styles.coluna}>
                    <label htmlFor="conta-senha-nova" className={styles.rotulo}>
                      Senha nova <span className={styles.nota}>(mínimo 8 caracteres)</span>
                    </label>
                    <input id="conta-senha-nova" type="password" autoComplete="new-password" className={styles.campo} value={senhaNova} onChange={(e) => setSenhaNova(e.target.value)} />
                  </div>
                </div>
                <div>
                  <button type="button" className="mm-btn mm-btn--primary" disabled={ocupado || !senhaAtual || senhaNova.length < 8} onClick={() => void trocarSenha()}>
                    Trocar a senha
                  </button>
                </div>
                {senhaMsg ? <p className={senhaMsg.ok ? styles.ok : styles.erro}>{senhaMsg.texto}</p> : null}
                <p className={styles.nota}>
                  Esqueceu a senha atual? <Link to="/esqueci-senha">Receber um link por e-mail</Link>.
                </p>
              </section>
            </>
          ) : null}

          {secao === "prefs" ? (
            <>
              <div className={styles.tituloLinha}>
                <h1 className={styles.titulo}>Preferências</h1>
                <span className={estadoSalvar === "erro" ? styles.erro : styles.salvo} aria-live="polite">
                  {estadoSalvar === "salvando" ? "Salvando…" : estadoSalvar === "salvo" ? "✓ Salvo automaticamente" : estadoSalvar === "erro" ? "Não foi possível salvar" : "Salva sozinha a cada mudança"}
                </span>
              </div>
              {err ? <p className={styles.erro}>{err}</p> : null}

              <section className={`${styles.cartao} ${bloqueado ? styles.bloqueado : ""}`}>
                <h2 className={styles.cartaoTitulo}>Ao catalogar</h2>
                <label className={styles.opcao}>
                  <span>
                    Conferir antes de mandar para a IA
                    <small>Depois de escolher o arquivo, você confirma antes do processamento.</small>
                  </span>
                  <input type="checkbox" role="switch" disabled={bloqueado} checked={prefs.confirmEnabled} onChange={(e) => mudar("confirmEnabled", e.target.checked)} />
                </label>
                <label className={styles.opcao}>
                  <span>
                    Guardar campos que não são da categoria
                    <small>Se a IA achar dados que a categoria não prevê, eles ficam no memo mesmo assim.</small>
                  </span>
                  <input type="checkbox" role="switch" disabled={bloqueado} checked={prefs.allowFreeSpecificFieldsWithoutCategoryMatch} onChange={(e) => mudar("allowFreeSpecificFieldsWithoutCategoryMatch", e.target.checked)} />
                </label>
                <div className={styles.opcao}>
                  <label htmlFor="conta-ocr">
                    Fotos pouco nítidas: ler com IA de imagem
                    <small>Abaixo desta nitidez (1 a 100), a IA olha a imagem — custo extra só nesses casos. Vazio = desligado.</small>
                  </label>
                  <input
                    id="conta-ocr"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    className={styles.campoCurto}
                    disabled={bloqueado}
                    placeholder="Desligado"
                    value={prefs.imageOcrVisionMinConfidence ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (raw === "") return mudar("imageOcrVisionMinConfidence", null);
                      const n = Number.parseInt(raw, 10);
                      if (Number.isFinite(n) && n >= 1 && n <= 100) mudar("imageOcrVisionMinConfidence", n);
                    }}
                  />
                </div>
              </section>

              <section className={`${styles.cartao} ${bloqueado ? styles.bloqueado : ""}`}>
                <h2 className={styles.cartaoTitulo}>Quanto de IA usar em cada tipo</h2>
                <p className={styles.nota}>
                  Vale para os memos novos. <b>Sem IA</b>: só guarda. <b>Básico</b>: palavras-chave e categoria. <b>Completo</b>: também os campos da categoria.
                </p>
                <div className={styles.gradeIa}>
                  {TIPOS_IA.map(([key, rotulo]) => (
                    <div key={key} className={styles.linhaIa}>
                      <span className={styles.rotuloIa}>{rotulo}</span>
                      <span className={styles.segmentos} role="radiogroup" aria-label={rotulo}>
                        {USER_IA_USE_LEVELS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={prefs[key] === v}
                            disabled={bloqueado}
                            className={`${styles.segmento} ${prefs[key] === v ? styles.segmentoAtivo : ""}`}
                            onClick={() => mudar(key, v)}
                          >
                            {NIVEL_IA[v]}
                          </button>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.cartao}>
                <h2 className={styles.cartaoTitulo}>Voz e respostas</h2>
                <label className={styles.opcao}>
                  <span>
                    Voz ligada
                    <small>Lê as respostas em voz alta e deixa usar o microfone.</small>
                  </span>
                  <input type="checkbox" role="switch" checked={prefs.soundEnabled} onChange={(e) => mudar("soundEnabled", e.target.checked)} />
                </label>
                {prefs.soundEnabled ? (
                  <div className={styles.opcao}>
                    <label htmlFor="conta-voz">Velocidade da voz</label>
                    <span className={styles.velocidade}>
                      Lenta
                      <input id="conta-voz" type="range" min={0.5} max={2} step={0.1} value={prefs.ttsRate ?? 1} onChange={(e) => mudar("ttsRate", Number(e.target.value))} />
                      Rápida <b>{fmt(prefs.ttsRate ?? 1, 1)}×</b>
                    </span>
                  </div>
                ) : null}
                <label className={styles.opcao}>
                  <span>
                    Abrir o PDF numa aba nova
                    <small>Em vez de baixar o arquivo.</small>
                  </span>
                  <input type="checkbox" role="switch" checked={prefs.pdfAbrirAba} onChange={(e) => mudar("pdfAbrirAba", e.target.checked)} />
                </label>
              </section>
            </>
          ) : null}

          {secao === "uso" ? (
            <>
              <h1 className={styles.titulo}>Uso do plano</h1>
              {usageErr ? <p className={styles.erro}>{usageErr}</p> : null}
              {!usage && !usageErr ? <p className="mm-muted">Carregando…</p> : null}
              {usage ? (
                <>
                  <section className={`${styles.cartao} ${styles.plano}`}>
                    <div>
                      <span className={styles.sobretitulo}>Seu plano</span>
                      <span className={styles.planoNome}>{usage.planName}</span>
                      <span className={styles.nota}>Os créditos de IA voltam a zero todo mês.</span>
                    </div>
                  </section>
                  <div className={styles.grade2}>
                    <BarraUso titulo="Memos" metric={usage.memos} nota="Os memos dos grupos contam no plano de cada grupo." />
                    <BarraUso titulo="Armazenamento" metric={usage.storageGB} dec={2} unidade=" GB" nota="Fotos, áudios, vídeos e documentos guardados." />
                    <BarraUso titulo="Créditos de IA (este mês)" metric={usage.apiCreditsMonth} dec={2} nota="O que a IA gastou para você neste mês." />
                    <BarraUso titulo="Downloads (este mês)" metric={usage.downloadsMonthGB} dec={2} unidade=" GB" nota="Arquivos originais abertos ou baixados." />
                  </div>
                  {usage.creditosPorArea ? (
                    <section className={styles.cartao}>
                      <h2 className={styles.cartaoTitulo}>Onde a IA foi usada este mês</h2>
                      <div className={styles.grade4}>
                        {(
                          [
                            ["Catalogar", usage.creditosPorArea.catalogar],
                            ["Perguntar", usage.creditosPorArea.perguntar],
                            ["Importar em lote", usage.creditosPorArea.lote],
                            ["Avisos", usage.creditosPorArea.avisos],
                          ] as const
                        ).map(([rotulo, valor]) => (
                          <div key={rotulo} className={styles.area}>
                            <span>{rotulo}</span>
                            <b>{fmt(valor, 2)} créditos</b>
                          </div>
                        ))}
                      </div>
                      {usage.creditosPorArea.outros > 0 ? (
                        <p className={styles.nota}>Outros usos: {fmt(usage.creditosPorArea.outros, 2)} créditos.</p>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
    </>
  );
}

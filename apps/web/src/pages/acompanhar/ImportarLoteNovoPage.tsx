import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  BatchFileSituacao,
  BatchFileVerifyResult,
  BatchProcessJobStatus,
  BatchProcessResponse,
  BatchProcessStartResponse,
  BatchVerifyResponse,
  MeResponse,
  StorageProvider,
} from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPostJson, apiPostMultipart, apiPutJson } from "../../api";
import Header from "../../components/Header";
import { BatchFilePreviewModal } from "../../components/BatchFilePreviewModal";
import {
  AutomacaoModal,
  IA_ROTULO,
  rotuloIntervalo,
  type Automacao,
  type Execucao,
  type Form as AutomacaoForm,
} from "../../components/AutomacoesImportacao";
import {
  IconArrowLeft,
  IconCheck,
  IconDoc,
  IconEdit,
  IconFolder,
  IconHistory,
  IconInfo,
  IconLink,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServer,
  IconTrash,
  IconUser,
  IconUsers,
} from "../../components/icons";
import styles from "./acompanhar.module.css";

/** Lote 3: Importar em lote (novo visual) em 3 passos + abas Importações automáticas e Extrair dono do memo. */

type IaLevel = "semIA" | "basico" | "completo";
type Aba = "importar" | "automaticas" | "sem-dono";

interface StorageConfigOption {
  id: number;
  label: string;
  url: string;
  pathPrefix: string | null;
  isDefault: boolean;
}

const ORIGENS: { value: StorageProvider; label: string; dica: string; icone: "folder" | "server" | "link"; emBreve?: boolean }[] = [
  { value: "LOCAL", label: "Disco local", dica: "pasta do seu computador", icone: "folder" },
  { value: "REDE", label: "Rede local", dica: "pasta da rede \\\\servidor", icone: "server" },
  { value: "WEBDAV", label: "WebDAV", dica: "servidor da empresa", icone: "server" },
  { value: "ONEDRIVE", label: "OneDrive", dica: "em breve", icone: "folder", emBreve: true },
  { value: "GOOGLE_DRIVE", label: "Google Drive", dica: "em breve", icone: "folder", emBreve: true },
  { value: "URL", label: "Link (URL)", dica: "em breve", icone: "link", emBreve: true },
];
const EXEMPLO: Partial<Record<StorageProvider, string>> = {
  WEBDAV: "Ex.: http://192.168.1.10:19401/contratos",
};
const IAS: { value: IaLevel; label: string; desc: string }[] = [
  { value: "semIA", label: "Sem IA", desc: "Guarda o texto. Você completa depois." },
  { value: "basico", label: "Básico", desc: "Categoria e palavras-chave." },
  { value: "completo", label: "Completo", desc: "Também os campos da categoria. Recomendado." },
];

/** Situação em português simples, como no mockup aprovado. */
const SITUACAO: Record<BatchFileSituacao, { rotulo: string; classe: string }> = {
  pronto: { rotulo: "Pronto", classe: styles.tagOk },
  suspeito_duplicidade: { rotulo: "Parece repetido", classe: styles.tagAviso },
  ja_cadastrado: { rotulo: "Já cadastrado", classe: styles.tagMudo },
  formato_nao_suportado: { rotulo: "Não dá para importar", classe: styles.tagErro },
  muito_grande: { rotulo: "Não dá para importar", classe: styles.tagErro },
  erro_acesso: { rotulo: "Não dá para importar", classe: styles.tagErro },
};
const MOTIVO_PADRAO: Partial<Record<BatchFileSituacao, string>> = {
  formato_nao_suportado: "Tipo de arquivo não aceito",
  muito_grande: "Arquivo grande demais",
  erro_acesso: "Não foi possível abrir o arquivo",
};
const TIPO: Record<string, string> = { text: "Texto", image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento" };

const JOB_KEY = "mm_importar_lote_job";
/** Igual ao limite do servidor por lote. */
const MAX_POR_VEZ = 50;
const DICA_DONO = "Sobras da importação: arquivos que caíram numa categoria Pessoal, mas o proMemory não achou no documento de quem é o memo. Escolha a pessoa e toque em Atribuir.";
type JobSalvo = { jobId: string; total: number; arquivos: string[]; groupId: number | null };
/** Disco local e Rede local: a pasta é escolhida no navegador e os arquivos são enviados (o original é descartado). */
const peloNavegador = (p: StorageProvider) => p === "LOCAL" || p === "REDE";
/** O navegador só informa o caminho a partir da pasta escolhida. */
const chaveArquivo = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;

function lerJob(): JobSalvo | null {
  try { return JSON.parse(localStorage.getItem(JOB_KEY) ?? "null") as JobSalvo | null; } catch { return null; }
}
function gravarJob(j: JobSalvo | null) {
  try { if (j) localStorage.setItem(JOB_KEY, JSON.stringify(j)); else localStorage.removeItem(JOB_KEY); } catch { /* sem storage */ }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
function msgErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; }
}
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const importavel = (f: BatchFileVerifyResult) => f.situacao === "pronto" || f.situacao === "suspeito_duplicidade";

function IconeOrigem({ tipo }: { tipo: "folder" | "server" | "link" }) {
  if (tipo === "server") return <IconServer size={22} />;
  if (tipo === "link") return <IconLink size={22} />;
  return <IconFolder size={22} />;
}

// ─── Passos ──────────────────────────────────────────────────────────────────

function Passos({ atual }: { atual: 0 | 1 | 2 }) {
  const nomes = ["Escolher a pasta", "Conferir os arquivos", "Importar"];
  return (
    <div className={styles.passos}>
      {nomes.map((n, i) => (
        <div key={n} className={`${styles.passo} ${i === atual ? styles.passoOn : i < atual ? styles.passoOk : ""}`}>
          <i>{i < atual ? "✓" : i + 1}</i><span>{n}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Aba Importações automáticas ─────────────────────────────────────────────

const FORM_NOVO = (pasta: string, iaLevel: IaLevel): AutomacaoForm => ({
  pasta, iaLevel, intervaloMin: 60, copiarArquivo: false, limiteExecucao: 50, avisarEmail: true, ativo: true,
});

function AbaAutomaticas(props: {
  groupId: number;
  lista: Automacao[];
  recarregar: () => Promise<void>;
  novo: { pasta: string; iaLevel: IaLevel } | null;
  setNovo: (n: { pasta: string; iaLevel: IaLevel } | null) => void;
}) {
  const { lista, recarregar } = props;
  const [editando, setEditando] = useState<Automacao | null>(null);
  const [historico, setHistorico] = useState<{ id: number; itens: Execucao[] } | null>(null);
  const [confirmar, setConfirmar] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!lista.some((a) => a.executandoDesde)) return;
    const t = setInterval(() => void recarregar(), 5000);
    return () => clearInterval(t);
  }, [lista, recarregar]);

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); } catch (e) { setErro(msgErro(e)); }
    await recarregar();
  }
  async function verHistorico(id: number) {
    if (historico?.id === id) { setHistorico(null); return; }
    try {
      const r = await apiGet<{ execucoes: Execucao[] }>(`/api/batch-automacoes/${id}/execucoes`);
      setHistorico({ id, itens: r.execucoes });
    } catch (e) { setErro(msgErro(e)); }
  }
  const formDe = (a: Automacao): AutomacaoForm => ({
    pasta: a.pasta, iaLevel: a.iaLevel, intervaloMin: a.intervaloMin, copiarArquivo: a.copiarArquivo,
    limiteExecucao: a.limiteExecucao, avisarEmail: a.avisarEmail, ativo: a.ativo,
  });

  return (
    <>
      <div className={styles.ferramentas} style={{ marginBottom: 14 }}>
        <span className={styles.muted} style={{ fontSize: 13, flex: "1 1 300px" }}>
          O servidor olha estas pastas sozinho e importa os arquivos novos que estiverem <b>Prontos</b>. Repetidos ficam de fora.
        </span>
        <button type="button" className="mm-btn mm-btn--primary" onClick={() => props.setNovo({ pasta: "", iaLevel: "completo" })}>
          <IconPlus size={14} /> Nova importação automática
        </button>
      </div>
      {erro ? <p className="mm-error">{erro}</p> : null}
      {!lista.length ? (
        <div className={styles.vazio}><b>Nenhuma importação automática neste grupo.</b>Crie uma aqui ou, depois de conferir uma pasta em Importar agora, toque em Automatizar esta pasta.</div>
      ) : null}
      {lista.map((a) => {
        const erroUlt = a.ultimoStatus === "erro";
        return (
          <div key={a.id} className={styles.auto}>
            <div className={styles.autoTopo}>
              <IconFolder size={18} style={{ color: "var(--mm-primary)", flex: "none" }} />
              <code>{a.pasta}</code>
              <span className={styles.sp} />
              {a.executandoDesde ? (
                <span className={`${styles.tag}`}>Rodando agora…</span>
              ) : (
                <span className={`${styles.st} ${a.ativo ? "" : styles.stOff}`}>
                  {a.ativo ? "Ligada" : "Pausada"}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={a.ativo}
                    aria-label={a.ativo ? "Pausar" : "Ligar"}
                    className={`${styles.chave} ${a.ativo ? "" : styles.chaveOff}`}
                    onClick={() => void acao(() => apiPutJson(`/api/batch-automacoes/${a.id}`, { ...formDe(a), ativo: !a.ativo }))}
                  />
                </span>
              )}
            </div>
            <div className={styles.autoLinha}>
              <span>a cada {rotuloIntervalo(a.intervaloMin)}</span>
              <span>IA {IA_ROTULO[a.iaLevel]}</span>
              <span>até {a.limiteExecucao} por vez</span>
              <span>{a.copiarArquivo ? "copia o arquivo" : "só referencia o arquivo"}</span>
              <span>criada por {a.criador ?? "—"}</span>
            </div>
            <div className={`${styles.ultimaExec} ${erroUlt ? styles.ultimaExecErro : ""}`}>
              Última: {fmt(a.ultimaExecucao)}
              {a.ultimoResumo ? <> · {erroUlt ? <b>erro: </b> : null}{a.ultimoResumo}</> : null}
              {a.ativo && !a.executandoDesde ? <> · próxima {fmt(a.proximaExecucao)}</> : null}
            </div>
            <div className={styles.autoAcoes}>
              <button type="button" className="mm-btn mm-btn--ghost" disabled={!!a.executandoDesde}
                onClick={() => void acao(() => apiPostJson(`/api/batch-automacoes/${a.id}/executar`, {}))}><IconPlay size={13} /> Executar agora</button>
              <button type="button" className="mm-btn mm-btn--ghost" onClick={() => void verHistorico(a.id)}>
                <IconHistory size={13} /> {historico?.id === a.id ? "Ocultar histórico" : "Histórico"}
              </button>
              <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setEditando(a)}><IconEdit size={13} /> Editar</button>
              <button type="button" className="mm-btn mm-btn--ghost" style={{ color: "var(--mm-danger)" }} onClick={() => setConfirmar(a.id)}><IconTrash size={13} /> Excluir</button>
            </div>
            {confirmar === a.id ? (
              <div className={styles.confirma} style={{ marginTop: 8 }}>
                Excluir esta importação automática? Os memos já importados continuam.
                <span className={styles.sp} />
                <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setConfirmar(null)}>Cancelar</button>
                <button type="button" className="mm-btn mm-btn--primary" style={{ background: "var(--mm-danger)", borderColor: "var(--mm-danger)" }}
                  onClick={() => { setConfirmar(null); void acao(() => apiDeleteJson(`/api/batch-automacoes/${a.id}`)); }}>Excluir</button>
              </div>
            ) : null}
            {historico?.id === a.id ? (
              <ul className={styles.historico}>
                {historico.itens.length === 0 ? <li className={styles.muted}>Ainda não executou.</li> : null}
                {historico.itens.map((e) => (
                  <li key={e.id} style={{ color: e.status === "erro" ? "var(--mm-danger)" : undefined }}>
                    {fmt(e.inicio)} ({e.origem === "manual" ? "manual" : "agendada"}): {e.mensagem}
                    {e.detalhes?.erros?.length ? <ul>{e.detalhes.erros.slice(0, 5).map((x) => <li key={x.arquivo}>{x.arquivo}: {x.erro}</li>)}</ul> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}

      {props.novo ? (
        <AutomacaoModal
          groupId={props.groupId}
          editandoId={null}
          inicial={FORM_NOVO(props.novo.pasta, props.novo.iaLevel)}
          onFechar={() => props.setNovo(null)}
          onSalvo={() => { props.setNovo(null); void recarregar(); }}
        />
      ) : null}
      {editando ? (
        <AutomacaoModal
          groupId={props.groupId}
          editandoId={editando.id}
          inicial={formDe(editando)}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); void recarregar(); }}
        />
      ) : null}
    </>
  );
}

// ─── Aba Extrair dono do memo ──────────────────────────────────────────────────────

type Membro = { id: number; name: string | null; email: string | null };
type SemDono = {
  id: number; category: string | null; titulo?: string | null; resumo: string; campo: string | null; valor: string | null;
  motivo: string; donoAtualId: number; createdAt: string;
};
const rotuloMembro = (m: Membro) => (m.name ? `${m.name}${m.email ? ` (${m.email})` : ""}` : m.email ?? `#${m.id}`);

function AbaSemDono(props: { itens: SemDono[]; membros: Membro[]; groupId: number; recarregar: () => Promise<void> }) {
  const [escolha, setEscolha] = useState<Record<number, number>>({});
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const nomeDe = (id: number) => {
    const m = props.membros.find((x) => x.id === id);
    return m ? (m.name ?? m.email ?? `#${id}`) : `#${id}`;
  };

  async function atribuir(memoId: number) {
    const dono = escolha[memoId];
    if (!dono) return;
    setOcupado(memoId);
    setErro(null);
    try {
      await apiPostJson(`/api/memos/${memoId}/atribuir-dono`, { groupId: props.groupId, userId: dono });
      await props.recarregar();
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      <div className={styles.banner} style={{ margin: "0 0 12px" }}>
        <IconInfo size={16} />
        <div>
          <b>Sobras da importação.</b> Arquivos que caíram numa categoria <b>Pessoal</b>, mas o proMemory não achou no documento de quem é o memo
          (nome vazio, nome que ninguém do grupo tem ou duas pessoas com o mesmo nome). Até você escolher a pessoa e tocar em Atribuir, o memo fica com quem importou.
        </div>
      </div>
      {erro ? <p className="mm-error">{erro}</p> : null}
      {!props.itens.length ? (
        <div className={styles.vazio}><b>Nenhum memo esperando dono.</b>Tudo certo por aqui.</div>
      ) : (
        <div className={styles.painel} style={{ padding: "4px 6px" }}>
          <div className={styles.tabelaWrap}>
            <table className={styles.tabela}>
              <thead><tr><th>Memo</th><th>Categoria</th><th>Campo dono</th><th>Por quê</th><th>Dono</th><th /></tr></thead>
              <tbody>
                {props.itens.map((i) => (
                  <tr key={i.id}>
                    <td style={{ minWidth: 180 }}>
                      <b title={i.resumo}>{i.titulo ?? (i.resumo.length > 60 ? `${i.resumo.slice(0, 60)}…` : i.resumo || `Memo #${i.id}`)}</b>
                      <div className={styles.muted} style={{ fontSize: 11.5 }}>#{i.id} · com {nomeDe(i.donoAtualId)} · {new Date(i.createdAt).toLocaleDateString("pt-BR")}</div>
                    </td>
                    <td>{i.category ? <span className={styles.tag}>{i.category}</span> : "—"}</td>
                    <td>
                      {i.valor ? <span className={`${styles.tag} ${styles.tagMudo}`}>{i.campo ? `${i.campo}: ` : ""}{i.valor}</span> : <span className={styles.campoVazio} title={i.campo ? `${i.campo} vazio` : "vazio"} />}
                    </td>
                    <td className={styles.porque}>{i.motivo}</td>
                    <td>
                      <select className={styles.campo} style={{ minWidth: 170 }} value={escolha[i.id] ?? ""} onChange={(e) => setEscolha((p) => ({ ...p, [i.id]: Number(e.target.value) }))} aria-label="Escolher a pessoa">
                        <option value="">escolher pessoa</option>
                        {props.membros.map((m) => <option key={m.id} value={m.id}>{rotuloMembro(m)}</option>)}
                      </select>
                    </td>
                    <td>
                      <button type="button" className="mm-btn mm-btn--primary" disabled={!escolha[i.id] || ocupado != null} onClick={() => void atribuir(i.id)}>
                        {ocupado === i.id ? "…" : "Atribuir"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function ImportarLoteNovoPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const abaParam = params.get("aba");
  const aba: Aba = abaParam === "automaticas" || abaParam === "sem-dono" ? abaParam : "importar";
  const [me, setMe] = useState<MeResponse | null>(null);

  // passo 1
  const [provider, setProvider] = useState<StorageProvider>("LOCAL");
  const [folderPath, setFolderPath] = useState("");
  const [iaLevel, setIaLevel] = useState<IaLevel>("completo");
  const [webdavConfigs, setWebdavConfigs] = useState<StorageConfigOption[]>([]);
  const [webdavId, setWebdavId] = useState<number | null>(null);
  const [escolhidos, setEscolhidos] = useState<Map<string, File>>(new Map());
  const [nomePasta, setNomePasta] = useState("");
  const inputPasta = useRef<HTMLInputElement>(null);
  const inputArquivos = useRef<HTMLInputElement>(null);
  // passo 2
  const [verify, setVerify] = useState<BatchVerifyResponse | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [mostrarJa, setMostrarJa] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<BatchFileVerifyResult | null>(null);
  // passo 3
  const [job, setJob] = useState<JobSalvo | null>(null);
  const [envio, setEnvio] = useState<{ feitos: number; total: number } | null>(null);
  const [status, setStatus] = useState<BatchProcessJobStatus | null>(null);
  const [resultado, setResultado] = useState<BatchProcessResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // abas extras
  const [automacoes, setAutomacoes] = useState<Automacao[] | null>(null);
  const [semDono, setSemDono] = useState<{ itens: SemDono[]; membros: Membro[] } | null>(null);
  const [novaAuto, setNovaAuto] = useState<{ pasta: string; iaLevel: IaLevel } | null>(null);
  const iaInicial = useRef(false);

  useEffect(() => {
    apiGet<MeResponse>("/api/me").then(setMe).catch(() => navigate("/login"));
  }, [navigate]);
  useEffect(() => {
    if (me && !iaInicial.current) {
      iaInicial.current = true;
      setIaLevel((me.iaUseDocumento ?? me.iaUseTexto ?? "completo") as IaLevel);
    }
  }, [me]);

  const groupId = me?.lastWorkspaceGroupId ?? null;
  const destino = groupId != null ? me?.groupLabel ?? "Grupo" : "Pessoal";

  const carregarAutomacoes = useCallback(async () => {
    if (groupId == null) { setAutomacoes([]); return; }
    try {
      const r = await apiGet<{ automacoes: Automacao[] }>(`/api/batch-automacoes?groupId=${groupId}`);
      setAutomacoes(r.automacoes);
    } catch { setAutomacoes([]); }
  }, [groupId]);
  const carregarSemDono = useCallback(async () => {
    if (groupId == null) { setSemDono({ itens: [], membros: [] }); return; }
    try {
      setSemDono(await apiGet<{ itens: SemDono[]; membros: Membro[] }>(`/api/memos/sem-dono?groupId=${groupId}`));
    } catch { setSemDono({ itens: [], membros: [] }); }
  }, [groupId]);
  useEffect(() => { if (me) { void carregarAutomacoes(); void carregarSemDono(); } }, [me, carregarAutomacoes, carregarSemDono]);

  // WebDAV: servidores cadastrados no grupo
  useEffect(() => {
    if (provider !== "WEBDAV" || groupId == null) { setWebdavConfigs([]); setWebdavId(null); return; }
    apiGet<{ configs: StorageConfigOption[] }>(`/api/groups/${groupId}/storage-configs`)
      .then((r) => {
        setWebdavConfigs(r.configs);
        const def = r.configs.find((c) => c.isDefault) ?? r.configs[0] ?? null;
        setWebdavId(def?.id ?? null);
        if (def) setFolderPath(caminhoDe(def));
      })
      .catch(() => {});
  }, [provider, groupId]);

  // Retoma uma importação que estava rodando quando a tela foi fechada
  const acompanhar = useCallback(async (j: JobSalvo) => {
    setJob(j);
    setResultado(null);
    let falhas = 0;
    for (;;) {
      try {
        const st = await apiGet<BatchProcessJobStatus>(`/api/memos/batch/process/status/${j.jobId}`);
        falhas = 0;
        setStatus(st);
        if (st.finished) { setResultado(st); gravarJob(null); return; }
      } catch (e) {
        const msg = msgErro(e);
        if (msg.includes("job_not_found")) {
          gravarJob(null);
          setJob(null);
          setErro("O servidor perdeu o acompanhamento deste lote (provável reinício). Confira a pasta de novo: o que já entrou aparece como Já cadastrado.");
          return;
        }
        if (++falhas >= 15) { setErro("Sem resposta do servidor ao acompanhar o lote. Confira a pasta de novo para ver o que já entrou."); return; }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, []);
  useEffect(() => {
    if (!me) return;
    const j = lerJob();
    if (j && j.groupId === groupId) void acompanhar(j);
  }, [me, groupId, acompanhar]);

  function caminhoDe(c: StorageConfigOption) {
    const base = c.url.replace(/\/$/, "");
    const prefix = c.pathPrefix?.trim() ?? "";
    const sep = prefix && !prefix.startsWith("/") ? "/" : "";
    return prefix ? `${base}${sep}${prefix}` : base;
  }

  function trocarAba(nova: Aba) {
    const p = new URLSearchParams(params);
    if (nova === "importar") p.delete("aba"); else p.set("aba", nova);
    setParams(p, { replace: true });
  }

  function escolher(lista: FileList | null, pasta: boolean) {
    const m = new Map<string, File>();
    for (const f of Array.from(lista ?? [])) {
      if (f.name.startsWith(".") || f.name.startsWith("~$") || f.name === "Thumbs.db" || f.name === "desktop.ini") continue;
      m.set(chaveArquivo(f), f);
    }
    setEscolhidos(m);
    const primeiro = m.keys().next().value as string | undefined;
    setNomePasta(pasta && primeiro?.includes("/") ? primeiro.split("/")[0] : `${m.size} arquivo${m.size !== 1 ? "s" : ""} escolhido${m.size !== 1 ? "s" : ""}`);
  }

  async function verificar() {
    setErro(null);
    setVerificando(true);
    try {
      const r = peloNavegador(provider)
        ? await apiPostJson<BatchVerifyResponse>("/api/memos/batch/verify/navegador", {
            provider,
            groupId,
            files: [...escolhidos.entries()].map(([chave, f]) => ({ originalFileName: f.name, chave, sizeBytes: f.size })),
          })
        : await apiPostJson<BatchVerifyResponse>("/api/memos/batch/verify/local", { provider, folderPath: folderPath.trim(), iaLevel, groupId });
      setVerify(r);
      setSelected(new Set(r.files.filter(importavel).map((f) => f.fullPath)));
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setVerificando(false);
    }
  }

  async function importar() {
    if (!verify) return;
    const lista = verify.files.filter((f) => importavel(f) && selected.has(f.fullPath));
    if (!lista.length) return;
    setErro(null);
    if (peloNavegador(provider)) {
      await enviarPeloNavegador(lista.slice(0, MAX_POR_VEZ));
      return;
    }
    const escolhidos = lista;
    try {
      const start = await apiPostJson<BatchProcessStartResponse>("/api/memos/batch/process/local", {
        provider, folderPath: folderPath.trim(), iaLevel, groupId,
        onlyFileNames: escolhidos.map((f) => f.originalFileName),
        onlyFullPaths: escolhidos.map((f) => f.fullPath),
      });
      const j: JobSalvo = { jobId: start.jobId, total: start.totalRequested, arquivos: escolhidos.map((f) => f.originalFileName), groupId };
      gravarJob(j);
      setStatus(null);
      void acompanhar(j);
    } catch (e) {
      setErro(msgErro(e));
    }
  }

  /** Abre o lote no servidor e envia os arquivos um a um, sem deixar a fila do servidor crescer. */
  async function enviarPeloNavegador(lista: BatchFileVerifyResult[]) {
    try {
      const start = await apiPostJson<BatchProcessStartResponse>("/api/memos/batch/navegador/iniciar", {
        provider, iaLevel, groupId, nomes: lista.map((f) => f.originalFileName),
      });
      const j: JobSalvo = { jobId: start.jobId, total: start.totalRequested, arquivos: lista.map((f) => f.originalFileName), groupId };
      gravarJob(j);
      setStatus(null);
      setEnvio({ feitos: 0, total: lista.length });
      void acompanhar(j);
      for (let i = 0; i < lista.length; i++) {
        const arq = escolhidos.get(lista[i].fullPath);
        const fd = new FormData();
        if (arq) fd.append("file", arq, arq.name);
        else fd.append("file", new Blob([]), lista[i].originalFileName);
        const r = (await apiPostMultipart(`/api/memos/batch/navegador/${start.jobId}/arquivo`, fd)) as { pendentes?: number; filaMax?: number };
        setEnvio({ feitos: i + 1, total: lista.length });
        // Espera a fila do servidor andar antes de mandar o próximo (evita guardar muitos arquivos em memória)
        let pend = r.pendentes ?? 0;
        while (i < lista.length - 1 && pend >= (r.filaMax ?? 2)) {
          await new Promise((ok) => setTimeout(ok, 1500));
          const st = await apiGet<BatchProcessJobStatus>(`/api/memos/batch/process/status/${start.jobId}`);
          pend = i + 1 - st.processed;
        }
      }
    } catch (e) {
      setErro(`O envio parou: ${msgErro(e)}. O que já chegou continua sendo importado.`);
    } finally {
      setEnvio(null);
    }
  }

  function abrirEscolhido(f: BatchFileVerifyResult) {
    const arq = escolhidos.get(f.fullPath);
    if (!arq) return;
    const url = URL.createObjectURL(arq);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function recomecar() {
    setJob(null);
    setStatus(null);
    setResultado(null);
    setVerify(null);
    setSelected(new Set());
    setErro(null);
  }

  const passo: 0 | 1 | 2 = job ? 2 : verify ? 1 : 0;
  const files = verify?.files ?? [];
  const cont = useMemo(() => ({
    prontos: files.filter((f) => f.situacao === "pronto").length,
    repetidos: files.filter((f) => f.situacao === "suspeito_duplicidade").length,
    ja: files.filter((f) => f.situacao === "ja_cadastrado").length,
    nao: files.filter((f) => !importavel(f) && f.situacao !== "ja_cadastrado").length,
  }), [files]);
  const importaveis = files.filter(importavel);
  const marcados = importaveis.filter((f) => selected.has(f.fullPath));
  const todos = importaveis.length > 0 && marcados.length === importaveis.length;
  const visiveis = files.filter((f) => mostrarJa || f.situacao !== "ja_cadastrado");
  const creditos = verify ? Math.round((verify.creditEstimate[iaLevel] * marcados.length) / Math.max(1, importaveis.length)) : 0;
  const navegador = peloNavegador(provider);
  const podeVer = navegador ? escolhidos.size > 0 : provider === "WEBDAV" && folderPath.trim().length > 0;
  const acimaDoLimite = navegador && marcados.length > MAX_POR_VEZ;

  // passo 3: lista de arquivos com situação
  const concluidos = new Map((status?.results ?? []).map((r) => [r.originalFileName, r]));
  const proximoNome = job?.arquivos.find((n) => !concluidos.has(n));
  const feitos = status?.processed ?? 0;
  const total = status?.totalRequested || job?.total || 0;
  const erros = resultado?.results.filter((r) => !r.ok) ?? [];
  const nSemDono = resultado?.results.filter((r) => r.ok && r.donoPendente).length ?? 0;

  return (
    <div className={styles.shell}>
      <Header />
      <main className={`${styles.page} ${styles.pageLarga}`}>
        <div className={styles.topo}>
          <button type="button" className={styles.voltar} onClick={() => navigate(-1)} aria-label="Voltar"><IconArrowLeft size={16} /></button>
          <h1>Importar em lote</h1>
          <span className={styles.sp} />
          <span className={styles.destino}>{groupId != null ? <IconUsers size={12} /> : <IconUser size={12} />}Destino: {destino}</span>
        </div>
        <p className={styles.sub}>Registra os arquivos de uma pasta como memos, sem copiar para a nuvem.</p>

        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={aba === "importar"} className={`${styles.tab} ${aba === "importar" ? styles.tabOn : ""}`} onClick={() => trocarAba("importar")}>
            <IconFolder size={15} /> Importar agora
          </button>
          {groupId != null ? (
            <>
              <button type="button" role="tab" aria-selected={aba === "automaticas"} className={`${styles.tab} ${aba === "automaticas" ? styles.tabOn : ""}`} onClick={() => trocarAba("automaticas")}>
                <IconRefresh size={15} /> Importações automáticas {automacoes ? <span className={styles.tabN}>{automacoes.length}</span> : null}
              </button>
              {/* Só aparece quando há memo esperando dono (ou quando a aba já está aberta) */}
              {(semDono?.itens.length ?? 0) > 0 || aba === "sem-dono" ? (
                <button type="button" role="tab" aria-selected={aba === "sem-dono"} title={DICA_DONO}
                  className={`${styles.tab} ${aba === "sem-dono" ? styles.tabOn : ""}`} onClick={() => trocarAba("sem-dono")}>
                  <IconUser size={15} /> Extrair dono do memo {semDono ? <span className={styles.tabN}>{semDono.itens.length}</span> : null}
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        {aba === "automaticas" && groupId != null ? (
          automacoes ? <AbaAutomaticas groupId={groupId} lista={automacoes} recarregar={carregarAutomacoes} novo={novaAuto} setNovo={setNovaAuto} /> : <p className={styles.muted}>Carregando…</p>
        ) : aba === "sem-dono" && groupId != null ? (
          semDono ? <AbaSemDono itens={semDono.itens} membros={semDono.membros} groupId={groupId} recarregar={carregarSemDono} /> : <p className={styles.muted}>Carregando…</p>
        ) : (
          <>
            <Passos atual={passo} />
            {erro ? <p className="mm-error">{erro}</p> : null}

            {passo === 0 ? (
              <>
                <div className={styles.painel}>
                  <h2>De onde vêm os arquivos?</h2>
                  <div className={styles.origens}>
                    {ORIGENS.map((o) => (
                      <button key={o.value} type="button" disabled={o.emBreve}
                        className={`${styles.origem} ${provider === o.value ? styles.origemOn : ""}`}
                        onClick={() => { setProvider(o.value); if (o.value !== "WEBDAV") setFolderPath(""); setEscolhidos(new Map()); setNomePasta(""); }}>
                        <IconeOrigem tipo={o.icone} />{o.label}<small>{o.dica}</small>
                      </button>
                    ))}
                  </div>
                  {navegador ? (
                    <div className={styles.escolha}>
                      <div className={styles.escolhaBotoes}>
                        <button type="button" className="mm-btn mm-btn--primary" onClick={() => inputPasta.current?.click()}>
                          <IconFolder size={14} /> Escolher pasta
                        </button>
                        <button type="button" className="mm-btn mm-btn--ghost" onClick={() => inputArquivos.current?.click()}>
                          <IconDoc size={14} /> Escolher arquivos
                        </button>
                        {escolhidos.size ? (
                          <span className={styles.escolhaNome}>
                            <b>{nomePasta}</b> · {escolhidos.size} arquivo{escolhidos.size !== 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </div>
                      {/* webkitdirectory: o navegador deixa escolher uma pasta inteira (com subpastas) */}
                      <input ref={inputPasta} type="file" multiple hidden
                        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                        onChange={(e) => { escolher(e.target.files, true); e.target.value = ""; }} />
                      <input ref={inputArquivos} type="file" multiple hidden
                        onChange={(e) => { escolher(e.target.files, false); e.target.value = ""; }} />
                      <div className={`${styles.banner} ${styles.bannerAviso}`} style={{ margin: "12px 0 0" }}>
                        <IconInfo size={16} />
                        <div>
                          <b>Doc original é descartado.</b> O navegador envia os arquivos, o proMemory lê o texto e cria os memos.
                          O arquivo e o caminho dele não ficam guardados: depois não dá para abrir o original pelo memo.
                          {provider === "REDE" ? <> Na janela, abra a rede (ex.: {"\\\\servidor\\pasta"}) e escolha a pasta.</> : null}
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className={`${styles.pastaLinha} ${provider === "WEBDAV" && webdavConfigs.length ? "" : styles.pastaSo}`}>
                    {provider === "WEBDAV" && webdavConfigs.length ? (
                      <div>
                        <label className={styles.lbl} htmlFor="il-webdav">Servidor WebDAV</label>
                        <select id="il-webdav" className={styles.campo} value={webdavId ?? ""} onChange={(e) => {
                          const id = e.target.value ? Number(e.target.value) : null;
                          setWebdavId(id);
                          const c = webdavConfigs.find((x) => x.id === id);
                          setFolderPath(c ? caminhoDe(c) : "");
                        }}>
                          <option value="">Digitar o endereço</option>
                          {webdavConfigs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                    ) : null}
                    <div>
                      <label className={styles.lbl} htmlFor="il-pasta">Pasta</label>
                      <input id="il-pasta" className={styles.campo} placeholder={EXEMPLO[provider] ?? ""} value={folderPath} onChange={(e) => setFolderPath(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && folderPath.trim()) void verificar(); }} />
                    </div>
                  </div>
                  )}
                </div>
                <div className={styles.painel}>
                  <h2>Quanto a IA deve trabalhar?</h2>
                  <div className={styles.ias}>
                    {IAS.map((o) => (
                      <button key={o.value} type="button" className={`${styles.ia} ${iaLevel === o.value ? styles.iaOn : ""}`} onClick={() => setIaLevel(o.value)} aria-pressed={iaLevel === o.value}>
                        <b>{o.label}</b>{o.desc}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.barra}>
                  <span className={styles.nota}><IconInfo size={14} style={{ verticalAlign: -2 }} /> Nada é importado ainda. Primeiro você confere a lista.</span>
                  <span className={styles.sp} />
                  <button type="button" className="mm-btn mm-btn--primary" disabled={!podeVer || verificando} onClick={() => void verificar()}>
                    <IconSearch size={14} /> {verificando ? "Olhando a pasta…" : navegador ? "Conferir os arquivos" : "Ver os arquivos da pasta"}
                  </button>
                </div>
              </>
            ) : null}

            {passo === 1 && verify ? (
              <>
                <div className={styles.painel}>
                  <div className={styles.resumo}>
                    <span className={styles.pilula}><b style={{ color: "var(--mm-success)" }}>{cont.prontos}</b> pronto{cont.prontos !== 1 ? "s" : ""}</span>
                    {cont.repetidos ? <span className={styles.pilula}><b style={{ color: "var(--mm-warning)" }}>{cont.repetidos}</b> parece{cont.repetidos !== 1 ? "m" : ""} repetido{cont.repetidos !== 1 ? "s" : ""}</span> : null}
                    {cont.nao ? <span className={styles.pilula}><b style={{ color: "var(--mm-danger)" }}>{cont.nao}</b> não dá para importar</span> : null}
                    {cont.ja ? (
                      <span className={styles.pilula}><b>{cont.ja}</b> já cadastrado{cont.ja !== 1 ? "s" : ""} · <button type="button" className={styles.link} onClick={() => setMostrarJa((v) => !v)}>{mostrarJa ? "esconder" : "mostrar"}</button></span>
                    ) : null}
                    <span className={styles.sp} />
                    <span className={styles.muted} style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{navegador ? nomePasta : folderPath} · {files.length} arquivo{files.length !== 1 ? "s" : ""}</span>
                  </div>
                  {!files.length ? <p className={styles.muted}>Nenhum arquivo nesta pasta.</p> : (
                    <div className={styles.tabelaWrap}>
                      <table className={styles.tabela}>
                        <thead>
                          <tr>
                            <th style={{ width: 30 }}>
                              <input type="checkbox" checked={todos} disabled={!importaveis.length}
                                ref={(el) => { if (el) el.indeterminate = marcados.length > 0 && !todos; }}
                                onChange={() => setSelected(todos ? new Set() : new Set(importaveis.map((f) => f.fullPath)))}
                                aria-label="Marcar ou desmarcar todos" />
                            </th>
                            <th>Arquivo</th><th>Tipo</th><th>Tamanho</th><th>Situação</th><th>Por quê</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visiveis.map((f) => {
                            const s = SITUACAO[f.situacao];
                            return (
                              <tr key={f.fullPath}>
                                <td>{importavel(f) ? (
                                  <input type="checkbox" checked={selected.has(f.fullPath)} aria-label={`Importar ${f.originalFileName}`}
                                    onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(f.fullPath)) n.delete(f.fullPath); else n.add(f.fullPath); return n; })} />
                                ) : null}</td>
                                <td>
                                  <span className={styles.arq}>
                                    <IconDoc size={15} />
                                    <button type="button" className={styles.arqNome} title="Ver o arquivo" onClick={() => (navegador ? abrirEscolhido(f) : setPreview(f))}>{f.originalFileName}</button>
                                  </span>
                                </td>
                                <td>{f.mediaType ? TIPO[f.mediaType] ?? f.mediaType : "—"}</td>
                                <td style={{ whiteSpace: "nowrap" }}>{formatBytes(f.sizeBytes)}</td>
                                <td><span className={`${styles.tag} ${s.classe}`}>{s.rotulo}</span></td>
                                <td className={styles.porque}>{f.motivo || MOTIVO_PADRAO[f.situacao] || ""}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div className={styles.barra}>
                  <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setVerify(null)}><IconArrowLeft size={14} /> Trocar a pasta</button>
                  {groupId != null && !navegador ? (
                    <button type="button" className="mm-btn mm-btn--ghost" onClick={() => { setNovaAuto({ pasta: folderPath.trim(), iaLevel }); trocarAba("automaticas"); }}>
                      <IconRefresh size={14} /> Automatizar esta pasta
                    </button>
                  ) : null}
                  <span className={styles.sp} />
                  {acimaDoLimite ? <span className={styles.nota}>Vão os {MAX_POR_VEZ} primeiros; o resto, na próxima vez.</span> : null}
                  <span className={styles.nota}>IA {IA_ROTULO[iaLevel]} · cerca de <b>{creditos}</b> crédito{creditos !== 1 ? "s" : ""}</span>
                  <button type="button" className="mm-btn mm-btn--primary" disabled={!marcados.length} onClick={() => void importar()}>
                    <IconCheck size={14} /> Importar {Math.min(marcados.length, navegador ? MAX_POR_VEZ : Infinity)} arquivo{marcados.length !== 1 ? "s" : ""}
                  </button>
                </div>
              </>
            ) : null}

            {passo === 2 && job ? (
              resultado ? (
                <div className={styles.painel}>
                  <h2>Pronto! Resultado</h2>
                  <div className={styles.numeros}>
                    <div className={styles.nOk}><b>{resultado.totalCreated}</b>memo{resultado.totalCreated !== 1 ? "s" : ""} criado{resultado.totalCreated !== 1 ? "s" : ""}</div>
                    <div className={styles.nErro}><b>{resultado.totalErrors}</b>com erro</div>
                    <div className={styles.nAviso}><b>{nSemDono}</b>sem dono</div>
                  </div>
                  {erros.map((r) => (
                    <div key={r.originalFileName} className={`${styles.banner} ${styles.bannerAviso}`} style={{ margin: "0 0 8px" }}>
                      <IconInfo size={16} /><div><b>{r.originalFileName}</b>: {r.error ?? "erro ao importar"}</div>
                    </div>
                  ))}
                  {nSemDono ? (
                    <div className={styles.banner} style={{ margin: "0 0 12px" }}>
                      <IconUser size={16} />
                      <div>{nSemDono} memo{nSemDono !== 1 ? "s" : ""} de categoria Pessoal ficou sem dono. <button type="button" className={styles.link} onClick={() => { void carregarSemDono(); trocarAba("sem-dono"); }}>Escolher o dono</button></div>
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="mm-btn mm-btn--primary" onClick={() => navigate("/?tab=buscar")}><IconSearch size={14} /> Ver os memos no Buscar</button>
                    <button type="button" className="mm-btn mm-btn--ghost" onClick={recomecar}>Importar outra pasta</button>
                  </div>
                </div>
              ) : (
                <div className={styles.painel}>
                  <h2>Importando…</h2>
                  <div className={styles.grande}>{feitos} <span className={styles.muted} style={{ fontSize: 16, fontWeight: 600 }}>de {total}</span></div>
                  <div className={styles.progresso}><i style={{ width: `${total ? Math.round((feitos / total) * 100) : 0}%` }} /></div>
                  {envio ? (
                    <p className={styles.muted} style={{ margin: "0 0 10px", fontSize: 12.5 }}>
                      <b style={{ color: "var(--mm-warning)" }}>Enviando {envio.feitos} de {envio.total}. Não feche esta tela até terminar o envio.</b>
                    </p>
                  ) : (
                    <p className={styles.muted} style={{ margin: "0 0 10px", fontSize: 12.5 }}>
                      Pode fechar esta tela: a importação continua no servidor e, quando você voltar, o resultado aparece aqui.
                    </p>
                  )}
                  <div className={styles.lista}>
                    {job.arquivos.slice(0, 200).map((n) => {
                      const r = concluidos.get(n);
                      return (
                        <div key={n}>
                          {r ? (r.ok ? <span className={`${styles.tag} ${styles.tagOk}`}>✓</span> : <span className={`${styles.tag} ${styles.tagErro}`}>!</span>)
                            : n === proximoNome ? <span className={styles.tag}>…</span> : <span className={`${styles.tag} ${styles.tagMudo}`}>·</span>}
                          <span style={{ overflowWrap: "anywhere", fontWeight: n === proximoNome ? 700 : 400 }}>{n}</span>
                          <small>{r ? (r.ok ? (r.memoId ? `memo #${r.memoId}` : "criado") : <span style={{ color: "var(--mm-danger)" }}>{r.error}</span>) : n === proximoNome ? "lendo…" : "na fila"}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            ) : null}
          </>
        )}
      </main>

      {preview ? <BatchFilePreviewModal file={preview} provider={provider} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

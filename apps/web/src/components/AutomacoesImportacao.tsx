import { useCallback, useEffect, useState } from "react";
import { apiDeleteJson, apiGet, apiPostJson, apiPutJson } from "../api";

type IaLevel = "semIA" | "basico" | "completo";

export interface Automacao {
  id: number;
  groupId: number;
  pasta: string;
  iaLevel: IaLevel;
  intervaloMin: number;
  copiarArquivo: boolean;
  limiteExecucao: number;
  avisarEmail: boolean;
  ativo: boolean;
  proximaExecucao: string | null;
  executandoDesde: string | null;
  ultimaExecucao: string | null;
  ultimoStatus: string | null;
  ultimoResumo: string | null;
  falhasSeguidas: number;
  criador: string | null;
}

type Execucao = {
  id: number;
  origem: string;
  inicio: string;
  fim: string | null;
  status: string;
  importados: number;
  erros: number;
  semDono: number;
  mensagem: string | null;
  detalhes: { erros?: { arquivo: string; erro: string }[] } | null;
};

type Form = Omit<Automacao, "id" | "groupId" | "proximaExecucao" | "executandoDesde" | "ultimaExecucao" | "ultimoStatus" | "ultimoResumo" | "falhasSeguidas" | "criador">;

const INTERVALOS: { min: number; rotulo: string }[] = [
  { min: 15, rotulo: "15 minutos" },
  { min: 30, rotulo: "30 minutos" },
  { min: 60, rotulo: "1 hora" },
  { min: 360, rotulo: "6 horas" },
  { min: 1440, rotulo: "1 dia" },
];
const rotuloIntervalo = (m: number) => INTERVALOS.find((i) => i.min === m)?.rotulo ?? `${m} min`;
const IA_ROTULO: Record<IaLevel, string> = { semIA: "Sem IA", basico: "Básico", completo: "Completo" };
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

function msgErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; }
}

/** Janela "Automatizar": verifica a pasta ao abrir (erro em vermelho + "Verificar de novo") e salva. */
function AutomacaoModal(props: {
  groupId: number;
  inicial: Form;
  editandoId: number | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [form, setForm] = useState<Form>(props.inicial);
  const [verif, setVerif] = useState<{ estado: "verificando" | "ok" | "erro"; texto: string }>({ estado: "verificando", texto: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const verificar = useCallback(async (pasta: string) => {
    setVerif({ estado: "verificando", texto: "" });
    try {
      const r = await apiPostJson<{ ok: boolean; arquivos?: number; erro?: string }>("/api/batch-automacoes/verificar", { groupId: props.groupId, pasta });
      setVerif(r.ok
        ? { estado: "ok", texto: `Pasta acessível: ${r.arquivos ?? 0} arquivo(s) encontrado(s).` }
        : { estado: "erro", texto: r.erro ?? "Pasta inacessível." });
    } catch (e) {
      setVerif({ estado: "erro", texto: msgErro(e) });
    }
  }, [props.groupId]);

  useEffect(() => { void verificar(props.inicial.pasta); }, [verificar, props.inicial.pasta]);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      if (props.editandoId) await apiPutJson(`/api/batch-automacoes/${props.editandoId}`, form);
      else await apiPostJson("/api/batch-automacoes", { ...form, groupId: props.groupId });
      props.onSalvo();
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) props.onFechar(); }}>
      <div className="mm-modal" role="dialog" aria-modal="true" style={{ maxWidth: 600, width: "100%" }}>
        <h3 style={{ marginTop: 0 }}>{props.editandoId ? "Editar importação automática" : "Automatizar importação"}</h3>
        <p className="mm-muted" style={{ fontSize: "0.85rem" }}>
          A cada intervalo o servidor verifica a pasta e importa os arquivos novos com situação <strong>Pronto</strong>.
          Suspeitos e já cadastrados ficam de fora.
        </p>

        <label style={{ display: "grid", gap: "0.3rem", marginBottom: "0.6rem" }}>
          <strong>Pasta</strong>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input className="mm-field" style={{ flex: 1 }} value={form.pasta} onChange={(e) => set("pasta", e.target.value)} />
            <button type="button" className="mm-btn mm-btn--ghost" onClick={() => void verificar(form.pasta)} disabled={verif.estado === "verificando"}>
              {verif.estado === "verificando" ? "Verificando…" : "Verificar de novo"}
            </button>
          </div>
          {verif.estado === "erro" ? (
            <span style={{ color: "var(--mm-danger)", fontSize: "0.85rem" }} role="alert">Não dá para automatizar: {verif.texto}</span>
          ) : verif.estado === "ok" ? (
            <span style={{ color: "var(--mm-success)", fontSize: "0.85rem" }}>{verif.texto}</span>
          ) : null}
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.6rem" }}>
          <label style={{ display: "grid", gap: "0.3rem" }}>
            <strong>Verificar a cada</strong>
            <select className="mm-field" value={form.intervaloMin} onChange={(e) => set("intervaloMin", Number(e.target.value))}>
              {INTERVALOS.map((i) => <option key={i.min} value={i.min}>{i.rotulo}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.3rem" }}>
            <strong>Nível de IA</strong>
            <select className="mm-field" value={form.iaLevel} onChange={(e) => set("iaLevel", e.target.value as IaLevel)}>
              <option value="semIA">Sem IA</option>
              <option value="basico">Básico</option>
              <option value="completo">Completo (com busca semântica)</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.3rem" }}>
            <strong>Máximo por execução</strong>
            <input className="mm-field" type="number" min={1} max={500} value={form.limiteExecucao}
              onChange={(e) => set("limiteExecucao", Math.max(1, Math.min(500, Number(e.target.value) || 1)))} />
          </label>
        </div>

        <label style={{ display: "flex", gap: "0.5rem", marginTop: "0.7rem" }}>
          <input type="checkbox" checked={form.copiarArquivo} onChange={(e) => set("copiarArquivo", e.target.checked)} />
          <span>Copiar o arquivo para o armazenamento do MyMemory <span className="mm-muted">(como o Catalogar; desmarcado = só referencia o arquivo na pasta)</span></span>
        </label>
        <label style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
          <input type="checkbox" checked={form.avisarEmail} onChange={(e) => set("avisarEmail", e.target.checked)} />
          <span>Enviar resumo por e-mail quando importar algo ou der erro</span>
        </label>
        <label style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
          <input type="checkbox" checked={form.ativo} onChange={(e) => set("ativo", e.target.checked)} />
          <span>Ativa</span>
        </label>

        {erro ? <p className="mm-error">{erro}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={props.onFechar}>Cancelar</button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={salvando || verif.estado !== "ok"} onClick={() => void salvar()}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Importação automática do grupo: lista de automações, "Executar agora", pausar/reativar, editar,
 * excluir e histórico. `novo` abre a janela já com a pasta e o nível de IA da tela de importação.
 */
export function AutomacoesImportacao(props: {
  groupId: number;
  novo: { pasta: string; iaLevel: IaLevel } | null;
  onFecharNovo: () => void;
}) {
  const [lista, setLista] = useState<Automacao[]>([]);
  const [editando, setEditando] = useState<Automacao | null>(null);
  const [historico, setHistorico] = useState<{ id: number; itens: Execucao[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await apiGet<{ automacoes: Automacao[] }>(`/api/batch-automacoes?groupId=${props.groupId}`);
      setLista(r.automacoes);
    } catch {
      setLista([]); // viewer: sem permissão, a seção não aparece
    }
  }, [props.groupId]);

  useEffect(() => { void carregar(); }, [carregar]);
  // Enquanto alguma roda, atualiza a lista a cada 5 s
  useEffect(() => {
    if (!lista.some((a) => a.executandoDesde)) return;
    const t = setInterval(() => void carregar(), 5000);
    return () => clearInterval(t);
  }, [lista, carregar]);

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); } catch (e) { setErro(msgErro(e)); }
    await carregar();
  }

  async function verHistorico(id: number) {
    if (historico?.id === id) { setHistorico(null); return; }
    try {
      const r = await apiGet<{ execucoes: Execucao[] }>(`/api/batch-automacoes/${id}/execucoes`);
      setHistorico({ id, itens: r.execucoes });
    } catch (e) {
      setErro(msgErro(e));
    }
  }

  const formDe = (a: Automacao): Form => ({
    pasta: a.pasta, iaLevel: a.iaLevel, intervaloMin: a.intervaloMin, copiarArquivo: a.copiarArquivo,
    limiteExecucao: a.limiteExecucao, avisarEmail: a.avisarEmail, ativo: a.ativo,
  });

  return (
    <>
      {props.novo ? (
        <AutomacaoModal
          groupId={props.groupId}
          editandoId={null}
          inicial={{ pasta: props.novo.pasta, iaLevel: props.novo.iaLevel, intervaloMin: 60, copiarArquivo: false, limiteExecucao: 50, avisarEmail: true, ativo: true }}
          onFechar={props.onFecharNovo}
          onSalvo={() => { props.onFecharNovo(); void carregar(); }}
        />
      ) : null}
      {editando ? (
        <AutomacaoModal
          groupId={props.groupId}
          editandoId={editando.id}
          inicial={formDe(editando)}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); void carregar(); }}
        />
      ) : null}

      {lista.length ? (
        <div style={{ marginTop: "1.5rem" }}>
          <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.5rem" }}>Importações automáticas deste espaço</h2>
          {erro ? <p className="mm-error">{erro}</p> : null}
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {lista.map((a) => (
              <div key={a.id} style={{ border: "1px solid var(--mm-border)", borderRadius: 10, padding: "0.7rem 0.9rem" }}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div style={{ minWidth: 0 }}>
                    <code style={{ wordBreak: "break-all" }}>{a.pasta}</code>
                    <div className="mm-muted" style={{ fontSize: "0.82rem" }}>
                      A cada {rotuloIntervalo(a.intervaloMin)} · IA {IA_ROTULO[a.iaLevel]} · até {a.limiteExecucao} por vez
                      {a.copiarArquivo ? " · copia o arquivo" : " · só referencia"} · criada por {a.criador ?? "—"}
                    </div>
                  </div>
                  <span style={{ fontWeight: 600, color: a.executandoDesde ? "var(--mm-primary)" : a.ativo ? "var(--mm-success)" : "var(--mm-muted)" }}>
                    {a.executandoDesde ? "Executando…" : a.ativo ? "Ativa" : "Pausada"}
                  </span>
                </div>
                <div style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
                  Última: {fmt(a.ultimaExecucao)}
                  {a.ultimoResumo ? (
                    <span style={{ color: a.ultimoStatus === "erro" ? "var(--mm-danger)" : undefined }}> — {a.ultimoResumo}</span>
                  ) : null}
                  {a.ativo && !a.executandoDesde ? <> · Próxima: {fmt(a.proximaExecucao)}</> : null}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" }}>
                  <button type="button" className="mm-btn mm-btn--ghost" disabled={!!a.executandoDesde}
                    onClick={() => void acao(() => apiPostJson(`/api/batch-automacoes/${a.id}/executar`, {}))}>Executar agora</button>
                  <button type="button" className="mm-btn mm-btn--ghost"
                    onClick={() => void acao(() => apiPutJson(`/api/batch-automacoes/${a.id}`, { ...formDe(a), ativo: !a.ativo }))}>
                    {a.ativo ? "Pausar" : "Reativar"}
                  </button>
                  <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setEditando(a)}>Editar</button>
                  <button type="button" className="mm-btn mm-btn--ghost" onClick={() => void verHistorico(a.id)}>
                    {historico?.id === a.id ? "Ocultar histórico" : "Histórico"}
                  </button>
                  <button type="button" className="mm-btn mm-btn--ghost"
                    onClick={() => { if (window.confirm("Excluir esta importação automática? Os memos já importados continuam.")) void acao(() => apiDeleteJson(`/api/batch-automacoes/${a.id}`)); }}>
                    Excluir
                  </button>
                </div>
                {historico?.id === a.id ? (
                  <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
                    {historico.itens.length === 0 ? <li className="mm-muted">Ainda não executou.</li> : null}
                    {historico.itens.map((e) => (
                      <li key={e.id} style={{ color: e.status === "erro" ? "var(--mm-danger)" : undefined }}>
                        {fmt(e.inicio)} ({e.origem === "manual" ? "manual" : "agendada"}): {e.mensagem}
                        {e.detalhes?.erros?.length ? (
                          <ul>{e.detalhes.erros.slice(0, 5).map((x) => <li key={x.arquivo}>{x.arquivo}: {x.erro}</li>)}</ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

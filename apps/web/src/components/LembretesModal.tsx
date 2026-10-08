import { useEffect, useMemo, useState } from "react";
import type {
  LembreteDestinatarioTipo,
  LembretePreviaResponse,
  LembreteRegra,
  LembreteRegraInput,
  MemoContextCampo,
} from "@mymemory/shared";
import { formatarAntecedencia, LEMBRETE_ANTECEDENCIAS_OPCOES, LEMBRETE_INTERVALOS_MIN } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPatchJson, apiPostJson } from "../api";
import styles from "./LembretesModal.module.css";

interface Props {
  categoryId: number;
  categoryName: string;
  campos: MemoContextCampo[];
  onClose: () => void;
}

/** Sugere o campo pelo nome: "Data Agenda" para data, "Horario" para horário etc. */
function sugerir(campos: MemoContextCampo[], ...padroes: RegExp[]): string {
  const ativos = campos.filter((c) => c.isActive === 1);
  for (const re of padroes) {
    const achado = ativos.find((c) => re.test(c.name.normalize("NFD").replace(/[̀-ͯ]/g, "")));
    if (achado) return achado.name;
  }
  return "";
}

function regraPadrao(campos: MemoContextCampo[]): LembreteRegraInput {
  const datas = campos.filter((c) => c.isActive === 1 && c.tipo === "date");
  return {
    ativo: true,
    campoData: datas[0]?.name ?? sugerir(campos, /data/i),
    campoHorario: sugerir(campos, /horar/i, /\bhora\b/i) || null,
    antecedenciasMin: [1440, 60],
    destinatarioTipo: "autor",
    destinatarioValor: null,
    campoAntecedencia: sugerir(campos, /lembrar antes/i, /antecedencia/i) || null,
    campoDestinatario: sugerir(campos, /destinatari/i, /lembrar quem/i) || null,
    campoLembrete: sugerir(campos, /^lembrete$/i) || null,
    modeloTexto: null,
    horarioPadrao: "08:00",
    lembrarImportados: false,
    intervaloMin: 15,
  };
}

function paraInput(r: LembreteRegra): LembreteRegraInput {
  const { id: _id, categoryId: _c, origem: _o, ultimaExecucao: _u, createdAt: _cr, updatedAt: _up, ...input } = r;
  return input;
}

const fmtDataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default function LembretesModal({ categoryId, categoryName, campos, onClose }: Props) {
  const [carregando, setCarregando] = useState(true);
  const [regra, setRegra] = useState<LembreteRegra | null>(null);
  const [form, setForm] = useState<LembreteRegraInput>(() => regraPadrao(campos));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [previa, setPrevia] = useState<LembretePreviaResponse | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);

  const camposAtivos = useMemo(() => campos.filter((c) => c.isActive === 1), [campos]);

  useEffect(() => {
    apiGet<{ regras: LembreteRegra[] }>(`/api/memo-context/categories/${categoryId}/lembretes`)
      .then((r) => {
        const memos = r.regras.find((x) => x.origem === "memos") ?? null;
        setRegra(memos);
        if (memos) setForm(paraInput(memos));
      })
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro ao carregar os lembretes."))
      .finally(() => setCarregando(false));
  }, [categoryId]);

  const set = <K extends keyof LembreteRegraInput>(k: K, v: LembreteRegraInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const alternarAntecedencia = (min: number) =>
    setForm((f) => {
      const tem = f.antecedenciasMin.includes(min);
      const lista = tem ? f.antecedenciasMin.filter((m) => m !== min) : [...f.antecedenciasMin, min];
      return { ...f, antecedenciasMin: lista.sort((a, b) => b - a) };
    });

  async function salvar() {
    setErro(null);
    setAviso(null);
    if (!form.campoData) return setErro("Escolha o campo de data.");
    if (!form.antecedenciasMin.length) return setErro("Escolha ao menos uma antecedência.");
    if (form.destinatarioTipo === "email" && !/@/.test(form.destinatarioValor ?? "")) {
      return setErro("Informe ao menos um e-mail para o destinatário fixo.");
    }
    setSalvando(true);
    try {
      if (regra) {
        await apiPatchJson(`/api/lembretes/${regra.id}`, form);
      } else {
        const { id } = await apiPostJson<{ id: number }>(`/api/memo-context/categories/${categoryId}/lembretes`, form);
        const r = await apiGet<{ regras: LembreteRegra[] }>(`/api/memo-context/categories/${categoryId}/lembretes`);
        setRegra(r.regras.find((x) => x.id === id) ?? null);
      }
      setAviso("Lembretes salvos.");
      setPrevia(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!regra || !window.confirm(`Excluir os lembretes da categoria "${categoryName}"?`)) return;
    try {
      await apiDeleteJson(`/api/lembretes/${regra.id}`);
      setRegra(null);
      setForm(regraPadrao(campos));
      setPrevia(null);
      setAviso("Lembretes excluídos.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao excluir.");
    }
  }

  async function verPrevia() {
    if (!regra) return;
    setCarregandoPrevia(true);
    setErro(null);
    try {
      setPrevia(await apiGet<LembretePreviaResponse>(`/api/lembretes/${regra.id}/previa`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao gerar a prévia.");
    } finally {
      setCarregandoPrevia(false);
    }
  }

  const selectCampo = (valor: string | null, onChange: (v: string | null) => void, vazio: string, id: string) => (
    <select id={id} className="mm-field" value={valor ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{vazio}</option>
      {camposAtivos.map((c) => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
    </select>
  );

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`mm-modal ${styles.modal}`} role="dialog" aria-modal="true" aria-labelledby="lembretes-titulo" onClick={(e) => e.stopPropagation()}>
        <h3 id="lembretes-titulo" className={styles.titulo}>🔔 Lembretes — {categoryName}</h3>
        <p className={styles.intro}>
          Envia e-mail antes da data/hora de cada memo desta categoria. O memo pode sobrepor o padrão
          (ex.: "me lembre 30 min antes", "avisar o João", "não precisa lembrar").
        </p>

        {carregando ? (
          <p className="mm-muted">Carregando…</p>
        ) : (
          <>
            <label className={styles.linhaCheck}>
              <input type="checkbox" checked={form.ativo} onChange={(e) => set("ativo", e.target.checked)} />
              <strong>Enviar lembretes desta categoria</strong>
            </label>

            <div className={styles.grade}>
              <div className={styles.campo}>
                <label htmlFor="lb-data">Campo de data *</label>
                {selectCampo(form.campoData || null, (v) => set("campoData", v ?? ""), "— escolha —", "lb-data")}
              </div>
              <div className={styles.campo}>
                <label htmlFor="lb-hora">Campo de horário</label>
                {selectCampo(form.campoHorario, (v) => set("campoHorario", v), "— sem horário —", "lb-hora")}
              </div>
              <div className={styles.campo}>
                <label htmlFor="lb-hpadrao">Horário quando o memo não tiver</label>
                <input id="lb-hpadrao" type="time" className="mm-field" value={form.horarioPadrao}
                  onChange={(e) => set("horarioPadrao", e.target.value || "08:00")} />
              </div>
              <div className={styles.campo}>
                <label htmlFor="lb-intervalo">Verificar a cada</label>
                <select id="lb-intervalo" className="mm-field" value={form.intervaloMin}
                  onChange={(e) => set("intervaloMin", Number(e.target.value))}>
                  {LEMBRETE_INTERVALOS_MIN.map((m) => <option key={m} value={m}>{m === 60 ? "1 hora" : `${m} min`}</option>)}
                </select>
              </div>
            </div>

            <div className={styles.campo}>
              <span className={styles.rotulo}>Antecedência padrão *</span>
              <div className={styles.chips}>
                {LEMBRETE_ANTECEDENCIAS_OPCOES.map((o) => (
                  <button key={o.min} type="button"
                    className={`${styles.chip} ${form.antecedenciasMin.includes(o.min) ? styles.chipAtivo : ""}`}
                    aria-pressed={form.antecedenciasMin.includes(o.min)}
                    onClick={() => alternarAntecedencia(o.min)}>
                    {o.rotulo}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.grade}>
              <div className={styles.campo}>
                <label htmlFor="lb-dest">Destinatário padrão</label>
                <select id="lb-dest" className="mm-field" value={form.destinatarioTipo}
                  onChange={(e) => set("destinatarioTipo", e.target.value as LembreteDestinatarioTipo)}>
                  <option value="autor">Quem registrou o memo</option>
                  <option value="grupo">Todos do grupo</option>
                  <option value="owner">Owner do grupo</option>
                  <option value="email">E-mail fixo</option>
                </select>
              </div>
              {form.destinatarioTipo === "email" ? (
                <div className={styles.campo}>
                  <label htmlFor="lb-emails">E-mails (separados por vírgula)</label>
                  <input id="lb-emails" className="mm-field" value={form.destinatarioValor ?? ""}
                    onChange={(e) => set("destinatarioValor", e.target.value)} placeholder="financeiro@empresa.com" />
                </div>
              ) : null}
            </div>

            <label className={styles.linhaCheck}>
              <input type="checkbox" checked={form.lembrarImportados} onChange={(e) => set("lembrarImportados", e.target.checked)} />
              Lembrar também memos da importação em lote
            </label>

            <details className={styles.avancado}>
              <summary>Campos do memo que sobrepõem o padrão (opcional)</summary>
              <div className={styles.grade}>
                <div className={styles.campo}>
                  <label htmlFor="lb-cant">"Lembrar antes"</label>
                  {selectCampo(form.campoAntecedencia, (v) => set("campoAntecedencia", v), "— não usar —", "lb-cant")}
                </div>
                <div className={styles.campo}>
                  <label htmlFor="lb-cdest">"Destinatário"</label>
                  {selectCampo(form.campoDestinatario, (v) => set("campoDestinatario", v), "— não usar —", "lb-cdest")}
                </div>
                <div className={styles.campo}>
                  <label htmlFor="lb-clemb">"Lembrete" (sim/não)</label>
                  {selectCampo(form.campoLembrete, (v) => set("campoLembrete", v), "— não usar —", "lb-clemb")}
                </div>
              </div>
              <p className={styles.dica}>
                Crie esses campos na categoria para a IA extrair do texto. Vazios → vale o padrão acima;
                destinatário vazio sem padrão → quem registrou.
              </p>
              <div className={styles.campo}>
                <label htmlFor="lb-modelo">Texto da mensagem</label>
                <textarea id="lb-modelo" className="mm-field" rows={2} value={form.modeloTexto ?? ""}
                  onChange={(e) => set("modeloTexto", e.target.value || null)}
                  placeholder="Padrão: Lembrete: {categoria} em {data} às {hora}. Ex.: Reunião com {Com quem} às {hora} em {Aonde}" />
              </div>
            </details>

            {erro ? <p className="mm-error">{erro}</p> : null}
            {aviso ? <p className={styles.ok}>{aviso}</p> : null}

            <div className={styles.acoes}>
              {regra ? (
                <button type="button" className="mm-btn mm-btn--ghost" onClick={() => void excluir()}>Excluir</button>
              ) : null}
              <span className={styles.espaco} />
              {regra ? (
                <button type="button" className="mm-btn mm-btn--ghost" disabled={carregandoPrevia} onClick={() => void verPrevia()}>
                  {carregandoPrevia ? "Calculando…" : "Prévia"}
                </button>
              ) : null}
              <button type="button" className="mm-btn mm-btn--ghost" onClick={onClose}>Fechar</button>
              <button type="button" className="mm-btn mm-btn--primary" disabled={salvando} onClick={() => void salvar()}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>

            {previa ? (
              <div className={styles.previa}>
                <p className={styles.rotulo}>
                  Próximos lembretes (até 60 dias)
                  {previa.semDataReconhecida ? ` — ${previa.semDataReconhecida} memo(s) sem data reconhecida` : ""}
                </p>
                {previa.itens.length === 0 ? (
                  <p className="mm-muted">Nenhum compromisso futuro encontrado nesta categoria.</p>
                ) : (
                  <div className={styles.tabelaWrap}>
                    <table className={styles.tabela}>
                      <thead>
                        <tr><th>Memo</th><th>Compromisso</th><th>Antecedência</th><th>Envio</th><th>Para</th><th>Situação</th></tr>
                      </thead>
                      <tbody>
                        {previa.itens.map((i) => (
                          <tr key={`${i.memoId}-${i.momentoAlvo}-${i.antecedenciaMin}`}>
                            <td title={i.resumo}>#{i.memoId}</td>
                            <td>{fmtDataHora(i.momentoAlvo)}</td>
                            <td>{formatarAntecedencia(i.antecedenciaMin)}</td>
                            <td>{fmtDataHora(i.enviarEm)}</td>
                            <td>{i.destinatarios.join(", ") || "—"}</td>
                            <td title={i.observacao ?? ""}>
                              {i.situacao === "enviado" ? "✓ enviado" : i.situacao === "ignorado" ? "— ignorado" : "agendado"}
                              {i.observacao ? <span className={styles.obs}>{i.observacao}</span> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

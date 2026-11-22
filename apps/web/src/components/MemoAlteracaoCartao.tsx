import { useEffect, useRef, useState } from "react";
import type { MemoAlteracaoResponse, MemoAlteravelCampo, MemoAlteravelResponse } from "@mymemory/shared";
import {
  estadoDaSituacao,
  estadoDoDito,
  normalizarDataParaIso,
  resolverValorStatus,
  rotulosSituacao,
  SIMBOLO_SITUACAO,
  situacaoEncerrada,
} from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPostJson } from "../api";
import { CHAVE_RELACAO_PENDENTE, type RelacaoPendente } from "./RelacaoAposSalvar";

interface RelacaoItem {
  id: number;
  tipo: string;
  lado: "origem" | "destino";
  outroId: number;
  outroCategoria: string | null;
  outroResumo: string;
}

/** Ligações do memo ("Resultado: ata #120"), com a opção de desfazer cada uma. */
function LigacoesDoMemo({ memoId }: { memoId: number }) {
  const [itens, setItens] = useState<RelacaoItem[]>([]);
  useEffect(() => {
    let vivo = true;
    apiGet<{ relacoes: RelacaoItem[] }>(`/api/memos/${memoId}/relacoes`)
      .then((r) => vivo && setItens(r.relacoes))
      .catch(() => vivo && setItens([]));
    return () => {
      vivo = false;
    };
  }, [memoId]);
  if (!itens.length) return null;
  return (
    <div style={{ marginTop: 10, fontSize: 13 }}>
      <b>Ligações</b>
      {itens.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 6, alignItems: "baseline", marginTop: 4 }}>
          <span style={{ flex: 1 }}>
            {r.lado === "destino" ? `Resultado (${r.tipo}): ` : `É ${r.tipo} de: `}
            <b>
              {r.outroCategoria ?? "memo"} #{r.outroId}
            </b>{" "}
            — {r.outroResumo}
          </span>
          <button
            type="button"
            className="mm-btn mm-btn--ghost"
            style={{ padding: "0 6px", fontSize: 12 }}
            title="Desfazer esta ligação"
            onClick={() => void apiDeleteJson(`/api/memos/relacoes/${r.id}`).then(() => setItens((xs) => xs.filter((x) => x.id !== r.id)))}
          >
            desligar
          </button>
        </div>
      ))}
    </div>
  );
}
import { capturarFalaCurta, vozDisponivel, type CapturaVoz } from "../lib/vozCurta";
import styles from "./MemoAlteracaoCartao.module.css";
import { VAZIO_OPCIONAL } from "./MemoNovoCartao";

/** AAAA-MM-DD → DD/MM/AAAA para editar; o resto como está. */
function paraTela(c: MemoAlteravelCampo): string {
  const m = c.tipo === "date" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(c.valor) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : c.valor;
}

/** Hora falada ("15 horas", "15h30", "15") → "15:00"/"15:30" nos campos de hora. */
function ajustarFalado(c: MemoAlteravelCampo, falado: string): string {
  const t = falado.trim().replace(/[.。]$/, "");
  if (!/hora|horario/i.test(c.nome.normalize("NFD").replace(/[̀-ͯ]/g, ""))) return t;
  const m = /^(\d{1,2})(?:\s*(?:h|:|horas?)\s*(\d{2})?)?(?:\s*(?:min|minutos))?$/i.exec(t.replace(/\s+e\s+/i, " "));
  if (!m) return t;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  return hh <= 23 && mm <= 59 ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : t;
}

/**
 * Data nova que merece confirmação: não é data, já passou há mais de 30 dias ou fica a mais de 2 anos.
 * Ex.: falar "16 de novembro de 2016" em vez de 2026 — sem isso o memo some das perguntas da semana.
 */
function avisoDataEstranha(c: MemoAlteravelCampo, novo: string): string | null {
  if (c.tipo !== "date" || !novo.trim()) return null;
  const iso = normalizarDataParaIso(novo);
  if (!iso) return `${c.nome}: "${novo}" não parece uma data (use dd/mm/aaaa).`;
  const [a, m, d] = iso.split("-");
  const tela = `${d}/${m}/${a}`;
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);
  const dias = Math.round((new Date(`${iso}T12:00:00`).getTime() - hoje.getTime()) / 86_400_000);
  const quanto = (n: number) => (n >= 365 ? `${Math.round(n / 365)} ano(s)` : n >= 60 ? `${Math.round(n / 30)} meses` : `${n} dias`);
  if (dias < -30) return `${c.nome}: ${tela} já passou (há ${quanto(-dias)}).`;
  if (dias > 730) return `${c.nome}: ${tela} fica daqui a ${quanto(dias)}.`;
  return null;
}

const normNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Valor de situação dito no comando ("cancelado", "concluida") → o valor fixo da categoria. */
function situacaoCanonica(v: string): Situacao | null {
  const e = estadoDoDito(v);
  return e === "concluido" ? "Concluído" : e === "cancelado" ? "Cancelado" : e === "aberto" ? "Pendente" : null;
}

type Situacao = "Pendente" | "Concluído" | "Cancelado";

/** Lista: em vez de mostrar a lista anterior inteira, diz só o que entra e o que sai. */
function diferencaLista(antes: string, depois: string): string {
  const linhas = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const a = linhas(antes);
  const d = linhas(depois);
  const entrou = d.filter((x) => !a.some((y) => normNome(y) === normNome(x)));
  const saiu = a.filter((x) => !d.some((y) => normNome(y) === normNome(x)));
  const partes = [...(entrou.length ? [`entra ${entrou.join(", ")}`] : []), ...(saiu.length ? [`sai ${saiu.join(", ")}`] : [])];
  return partes.join("; ") || "itens reordenados";
}

function mensagemErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    return (JSON.parse(raw) as { message?: string }).message ?? raw;
  } catch {
    return raw;
  }
}

/**
 * Cartão de alteração de um memo de categoria atualizável, aberto pela resposta do Perguntar:
 * campos editáveis (com 🎤 que encerra no silêncio), Salvar sem confirmação extra (a proteção é o
 * "Desfazer" que aparece depois) e as ações de situação: Concluído, Cancelado ou Reativar.
 */
export function MemoAlteracaoCartao({
  memoId,
  propostos,
  onFechar,
  onAlterado,
}: {
  memoId: number;
  /** Valores propostos por um comando do Perguntar (campo → valor novo); o cartão abre já com eles. */
  propostos?: Record<string, string>;
  onFechar: () => void;
  onAlterado: (memoId: number, r: MemoAlteracaoResponse, texto: string) => void;
}) {
  const [dados, setDados] = useState<MemoAlteravelResponse | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  /** Campos que vieram preenchidos pelo comando (destacados com o valor anterior). */
  const [propostosCampos, setPropostosCampos] = useState<Set<string>>(new Set());
  const [situacaoProposta, setSituacaoProposta] = useState<Situacao | null>(null);
  const propostosKey = JSON.stringify(propostos ?? {});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ouvindo, setOuvindo] = useState<string | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  /** Avisos de data estranha mostrados; um segundo clique em Salvar confirma. */
  const [avisosData, setAvisosData] = useState<string[] | null>(null);
  const capturaRef = useRef<CapturaVoz | null>(null);
  const comVoz = vozDisponivel();

  useEffect(() => {
    let vivo = true;
    apiGet<MemoAlteravelResponse>(`/api/memos/${memoId}/alteravel`)
      .then((r) => {
        if (!vivo) return;
        setDados(r);
        const base: Record<string, string> = Object.fromEntries(r.campos.map((c) => [c.nome, paraTela(c)]));
        const marcados = new Set<string>();
        let sit: Situacao | null = null;
        for (const [k, v] of Object.entries(JSON.parse(propostosKey) as Record<string, string>)) {
          const alvo = normNome(k);
          if (normNome(r.campoSituacao) === alvo) {
            sit = situacaoCanonica(v);
            continue;
          }
          const c = r.campos.find((x) => normNome(x.nome) === alvo);
          if (!c) continue;
          const tela = c.tipo === "date" ? paraTela({ ...c, valor: normalizarDataParaIso(v) ?? v }) : v;
          if (tela.trim() !== (base[c.nome] ?? "").trim()) {
            base[c.nome] = tela;
            marcados.add(c.nome);
          }
        }
        setValores(base);
        setPropostosCampos(marcados);
        setSituacaoProposta(sit && sit !== r.situacao ? sit : null);
      })
      .catch((e) => vivo && setErro(mensagemErro(e)));
    return () => {
      vivo = false;
      capturaRef.current?.parar();
    };
  }, [memoId, propostosKey]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !salvando && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar, salvando]);

  async function falar(c: MemoAlteravelCampo) {
    if (ouvindo) {
      capturaRef.current?.parar();
      return;
    }
    setErro(null);
    setOuvindo(c.nome);
    const cap = capturarFalaCurta((parcial) => setValores((v) => ({ ...v, [c.nome]: parcial })));
    capturaRef.current = cap;
    try {
      const falado = (await cap.resultado).trim();
      if (falado) {
        setValores((v) => ({ ...v, [c.nome]: ajustarFalado(c, falado) }));
        setDestaque(c.nome);
        window.setTimeout(() => setDestaque((d) => (d === c.nome ? null : d)), 1500);
      } else {
        setErro("Não ouvi nada. Tente de novo.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro no microfone.");
    } finally {
      capturaRef.current = null;
      setOuvindo(null);
    }
  }

  async function salvar() {
    if (!dados) return;
    const mudados = Object.fromEntries(
      dados.campos.filter((c) => (valores[c.nome] ?? "").trim() !== paraTela(c).trim()).map((c) => [c.nome, valores[c.nome] ?? ""])
    );
    if (!Object.keys(mudados).length) {
      onFechar();
      return;
    }
    if (!avisosData) {
      const avisos = dados.campos
        .filter((c) => c.nome in mudados)
        .map((c) => avisoDataEstranha(c, mudados[c.nome] ?? ""))
        .filter((a): a is string => a != null);
      if (avisos.length) {
        setAvisosData(avisos);
        return;
      }
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/${memoId}/alterar`, { campos: mudados });
      const texto = r.mudancas.length
        ? `Alterado: ${r.mudancas.map((m) => `${m.campo} → ${m.depois || "(vazio)"}`).join(", ")}.`
        : "Nada mudou.";
      onAlterado(memoId, r, texto);
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  async function mudarSituacao(situacao: Situacao) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/${memoId}/situacao`, { situacao });
      const texto =
        situacao === "Cancelado"
          ? "Marcado como cancelado."
          : situacao === "Concluído"
            ? `Marcado como ${rot.concluido.toLowerCase()}.`
            : "Reaberto.";
      onAlterado(memoId, r, texto);
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  const encerrado = dados ? situacaoEncerrada(dados.situacao) : false;
  // Nomes da situação nesta categoria (Pendente/Válido; Concluído pode ser Comprado, Pago…)
  const rot = dados?.situacaoRotulos ?? rotulosSituacao("afazer");
  const estadoAtual = estadoDaSituacao(dados?.situacao);

  return (
    <div className={styles.overlay} onClick={() => !salvando && onFechar()}>
      <div className={styles.cartao} role="dialog" aria-label={`Alterar memo #${memoId}`} onClick={(e) => e.stopPropagation()}>
        {/* Mesmo padrão dos outros cartões: título, Salvar e Cancelar no topo */}
        <div className={styles.topo} style={{ alignItems: "center", justifyContent: "flex-start", flexWrap: "wrap" }}>
          <div style={{ marginRight: "auto" }}>
            <strong>{dados?.categoria ?? "Memo"}</strong> <span className={styles.id}>#{memoId}</span>
            {dados ? (
              <span className={encerrado ? styles.situacaoEncerrada : styles.situacao}>
                {SIMBOLO_SITUACAO[estadoAtual]} {rot[estadoAtual]}
              </span>
            ) : null}
          </div>
          {dados ? (
            <button type="button" className="mm-btn mm-btn--primary" onClick={() => void salvar()} disabled={salvando}>
              {salvando ? "Salvando…" : avisosData ? "Salvar mesmo assim" : "Salvar"}
            </button>
          ) : null}
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </button>
        </div>

        {!dados && !erro ? <p className={styles.carregando}>Carregando…</p> : null}

        {dados ? (
          <>
            {situacaoProposta ? (
              <div className={styles.avisoData} role="status">
                <div>Proposta: marcar como {rot[estadoDaSituacao(situacaoProposta)]}.</div>
                <button type="button" className={styles.acao} onClick={() => void mudarSituacao(situacaoProposta)} disabled={salvando}>
                  Confirmar: {rot[estadoDaSituacao(situacaoProposta)]}
                </button>
              </div>
            ) : null}
            {propostosCampos.size ? (
              <p className={styles.dica}>Confira as mudanças propostas (em destaque) e salve.</p>
            ) : null}
            <div className={styles.campos}>
              {dados.campos.map((c) => (
                <div key={c.nome} className={styles.campo}>
                  <label htmlFor={`alt-${c.nome}`} title={c.descricao ?? undefined}>
                    {c.nome}
                  </label>
                  <div className={styles.linha}>
                    {c.tipo === "status" && c.valores?.length ? (
                      <select
                        id={`alt-${c.nome}`}
                        className={`mm-field ${destaque === c.nome || propostosCampos.has(c.nome) ? styles.inputDestaque : ""}`}
                        value={resolverValorStatus(valores[c.nome] ?? "", c.valores) ?? c.valores[0]}
                        onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                        disabled={salvando}
                      >
                        {c.valores.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : c.tipo === "lista" ? (
                      <textarea
                        id={`alt-${c.nome}`}
                        className={`mm-field ${ouvindo === c.nome ? styles.inputOuvindo : ""} ${destaque === c.nome || propostosCampos.has(c.nome) ? styles.inputDestaque : ""}`}
                        rows={Math.min(12, Math.max(3, (valores[c.nome] ?? "").split("\n").length + 1))}
                        value={valores[c.nome] ?? ""}
                        style={!(valores[c.nome] ?? "").trim() ? VAZIO_OPCIONAL : undefined}
                        placeholder="um item por linha"
                        onChange={(e) => {
                          setValores((v) => ({ ...v, [c.nome]: e.target.value }));
                          setAvisosData(null);
                        }}
                        disabled={salvando}
                      />
                    ) : (
                      <input
                        id={`alt-${c.nome}`}
                        className={`mm-field ${ouvindo === c.nome ? styles.inputOuvindo : ""} ${destaque === c.nome || propostosCampos.has(c.nome) ? styles.inputDestaque : ""}`}
                        value={valores[c.nome] ?? ""}
                        style={!(valores[c.nome] ?? "").trim() ? VAZIO_OPCIONAL : undefined}
                        placeholder={c.tipo === "date" ? "dd/mm/aaaa" : ""}
                        onChange={(e) => {
                          setValores((v) => ({ ...v, [c.nome]: e.target.value }));
                          setAvisosData(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && void salvar()}
                        disabled={salvando}
                      />
                    )}
                    {comVoz ? (
                      <button
                        type="button"
                        className={`${styles.mic} ${ouvindo === c.nome ? styles.micAtivo : ""}`}
                        onClick={() => void falar(c)}
                        disabled={salvando || (ouvindo != null && ouvindo !== c.nome)}
                        title={ouvindo === c.nome ? "Parar" : "Falar (encerra sozinho quando você para de falar)"}
                        aria-label={`Falar ${c.nome}`}
                      >
                        {ouvindo === c.nome ? "⏸" : "🎤"}
                      </button>
                    ) : null}
                  </div>
                  {ouvindo === c.nome ? <div className={styles.dica}>Ouvindo… pode falar.</div> : null}
                  {propostosCampos.has(c.nome) ? (
                    <div className={styles.dica}>
                      {c.tipo === "lista"
                        ? `Proposto pelo comando: ${diferencaLista(paraTela(c), valores[c.nome] ?? "")}`
                        : `Proposto pelo comando. Antes: ${paraTela(c) || "(vazio)"}`}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {erro ? <p className="mm-error">{erro}</p> : null}
            {avisosData ? (
              <div className={styles.avisoData} role="alert">
                {avisosData.map((a) => (
                  <div key={a}>⚠ {a}</div>
                ))}
                <div>Confira a data. Se estiver certa, clique em salvar de novo.</div>
              </div>
            ) : null}
            <LigacoesDoMemo memoId={memoId} />
            <div className={styles.acoes}>
              {encerrado ? (
                <button type="button" className={styles.acao} onClick={() => void mudarSituacao("Pendente")} disabled={salvando}>
                  ↺ Reabrir ({rot.aberto})
                </button>
              ) : (
                <>
                  {rot.opcoes.includes("concluido") ? (
                  <>
                  <button type="button" className={styles.acao} onClick={() => void mudarSituacao("Concluído")} disabled={salvando}>
                    ☑ Marcar como {rot.concluido.toLowerCase()}
                  </button>
                  <button
                    type="button"
                    className={styles.acao}
                    disabled={salvando}
                    title="Abre o Catalogar para registrar o resultado (texto, voz, foto, documento); ao salvar, liga a este memo e o marca como concluído"
                    onClick={() => {
                      const pendente: RelacaoPendente = { destinoId: memoId, tipo: "resultado", concluir: true, quando: Date.now() };
                      try {
                        sessionStorage.setItem(CHAVE_RELACAO_PENDENTE, JSON.stringify(pendente));
                      } catch {
                        /* sem sessionStorage: o Catalogar abre sem a ligação */
                      }
                      window.dispatchEvent(new CustomEvent("mm:abrir-catalogar"));
                      onFechar();
                    }}
                  >
                    📝 Concluir e registrar resultado
                  </button>
                  </>
                  ) : null}
                  <button
                    type="button"
                    className={`${styles.acao} ${styles.acaoCancelar}`}
                    onClick={() => void mudarSituacao("Cancelado")}
                    disabled={salvando}
                  >
                    ☒ Marcar como cancelado
                  </button>
                </>
              )}
            </div>
          </>
        ) : erro ? (
          <p className="mm-error">{erro}</p>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { ComandoCriacao, MemoCreatedResponse } from "@mymemory/shared";
import { normalizarDataParaIso, periodoDoDia, resolverValorStatus } from "@mymemory/shared";

/** Campo opcional vazio: contorno amarelo (não bloqueia; nos memos nenhum campo é obrigatório). */
export const VAZIO_OPCIONAL: React.CSSProperties = { borderColor: "#eab308", boxShadow: "0 0 0 1px #eab308" };

/** Valor do status como opção do seletor (vazio ou fora da lista = o inicial). */
const opcaoStatus = (valor: string, valores: string[]) => resolverValorStatus(valor, valores) ?? valores[0];
import { apiPostJson } from "../api";
import styles from "./MemoAlteracaoCartao.module.css";

/** Campos já extraídos pela IA (JSON plano) → mapa nome → valor. */
function lerDados(json: string | null | undefined): Record<string, string> {
  if (!json?.trim()) return {};
  try {
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, x == null ? "" : String(x)]));
  } catch {
    return {};
  }
}

const normNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** AAAA-MM-DD → DD/MM/AAAA para editar. */
function dataParaTela(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
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
 * Cartão de memo novo, aberto quando um pedido do Perguntar é de criação ("criar reunião interna
 * dia 10 às 10h"). Mostra o que o processamento do Catalogar extraiu e grava pelo mesmo caminho do
 * Catalogar (POST /api/memos/text/confirm). Nada é gravado antes do "Salvar".
 */
export function MemoNovoCartao({
  criacao,
  onFechar,
  onCriado,
}: {
  criacao: ComandoCriacao;
  onFechar: () => void;
  onCriado: (memo: MemoCreatedResponse, texto: string) => void;
}) {
  const p = criacao.processado;
  const [resumo, setResumo] = useState(p.suggestedMediaText ?? "");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const extraidos = lerDados(p.dadosEspecificosJson);
    const inicial: Record<string, string> = {};
    for (const c of criacao.campos) {
      const k = Object.keys(extraidos).find((x) => normNome(x) === normNome(c.nome));
      let v = k != null ? extraidos[k] ?? "" : "";
      // Vazio: período do dia pela hora (Manhã/Tarde/Noite); status = a opção que o seletor mostra (antes ficava
      // mostrando a primeira, mas gravava vazio e pedia "preencher")
      if (!v.trim()) {
        const valores = c.tipo === "status" ? c.valores ?? [] : [];
        v = periodoDoDia(c.nome, valores, new Date().getHours()) ?? (valores.length ? valores[0]! : "");
      }
      inicial[c.nome] = c.tipo === "date" ? dataParaTela(v) : v;
    }
    setValores(inicial);
  }, [criacao, p.dadosEspecificosJson]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !salvando && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar, salvando]);

  async function salvar() {
    if (!resumo.trim()) {
      setErro("Escreva um resumo.");
      return;
    }
    setSalvando(true);
    setErro(null);
    // Parte dos campos que a IA extraiu e o cartão não mostra (ex.: situação) segue como veio
    const dados: Record<string, string> = { ...lerDados(p.dadosEspecificosJson) };
    for (const c of criacao.campos) {
      const v = (valores[c.nome] ?? "").trim();
      const chave = Object.keys(dados).find((x) => normNome(x) === normNome(c.nome)) ?? c.nome;
      dados[chave] = c.tipo === "date" ? normalizarDataParaIso(v) ?? v : v;
    }
    if (criacao.campoSituacao) {
      const k = Object.keys(dados).find((x) => normNome(x) === normNome(criacao.campoSituacao!)) ?? criacao.campoSituacao;
      if (!(dados[k] ?? "").trim()) dados[k] = criacao.situacaoAberta ?? "Pendente";
    }
    try {
      const memo = await apiPostJson<MemoCreatedResponse>("/api/memos/text/confirm", {
        mediaText: resumo.trim(),
        keywords: p.suggestedKeywords ?? "",
        groupId: criacao.groupId,
        apiCost: p.apiCost ?? 0,
        originalText: p.originalText,
        iaLevel: p.iaLevel,
        dadosEspecificosJson: JSON.stringify(dados),
        dadosEspecificosOriginaisJson: p.dadosEspecificosOriginaisJson ?? null,
        matchedCategoryId: p.matchedCategoryId ?? null,
        category: criacao.categoria ?? p.category ?? null,
      });
      onCriado(memo, `Registrei em ${criacao.categoria ?? "memo"} #${memo.id}.`);
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={() => !salvando && onFechar()}>
      <div className={styles.cartao} role="dialog" aria-label="Registro novo" onClick={(e) => e.stopPropagation()}>
        {/* Salvar e Cancelar no topo, na linha do título: não precisa rolar o cartão para gravar */}
        <div className={styles.topo} style={{ alignItems: "center", justifyContent: "flex-start", flexWrap: "wrap" }}>
          <div style={{ marginRight: "auto" }}>
            <strong className={styles.categoria}>{criacao.categoria ?? "Memo"}</strong> <span className={styles.id}>novo</span>
          </div>
          <button type="button" className="mm-btn mm-btn--primary" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </button>
        </div>

        {p.processingWarning ? <p className={criacao.origemModelo ? styles.aviso : styles.dica}>{p.processingWarning}</p> : null}

        <div className={styles.campos}>
          <div className={styles.campo}>
            <label htmlFor="novo-resumo">Resumo</label>
            <textarea
              id="novo-resumo"
              className="mm-field"
              rows={3}
              value={resumo}
              onChange={(e) => setResumo(e.target.value)}
              disabled={salvando}
            />
          </div>
          {criacao.campos.map((c) => (
            <div key={c.nome} className={styles.campo}>
              <label htmlFor={`novo-${c.nome}`} title={c.descricao ?? undefined}>
                {c.nome}
                {/* Vazio: destaque caramelo, sem bloquear (nos memos nenhum campo é obrigatório) */}
                {!(valores[c.nome] ?? "").trim() ? <span style={{ color: "#ca8a04", fontWeight: 600 }}> · preencher</span> : null}
              </label>
              {c.tipo === "status" && c.valores?.length ? (
                <select
                  id={`novo-${c.nome}`}
                  className="mm-field"
                  value={opcaoStatus(valores[c.nome] ?? "", c.valores)}
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
                  id={`novo-${c.nome}`}
                  className="mm-field"
                  style={!(valores[c.nome] ?? "").trim() ? VAZIO_OPCIONAL : undefined}
                  rows={Math.min(12, Math.max(3, (valores[c.nome] ?? "").split("\n").length + 1))}
                  value={valores[c.nome] ?? ""}
                  placeholder="um item por linha"
                  onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                  disabled={salvando}
                />
              ) : (
                <input
                  id={`novo-${c.nome}`}
                  className="mm-field"
                  style={!(valores[c.nome] ?? "").trim() ? VAZIO_OPCIONAL : undefined}
                  value={valores[c.nome] ?? ""}
                  placeholder={c.tipo === "date" ? "dd/mm/aaaa" : ""}
                  onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && void salvar()}
                  disabled={salvando}
                />
              )}
            </div>
          ))}
        </div>

        {erro ? <p className="mm-error">{erro}</p> : null}
      </div>
    </div>
  );
}

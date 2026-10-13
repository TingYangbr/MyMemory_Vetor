import { useEffect, useMemo, useRef, useState } from "react";
import {
  PERIODO_ATALHOS,
  calcularPeriodo,
  descreverValorChip,
  interpretarPeriodo,
  montarFrase,
  valorIgual,
  type PerguntaChip,
  type PerguntaChipValor,
  type PeriodoValor,
} from "@mymemory/shared";
import { apiGet } from "../api";
import { capturarFalaCurta, vozDisponivel, type CapturaVoz } from "../lib/vozCurta";
import styles from "./PerguntaChips.module.css";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Frase da pergunta salva com os parâmetros como chips clicáveis. Cada chip abre um seletor
 * com digitação (autocomplete com valores da própria query), voz (🎤 encerra no silêncio)
 * e, para períodos, atalhos ("mês passado", "últimos 6 meses"…).
 */
export function PerguntaChips(props: {
  modeloId: number;
  pergunta: string;
  chips: PerguntaChip[];
  valores: Record<string, PerguntaChipValor>;
  onChange: (chave: string, valor: PerguntaChipValor | null) => void;
  disabled?: boolean;
}) {
  const { modeloId, pergunta, chips, valores, onChange, disabled } = props;
  const [aberto, setAberto] = useState<string | null>(null);
  const { segmentos, extras } = useMemo(() => montarFrase(pergunta, chips), [pergunta, chips]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(null);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, [aberto]);

  function chipBtn(chip: PerguntaChip, textoOriginal: string | null) {
    const v = valores[chip.chave];
    const alterado = v != null && !valorIgual(v, chip.valor);
    const texto = alterado || textoOriginal == null ? descreverValorChip(chip, v ?? chip.valor) : textoOriginal;
    return (
      <span key={chip.chave} className={styles.chipWrap}>
        <button
          type="button"
          className={`${styles.chip} ${alterado ? styles.chipAlterado : ""}`}
          onClick={() => setAberto((a) => (a === chip.chave ? null : chip.chave))}
          disabled={disabled}
          title={`${chip.rotulo} — clique para trocar`}
        >
          <span className={styles.chipRotulo}>{chip.rotulo}</span>
          {texto}
          <span className={styles.chipSeta} aria-hidden>▾</span>
        </button>
        {aberto === chip.chave ? (
          <ChipSeletor
            modeloId={modeloId}
            chip={chip}
            valor={v ?? chip.valor}
            alterado={alterado}
            onEscolher={(nv) => { onChange(chip.chave, nv); setAberto(null); }}
            onRestaurar={() => { onChange(chip.chave, null); setAberto(null); }}
            onFechar={() => setAberto(null)}
          />
        ) : null}
      </span>
    );
  }

  return (
    <div ref={wrapRef} className={styles.frase}>
      <span className={styles.badge} title="Pergunta salva com plano: reexecuta direto, sem replanejar">⚡</span>
      {segmentos.map((s, i) => ("chip" in s ? chipBtn(s.chip, s.texto) : <span key={`t${i}`}>{s.texto}</span>))}
      {extras.length ? (
        <div className={styles.extras}>
          {extras.map((c) => chipBtn(c, null))}
        </div>
      ) : null}
    </div>
  );
}

function ChipSeletor(props: {
  modeloId: number;
  chip: PerguntaChip;
  valor: PerguntaChipValor;
  alterado: boolean;
  onEscolher: (v: PerguntaChipValor) => void;
  onRestaurar: () => void;
  onFechar: () => void;
}) {
  const { modeloId, chip, valor, alterado, onEscolher, onRestaurar, onFechar } = props;
  const periodo = chip.tipo === "periodo";
  const pv = periodo ? (valor as PeriodoValor) : null;
  const [texto, setTexto] = useState(periodo ? "" : String(valor));
  const [ini, setIni] = useState(pv?.ini ?? "");
  const [fin, setFin] = useState(pv?.fin ?? "");
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [ouvindo, setOuvindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const capturaRef = useRef<CapturaVoz | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buscaSeq = useRef(0);
  const autocomplete = chip.tipo === "texto" || chip.tipo === "lista";

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  useEffect(() => () => capturaRef.current?.parar(), []);

  async function buscar(q: string): Promise<string[]> {
    const termo = chip.tipo === "lista" ? (q.split(",").pop() ?? "").trim() : q.trim();
    if (!autocomplete || termo.length < 2) { setSugestoes([]); return []; }
    const seq = ++buscaSeq.current;
    setBuscando(true);
    try {
      const r = await apiGet<{ valores: string[] }>(
        `/api/pergunta-modelos/${modeloId}/valores?chave=${encodeURIComponent(chip.chave)}&q=${encodeURIComponent(termo)}`
      );
      if (seq === buscaSeq.current) setSugestoes(r.valores);
      return r.valores;
    } catch {
      return [];
    } finally {
      if (seq === buscaSeq.current) setBuscando(false);
    }
  }

  // Autocomplete com debounce enquanto digita
  useEffect(() => {
    if (!autocomplete || ouvindo) return;
    const t = setTimeout(() => { void buscar(texto); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  function escolherSugestao(s: string) {
    if (chip.tipo === "lista") {
      const partes = texto.split(",").map((p) => p.trim());
      partes[partes.length - 1] = s;
      onEscolher(partes.filter(Boolean).join(", "));
    } else onEscolher(s);
  }

  function confirmarTexto() {
    if (periodo) {
      const p = interpretarPeriodo(texto);
      if (p) onEscolher(p);
      else setErro("Não entendi o período. Ex.: mês passado, últimos 3 meses, março de 2025.");
      return;
    }
    if (texto.trim()) onEscolher(texto.trim());
  }

  async function falar() {
    if (ouvindo) { capturaRef.current?.parar(); return; }
    setErro(null);
    setOuvindo(true);
    const cap = capturarFalaCurta((parcial) => setTexto(parcial));
    capturaRef.current = cap;
    try {
      const falado = (await cap.resultado).trim();
      if (!falado) { setErro("Não ouvi nada. Tente de novo."); return; }
      setTexto(falado);
      if (periodo) {
        const p = interpretarPeriodo(falado);
        if (p) onEscolher(p);
        else setErro(`Não entendi "${falado}" como período.`);
        return;
      }
      if (!autocomplete) { onEscolher(falado); return; }
      // Voz: se só um valor da base bate com o que foi dito, já escolhe
      const lista = await buscar(falado);
      const alvo = semAcento(falado);
      const exatos = lista.filter((s) => semAcento(s) === alvo);
      if (exatos.length === 1) escolherSugestao(exatos[0]!);
      else if (lista.length === 1) escolherSugestao(lista[0]!);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro no microfone.");
    } finally {
      capturaRef.current = null;
      setOuvindo(false);
    }
  }

  return (
    <div className={styles.seletor} role="dialog" aria-label={chip.rotulo}>
      <div className={styles.seletorTopo}>
        <strong>{chip.rotulo}</strong>
        <button type="button" className={styles.fechar} onClick={onFechar} aria-label="Fechar">×</button>
      </div>
      <div className={styles.linhaInput}>
        <input
          ref={inputRef}
          className={styles.input}
          value={texto}
          placeholder={periodo ? "ex.: mês passado, março de 2025" : chip.tipo === "lista" ? "valores separados por vírgula" : "digite para buscar"}
          inputMode={chip.tipo === "numero" ? "decimal" : undefined}
          onChange={(e) => { setTexto(e.target.value); setErro(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); confirmarTexto(); }
            if (e.key === "Escape") onFechar();
          }}
        />
        {vozDisponivel() ? (
          <button
            type="button"
            className={`${styles.mic} ${ouvindo ? styles.micAtivo : ""}`}
            onClick={() => void falar()}
            title={ouvindo ? "Parar" : "Falar (encerra sozinho quando você para de falar)"}
          >{ouvindo ? "⏸" : "🎤"}</button>
        ) : null}
        <button type="button" className={styles.ok} onClick={confirmarTexto} disabled={!texto.trim()}>OK</button>
      </div>
      {ouvindo ? <div className={styles.dica}>Ouvindo… pode falar.</div> : null}
      {erro ? <div className={styles.erro}>{erro}</div> : null}

      {autocomplete && (sugestoes.length || buscando) ? (
        <ul className={styles.sugestoes}>
          {buscando && !sugestoes.length ? <li className={styles.dica}>Buscando…</li> : null}
          {sugestoes.map((s) => (
            <li key={s}>
              <button type="button" className={styles.sugestao} onClick={() => escolherSugestao(s)}>{s}</button>
            </li>
          ))}
        </ul>
      ) : null}

      {periodo ? (
        <>
          <div className={styles.atalhos}>
            {PERIODO_ATALHOS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={styles.atalho}
                onClick={() => { const p = calcularPeriodo(a.id); if (p) onEscolher(p); }}
              >{a.rotulo}</button>
            ))}
          </div>
          <div className={styles.datas}>
            <input type="date" className={styles.input} value={ini} onChange={(e) => setIni(e.target.value)} aria-label="De" />
            <span>a</span>
            <input type="date" className={styles.input} value={fin} onChange={(e) => setFin(e.target.value)} aria-label="Até" />
            <button
              type="button"
              className={styles.ok}
              disabled={!ini && !fin}
              onClick={() => onEscolher({ ini: ini || null, fin: fin || null, rotulo: null })}
            >Aplicar</button>
          </div>
        </>
      ) : null}

      {alterado ? (
        <button type="button" className={styles.restaurar} onClick={onRestaurar}>
          ↺ voltar ao valor salvo ({descreverValorChip(chip, chip.valor)})
        </button>
      ) : null}
    </div>
  );
}

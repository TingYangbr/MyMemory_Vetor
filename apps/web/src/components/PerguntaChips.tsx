import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  PERIODO_ATALHOS,
  calcularPeriodo,
  comandoDeVoz,
  descreverValorChip,
  interpretarPeriodo,
  montarFrase,
  numeroFalado,
  valorIgual,
  type PerguntaChip,
  type PerguntaChipValor,
  type PeriodoValor,
} from "@mymemory/shared";
import { apiGet } from "../api";
import { abrirSessaoVoz, capturarFalaCurta, vozDisponivel, type CapturaVoz, type SessaoVoz } from "../lib/vozCurta";
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
  /** Modelo de registro: os valores não vêm de uma query, então não há autocomplete. */
  semSugestoes?: boolean;
}) {
  const { modeloId, pergunta, chips, valores, onChange, disabled, semSugestoes } = props;
  const [aberto, setAberto] = useState<string | null>(null);
  const { segmentos, extras } = useMemo(() => montarFrase(pergunta, chips), [pergunta, chips]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Voz contínua (modelo de registro): o 🎤 de um chip abre o microfone uma vez e segue pelos próximos chips,
  // um por vez, até acabarem, "parar", tocar de novo no ⏸, tocar em outro chip ou em Enviar.
  const sessaoVozRef = useRef<SessaoVoz | null>(null);
  const [vozContinua, setVozContinua] = useState(false);
  const encerrarVoz = () => {
    sessaoVozRef.current?.fechar();
    sessaoVozRef.current = null;
    setVozContinua(false);
  };
  const abrirVoz = async (): Promise<SessaoVoz> => {
    if (sessaoVozRef.current) return sessaoVozRef.current;
    const s = await abrirSessaoVoz();
    sessaoVozRef.current = s;
    setVozContinua(true);
    return s;
  };
  // Libera o microfone quando nenhum chip está aberto (clicou fora ou em Enviar) e ao sair da tela
  useEffect(() => {
    if (!aberto && sessaoVozRef.current) encerrarVoz();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
  useEffect(() => () => { sessaoVozRef.current?.fechar(); sessaoVozRef.current = null; }, []);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(null);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, [aberto]);

  // Modelo de registro: setas e voz contínua (o período, que tem seu próprio seletor, fica de fora)
  const navegaveis = chips.filter((c) => c.tipo !== "periodo");
  const ehRegistro = (chip: PerguntaChip) => !!semSugestoes && chip.tipo !== "periodo";

  function seletorDe(chip: PerguntaChip) {
    const v = valores[chip.chave];
    const alterado = v != null && !valorIgual(v, chip.valor);
    const vozDoRegistro = ehRegistro(chip);
    const pos = navegaveis.findIndex((c) => c.chave === chip.chave);
    return (
      <ChipSeletor
        key={chip.chave}
        modeloId={modeloId}
        chip={chip}
        valor={v ?? chip.valor}
        alterado={alterado}
        semSugestoes={semSugestoes}
        autoFalar={vozDoRegistro && vozContinua}
        progresso={vozDoRegistro ? `${pos + 1} de ${navegaveis.length}` : undefined}
        ehPrimeiro={vozDoRegistro && pos <= 0}
        ehUltimo={vozDoRegistro && pos === navegaveis.length - 1}
        abrirVoz={vozDoRegistro ? abrirVoz : undefined}
        aoVozConcluir={vozDoRegistro ? (acao, nv, dir = 1) => {
          if (nv != null && nv !== "") onChange(chip.chave, nv);
          // Sem fala ou sem entender: encerra o modo e deixa o seletor aberto para tentar de novo
          if (acao === "vazio") { encerrarVoz(); return; }
          if (acao === "parar") { encerrarVoz(); setAberto(null); return; }
          // valor, pular e seta: vai ao chip seguinte (dir = 1) ou ao anterior (dir = -1)
          const alvo = navegaveis[pos + dir];
          if (alvo) setAberto(alvo.chave);
          else if (dir === 1) { encerrarVoz(); setAberto(null); } // passou do último: concluído
        } : undefined}
        // Modelo de registro: o que foi digitado vale ao sair do chip, mesmo sem OK/Enter
        onRascunho={semSugestoes ? (nv) => onChange(chip.chave, nv) : undefined}
        onEscolher={(nv) => { onChange(chip.chave, nv); setAberto(null); }}
        onRestaurar={() => { onChange(chip.chave, null); setAberto(null); }}
        onFechar={() => setAberto(null)}
      />
    );
  }

  function chipBtn(chip: PerguntaChip, textoOriginal: string | null) {
    const v = valores[chip.chave];
    const alterado = v != null && !valorIgual(v, chip.valor);
    const texto = alterado || textoOriginal == null ? descreverValorChip(chip, v ?? chip.valor) : textoOriginal;
    const registro = ehRegistro(chip);
    return (
      <span key={chip.chave} className={styles.chipWrap}>
        <button
          type="button"
          className={`${styles.chip} ${alterado ? styles.chipAlterado : ""} ${aberto === chip.chave && registro ? styles.chipAtivo : ""}`}
          onClick={() => { encerrarVoz(); setAberto((a) => (a === chip.chave ? null : chip.chave)); }}
          disabled={disabled}
          title={`${chip.rotulo} — clique para trocar`}
        >
          <span className={styles.chipRotulo}>{chip.rotulo}</span>
          {texto}
          <span className={styles.chipSeta} aria-hidden>▾</span>
        </button>
        {/* Perguntas de consulta: balão preso ao chip, como sempre. O registro edita dentro da caixa (abaixo). */}
        {aberto === chip.chave && !registro ? seletorDe(chip) : null}
      </span>
    );
  }

  // Registro: a edição abre DENTRO da caixa de chips, logo abaixo deles, e a caixa cresce. Nada flutua por cima
  // dos outros chips nem do botão Enviar, e não há segundo painel.
  const chipEmEdicao = chips.find((c) => c.chave === aberto && ehRegistro(c)) ?? null;

  return (
    <div ref={wrapRef} className={styles.frase}>
      <span className={styles.badge} title="Pergunta salva com parâmetros: troque só o que precisa">⚡</span>
      {segmentos.map((s, i) => ("chip" in s ? chipBtn(s.chip, s.texto) : <span key={`t${i}`}>{s.texto}</span>))}
      {extras.length ? (
        <div className={styles.extras}>
          {extras.map((c) => chipBtn(c, null))}
        </div>
      ) : null}
      {chipEmEdicao ? seletorDe(chipEmEdicao) : null}
    </div>
  );
}

function ChipSeletor(props: {
  modeloId: number;
  chip: PerguntaChip;
  valor: PerguntaChipValor;
  alterado: boolean;
  semSugestoes?: boolean;
  /** Guarda o texto digitado ao sair do chip sem confirmar (clicar em outro chip ou fora). Só no modelo de registro. */
  onRascunho?: (v: string) => void;
  /** Voz contínua (modelo de registro): abre o microfone uma vez para a sessão inteira. */
  abrirVoz?: () => Promise<SessaoVoz>;
  /**
   * Modelo de registro: o que foi dito ou digitado neste chip e para onde ir. `acao`: valor, pular, parar ou
   * vazio (sem fala/sem entender: fica no chip). `dir`: 1 = próximo chip, -1 = anterior.
   */
  aoVozConcluir?: (acao: "valor" | "pular" | "parar" | "vazio", valor?: string | null, dir?: 1 | -1) => void;
  /** Voz contínua já ativa: este chip abre ouvindo, sem tocar no 🎤 e sem abrir o teclado. */
  autoFalar?: boolean;
  /** Ex.: "2 de 7" */
  progresso?: string;
  /** Modelo de registro: primeiro chip (seta ‹ desligada) e último (seta › vira ✓ de concluir). */
  ehPrimeiro?: boolean;
  ehUltimo?: boolean;
  onEscolher: (v: PerguntaChipValor) => void;
  onRestaurar: () => void;
  onFechar: () => void;
}) {
  const { modeloId, chip, valor, alterado, semSugestoes, onRascunho, abrirVoz, aoVozConcluir, autoFalar, progresso, ehPrimeiro, ehUltimo, onEscolher: escolherProp, onRestaurar: restaurarProp, onFechar: fecharProp } = props;
  // Confirmar (OK/Enter/voz/atalho), limpar ou cancelar (×/Esc) é uma decisão explícita: não vale o rascunho
  const decididoRef = useRef(false);
  const onEscolher = (v: PerguntaChipValor) => { decididoRef.current = true; escolherProp(v); };
  const onRestaurar = () => { decididoRef.current = true; restaurarProp(); };
  const onFechar = () => { decididoRef.current = true; fecharProp(); };
  const periodo = chip.tipo === "periodo";
  const pv = periodo ? (valor as PeriodoValor) : null;
  const [texto, setTexto] = useState(periodo ? "" : String(valor));
  const textoRef = useRef(texto);
  textoRef.current = texto;
  const inicialRef = useRef(periodo ? "" : String(valor).trim());
  const rascunhoRef = useRef(onRascunho);
  rascunhoRef.current = onRascunho;
  // Ao fechar sem decidir (clique em outro chip, fora, ou Enviar), o texto digitado e diferente do valor vale.
  // Layout effect: roda ainda dentro do clique, antes de o Enviar ler os valores.
  useLayoutEffect(() => () => {
    if (!rascunhoRef.current || decididoRef.current || periodo) return;
    const t = textoRef.current.trim();
    if (t && t !== inicialRef.current) rascunhoRef.current(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ini, setIni] = useState(pv?.ini ?? "");
  const [fin, setFin] = useState(pv?.fin ?? "");
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [ouvindo, setOuvindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const capturaRef = useRef<CapturaVoz | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buscaSeq = useRef(0);
  const autocomplete = (chip.tipo === "texto" || chip.tipo === "lista") && !semSugestoes;

  const seletorRef = useRef<HTMLDivElement>(null);
  const montadoRef = useRef(true);
  const cancelouRef = useRef(false);
  const autoFalarRef = useRef(autoFalar);
  /** Modelo de registro: layout compacto com setas, microfone no cabeçalho e sem OK. */
  const registro = !!aoVozConcluir && !periodo;
  /** Seta tocada durante a escuta: direção a seguir assim que o que foi dito for transcrito. */
  const pedidoRef = useRef<1 | -1 | null>(null);
  const [transcrevendo, setTranscrevendo] = useState(false);


  // Com a voz contínua ativa o chip abre ouvindo: nada de teclado. Senão, foco no campo como sempre.
  useEffect(() => {
    if (!autoFalarRef.current) { inputRef.current?.focus(); inputRef.current?.select(); }
    seletorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  useEffect(() => {
    montadoRef.current = true;
    if (!autoFalarRef.current) return () => { montadoRef.current = false; capturaRef.current?.parar(); };
    // Pequena pausa para a tela mostrar o chip antes de gravar
    const t = setTimeout(() => { void falar(); }, 300);
    return () => { clearTimeout(t); montadoRef.current = false; capturaRef.current?.parar(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** Voz contínua: o que foi dito vale para este chip e a escuta segue para o próximo (ou para). */
  async function falarEmSequencia() {
    if (ouvindo) { cancelouRef.current = true; capturaRef.current?.parar(); return; }
    setErro(null);
    cancelouRef.current = false;
    inputRef.current?.blur(); // fecha o teclado do celular
    setOuvindo(true);
    let cap: CapturaVoz;
    try {
      const sessao = await abrirVoz!();
      cap = sessao.capturar((parcial) => setTexto(parcial));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro no microfone.");
      setOuvindo(false);
      aoVozConcluir?.("vazio");
      return;
    }
    capturaRef.current = cap;
    let falado = "";
    try {
      falado = (await cap.resultado).trim();
    } catch (e) {
      if (!montadoRef.current) return;
      setErro(e instanceof Error ? e.message : "Erro no microfone.");
      capturaRef.current = null;
      pedidoRef.current = null;
      setTranscrevendo(false);
      setOuvindo(false);
      aoVozConcluir?.("vazio");
      return;
    }
    capturaRef.current = null;
    if (!montadoRef.current) return; // a pessoa saiu deste chip enquanto falava
    setOuvindo(false);
    setTranscrevendo(false);
    // Seta tocada durante a escuta: segue na direção pedida; senão, avança para o próximo chip
    const pediu = pedidoRef.current;
    const dir: 1 | -1 = pediu ?? 1;
    pedidoRef.current = null;
    if (cancelouRef.current) { decididoRef.current = true; aoVozConcluir?.("parar"); return; }
    if (!falado) {
      if (pediu) { decididoRef.current = true; aoVozConcluir?.("pular", null, dir); return; } // tocou na seta sem falar
      setErro("Não ouvi nada. Toque no 🎤 para continuar.");
      aoVozConcluir?.("vazio");
      return;
    }
    const comando = comandoDeVoz(falado);
    if (comando) { decididoRef.current = true; aoVozConcluir?.(comando, null, dir); return; }
    const valorDito = chip.tipo === "numero" ? numeroFalado(falado) : falado;
    if (chip.tipo === "numero" && !/\d/.test(valorDito)) {
      setErro(`Não entendi "${falado}" como número. Toque no 🎤 para tentar de novo.`);
      aoVozConcluir?.("vazio");
      return;
    }
    setTexto(valorDito);
    decididoRef.current = true;
    aoVozConcluir?.("valor", valorDito, dir);
  }

  /**
   * Setas do registro. Ouvindo: encerra a gravação já (sem esperar o silêncio), usa o que foi dito e segue.
   * Digitando: vale o texto do campo e segue.
   */
  function navegar(dir: 1 | -1) {
    if (transcrevendo) return;
    if (ouvindo) {
      pedidoRef.current = dir;
      setTranscrevendo(true);
      capturaRef.current?.parar();
      return;
    }
    const t = textoRef.current.trim();
    const mudou = !!t && t !== inicialRef.current;
    decididoRef.current = true;
    aoVozConcluir?.(mudou ? "valor" : "pular", mudou ? t : null, dir);
  }

  async function falar() {
    if (aoVozConcluir && abrirVoz && !periodo) return falarEmSequencia();
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

  // Modelo de registro: balão compacto na largura da caixa de chips. Cabeçalho: nome do campo, posição,
  // microfone e fechar. Linha de baixo: seta ‹, campo (ocupa a sobra da linha) e seta › (✓ no último).
  if (registro) {
    return (
      <div ref={seletorRef} className={`${styles.seletor} ${styles.seletorReg}`} role="dialog" aria-label={chip.rotulo}>
        <div className={styles.regTopo}>
          <strong>
            {chip.rotulo}
            {progresso ? <span className={styles.dica}> · {progresso}</span> : null}
          </strong>
          <span className={styles.regAcoes}>
            {vozDisponivel() ? (
              <button
                type="button"
                className={`${styles.mic} ${ouvindo ? styles.micAtivo : ""}`}
                onClick={() => void falar()}
                disabled={transcrevendo}
                aria-label={ouvindo ? "Parar de ouvir" : "Falar este e os próximos campos"}
                title={ouvindo ? "Parar de ouvir" : "Falar este e os próximos campos (diga “pular” ou “parar”)"}
              >{ouvindo ? "⏸" : "🎤"}</button>
            ) : null}
            <button type="button" className={styles.fechar} onClick={onFechar} aria-label="Fechar">×</button>
          </span>
        </div>
        <div className={styles.regLinha}>
          <button
            type="button"
            className={styles.seta}
            onClick={() => navegar(-1)}
            disabled={!!ehPrimeiro || transcrevendo}
            aria-label="Campo anterior"
          >‹</button>
          <input
            ref={inputRef}
            className={`${styles.input} ${styles.regInput}`}
            value={texto}
            placeholder="valor"
            inputMode={chip.tipo === "numero" ? "decimal" : undefined}
            onChange={(e) => { setTexto(e.target.value); setErro(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); navegar(1); }
              if (e.key === "Escape") onFechar();
            }}
          />
          <button
            type="button"
            className={`${styles.seta} ${ehUltimo ? styles.setaOk : ""}`}
            onClick={() => navegar(1)}
            disabled={transcrevendo}
            aria-label={ehUltimo ? "Concluir" : "Próximo campo"}
          >{transcrevendo ? "…" : ehUltimo ? "✓" : "›"}</button>
        </div>
        {transcrevendo ? (
          <div className={styles.dica}>Transcrevendo…</div>
        ) : ouvindo ? (
          <div className={styles.dica}>Fale o valor · “pular” · “parar”</div>
        ) : null}
        {erro ? <div className={styles.erro}>{erro}</div> : null}
        {alterado ? (
          <button type="button" className={styles.restaurar} onClick={onRestaurar}>↺ limpar</button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={seletorRef} className={styles.seletor} role="dialog" aria-label={chip.rotulo}>
      <div className={styles.seletorTopo}>
        <strong>{chip.rotulo}{progresso ? <span className={styles.dica}> · {progresso}</span> : null}</strong>
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
            title={
              ouvindo ? (abrirVoz ? "Parar de ouvir" : "Parar")
              : abrirVoz && !periodo ? "Falar este e os próximos campos (diga “pular” ou “parar”)"
              : "Falar (encerra sozinho quando você para de falar)"
            }
          >{ouvindo ? "⏸" : "🎤"}</button>
        ) : null}
        <button type="button" className={styles.ok} onClick={confirmarTexto} disabled={!texto.trim()}>OK</button>
      </div>
      {ouvindo ? (
        <div className={styles.dica}>
          {abrirVoz && !periodo
            ? `Ouvindo… diga o valor de ${chip.rotulo}. “Pular” deixa vazio; “parar” encerra.`
            : "Ouvindo… pode falar."}
        </div>
      ) : null}
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
          {chip.valor === "" ? "↺ limpar (deixar vazio)" : `↺ voltar ao valor salvo (${descreverValorChip(chip, chip.valor)})`}
        </button>
      ) : null}
    </div>
  );
}

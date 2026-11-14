import { useEffect, useState, type KeyboardEvent, type MutableRefObject, type RefObject } from "react";
import type { MemoContextCategory } from "@mymemory/shared";
import { apiGetOptional } from "../../api";
import {
  categoriaComRegra,
  dataDaTela,
  dataParaTela,
  ehCampoHora,
  keywordsParaLista,
  montarCamposFormulario,
  type CategoriaComRegra,
  type DadoCampo,
} from "../../lib/revisaoNova";
import s from "../../pages/catalogarNovo.module.css";

/** Categorias do grupo + globais, com campos e a regra de revisão. */
export function useCategoriasCompletas(groupId: number | null | undefined): CategoriaComRegra[] | null {
  const [cats, setCats] = useState<CategoriaComRegra[] | null>(null);
  useEffect(() => {
    let vivo = true;
    const pedidos = [apiGetOptional<{ categories: MemoContextCategory[] }>("/api/memo-context/structure")];
    if (groupId != null) {
      pedidos.unshift(apiGetOptional<{ categories: MemoContextCategory[] }>(`/api/memo-context/structure?groupId=${groupId}`));
    }
    void Promise.all(pedidos).then((rs) => {
      if (!vivo) return;
      const vistos = new Set<number>();
      const out: CategoriaComRegra[] = [];
      for (const r of rs) {
        if (!r.ok) continue;
        for (const c of r.data.categories ?? []) {
          if (c.isActive !== 1 || vistos.has(c.id)) continue;
          vistos.add(c.id);
          out.push(categoriaComRegra(c));
        }
      }
      setCats(out);
    });
    return () => {
      vivo = false;
    };
  }, [groupId]);
  return cats;
}

const SITUACOES = ["Ativo", "Concluído", "Cancelado"];

export interface MemoFormularioProps {
  categorias: CategoriaComRegra[];
  categoryId: number | null;
  onTrocarCategoria: (id: number | null) => void;
  /** Aviso depois de trocar a categoria: preencher com a IA ou deixar em branco. */
  avisoTroca: { nome: string } | null;
  onPreencherIA: () => void;
  onDeixarEmBranco: () => void;
  reextraindo: boolean;
  erroReextrair: string | null;
  /** Aviso no topo do formulário (abaixo do mínimo, categoria crítica). */
  avisoTopo?: { texto: string; sub?: string; info?: boolean } | null;
  assunto: string;
  setAssunto: (v: string) => void;
  assuntoPlaceholder?: string;
  resumo: string;
  setResumo: (v: string) => void;
  maxChars?: number;
  keywords: string;
  setKeywords: (v: string) => void;
  dados: DadoCampo[];
  setDado: (key: string, value: string) => void;
  destacarVazios?: boolean;
  tituloIa?: boolean;
  // Assistente de voz (mesmo da revisão antiga)
  resumoRef?: RefObject<HTMLTextAreaElement>;
  keywordsRef?: RefObject<HTMLTextAreaElement>;
  dadosRefs?: MutableRefObject<Map<string, HTMLInputElement | null>>;
  voz?: {
    textAreaExtraClass: string;
    keywordsAreaExtraClass: string;
    voiceTextAreaProps: object;
    voiceKeywordsAreaProps: object;
    voiceDadosProps: (key: string) => object;
    dadosFieldExtraClass: (key: string) => string;
  };
}

export default function MemoFormulario(p: MemoFormularioProps) {
  const [novaKw, setNovaKw] = useState("");
  const cat = p.categorias.find((c) => c.id === p.categoryId) ?? null;
  const campos = montarCamposFormulario(cat?.campos ?? [], p.dados);
  const lista = keywordsParaLista(p.keywords);
  const over = p.maxChars != null && p.resumo.length > p.maxChars;

  const addKw = () => {
    const novas = keywordsParaLista(novaKw);
    if (novas.length === 0) return;
    p.setKeywords([...lista, ...novas].join(", "));
    setNovaKw("");
  };
  const onKwKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKw();
    } else if (e.key === "Backspace" && !novaKw && lista.length > 0) {
      p.setKeywords(lista.slice(0, -1).join(", "));
    }
  };

  return (
    <div className={s.box}>
      <div className={s.bh}>
        O memo<span className={s.sp} />
        {p.tituloIa ? <span className={s.iaTag}>✦ preenchido pela IA</span> : null}
      </div>
      <div className={s.bb}>
        {p.avisoTopo ? (
          <div className={`${s.aviso} ${p.avisoTopo.info ? s.avisoInfo : ""}`}>
            <span aria-hidden>ⓘ</span>
            <div>
              <b>{p.avisoTopo.texto}</b>
              {p.avisoTopo.sub}
            </div>
          </div>
        ) : null}
        {p.avisoTroca ? (
          <div className={s.aviso} role="status">
            <span aria-hidden>↻</span>
            <div>
              <b>Você trocou a categoria para {p.avisoTroca.nome}.</b>
              Os campos agora são os de {p.avisoTroca.nome}. Quer que a IA preencha de novo a partir do original? O texto do resumo não muda.
              <div className={s.avisoBotoes}>
                <button type="button" className="mm-btn mm-btn--primary" disabled={p.reextraindo} onClick={p.onPreencherIA}>
                  {p.reextraindo ? "Preenchendo…" : "↻ Preencher com a IA"}
                </button>
                <button type="button" className="mm-btn mm-btn--ghost" disabled={p.reextraindo} onClick={p.onDeixarEmBranco}>
                  Deixar em branco
                </button>
              </div>
              {p.erroReextrair ? <p className={s.erro}>{p.erroReextrair}</p> : null}
            </div>
          </div>
        ) : null}

        <div className={s.f}>
          <label className={s.fl} htmlFor="nm-categoria">
            Categoria
          </label>
          <select
            id="nm-categoria"
            className={s.sel}
            value={p.categoryId ?? ""}
            onChange={(e) => p.onTrocarCategoria(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Sem categoria</option>
            {p.categorias.map((c) => (
              <option key={c.id} value={c.id} title={c.description ?? undefined}>
                {c.name}
              </option>
            ))}
          </select>
          {cat?.description ? <div className={s.cnt} style={{ textAlign: "left" }}>{cat.description}</div> : null}
        </div>

        <div className={s.f}>
          <label className={s.fl} htmlFor="nm-assunto">
            Assunto <span>· até 5 palavras, aparece no Buscar e nas listas</span>
          </label>
          <input
            id="nm-assunto"
            className={`${s.in} ${s.assunto}`}
            maxLength={80}
            value={p.assunto}
            placeholder={p.assuntoPlaceholder ?? "ex.: Visita técnica na fazenda"}
            onChange={(e) => p.setAssunto(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className={s.f}>
          <label className={s.fl} htmlFor="nm-resumo">
            Resumo
          </label>
          <textarea
            id="nm-resumo"
            ref={p.resumoRef}
            className={[s.ta, p.voz?.textAreaExtraClass].filter(Boolean).join(" ")}
            value={p.resumo}
            onChange={(e) => p.setResumo(e.target.value)}
            {...(p.voz?.voiceTextAreaProps ?? {})}
          />
          {p.maxChars != null ? (
            <div className={`${s.cnt} ${over ? s.cntOver : ""}`}>
              {p.resumo.length.toLocaleString("pt-BR")} / {p.maxChars.toLocaleString("pt-BR")}
            </div>
          ) : null}
        </div>

        <div className={s.f}>
          <label className={s.fl} htmlFor="nm-kw">
            Palavras-chave <span>· toque no × para tirar</span>
          </label>
          <div className={[s.kw, p.voz?.keywordsAreaExtraClass].filter(Boolean).join(" ")}>
            {lista.map((k, i) => (
              <span key={`${k}-${i}`} className={s.chip}>
                {k}
                <button
                  type="button"
                  aria-label={`Tirar ${k}`}
                  onClick={() => p.setKeywords(lista.filter((_, j) => j !== i).join(", "))}
                >
                  ×
                </button>
              </span>
            ))}
            <textarea
              id="nm-kw"
              ref={p.keywordsRef}
              className={s.kwAdd}
              rows={1}
              value={novaKw}
              placeholder="+ adicionar"
              onChange={(e) => setNovaKw(e.target.value)}
              onKeyDown={onKwKey}
              onBlur={addKw}
              {...(p.voz?.voiceKeywordsAreaProps ?? {})}
            />
          </div>
        </div>

        <div className={s.campos}>
          <div className={s.camposTit}>
            {cat ? `Campos da categoria ${cat.name}` : "Campos"}
            {cat && campos.length > 0 ? (
              <span>
                {" "}
                · {campos.some((c) => c.value.trim()) ? "confira o que foi preenchido" : "ainda em branco"}
              </span>
            ) : null}
          </div>
          {campos.length === 0 ? (
            <p className={s.semCampos}>
              {cat ? "Esta categoria não tem campos. Só resumo e palavras-chave." : "Escolha uma categoria para ver os campos dela."}
            </p>
          ) : (
            <div className={s.cg}>
              {campos.map((c) => {
                const situacao = cat?.campoSituacao != null && c.key.toLowerCase() === cat.campoSituacao.toLowerCase();
                const vazio = !c.value.trim();
                const cls = [s.in, vazio ? (p.destacarVazios ? s.vazioDestaque : s.vazio) : "", p.voz?.dadosFieldExtraClass(c.key)]
                  .filter(Boolean)
                  .join(" ");
                const id = `nm-campo-${c.key}`;
                if (situacao) {
                  return (
                    <div key={c.key} style={{ gridColumn: "1 / -1" }}>
                      <span className={s.cgNome}>{c.key}</span>
                      <div className={s.seg} role="group" aria-label={c.key}>
                        {SITUACOES.map((o) => (
                          <button
                            key={o}
                            type="button"
                            className={(c.value || "Ativo") === o ? s.segOn : ""}
                            onClick={() => p.setDado(c.key, o)}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
                const ehData = c.tipo === "date";
                const ehHora = !ehData && ehCampoHora(c.key);
                const longo = c.value.length > 40;
                return (
                  <label key={c.key} htmlFor={id} style={longo ? { gridColumn: "1 / -1" } : undefined}>
                    <span className={s.cgNome} title={c.descricao ?? undefined}>
                      {c.key}
                      {c.antigo ? <em>campo antigo</em> : null}
                    </span>
                    <input
                      id={id}
                      ref={(el) => {
                        p.dadosRefs?.current.set(c.key, el);
                      }}
                      className={cls}
                      value={ehData ? dataParaTela(c.value) : c.value}
                      inputMode={c.tipo === "number" ? "decimal" : ehData || ehHora ? "numeric" : undefined}
                      placeholder={vazio ? (ehData ? "dd/mm/aaaa" : ehHora ? "hh:mm" : "vazio: a IA não achou") : undefined}
                      onChange={(e) => p.setDado(c.key, ehData ? dataDaTela(e.target.value) : e.target.value)}
                      autoComplete="off"
                      {...(p.voz?.voiceDadosProps(c.key) ?? {})}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

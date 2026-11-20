import type {
  AvisoExecucaoSnapshot,
  MemoContextCategory,
  PerguntaCardHistorico,
  PerguntaClassificacao,
  PerguntaFiltros,
  PerguntaPlanoSalvo,
  PerguntaResposta,
  PlanoSalvo,
} from "@mymemory/shared";
import { descreverStatus, lerValoresStatus, lerVerbosStatus } from "@mymemory/shared";
import { createHash } from "node:crypto";
import { invokeLLM } from "../lib/invokeLlm.js";
import { withSpan } from "../lib/requestTimings.js";
import { executarPipe1 } from "./perguntaPipe1.js";
import { executarPipe2, type QueryDisponivel } from "./perguntaPipe2.js";
import { executarPipe3 } from "./perguntaPipe3.js";
import { getActiveSystemPrompt } from "./llmPromptConfigService.js";
import { gerarSugestaoAviso } from "./avisoService.js";
import type { RestricaoMemos } from "../lib/openaiEmbedding.js";
import {
  aplicarCorte,
  deQuem,
  mensagemRecusa,
  pessoaDaPergunta,
  registrarRecusa,
  type PerfilNaPergunta,
} from "./perfilPerguntaService.js";
import { listarMembrosDoGrupo } from "./donoMemoService.js";
import { executarComandoAlteracao } from "./comandoAlteracaoService.js";
import { prepararCriacao } from "./comandoCriacaoService.js";
import { detectarRepetirLista, prepararRepeticaoLista } from "./repetirListaService.js";
import {
  descricaoConfiguracao,
  detectarPerguntaSobreAssuntos,
  grupoTemConhecimento,
  respostaComoUsar,
  respostaListaAssuntos,
} from "./assuntosAjudaService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCategoriasPayload(categories: MemoContextCategory[]): { nome: string; descricao: string | null }[] {
  return categories
    .filter((c) => c.isActive === 1)
    .map((c) => ({ nome: c.name, descricao: c.description ?? null }));
}

function normCat(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Procura a categoria ativa mais próxima do alvo por similaridade textual.
 * Retorna o nome EXATO da categoria no catálogo, ou null se não encontrar nenhuma.
 * Níveis: (1) normalizado exato, (2) uma contém a outra, (3) sobreposição de palavras ≥ 3 chars.
 */
function encontrarCategoriaProxima(
  alvo: string,
  categories: MemoContextCategory[]
): string | null {
  const normAlvo = normCat(alvo);
  const ativas = categories.filter((c) => c.isActive === 1);

  const exato = ativas.find((c) => normCat(c.name) === normAlvo);
  if (exato) return exato.name;

  const contem = ativas.find((c) => {
    const n = normCat(c.name);
    return n.includes(normAlvo) || normAlvo.includes(n);
  });
  if (contem) return contem.name;

  const palavrasAlvo = normAlvo.split(/\s+/).filter((w) => w.length >= 3);
  if (palavrasAlvo.length > 0) {
    let melhor: { name: string; score: number } | null = null;
    for (const c of ativas) {
      const palavrasCat = normCat(c.name).split(/\s+/).filter((w) => w.length >= 3);
      const overlap = palavrasAlvo.filter((w) => palavrasCat.includes(w)).length;
      if (overlap > 0 && (!melhor || overlap > melhor.score)) {
        melhor = { name: c.name, score: overlap };
      }
    }
    if (melhor) return melhor.name;
  }

  return null;
}

function buildContextoSessao(historico: PerguntaCardHistorico[]): object {
  if (!historico.length) return { mensagens: [] };
  return {
    mensagens: historico.slice(-3).map((h) => ({
      pergunta: h.pergunta,
      resposta: h.resposta,
      pipe: h.pipe,
    })),
  };
}

function toParamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function buildQueriesDisponiveis(
  categories: MemoContextCategory[],
  categoriaNames: string[]
): QueryDisponivel[] {
  return categories
    .filter((c) => c.isActive === 1 && categoriaNames.includes(c.name))
    .flatMap((c) => {
      // Índice campo normalizado → MemoContextCampo para cross-reference
      const campoByParamName = new Map(
        (c.campos ?? [])
          .filter((f) => f.isActive === 1)
          .map((f) => [toParamName(f.name), f])
      );

      return (c.queries ?? [])
        .filter((q) => q.isActive === 1)
        .map((q) => ({
          query_id: String(q.id),
          nome: q.nome,
          descricao: q.descricao,
          sentencaSql: q.sentencaSql,
          conexaoId: q.conexaoId ?? null,
          conexaoPendente: q.conexaoPendente,
          params: (q.params ?? [])
            .filter((p) => p.isActive === 1)
            .sort((a, b) => a.ordem - b.ordem)
            .map((p) => {
              const campo = campoByParamName.get(toParamName(p.campo));
              const exemplos = campo?.normalizedTerms
                ? campo.normalizedTerms.split(",").map((t) => t.trim()).filter(Boolean)
                : [];
              // Status: valores fixos e verbos — o planejador e o filtro usam o valor da lista
              const valoresStatus = campo?.tipo === "status" ? lerValoresStatus(campo.normalizedTerms) : [];
              const status = valoresStatus.length
                ? { valores: valoresStatus, verbos: lerVerbosStatus(campo?.verbos, valoresStatus) }
                : null;
              const descricao = status
                ? [campo?.description, descreverStatus(status.valores, status.verbos)].filter(Boolean).join(" — ")
                : (campo?.description ?? null);
              return {
                nome: toParamName(p.campo),
                tipo: p.tipo,
                obrigatorio: p.obrigatorio === 1,
                operadorSql: p.operadorSql,
                normalizar: p.normalizar === 1,
                descricao_campo: descricao,
                ...(exemplos.length ? { exemplos_valores: exemplos } : {}),
                ...(status ? { status } : {}),
              };
            }),
        }));
    });
}

/** Hash do SQL + parâmetros + conexão da query: se mudar depois de salvar a pergunta, o plano salvo é descartado. */
export function hashQueryDisponivel(q: QueryDisponivel): string {
  const base = JSON.stringify({
    sql: q.sentencaSql,
    conexao: q.conexaoId,
    params: q.params.map((p) => [p.nome, p.tipo, p.operadorSql, p.obrigatorio]),
  });
  return createHash("sha256").update(base).digest("hex").slice(0, 32);
}

/** Coleta todos os memo_ids citados nas respostas do histórico da sessão. */
function escopoMemoIdsDoHistorico(historico: PerguntaCardHistorico[]): number[] {
  const ids = new Set<number>();
  for (const h of historico) {
    for (const d of h.dados_usados ?? []) ids.add(d.memo_id);
  }
  return [...ids];
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    const t = raw.trim();
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    if (i >= 0 && k > i) return JSON.parse(t.slice(i, k + 1)) as T;
  } catch { /* */ }
  return fallback;
}

// ── Classificação ─────────────────────────────────────────────────────────────

export async function classificarPergunta(input: {
  pergunta: string;
  categories: MemoContextCategory[];
  historico: PerguntaCardHistorico[];
  contextoTela?: string;
}): Promise<{ classificacao: PerguntaClassificacao; costUsd: number }> {
  const userMsg = JSON.stringify(
    {
      pergunta: input.pergunta,
      contexto_sessao: buildContextoSessao(input.historico),
      // Onde o usuário estava no sistema de origem (tela, filtros ativos, texto selecionado) —
      // ajuda a resolver referências implícitas mesmo numa pergunta "nova" (contexto: "nova"),
      // sem histórico de sessão pra puxar. Vem de integrações externas (ex.: Softing-erp).
      contexto_tela: input.contextoTela ?? null,
      categorias_disponiveis: buildCategoriasPayload(input.categories),
      modelo_estruturado_generico: {
        id: "consulta_analitica_generica",
        descricao:
          "Permite consultar dados estruturados com filtros, contagem, listagem, agrupamento, soma, média, mínimo, máximo, percentual e comparação quando possível.",
      },
    },
    null,
    2
  );

  const user = `Classifique a pergunta abaixo.\n\nEntrada:\n${userMsg}\n\nRetorne somente JSON neste formato:\n{"pipe":"semantica | estruturada | hibrida","categorias":[],"multi_categoria":true,"intencao":"contagem | percentual | listagem | resumo | explicacao | comparacao | agrupamento | soma | media | tendencia | outro","contexto":"nova | continuidade | refinamento","escopo_sugerido":"global | contexto_sessao | indefinido","categoria_principal":null,"justificativa":"","acao":"consultar | criar | alterar","alvo":"dados | uso_do_sistema"}\n\nCampo "alvo": "uso_do_sistema" quando a pessoa quer saber COMO USAR o sistema ou uma categoria — como fazer algo, onde configurar, para que serve, se é possível, o que significa uma tela, botão, campo, lembrete ou situação (ex.: "como faço para remarcar um compromisso na agenda?", "a agenda manda lembrete?", "onde configuro o lembrete?"); nesses casos "acao" é "consultar". "dados" quando quer os próprios registros e memos ou o que está neles (ex.: "o que tenho na agenda amanhã?", "como está minha agenda essa semana?", "quanto gastei em março?"). Citar o nome de uma categoria não decide: decide se a resposta está nos registros (dados) ou no modo de usar (uso_do_sistema). Na dúvida, "dados".\n\nCampo "acao": "alterar" quando o texto pede para mudar um registro que já existe (adiar, remarcar, mudar, cancelar, concluir, reativar, acrescentar ou tirar itens de uma lista); "criar" quando pede para registrar algo novo (criar, agendar, marcar uma reunião, anotar); "consultar" quando é uma pergunta ou um pedido de informação. Na dúvida, "consultar".`;

  const systemClassificacao = await getActiveSystemPrompt("perguntas_pipe1_classificacao_system");
  const { text, costUsd } = await invokeLLM({ system: systemClassificacao, user, jsonObject: true, source: "classificacao" });

  const fallback: PerguntaClassificacao = {
    pipe: "semantica",
    categorias: [],
    multi_categoria: false,
    intencao: "outro",
    contexto: "nova",
    escopo_sugerido: "global",
    justificativa: "fallback",
  };
  const parsed = safeParseJson<Partial<PerguntaClassificacao>>(text, {});
  const categoriaPrincipal =
    typeof parsed.categoria_principal === "string" && parsed.categoria_principal.trim()
      ? parsed.categoria_principal.trim()
      : null;
  const classificacao: PerguntaClassificacao = {
    pipe: (["semantica", "estruturada", "hibrida"].includes(String(parsed.pipe ?? "")) ? parsed.pipe : "semantica") as PerguntaClassificacao["pipe"],
    categorias: Array.isArray(parsed.categorias) ? (parsed.categorias as string[]) : [],
    multi_categoria: Boolean(parsed.multi_categoria),
    intencao: (parsed.intencao ?? fallback.intencao) as PerguntaClassificacao["intencao"],
    contexto: (["nova", "continuidade", "refinamento"].includes(String(parsed.contexto ?? "")) ? parsed.contexto : "nova") as PerguntaClassificacao["contexto"],
    escopo_sugerido: (["global", "contexto_sessao", "indefinido"].includes(String(parsed.escopo_sugerido ?? "")) ? parsed.escopo_sugerido : "global") as PerguntaClassificacao["escopo_sugerido"],
    categoria_principal: categoriaPrincipal,
    justificativa: String(parsed.justificativa ?? ""),
    acao: (["consultar", "criar", "alterar"].includes(String(parsed.acao ?? "")) ? parsed.acao : "consultar") as PerguntaClassificacao["acao"],
    alvo: parsed.alvo === "uso_do_sistema" ? "uso_do_sistema" : "dados",
  };

  return { classificacao, costUsd };
}

// ── Orquestrador principal ────────────────────────────────────────────────────

export async function perguntarMemory(input: {
  userId: number;
  isAdmin: boolean;
  groupId: number | null;
  pergunta: string;
  filtros: PerguntaFiltros;
  historico: PerguntaCardHistorico[];
  categories: MemoContextCategory[];
  forcePipe?: import("@mymemory/shared").PerguntaPipe;
  forceCategories?: string[];
  thresholdInitial?: number;
  thresholdMin?: number;
  /** Busca nos memos desce o limiar sozinha até achar o primeiro memo (botão "Buscar nos memos"). */
  ampliarAteAchar?: boolean;
  /** Tela/filtros/seleção de onde a pergunta partiu (integrações externas, ex. Softing-erp). */
  contextoTela?: string;
  /** Perfil de acesso do grupo (só quando ele ligou os perfis). Ausente = comportamento de sempre. */
  perfil?: PerfilNaPergunta | null;
  /** Aceita comandos de alteração (só a tela do usuário; nunca chave de integração). */
  permitirComandos?: boolean;
  /** Força o alvo (botões "Buscar nos meus registros" / "No manual"). */
  forceAlvo?: import("@mymemory/shared").PerguntaAlvo;
}): Promise<{
  resposta: PerguntaResposta;
  classificacao: PerguntaClassificacao;
  apiCost: number;
  aguardaFase2?: boolean;
  comando?: import("@mymemory/shared").ComandoAlteracao;
  criacao?: import("@mymemory/shared").ComandoCriacao;
  limiarInicial?: number;
  limiarUsado?: number;
  limiarMinimo?: number;
  memosEncontrados?: number;
  sugestaoAviso?: string;
  avisoSnapshot?: AvisoExecucaoSnapshot;
  planoSalvavel?: PerguntaPlanoSalvo;
}> {
  let totalCost = 0;

  // Categorias que a pessoa pode ver (perfil de acesso ligado = só as liberadas)
  const efetivoPerfil = input.perfil?.efetivo;
  const liberadasPerfil = efetivoPerfil && !efetivoPerfil.todas ? new Set(efetivoPerfil.categoriasPermitidas) : null;
  const categoriasVisiveis = liberadasPerfil ? input.categories.filter((c) => liberadasPerfil.has(c.name)) : input.categories;

  // Perguntas sobre os próprios assuntos ("quais assuntos posso usar?", "como uso a Agenda?"):
  // respondidas por regra, sem classificar nem buscar nos memos.
  if (!input.forcePipe && !input.forceAlvo) {
    const visiveis = categoriasVisiveis;
    const sobre = detectarPerguntaSobreAssuntos(input.pergunta, visiveis);
    if (sobre) {
      const r =
        sobre.tipo === "lista"
          ? { texto: respostaListaAssuntos(visiveis), costUsd: 0 }
          : await respostaComoUsar(sobre.categoria);
      return {
        resposta: {
          resposta: r.texto,
          tipo_resposta: "semantica",
          dados_usados: [],
          limitacoes: [],
          confianca_estimada: 1,
          ...(sobre.tipo === "como_usar" ? { alvo: "uso_do_sistema" as const } : {}),
        },
        classificacao: {
          pipe: "semantica",
          categorias: sobre.tipo === "como_usar" ? [sobre.categoria.name] : [],
          multi_categoria: false,
          intencao: "explicacao",
          contexto: "nova",
          escopo_sugerido: "global",
          justificativa: "pergunta sobre os assuntos (categorias), respondida por regra",
        },
        apiCost: r.costUsd,
      };
    }
  }

  // "Repete a última lista de compras" / botão ⧉ Repetir lista: cartão de registro novo com a lista
  // anterior (itens pendentes, sem os cancelados). Só pela tela do usuário; nada é gravado aqui.
  if (!input.forcePipe && !input.forceAlvo && input.permitirComandos) {
    const pedidoLista = detectarRepetirLista(input.pergunta, categoriasVisiveis);
    if (pedidoLista) {
      const r = await prepararRepeticaoLista({
        userId: input.userId,
        groupId: input.groupId,
        categories: categoriasVisiveis,
        pedido: pedidoLista,
      });
      const classificacaoLista: PerguntaClassificacao = {
        pipe: "semantica",
        categorias: "criacao" in r && r.criacao.categoria ? [r.criacao.categoria] : [],
        multi_categoria: false,
        intencao: "outro",
        contexto: "nova",
        escopo_sugerido: "global",
        justificativa: "repetir lista (regra)",
        acao: "criar",
      };
      const texto = "criacao" in r ? r.criacao.mensagem : r.erro;
      return {
        resposta: {
          resposta: texto,
          tipo_resposta: "semantica",
          dados_usados: [],
          limitacoes: [],
          confianca_estimada: "criacao" in r ? 1 : 0,
        },
        classificacao: classificacaoLista,
        apiCost: 0,
        ...("criacao" in r ? { criacao: r.criacao } : {}),
      };
    }
  }

  // Classificação (ou pipe forçado)
  let classificacao: PerguntaClassificacao;
  if (input.forcePipe) {
    classificacao = {
      pipe: input.forcePipe,
      categorias: input.forceCategories ?? [],
      multi_categoria: false,
      intencao: "outro",
      contexto: "nova",
      escopo_sugerido: "global",
      justificativa: `pipe forçado pelo usuário: ${input.forcePipe}`,
    };
  } else {
    const r = await withSpan("Classificação", () => classificarPergunta({
      pergunta: input.pergunta,
      categories: input.categories,
      historico: input.historico,
      contextoTela: input.contextoTela,
    }));
    classificacao = r.classificacao;
    totalCost += r.costUsd;
  }

  // Fallback de categoria: se o LLM não mapeou nenhuma categoria mas identificou um tema
  // (categoria_principal preenchida), tenta localizar a categoria mais próxima no catálogo.
  if (
    classificacao.categorias.length === 0 &&
    classificacao.categoria_principal &&
    (classificacao.pipe === "estruturada" || classificacao.pipe === "hibrida")
  ) {
    const match = encontrarCategoriaProxima(classificacao.categoria_principal, input.categories);
    if (match) classificacao.categorias = [match];
  }

  // Dúvida de uso do sistema ("como faço para remarcar na agenda?"): responde pelo conhecimento
  // importado (manuais), com a configuração da categoria citada; sem nada no manual, pela configuração.
  const querUso = input.forceAlvo === "uso_do_sistema" || (input.forceAlvo !== "dados" && classificacao.alvo === "uso_do_sistema");
  if (querUso) {
    if (input.forceAlvo === "uso_do_sistema") classificacao.alvo = "uso_do_sistema";
    const cat = classificacao.categorias
      .map((n) => categoriasVisiveis.find((c) => c.isActive === 1 && c.name === n))
      .find((c): c is MemoContextCategory => Boolean(c)) ?? null;
    const comoUso = (texto: string, dados: import("@mymemory/shared").PerguntaMemoUsado[] = [], confianca = 1) => ({
      resposta: texto,
      tipo_resposta: "semantica" as const,
      dados_usados: dados,
      limitacoes: [],
      confianca_estimada: confianca,
      alvo: "uso_do_sistema" as const,
    });
    if (await grupoTemConhecimento(input.groupId)) {
      const r = await executarPipe1({
        pergunta: input.pergunta,
        userId: input.userId,
        groupId: input.groupId,
        filtros: {},
        categoriaNames: classificacao.categorias,
        thresholdInitial: input.thresholdInitial ?? 0.7,
        thresholdMin: input.thresholdMin ?? 0.3,
        contextoTela: input.contextoTela,
        restricao: {
          soConhecimento: true,
          ...(liberadasPerfil && efetivoPerfil
            ? {
                categoriasPermitidas: efetivoPerfil.categoriasPermitidas,
                incluiSemCategoria: efetivoPerfil.incluiSemCategoria,
                categoriasConhecidas: input.categories.filter((c) => c.isActive === 1).map((c) => c.name),
              }
            : {}),
        },
        ampliarAteAchar: true,
        configuracaoCategoria: cat ? descricaoConfiguracao(cat) : undefined,
      });
      totalCost += r.apiCost;
      if (r.memosEncontrados > 0) {
        classificacao.pipe = "semantica";
        return {
          resposta: { ...r.resposta, alvo: "uso_do_sistema" },
          classificacao,
          apiCost: totalCost,
          memosEncontrados: r.memosEncontrados,
        };
      }
    }
    if (cat) {
      const r = await respostaComoUsar(cat);
      totalCost += r.costUsd;
      classificacao.pipe = "semantica";
      return { resposta: comoUso(r.texto), classificacao, apiCost: totalCost };
    }
    if (input.forceAlvo === "uso_do_sistema") {
      classificacao.pipe = "semantica";
      return {
        resposta: comoUso("Não achei isso no manual deste grupo. Tente perguntar de outro jeito ou citar o assunto (ex.: \"Como uso o assunto Agenda?\").", [], 0),
        classificacao,
        apiCost: totalCost,
      };
    }
    // Sem manual e sem categoria citada: segue como pergunta normal
    classificacao.alvo = "dados";
  }

  // Comando ("adiar a reunião para 14h", "acrescentar arroz na lista"): não é pergunta e nunca vai
  // aos pipes de consulta, que só leem. Só pela tela do usuário (nunca por chave de integração).
  if ((classificacao.acao === "alterar" || classificacao.acao === "criar") && input.permitirComandos) {
    const respostaComando = (texto: string, limitacao: string): import("@mymemory/shared").PerguntaResposta => ({
      resposta: texto,
      tipo_resposta: classificacao.pipe,
      dados_usados: [],
      limitacoes: [limitacao],
      confianca_estimada: 0,
    });
    // Perfil de acesso ligado: só as categorias que o perfil libera
    const efetivo = input.perfil?.efetivo;
    const liberadas = efetivo && !efetivo.todas ? new Set(efetivo.categoriasPermitidas) : null;
    const cats = liberadas ? input.categories.filter((c) => liberadas.has(c.name)) : input.categories;
    if (classificacao.acao === "criar") {
      // Mesmo processamento do Catalogar; nada é gravado até o usuário salvar no cartão.
      // O custo do processamento vai no memo (como no Catalogar), não na pergunta.
      const criacao = await withSpan("Registro novo", () => prepararCriacao({
        texto: input.pergunta,
        userId: input.userId,
        isAdmin: input.isAdmin,
        groupId: input.groupId,
        categories: cats,
        classificacao,
      }));
      return {
        resposta: respostaComando(
          `${criacao.mensagem} Nada foi gravado ainda. Se era uma pergunta, use ↺ Refazer.`,
          "Registro novo ainda não gravado: confira no cartão e salve."
        ),
        classificacao,
        apiCost: totalCost,
        criacao,
      };
    }
    const cmd = await withSpan("Comando de alteração", () => executarComandoAlteracao({
      texto: input.pergunta,
      userId: input.userId,
      isAdmin: input.isAdmin,
      groupId: input.groupId,
      categories: cats,
      classificacao,
    }));
    if (cmd) {
      totalCost += cmd.costUsd;
      return { resposta: cmd.resposta, classificacao, apiCost: totalCost, comando: cmd.comando };
    }
    return {
      resposta: respostaComando(
        "Isto parece um pedido de alteração, mas não há neste grupo uma categoria atualizável que você possa alterar. Ligue \"Atualizável\" na categoria. Se era uma pergunta, use ↺ Refazer.",
        "Nenhuma categoria atualizável disponível para o comando."
      ),
      classificacao,
      apiCost: totalCost,
    };
  }

  // Guarda estruturada: sem categoria identificada não há queries disponíveis e o resultado
  // seria sempre vazio. Retorna mensagem clara em vez de silêncio — o frontend pode oferecer
  // ao usuário a opção de tentar a busca semântica.
  if (
    (classificacao.pipe === "estruturada" || classificacao.pipe === "hibrida") &&
    classificacao.categorias.length === 0
  ) {
    const resposta: import("@mymemory/shared").PerguntaResposta = {
      // Curta e sem termos técnicos. "Sim" (uma vez) ou o botão fazem a busca nos memos.
      resposta: "Não achei isso nas consultas do grupo. Quer que eu procure nos textos dos memos? Responda sim ou toque em 🔎 Buscar nos memos.",
      tipo_resposta: "estruturada",
      dados_usados: [],
      limitacoes: [],
      confianca_estimada: 0,
    };
    return {
      resposta,
      classificacao,
      apiCost: totalCost,
    };
  }

  // ── Perfil de acesso (só com `perfis_ativos` ligado no grupo) ────────────────
  // A classificação acima já recebeu TODAS as categorias; aqui o servidor corta pela lista do perfil.
  // Recusa total: uma categoria fora da lista e nada mais é executado.
  let restricao: RestricaoMemos | undefined;
  let escopoAutorId: number | null = null;
  let avisoEscopo: string | undefined;
  let escopoImplicito = false;
  let restricaoSemAutor: RestricaoMemos | undefined;
  const perfil = input.perfil ?? null;
  if (perfil) {
    const catalogo = input.categories.filter((c) => c.isActive === 1).map((c) => c.name);
    const corte = aplicarCorte(perfil.efetivo, classificacao.categorias, catalogo);
    if (!corte.liberada) {
      await registrarRecusa({
        groupId: perfil.groupId,
        userId: perfil.userId,
        perfilId: perfil.efetivo.perfilId,
        categorias: corte.foraDoPerfil,
        motivo: "fora_do_perfil",
        pergunta: input.pergunta,
      });
      return {
        resposta: {
          resposta: mensagemRecusa(corte.foraDoPerfil),
          tipo_resposta: classificacao.pipe,
          dados_usados: [],
          limitacoes: ["Categoria fora do perfil de acesso."],
          confianca_estimada: 0,
        },
        classificacao,
        apiCost: totalCost,
      };
    }

    // Escopo "Pessoal": nas categorias marcadas, memos do próprio autor, a menos que peça "de todos".
    const classificadas = new Set(classificacao.categorias.map(normCat));
    const meusClassificadas = perfil.categoriasMeus.filter((n) => classificadas.has(normCat(n)));
    if (meusClassificadas.length && deQuem(input.pergunta) === "eu") {
      // Membro citado ("agenda do Suporte") → os memos dele; sem nome → os de quem pergunta.
      const cats = meusClassificadas.map((n) => `"${n}"`).join(", ");
      const citado = pessoaDaPergunta(input.pergunta, await listarMembrosDoGrupo(perfil.groupId));
      if (citado?.tipo === "membro" && citado.id !== perfil.autorEscopoId) {
        escopoAutorId = citado.id;
        avisoEscopo = `Mostrando só os memos de ${citado.nome} em ${cats}.`;
      } else if (citado?.tipo === "ambiguo") {
        avisoEscopo = `"${citado.termo}" corresponde a mais de um membro; mostrando os memos de todos em ${cats}.`;
      } else if (perfil.autorEscopoId != null) {
        escopoAutorId = perfil.autorEscopoId;
        escopoImplicito = true;
        avisoEscopo = `Mostrando só os seus memos em ${cats}; para ver os de todos, peça "de todos".`;
      }
    }
    const restrito = !perfil.efetivo.todas;
    if (restrito || escopoAutorId != null) {
      restricao = {
        categoriasPermitidas: restrito ? perfil.efetivo.categoriasPermitidas : undefined,
        incluiSemCategoria: perfil.efetivo.incluiSemCategoria,
        categoriasConhecidas: catalogo,
        escopoAutor: escopoAutorId != null ? { categorias: meusClassificadas, userId: escopoAutorId } : undefined,
      };
      restricaoSemAutor = restrito ? { ...restricao, escopoAutor: undefined } : undefined;
    }
  }
  /** Executa o pipe escolhido com um escopo; `vazio` = nenhum memo nem linha encontrada. */
  const rodar = async (
    restricao: RestricaoMemos | undefined,
    escopoAutorId: number | null
  ): Promise<{ saida: Awaited<ReturnType<typeof perguntarMemory>>; vazio: boolean; podeRepetir: boolean }> => {
    const thInitial = input.thresholdInitial ?? 0.7;
    const thMin = input.thresholdMin ?? 0.3;

    // Resolve o ID da primeira categoria para lookup de override de prompt nas chamadas 2-5
    const firstCategoryName = classificacao.categorias[0] ?? null;
    const firstCategoryId = firstCategoryName
      ? (input.categories.find((c) => c.isActive === 1 && c.name === firstCategoryName)?.id ?? null)
      : null;

    // ── Pipe 1 — Semântica ────────────────────────────────────────────────────
    if (classificacao.pipe === "semantica") {
      const escopoIds = classificacao.escopo_sugerido === "contexto_sessao"
        ? escopoMemoIdsDoHistorico(input.historico)
        : undefined;
      const result = await executarPipe1({
        pergunta: input.pergunta,
        userId: input.userId,
        groupId: input.groupId,
        filtros: input.filtros,
        categoriaNames: classificacao.categorias,
        thresholdInitial: thInitial,
        thresholdMin: thMin,
        escopoMemoIds: escopoIds?.length ? escopoIds : undefined,
        categoryId: firstCategoryId,
        contextoTela: input.contextoTela,
        restricao,
        ampliarAteAchar: input.ampliarAteAchar,
      });
      // "Por que o faturamento aumentou?" cai aqui pelo "por que", mas a explicação precisa dos números do ERP:
      // sem nenhum memo e com queries cadastradas na categoria, promove para híbrida (Pipe 2 + Pipe 1).
      const temQueries = result.memosEncontrados === 0 && buildQueriesDisponiveis(input.categories, classificacao.categorias).length > 0;
      if (temQueries) {
        classificacao.pipe = "hibrida";
        totalCost += result.apiCost;
      } else {
        const { texto: sugestaoAviso } = gerarSugestaoAviso();
        const avisoSnapshot: AvisoExecucaoSnapshot = { tipo: "semantica", limiar: result.limiarUsado ?? thInitial };
        const saida1 = {
          resposta: result.resposta,
          classificacao,
          apiCost: totalCost + result.apiCost,
          limiarInicial: result.limiarInicial,
          limiarUsado: result.limiarUsado,
          limiarMinimo: result.limiarMinimo,
          memosEncontrados: result.memosEncontrados,
          sugestaoAviso,
          avisoSnapshot,
        };
        return { saida: saida1, vazio: result.memosEncontrados === 0, podeRepetir: true };
      }
    }

    // ── Pipe 2 — Estruturada ──────────────────────────────────────────────────
    if (classificacao.pipe === "estruturada") {
      const queriesDisponiveis = buildQueriesDisponiveis(input.categories, classificacao.categorias);
      const result = await executarPipe2({
        pergunta: input.pergunta,
        userId: input.userId,
        groupId: input.groupId,
        filtros: input.filtros,
        historico: input.historico,
        classificacao,
        queriesDisponiveis,
        categoryId: firstCategoryId,
        escopoAutorId,
      });
      const queriesUsadas = result.queriesParaAviso ?? [];
      const { texto: sugestaoAviso } = gerarSugestaoAviso();
      const avisoSnapshot: AvisoExecucaoSnapshot = { tipo: "estruturada", queries: queriesUsadas };
      // Plano reaproveitável ao salvar a pergunta (evita classificação + planejamento na reexecução)
      let planoSalvavel: PerguntaPlanoSalvo | undefined;
      if (result.planoExecutado?.queries.length) {
        const queryHashes: Record<string, string> = {};
        for (const t of result.planoExecutado.queries) {
          const q = queriesDisponiveis.find((x) => x.query_id === t.query_id);
          if (q) queryHashes[t.query_id] = hashQueryDisponivel(q);
        }
        planoSalvavel = {
          versao: 1,
          classificacao,
          plano: result.planoExecutado as unknown as PlanoSalvo,
          queryHashes,
        };
      }
      const saida2 = {
        resposta: result.resposta,
        classificacao,
        apiCost: totalCost + result.apiCost,
        sugestaoAviso,
        avisoSnapshot,
        planoSalvavel,
      };
      return { saida: saida2, vazio: (result.dadosEstruturados?.totalLinhas ?? 0) === 0, podeRepetir: true };
    }

    // ── Pipe 3 — Híbrida ──────────────────────────────────────────────────────
    const queriesDisponiveis = buildQueriesDisponiveis(input.categories, classificacao.categorias);
    const escopoIds3 = classificacao.escopo_sugerido === "contexto_sessao"
      ? escopoMemoIdsDoHistorico(input.historico)
      : undefined;
    const result = await executarPipe3({
      pergunta: input.pergunta,
      userId: input.userId,
      groupId: input.groupId,
      filtros: input.filtros,
      historico: input.historico,
      classificacao,
      queriesDisponiveis,
      categoriaNames: classificacao.categorias,
      thresholdInitial: thInitial,
      thresholdMin: thMin,
      escopoMemoIds: escopoIds3?.length ? escopoIds3 : undefined,
      categoryId: firstCategoryId,
      restricao,
      escopoAutorId,
    });
    const queriesUsadas3 = result.queriesParaAviso ?? [];
    const { texto: sugestaoAviso3 } = gerarSugestaoAviso();
    const avisoSnapshot3: AvisoExecucaoSnapshot = {
      tipo: "hibrida",
      limiar: result.limiarUsado ?? thInitial,
      queries: queriesUsadas3,
    };
    const saida3 = {
      resposta: result.resposta,
      classificacao,
      apiCost: totalCost + result.apiCost,
      aguardaFase2: result.aguardaFase2,
      limiarInicial: result.limiarInicial,
      limiarUsado: result.limiarUsado,
      limiarMinimo: result.limiarMinimo,
      memosEncontrados: result.memosEncontrados,
      sugestaoAviso: sugestaoAviso3,
      avisoSnapshot: avisoSnapshot3,
    };
    const vazio3 = (result.memosEncontrados ?? 0) === 0 && semLinhas(result.resposta.dados_estruturados);
    return { saida: saida3, vazio: vazio3, podeRepetir: !result.aguardaFase2 };
  };

  let r = await rodar(restricao, escopoAutorId);
  // Escopo "Pessoal" implícito sem resultado: repete nos memos de todos (o perfil já permite pedir
  // "de todos"), para não responder "não existe" quando o memo é de outro membro.
  if (r.vazio && escopoImplicito && r.podeRepetir) {
    const r2 = await rodar(restricaoSemAutor, null);
    if (!r2.vazio) {
      r2.saida.apiCost += r.saida.apiCost - totalCost;
      r = r2;
      avisoEscopo = "Nada encontrado nos seus memos; mostrando os de todos.";
    }
  }
  const resp = r.saida.resposta;
  const limitacoes = avisoEscopo ? [...(resp.limitacoes ?? []), avisoEscopo] : resp.limitacoes;
  // Nenhum resultado não é certeza de que "não existe": confiança baixa
  const confianca = r.vazio ? Math.min(resp.confianca_estimada ?? 0, 0.2) : resp.confianca_estimada;
  return { ...r.saida, resposta: { ...resp, limitacoes, confianca_estimada: confianca } };
}

function semLinhas(d: PerguntaResposta["dados_estruturados"]): boolean {
  if (!d) return true;
  const lista = Array.isArray(d) ? d : [d];
  return lista.every((x) => (x?.totalLinhas ?? x?.linhas?.length ?? 0) === 0);
}

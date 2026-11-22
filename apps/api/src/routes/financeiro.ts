import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveUserId } from "../lib/userContext.js";
import { FIN_MOEDA_CODIGOS } from "@mymemory/shared";
import { obterCotacao } from "../services/finCotacaoService.js";
import {
  FinErro,
  agenda,
  atualizarConta,
  atualizarRecorrencia,
  baixar,
  conferencia,
  criarConta,
  criarLancamento,
  criarParcelado,
  criarRecorrencia,
  definirExcecao,
  desfazerBaixa,
  excluirLancamento,
  excluirLote,
  hojeSaoPaulo,
  listarContasComSaldo,
  listarLancamentos,
  listarRecorrencias,
  resolverEspaco,
  ultimoLancamentoId,
  venderInvestimento,
  type Espaco,
} from "../services/financeiroService.js";
import { lerFinConfig, salvarFinConfig } from "../services/finConfigService.js";

/** Controle financeiro — etapa 1 do núcleo (contas, livro, títulos, motor de recorrência). Espaço = o atual do usuário. */

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.coerce.number().int().positive();
const sentido = z.enum(["pagar", "receber"]);
const periodicidade = z.enum(["semanal", "quinzenal", "mensal", "bimestral", "trimestral", "semestral", "anual"]);
const valor = z.number().finite().min(0).max(1e12);

function primeiroEUltimoDoMes(): { de: string; ate: string } {
  const h = hojeSaoPaulo();
  const [a, m] = h.split("-").map(Number);
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${h.slice(0, 7)}-01`, ate: `${h.slice(0, 7)}-${String(ult).padStart(2, "0")}` };
}

const plugin: FastifyPluginAsync = async (app) => {
  async function ctx(req: FastifyRequest, reply: FastifyReply): Promise<Espaco | null> {
    const userId = await resolveUserId(req);
    if (!userId) {
      void reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    return resolverEspaco(userId);
  }

  /** Executa com o espaço do usuário; FinErro vira 400 com mensagem para a tela. */
  function rota<T>(fn: (e: Espaco, req: FastifyRequest) => Promise<T>) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const e = await ctx(req, reply);
      if (!e) return;
      try {
        return await fn(e, req);
      } catch (err) {
        if (err instanceof FinErro) return reply.code(400).send({ error: err.codigo, message: err.message });
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "invalid_body", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
        }
        throw err;
      }
    };
  }

  const periodo = (req: FastifyRequest) => {
    const q = req.query as { de?: string; ate?: string };
    const pad = primeiroEUltimoDoMes();
    return { de: q.de && data.safeParse(q.de).success ? q.de : pad.de, ate: q.ate && data.safeParse(q.ate).success ? q.ate : pad.ate };
  };

  app.get("/api/fin/espaco", rota(async (e) => ({ ...e, hoje: hojeSaoPaulo(), ...primeiroEUltimoDoMes() })));

  app.get("/api/fin/contas", rota(async (e, req) => {
    const p = periodo(req);
    return { ...p, contas: await listarContasComSaldo(e, p.de, p.ate) };
  }));

  app.post("/api/fin/contas", rota(async (e, req) => {
    const b = z.object({
      nome: z.string().min(1).max(120),
      tipo: z.enum(["banco", "cartao", "corretora", "investimento", "despesa", "receita"]),
      papel: z.string().max(30).nullish(),
      corretoraContaId: id.nullish(),
      moeda: z.string().length(3).nullish(),
      mercado: z.enum(["local", "exterior"]).nullish(),
      saldoInicial: z.number().finite().nullish(),
      saldoInicialReais: z.number().finite().positive().nullish(),
      dataSaldo: data.nullish(),
    }).parse(req.body);
    return { conta: await criarConta(e, b) };
  }));

  app.patch("/api/fin/contas/:id", rota(async (e, req) => {
    const b = z.object({ nome: z.string().max(120).optional(), ativo: z.boolean().optional(), mercado: z.enum(["local", "exterior"]).optional() }).parse(req.body);
    await atualizarConta(e, id.parse((req.params as { id: string }).id), b);
    return { ok: true };
  }));

  app.get("/api/fin/config", rota(async (e) => lerFinConfig(e)));

  app.patch("/api/fin/config", rota(async (e, req) => {
    const b = z.object({ gravarDireto: z.boolean().optional(), criarGrupo: z.boolean().optional(), criarConta: z.boolean().optional() }).parse(req.body);
    return salvarFinConfig(e, b);
  }));

  app.get("/api/fin/agenda", rota(async (e, req) => {
    const p = periodo(req);
    return agenda(e, p.de, p.ate);
  }));

  app.get("/api/fin/recorrencias", rota(async (e) => ({ recorrencias: await listarRecorrencias(e) })));

  app.post("/api/fin/recorrencias", rota(async (e, req) => {
    const b = z.object({
      sentido, descricao: z.string().min(1).max(200), valor: valor.positive(), periodicidade,
      inicio: data, fim: data.nullish(), contaGrupoId: id, contaPagamentoId: id.nullish(),
    }).parse(req.body);
    return { id: await criarRecorrencia(e, b) };
  }));

  app.patch("/api/fin/recorrencias/:id", rota(async (e, req) => {
    const b = z.object({
      descricao: z.string().max(200).optional(), valor: valor.positive().optional(), fim: data.nullable().optional(),
      contaGrupoId: id.optional(), contaPagamentoId: id.nullable().optional(), ativo: z.boolean().optional(),
    }).parse(req.body);
    await atualizarRecorrencia(e, id.parse((req.params as { id: string }).id), b);
    return { ok: true };
  }));

  /** Exceção de um vencimento: { valor } ou { pular: true }; corpo { remover: true } desfaz. */
  app.put("/api/fin/recorrencias/:id/excecoes/:referencia", rota(async (e, req) => {
    const pr = req.params as { id: string; referencia: string };
    const b = z.object({ valor: valor.positive().nullish(), pular: z.boolean().optional(), remover: z.boolean().optional() }).parse(req.body);
    await definirExcecao(e, id.parse(pr.id), data.parse(pr.referencia), b.remover ? null : { valor: b.valor ?? null, pular: b.pular ?? false });
    return { ok: true };
  }));

  app.post("/api/fin/parcelados", rota(async (e, req) => {
    const b = z.object({
      sentido, descricao: z.string().min(1).max(200), valorTotal: valor.positive(), parcelas: z.number().int().min(1).max(360),
      primeiroVencimento: data, periodicidade: periodicidade.optional(), contaGrupoId: id, dataCompetencia: data.nullish(),
    }).parse(req.body);
    return criarParcelado(e, b);
  }));

  app.delete("/api/fin/parcelados/:lote", rota(async (e, req) => {
    await excluirLote(e, z.string().uuid().parse((req.params as { lote: string }).lote));
    return { ok: true };
  }));

  app.post("/api/fin/baixas", rota(async (e, req) => {
    const b = z.object({
      tituloId: id.nullish(), recorrenciaId: id.nullish(), referencia: data.nullish(),
      data, valorPago: valor.positive().nullish(), contaPagamentoId: id,
    }).parse(req.body);
    return baixar(e, b);
  }));

  app.delete("/api/fin/baixas/:tituloId", rota(async (e, req) => {
    await desfazerBaixa(e, id.parse((req.params as { tituloId: string }).tituloId));
    return { ok: true };
  }));

  app.get("/api/fin/lancamentos", rota(async (e, req) => {
    const p = periodo(req);
    const c = id.safeParse((req.query as { contaId?: string }).contaId);
    return { ...p, lancamentos: await listarLancamentos(e, p.de, p.ate, c.success ? c.data : null) };
  }));

  app.post("/api/fin/lancamentos", rota(async (e, req) => {
    const b = z.object({
      data, descricao: z.string().max(200), valor: valor.nullish(), valorMoeda: valor.nullish(), contaOrigemId: id, contaDestinoId: id,
      quantidade: z.number().finite().nullish(), preco: z.number().finite().positive().nullish(),
    }).parse(req.body);
    const r = await criarLancamento(e, b);
    return { ...r, id: await ultimoLancamentoId(e, { data: b.data, origem: b.contaOrigemId, destino: b.contaDestinoId }) };
  }));

  app.delete("/api/fin/lancamentos/:id", rota(async (e, req) => {
    await excluirLancamento(e, id.parse((req.params as { id: string }).id));
    return { ok: true };
  }));

  app.post("/api/fin/investimentos/venda", rota(async (e, req) => {
    const b = z.object({
      contaPapelId: id, contaDestinoId: id, data, quantidade: z.number().finite().positive(), valorTotal: valor.positive(),
    }).parse(req.body);
    return venderInvestimento(e, b);
  }));

  app.get("/api/fin/conferencia", rota(async (e) => conferencia(e)));

  /** Cotação PTAX (fechamento) da moeda na data ou a última anterior. */
  app.get("/api/fin/cotacao", rota(async (_e, req) => {
    const q = req.query as { moeda?: string; data?: string };
    const moeda = String(q.moeda ?? "").toUpperCase();
    if (!FIN_MOEDA_CODIGOS.includes(moeda)) throw new FinErro("moeda", "Moeda não suportada.");
    const d = q.data && data.safeParse(q.data).success ? q.data : hojeSaoPaulo();
    return { moeda, cotacao: await obterCotacao(moeda, d) };
  }));
};

export default plugin;

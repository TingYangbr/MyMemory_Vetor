/**
 * Controle financeiro — etapa 2a (leitura pelo Fale comigo). Categoria-modelo "Controle financeiro" e as
 * consultas prontas sobre as tabelas fin_. Rodam isoladas (papel mm_query_reader): a RLS já recorta o espaço
 * (grupo ou pessoal), então as consultas não filtram groupid/userid. A previsão das recorrências vem da
 * função fin_agenda (o motor em SQL, igual ao de packages/shared/src/financeiro.ts).
 */

export interface FinConsultaDef {
  nome: string;
  descricao: string;
  sql: string;
  params: { campo: string; tipo: "date" | "string" | "number"; operadorSql: string }[];
}

const HOJE = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
const INI_MES = "date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date";
const FIM_MES = "(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month - 1 day')::date";
/** "Sem data final" na agenda: títulos sem limite; a previsão das recorrências vai até 12 meses à frente (fin_agenda). */
export const SEM_FIM = "DATE '9999-12-31'";

/**
 * Fatura de cartão: vencimento da fatura em que cai uma compra feita em "d", com fechamento no dia "fech" e vencimento
 * no dia "venc" (dia além do fim do mês = último dia). Compra até o dia do fechamento entra no fechamento do mês; depois
 * dele, no do mês seguinte. Vencimento depois do fechamento = mesmo mês; antes ou igual = mês seguinte.
 */
export const SQL_FUNCOES_FATURA = `
CREATE OR REPLACE FUNCTION public.fin_fatura_de(d date, fech int, venc int) RETURNS date
LANGUAGE sql IMMUTABLE AS $f$
  WITH a AS (
    SELECT CASE WHEN EXTRACT(DAY FROM d)::int <= LEAST(fech, EXTRACT(DAY FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int)
                THEN date_trunc('month', d)::date ELSE (date_trunc('month', d) + interval '1 month')::date END AS mf
  ), b AS (
    SELECT CASE WHEN venc > fech THEN mf ELSE (mf + interval '1 month')::date END AS mv FROM a
  )
  SELECT mv + (LEAST(venc, EXTRACT(DAY FROM (mv + interval '1 month - 1 day'))::int) - 1) FROM b
$f$;
CREATE OR REPLACE FUNCTION public.fin_fatura_pagamento(d date, fech int, venc int) RETURNS date
LANGUAGE sql IMMUTABLE AS $f$
  SELECT public.fin_fatura_de(
    CASE WHEN EXTRACT(DAY FROM d)::int >= fech THEN date_trunc('month', d)::date
         ELSE (date_trunc('month', d) - interval '1 month')::date END, fech, venc)
$f$;
CREATE OR REPLACE FUNCTION public.fin_lanc_fatura() RETURNS trigger
LANGUAGE plpgsql AS $f$
DECLARE o record; dd record;
BEGIN
  IF NEW.fatura IS NOT NULL THEN RETURN NEW; END IF;
  SELECT tipo, dia_fechamento, dia_vencimento INTO o FROM public.fin_contas WHERE id = NEW.conta_origemid;
  IF o.tipo = 'cartao' AND o.dia_fechamento IS NOT NULL AND o.dia_vencimento IS NOT NULL THEN
    NEW.fatura := public.fin_fatura_de(NEW.data, o.dia_fechamento, o.dia_vencimento);
    RETURN NEW;
  END IF;
  SELECT tipo, dia_fechamento, dia_vencimento INTO dd FROM public.fin_contas WHERE id = NEW.conta_destinoid;
  IF dd.tipo = 'cartao' AND dd.dia_fechamento IS NOT NULL AND dd.dia_vencimento IS NOT NULL THEN
    NEW.fatura := CASE WHEN o.tipo IN ('banco', 'corretora')
      THEN public.fin_fatura_pagamento(NEW.data, dd.dia_fechamento, dd.dia_vencimento)
      ELSE public.fin_fatura_de(NEW.data, dd.dia_fechamento, dd.dia_vencimento) END;
  END IF;
  RETURN NEW;
END
$f$;
DROP TRIGGER IF EXISTS fin_lanc_fatura ON public.fin_lancamentos;
CREATE TRIGGER fin_lanc_fatura BEFORE INSERT ON public.fin_lancamentos FOR EACH ROW EXECUTE FUNCTION public.fin_lanc_fatura()`;

/** Recalcula a fatura dos lançamentos de um cartão (exceto os mudados à mão). Sem dias, tira a fatura. Parâmetro: id do cartão. */
export const SQL_RECALCULAR_FATURAS = `
UPDATE fin_lancamentos l SET fatura = CASE
    WHEN c.dia_fechamento IS NULL OR c.dia_vencimento IS NULL THEN NULL
    WHEN l.conta_origemid = c.id THEN public.fin_fatura_de(l.data, c.dia_fechamento, c.dia_vencimento)
    WHEN o.tipo IN ('banco', 'corretora') THEN public.fin_fatura_pagamento(l.data, c.dia_fechamento, c.dia_vencimento)
    ELSE public.fin_fatura_de(l.data, c.dia_fechamento, c.dia_vencimento) END
FROM fin_contas c, fin_contas o
WHERE c.id = $1 AND o.id = l.conta_origemid AND (l.conta_origemid = c.id OR l.conta_destinoid = c.id)
  AND l.fatura_manual = 0`;

/** Função do motor em SQL: títulos + ocorrências previstas das recorrências + faturas de cartão, como a aba Previstos da tela. */
export const SQL_FUNCAO_FIN_AGENDA = `
CREATE OR REPLACE FUNCTION public.fin_agenda(p_de date, p_ate date)
RETURNS TABLE (vencimento date, situacao text, tipo text, descricao text, valor numeric, grupo text,
               origem text, parcela int, parcelas int, pago_em date, valor_pago numeric)
LANGUAGE sql STABLE
AS $fn$
  WITH h AS (SELECT ${HOJE} AS d),
  tit AS (
    SELECT t.vencimento AS v,
           CASE WHEN t.situacao = 'quitado' THEN 'pago' WHEN t.vencimento < h.d THEN 'atraso' ELSE 'confirmado' END AS s,
           t.sentido AS tp, t.descricao AS ds, t.valor AS vl, g.nome AS gr,
           CASE WHEN t.recorrenciaid IS NULL THEN 'titulo' ELSE 'recorrencia' END AS og,
           t.parcela AS pc, t.parcelas AS pcs, t.quitado_em AS pe, t.valor_pago AS vp
    FROM fin_titulos t JOIN fin_contas g ON g.id = t.conta_grupoid CROSS JOIN h
    WHERE (t.situacao = 'aberto' AND t.vencimento <= p_ate AND (t.vencimento >= p_de OR t.vencimento < h.d))
       OR (t.situacao = 'quitado' AND t.quitado_em BETWEEN p_de AND p_ate)
  ),
  reg AS (
    SELECT r.id, r.sentido, r.descricao, r.valor, r.periodicidade, r.inicio, LEAST(COALESCE(r.fim, p_ate), CASE WHEN p_ate >= DATE '9999-01-01' THEN h.d + 366 ELSE p_ate END) AS ate,
           g.nome AS gr, h.d AS hoje,
           GREATEST(r.inicio, date_trunc('month', r.criado_em AT TIME ZONE 'America/Sao_Paulo')::date, h.d - 366) AS piso,
           CASE r.periodicidade WHEN 'mensal' THEN 1 WHEN 'bimestral' THEN 2 WHEN 'trimestral' THEN 3
                                WHEN 'semestral' THEN 6 WHEN 'anual' THEN 12 ELSE 0 END AS meses
    FROM fin_recorrencias r JOIN fin_contas g ON g.id = r.conta_grupoid CROSS JOIN h
    WHERE r.ativo = 1
  ),
  oc AS (
    SELECT reg.*, ref.d AS ref
    FROM reg
    CROSS JOIN LATERAL (
      SELECT CASE WHEN reg.meses > 0 THEN (reg.inicio + make_interval(months => n * reg.meses))::date
                  ELSE reg.inicio + n * (CASE reg.periodicidade WHEN 'semanal' THEN 7 ELSE 14 END) END AS d
      FROM generate_series(0, GREATEST(-1, CASE WHEN reg.meses > 0
          THEN ((EXTRACT(YEAR FROM reg.ate) - EXTRACT(YEAR FROM reg.inicio)) * 12
                + EXTRACT(MONTH FROM reg.ate) - EXTRACT(MONTH FROM reg.inicio))::int / reg.meses
          ELSE (reg.ate - reg.inicio) / (CASE reg.periodicidade WHEN 'semanal' THEN 7 ELSE 14 END) END)) AS n
    ) ref
  ),
  prev AS (
    SELECT oc.ref AS v, CASE WHEN oc.ref < oc.hoje THEN 'atraso' ELSE 'previsto' END AS s,
           oc.sentido AS tp, oc.descricao AS ds, COALESCE(x.valor, oc.valor) AS vl, oc.gr,
           'recorrencia' AS og, NULL::int AS pc, NULL::int AS pcs, NULL::date AS pe, NULL::numeric AS vp
    FROM oc
    LEFT JOIN fin_recorrencia_excecoes x ON x.recorrenciaid = oc.id AND x.referencia = oc.ref
    WHERE oc.ref <= oc.ate
      AND COALESCE(x.pular, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM fin_titulos t2 WHERE t2.recorrenciaid = oc.id AND t2.referencia = oc.ref)
      AND ((oc.ref < oc.hoje AND oc.ref >= oc.piso) OR (oc.ref >= oc.hoje AND oc.ref >= p_de))
  ),
  fat AS (
    SELECT c.id AS cid, c.nome AS cn, c.dia_fechamento AS fe, c.dia_vencimento AS ve, l.fatura AS fv,
           SUM(CASE WHEN l.conta_origemid = c.id THEN l.valor WHEN o.tipo IN ('banco', 'corretora') THEN 0 ELSE -l.valor END) AS compras,
           SUM(CASE WHEN l.conta_destinoid = c.id AND o.tipo IN ('banco', 'corretora') THEN l.valor ELSE 0 END) AS pago,
           MAX(CASE WHEN l.conta_destinoid = c.id AND o.tipo IN ('banco', 'corretora') THEN l.data END) AS ult
    FROM fin_contas c
    JOIN fin_lancamentos l ON c.id IN (l.conta_origemid, l.conta_destinoid) AND l.fatura IS NOT NULL
    JOIN fin_contas o ON o.id = l.conta_origemid
    WHERE c.tipo = 'cartao'
    GROUP BY c.id, c.nome, c.dia_fechamento, c.dia_vencimento, l.fatura
  ),
  fat2 AS (SELECT fat.*, SUM(compras - pago) OVER (PARTITION BY cid ORDER BY fv) AS aberto FROM fat),
  fatr AS (
    SELECT fv AS v,
           CASE WHEN aberto <= 0.005 THEN 'pago'
                WHEN fv < h.d THEN 'atraso'
                WHEN fe IS NOT NULL AND public.fin_fatura_de(h.d, fe, ve) <= fv THEN 'previsto'
                ELSE 'confirmado' END AS s,
           'pagar'::text AS tp, 'Fatura ' || cn AS ds,
           CASE WHEN aberto <= 0.005 THEN pago ELSE aberto END AS vl, cn AS gr, 'fatura'::text AS og,
           NULL::int AS pc, NULL::int AS pcs, CASE WHEN aberto <= 0.005 THEN ult END AS pe,
           CASE WHEN pago > 0 THEN pago END AS vp
    FROM fat2 CROSS JOIN h
    WHERE (aberto > 0.005 AND fv <= p_ate AND (fv >= p_de OR fv < h.d))
       OR (aberto <= 0.005 AND pago > 0 AND fv BETWEEN p_de AND p_ate)
  )
  SELECT v, s, tp, ds, vl, gr, og, pc, pcs, pe, vp FROM tit
  UNION ALL
  SELECT v, s, tp, ds, vl, gr, og, pc, pcs, pe, vp FROM prev
  UNION ALL
  SELECT v, s, tp, ds, vl, gr, og, pc, pcs, pe, vp FROM fatr
$fn$`;

/**
 * View de entradas e saídas (como a ia_FaturamentoProduto do ERP): uma linha por lançamento com todos os campos — de
 * onde saiu e para onde foi, grupo, tipo, conta do lado do dinheiro, receita/despesa/resultado já com sinal, moeda e
 * quantidade. O recorte do espaço está NA view (mesma regra da RLS: mm_ctx_*), porque ela roda com os direitos do dono;
 * fora de uma consulta isolada (sem contexto) ela não devolve nada.
 */
export const SQL_VIEW_FIN_LANCAMENTOS = `
CREATE OR REPLACE VIEW public.fin_v_lancamentos AS
SELECT l.id, l.data, to_char(date_trunc('month', l.data), 'YYYY-MM') AS mes, l.descricao, l.valor,
  o.nome AS saiu_de, o.tipo AS tipo_saida, d.nome AS foi_para, d.tipo AS tipo_entrada,
  CASE WHEN o.tipo IN ('despesa', 'receita') THEN o.nome WHEN d.tipo IN ('despesa', 'receita') THEN d.nome END AS grupo,
  CASE WHEN 'despesa' IN (o.tipo, d.tipo) THEN 'despesa'
       WHEN 'receita' IN (o.tipo, d.tipo) THEN 'receita'
       WHEN 'investimento' IN (o.tipo, d.tipo) THEN 'investimento'
       WHEN o.tipo IN ('banco', 'cartao', 'corretora') AND d.tipo IN ('banco', 'cartao', 'corretora') THEN 'transferencia'
       ELSE 'outro' END AS tipo,
  CASE WHEN o.tipo IN ('despesa', 'receita') THEN d.nome WHEN d.tipo IN ('despesa', 'receita') THEN o.nome END AS conta,
  CASE WHEN o.tipo = 'receita' THEN l.valor WHEN d.tipo = 'receita' THEN -l.valor ELSE 0 END AS receita,
  CASE WHEN d.tipo = 'despesa' THEN l.valor WHEN o.tipo = 'despesa' THEN -l.valor ELSE 0 END AS despesa,
  (CASE WHEN o.tipo = 'receita' THEN l.valor WHEN d.tipo = 'receita' THEN -l.valor ELSE 0 END)
    - (CASE WHEN d.tipo = 'despesa' THEN l.valor WHEN o.tipo = 'despesa' THEN -l.valor ELSE 0 END) AS resultado,
  l.moeda, l.valor_moeda, l.quantidade, l.preco,
  ti.descricao AS titulo, ti.vencimento AS titulo_vencimento, l.tituloid AS titulo_id, l.fatura
FROM fin_lancamentos l
JOIN fin_contas o ON o.id = l.conta_origemid
JOIN fin_contas d ON d.id = l.conta_destinoid
LEFT JOIN fin_titulos ti ON ti.id = l.tituloid
WHERE (SELECT public.mm_ctx_ativo())
  AND CASE WHEN (SELECT public.mm_ctx_group_id()) IS NOT NULL
        THEN l.groupid = (SELECT public.mm_ctx_group_id())
        ELSE l.groupid IS NULL AND l.userid = (SELECT public.mm_ctx_user_id()) END`;

/** A mesma consulta sem a view (fallback se o banco não aceitar criá-la). */
export const SQL_LANCAMENTOS_SEM_VIEW = `SELECT l.data, to_char(date_trunc('month', l.data), 'YYYY-MM') AS mes, l.descricao, l.valor,
  o.nome AS saiu_de, o.tipo AS tipo_saida, d.nome AS foi_para, d.tipo AS tipo_entrada,
  CASE WHEN o.tipo IN ('despesa', 'receita') THEN o.nome WHEN d.tipo IN ('despesa', 'receita') THEN d.nome END AS grupo,
  CASE WHEN 'despesa' IN (o.tipo, d.tipo) THEN 'despesa'
       WHEN 'receita' IN (o.tipo, d.tipo) THEN 'receita'
       WHEN 'investimento' IN (o.tipo, d.tipo) THEN 'investimento'
       WHEN o.tipo IN ('banco', 'cartao', 'corretora') AND d.tipo IN ('banco', 'cartao', 'corretora') THEN 'transferencia'
       ELSE 'outro' END AS tipo,
  CASE WHEN o.tipo IN ('despesa', 'receita') THEN d.nome WHEN d.tipo IN ('despesa', 'receita') THEN o.nome END AS conta,
  CASE WHEN o.tipo = 'receita' THEN l.valor WHEN d.tipo = 'receita' THEN -l.valor ELSE 0 END AS receita,
  CASE WHEN d.tipo = 'despesa' THEN l.valor WHEN o.tipo = 'despesa' THEN -l.valor ELSE 0 END AS despesa,
  (CASE WHEN o.tipo = 'receita' THEN l.valor WHEN d.tipo = 'receita' THEN -l.valor ELSE 0 END)
    - (CASE WHEN d.tipo = 'despesa' THEN l.valor WHEN o.tipo = 'despesa' THEN -l.valor ELSE 0 END) AS resultado,
  l.moeda, l.valor_moeda, l.quantidade, l.preco
FROM fin_lancamentos l
JOIN fin_contas o ON o.id = l.conta_origemid
JOIN fin_contas d ON d.id = l.conta_destinoid
WHERE l.data BETWEEN COALESCE(:data_ini, ${INI_MES}) AND COALESCE(:data_fin, ${FIM_MES})
  AND (:tipo IS NULL
       OR ('despesa' IN (o.tipo, d.tipo) AND (:tipo ILIKE '%desp%' OR :tipo ILIKE '%gast%'))
       OR ('receita' IN (o.tipo, d.tipo) AND (:tipo ILIKE '%receit%' OR :tipo ILIKE '%receb%' OR :tipo ILIKE '%ganh%'))
       OR ('investimento' IN (o.tipo, d.tipo) AND :tipo ILIKE '%invest%')
       OR (o.tipo IN ('banco', 'cartao', 'corretora') AND d.tipo IN ('banco', 'cartao', 'corretora') AND :tipo ILIKE '%transf%'))
  AND (:grupo IS NULL OR (o.tipo IN ('despesa', 'receita') AND o.nome ILIKE :grupo) OR (d.tipo IN ('despesa', 'receita') AND d.nome ILIKE :grupo))
  AND (:conta IS NULL OR o.nome ILIKE :conta OR d.nome ILIKE :conta)
  AND (:saiu_de IS NULL OR o.nome ILIKE :saiu_de)
  AND (:foi_para IS NULL OR d.nome ILIKE :foi_para)
  AND (:descricao IS NULL OR l.descricao ILIKE :descricao)
  AND (:valor_min IS NULL OR l.valor >= :valor_min)
  AND (:valor_max IS NULL OR l.valor <= :valor_max)
ORDER BY l.data, l.id`;

/** Três categorias, separadas pelo tempo da pergunta (futuro, passado, posição) — como no ERP, facilita a classificação. */
export interface FinCategoriaDef {
  nome: string;
  descricao: string;
  resumo: string;
  exemplos: string;
  /** Nomes (início) das consultas de FIN_CONSULTAS que vão nesta categoria. */
  consultas: string[];
}

const ORIGEM = "Dados da tela Contas a pagar e receber (controle financeiro), não de memos. ";

export const FIN_CATEGORIAS: FinCategoriaDef[] = [
  {
    nome: "Finanças Pessoais - A pagar e receber",
    descricao:
      ORIGEM +
      "O FUTURO e os compromissos: contas a pagar e a receber, vencimentos, o que vence hoje/esta semana/no mês, contas atrasadas, " +
      "aluguel, salário e outras contas fixas (recorrentes), parcelas e boletos, quanto vou pagar ou receber, " +
      "fluxo de caixa previsto, se vai faltar dinheiro.",
    resumo: "O que vence, o que está atrasado, quanto vai pagar e receber, e como fica o caixa nos próximos meses.",
    exemplos: ["O que vence esta semana?", "Tenho conta atrasada?", "Quanto vou pagar em março?", "Quanto falta da geladeira?", "Como fica meu caixa nos próximos 3 meses?"].join("\n"),
    consultas: ["Financeiro — Contas a pagar e receber", "Financeiro — Fluxo de caixa"],
  },
  {
    nome: "Finanças Pessoais - Gastos e lançamentos",
    descricao:
      ORIGEM +
      "O PASSADO: quanto gastei ou recebi, gastos por grupo (alimentação, moradia, transporte…), receitas, quanto sobrou ou faltou no mês, " +
      "comparar meses, quanto saiu ou entrou de uma conta ou cartão, extrato, lançamentos, para quem paguei, maiores gastos.",
    resumo: "Quanto gastou e recebeu, por grupo e por mês, o que sobrou, e o extrato de cada conta e cartão.",
    exemplos: ["Quanto gastei com alimentação em outubro?", "Sobrou dinheiro em outubro?", "Quanto saiu do Itaú este mês?", "O que paguei para a Michelle?", "Quais foram meus maiores gastos no mês?"].join("\n"),
    consultas: ["Financeiro — Lançamentos"],
  },
  {
    nome: "Finanças Pessoais - Saldos e investimentos",
    descricao:
      ORIGEM +
      "A POSIÇÃO de hoje (ou de uma data): saldo de banco e de corretora, quanto tenho, quanto devo no cartão de crédito, " +
      "contas a receber e a pagar em aberto (total), dólar e outras moedas e quanto valem hoje, " +
      "investimentos (ações, fundos, Tesouro): quantidade, preço médio, quanto investi em cada papel.",
    resumo: "Quanto tem em cada conta, quanto deve no cartão, quanto vale o dólar guardado e a posição dos investimentos.",
    exemplos: ["Quanto tenho no banco?", "Quanto devo no cartão?", "Quanto vale meu dólar hoje?", "Quantas PETR4 tenho e a que preço médio?", "Quanto tenho investido?"].join("\n"),
    consultas: ["Financeiro — Saldos", "Financeiro — Posição de investimentos", "Financeiro — Contas cadastradas", "Financeiro — Histórico de preços"],
  },
];

const periodo = (_desc: string): FinConsultaDef["params"] => [
  { campo: "data_ini", tipo: "date", operadorSql: ">=" },
  { campo: "data_fin", tipo: "date", operadorSql: "<=" },
];

export const FIN_CONSULTAS: FinConsultaDef[] = [
  {
    nome: "Financeiro — Histórico de preços",
    descricao:
      "Preço de fechamento de cada pregão dos papéis da B3 (arquivo oficial da B3), dos papéis que alguém da base tem ou já " +
      "teve: data, papel (ticker), fechamento, abertura, maxima, minima, volume e variacao_pct_periodo (variação do fechamento " +
      "sobre o primeiro pregão do período, em %). Use para: quanto PETR4 subiu ou caiu no mês/ano, evolução do preço, maior e " +
      "menor preço no período, preço em uma data. Preços não ajustados por desdobramento ou proventos. papel = ticker (PETR4); " +
      "sem período: os últimos 30 dias. 'Quanto subiu' = variacao_pct_periodo da última data do período.",
    sql: `SELECT p.data, p.ticker AS papel, p.fechamento, p.abertura, p.maxima, p.minima, p.volume,
  ROUND(100.0 * (p.fechamento / NULLIF(FIRST_VALUE(p.fechamento) OVER (PARTITION BY p.ticker ORDER BY p.data), 0) - 1), 2) AS variacao_pct_periodo
FROM fin_precos_historico p
WHERE (:papel IS NULL OR p.ticker = UPPER(:papel))
  AND p.data BETWEEN COALESCE(:data_ini, ${HOJE} - 30) AND COALESCE(:data_fin, ${HOJE})
ORDER BY p.ticker, p.data
LIMIT 5000`,
    params: [
      { campo: "papel", tipo: "string", operadorSql: "=" },
      { campo: "data_ini", tipo: "date", operadorSql: ">=" },
      { campo: "data_fin", tipo: "date", operadorSql: "<=" },
    ],
  },
  {
    nome: "Financeiro — Contas a pagar e receber (previstos)",
    descricao:
      "Vencimentos do período: títulos (parcelas, contas a prazo), a PREVISÃO das contas recorrentes (aluguel, salário) e as " +
      "FATURAS dos cartões (descricao 'Fatura <cartão>', valor = o que falta pagar; previsto = fatura ainda aberta, confirmado = " +
      "fechada). " +
      "Use para: o que vence, quanto vou pagar/receber em um mês, contas atrasadas, o que já foi pago. " +
      "Colunas: vencimento, situacao (previsto = recorrente ainda não pago; confirmado = título a vencer; atraso = vencido e não pago; pago), " +
      "tipo (pagar ou receber), descricao, valor, grupo, pago_em, valor_pago. " +
      "data_ini/data_fin = período dos vencimentos (sem data_ini: desde o dia 1º do mês atual; sem data_fin: sem limite, " +
      "as contas fixas previstas até 12 meses à frente); atrasados de antes do período sempre aparecem; " +
      "pagos entram pela data do pagamento. " +
      "tipo: 'pagar' ou 'receber'. situacao: 'aberto' = A PAGAR / A RECEBER / pendente / em aberto / não pago (a vencer + atrasado); " +
      "'atraso' = vencido e não pago; 'pago' = já pago ou recebido (quitado); vazio = tudo. " +
      "\"O que tenho a pagar em dezembro\" → tipo pagar e situacao aberto; \"o que paguei\" → situacao pago.",
    sql: `SELECT a.vencimento, a.situacao, a.tipo, a.descricao, a.valor, a.grupo, a.parcela, a.parcelas, a.pago_em, a.valor_pago
FROM fin_agenda(COALESCE(:data_ini, ${INI_MES}), COALESCE(:data_fin, ${SEM_FIM})) a
WHERE (:tipo IS NULL OR :tipo ILIKE '%' || a.tipo || '%')
  AND (:situacao IS NULL OR CASE
        WHEN :situacao ILIKE '%atras%' OR :situacao ILIKE '%vencid%' THEN a.situacao = 'atraso'
        WHEN :situacao ILIKE '%abert%' OR :situacao ILIKE '%vencer%' OR :situacao ILIKE '%pend%'
          OR :situacao ILIKE '%pagar%' OR :situacao ILIKE '%receber%' OR :situacao ILIKE '%não%' OR :situacao ILIKE '%nao%'
          THEN a.situacao IN ('previsto', 'confirmado', 'atraso')
        WHEN :situacao ILIKE '%pag%' OR :situacao ILIKE '%receb%' OR :situacao ILIKE '%quit%' OR :situacao ILIKE '%baix%' THEN a.situacao = 'pago'
        ELSE true END)
  AND (:descricao IS NULL OR a.descricao ILIKE :descricao)
  AND (:grupo IS NULL OR a.grupo ILIKE :grupo)
ORDER BY a.vencimento, a.descricao
LIMIT 500`,
    params: [
      ...periodo(""),
      { campo: "tipo", tipo: "string", operadorSql: "=" },
      { campo: "situacao", tipo: "string", operadorSql: "=" },
      { campo: "descricao", tipo: "string", operadorSql: "LIKE" },
      { campo: "grupo", tipo: "string", operadorSql: "LIKE" },
    ],
  },
  {
    nome: "Financeiro — Lançamentos (entradas e saídas)",
    descricao:
      "Detalhe: UMA LINHA POR LANÇAMENTO (gasto, receita, pagamento, transferência, compra/venda de investimento), com todos " +
      "os campos de entrada e saída. Monte os totais com a agregação (soma), como no ERP: por grupo, por mês (coluna mes), " +
      "por grupo e mês, por conta, maiores gastos, resultado, extrato. Colunas: data, mes (AAAA-MM), descricao, valor, " +
      "saiu_de e tipo_saida (conta de onde saiu: banco, cartão, corretora, grupo de receita…), foi_para e tipo_entrada " +
      "(para onde foi), grupo (despesa/receita: Alimentação, Moradia, Salário…), tipo (despesa, receita, transferencia, " +
      "investimento, outro), conta (banco ou cartão do lado do dinheiro, para despesa/receita), receita, despesa, " +
      "resultado (= receita − despesa, já com sinal: estorno subtrai), moeda e valor_moeda (conta em outra moeda), " +
      "quantidade e preco (investimento), titulo e titulo_vencimento (conta a pagar/receber que o lançamento pagou; " +
      "'lançamentos do título X', 'o que já paguei do aluguel de dezembro' → parâmetro titulo), fatura (vencimento da fatura do " +
      "cartão em que a compra caiu; 'o que tem na fatura de dezembro do Itaú' → fatura = '2026-12' e conta = Itaú; compra no " +
      "cartão é gasto na data da compra). Gasto = soma de despesa; recebido = soma de receita; sobra/falta = soma de " +
      "resultado; quanto SAIU de uma conta = soma de valor com saiu_de = conta; quanto ENTROU = soma de valor com " +
      "foi_para = conta; para quem paguei = foi_para. Para série mensal ('mensal', 'mês a mês', 'por mês') sem período " +
      "citado, use data_ini = 1º de janeiro do ano atual e data_fin = hoje. tipo: despesa/gasto, receita, transferencia, " +
      "investimento ('pagamentos', 'pagamentos efetuados', 'o que paguei', 'compras' = despesa, igual a gastos). Sem datas: o mês atual. Competência: compra no cartão conta no mês da compra.",
    sql: `SELECT data, mes, descricao, valor, saiu_de, tipo_saida, foi_para, tipo_entrada, grupo, tipo, conta,
  receita, despesa, resultado, moeda, valor_moeda, quantidade, preco, titulo, titulo_vencimento, fatura
FROM fin_v_lancamentos
WHERE data BETWEEN COALESCE(:data_ini, ${INI_MES}) AND COALESCE(:data_fin, ${FIM_MES})
  AND (:tipo IS NULL
       OR (tipo = 'despesa' AND (:tipo ILIKE '%desp%' OR :tipo ILIKE '%gast%' OR :tipo ILIKE '%pag%' OR :tipo ILIKE '%compr%' OR :tipo ILIKE '%sa_da%'))
       OR (tipo = 'receita' AND (:tipo ILIKE '%receit%' OR :tipo ILIKE '%receb%' OR :tipo ILIKE '%ganh%'))
       OR (tipo = 'investimento' AND :tipo ILIKE '%invest%')
       OR (tipo = 'transferencia' AND :tipo ILIKE '%transf%'))
  AND (:grupo IS NULL OR grupo ILIKE '%' || :grupo || '%')
  AND (:conta IS NULL OR saiu_de ILIKE '%' || :conta || '%' OR foi_para ILIKE '%' || :conta || '%')
  AND (:saiu_de IS NULL OR saiu_de ILIKE '%' || :saiu_de || '%')
  AND (:foi_para IS NULL OR foi_para ILIKE '%' || :foi_para || '%')
  AND (:descricao IS NULL OR descricao ILIKE '%' || :descricao || '%')
  AND (:valor_min IS NULL OR valor >= :valor_min)
  AND (:valor_max IS NULL OR valor <= :valor_max)
  AND (:titulo IS NULL OR titulo ILIKE '%' || :titulo || '%')
  AND (:fatura IS NULL OR to_char(fatura, 'YYYY-MM') = left(:fatura, 7))
ORDER BY data, id`,
    params: [
      ...periodo(""),
      { campo: "tipo", tipo: "string", operadorSql: "=" },
      { campo: "grupo", tipo: "string", operadorSql: "LIKE" },
      { campo: "conta", tipo: "string", operadorSql: "LIKE" },
      { campo: "saiu_de", tipo: "string", operadorSql: "LIKE" },
      { campo: "foi_para", tipo: "string", operadorSql: "LIKE" },
      { campo: "descricao", tipo: "string", operadorSql: "LIKE" },
      { campo: "valor_min", tipo: "number", operadorSql: ">=" },
      { campo: "valor_max", tipo: "number", operadorSql: "<=" },
      { campo: "titulo", tipo: "string", operadorSql: "LIKE" },
      { campo: "fatura", tipo: "string", operadorSql: "=" },
    ],
  },
  {
    nome: "Financeiro — Saldos das contas",
    descricao:
      "Saldo de cada conta numa data (sem data: hoje): bancos e corretoras (quanto tem), cartões e contas a pagar (quanto deve), " +
      "contas a receber. saldo_reais = saldo em reais (para conta em dólar etc., o custo em reais); saldo_moeda e valor_hoje_reais " +
      "(pela última cotação PTAX conhecida, data_cotacao) para contas em outra moeda. Use para: quanto tenho, quanto devo no cartão, " +
      "quanto vale meu dólar, quanto tenho no exterior. conta = nome; tipo_conta: banco, cartao, corretora, a_receber, a_pagar." +
      " mercado: 'local' (Brasil) ou 'exterior'. Ao responder, separe por mercado e por moeda; NUNCA some valores de moedas diferentes (saldo_moeda, custo_moeda). Valores em reais (saldo_reais, custo_reais, valor_hoje_reais) podem ser somados.",
    sql: `SELECT c.nome AS conta, c.tipo AS tipo_conta, COALESCE(c.mercado, 'local') AS mercado, c.moeda,
  CASE WHEN c.tipo IN ('cartao', 'a_pagar') THEN s.sai - s.ent ELSE s.ent - s.sai END AS saldo_reais,
  CASE WHEN c.moeda <> 'BRL' THEN CASE WHEN c.tipo = 'cartao' THEN s.sai_m - s.ent_m ELSE s.ent_m - s.sai_m END END AS saldo_moeda,
  CASE WHEN c.moeda <> 'BRL' THEN ROUND((CASE WHEN c.tipo = 'cartao' THEN s.sai_m - s.ent_m ELSE s.ent_m - s.sai_m END) * q.valor, 2) END AS valor_hoje_reais,
  q.valor AS cotacao, q.data AS data_cotacao
FROM fin_contas c
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(CASE WHEN l.conta_destinoid = c.id THEN l.valor END), 0) AS ent,
         COALESCE(SUM(CASE WHEN l.conta_origemid = c.id THEN l.valor END), 0) AS sai,
         COALESCE(SUM(CASE WHEN l.conta_destinoid = c.id THEN l.valor_moeda END), 0) AS ent_m,
         COALESCE(SUM(CASE WHEN l.conta_origemid = c.id THEN l.valor_moeda END), 0) AS sai_m
  FROM fin_lancamentos l
  WHERE (l.conta_destinoid = c.id OR l.conta_origemid = c.id) AND l.data <= COALESCE(:data, ${HOJE})
) s
LEFT JOIN LATERAL (
  SELECT fc.valor, fc.data FROM fin_cotacoes fc
  WHERE fc.moeda = c.moeda AND fc.data <= COALESCE(:data, ${HOJE})
  ORDER BY fc.data DESC LIMIT 1
) q ON true
WHERE c.ativo = 1 AND c.tipo IN ('banco', 'cartao', 'corretora', 'a_receber', 'a_pagar')
  AND (:conta IS NULL OR c.nome ILIKE :conta)
  AND (:tipo_conta IS NULL OR :tipo_conta ILIKE '%' || c.tipo || '%'
       OR (c.tipo = 'cartao' AND :tipo_conta ILIKE '%cart%') OR (c.tipo = 'banco' AND :tipo_conta ILIKE '%banc%'))
  AND (:mercado IS NULL OR (COALESCE(c.mercado, 'local') = 'exterior') = (:mercado ILIKE '%exter%' OR :mercado ILIKE '%fora%' OR :mercado ILIKE '%internac%' OR :mercado ILIKE '%eua%' OR :mercado ILIKE '%estados unidos%'))
ORDER BY 3, c.tipo, c.nome
LIMIT 200`,
    params: [
      { campo: "data", tipo: "date", operadorSql: "<=" },
      { campo: "conta", tipo: "string", operadorSql: "LIKE" },
      { campo: "tipo_conta", tipo: "string", operadorSql: "=" },
      { campo: "mercado", tipo: "string", operadorSql: "=" },
    ],
  },
  {
    nome: "Financeiro — Posição de investimentos",
    descricao:
      "Investimentos por papel e corretora numa data (sem data: hoje): quantidade, custo total e preço médio em reais; " +
      "papel em outra moeda (ex.: AAPL na Avenue) traz também custo e preço médio na moeda. Papel da B3 em reais traz preco_atual " +
      "(cotação brapi ou digitada, com preco_em), valor_mercado (quantidade × preço atual) e resultado (valor de mercado − custo, " +
      "não realizado) e resultado_pct; sem cotação esses campos vêm vazios. 'Quanto valem meus investimentos' = soma de valor_mercado. " +
      "Use para: quantas ações tenho, preço médio, quanto investi, investimentos no Brasil ou no exterior. papel = ticker (PETR4) ou nome." +
      " mercado: 'local' (Brasil) ou 'exterior'. Ao responder, separe por mercado e por moeda; NUNCA some valores de moedas diferentes (saldo_moeda, custo_moeda). Valores em reais (saldo_reais, custo_reais, valor_hoje_reais) podem ser somados.",
    sql: `SELECT c.papel, c.nome AS conta, cr.nome AS corretora, COALESCE(c.mercado, 'local') AS mercado, c.moeda, s.qtd AS quantidade, s.custo AS custo_reais,
  CASE WHEN s.qtd > 0 THEN ROUND(s.custo / s.qtd, 4) END AS preco_medio_reais,
  CASE WHEN c.moeda <> 'BRL' THEN s.custo_m END AS custo_moeda,
  CASE WHEN c.moeda <> 'BRL' AND s.qtd > 0 THEN ROUND(s.custo_m / s.qtd, 4) END AS preco_medio_moeda,
  CASE WHEN c.moeda = 'BRL' THEN q.preco END AS preco_atual,
  CASE WHEN c.moeda = 'BRL' THEN to_char(q.momento AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') END AS preco_em,
  CASE WHEN c.moeda = 'BRL' AND q.preco IS NOT NULL THEN ROUND(s.qtd * q.preco, 2) END AS valor_mercado,
  CASE WHEN c.moeda = 'BRL' AND q.preco IS NOT NULL THEN ROUND(s.qtd * q.preco - s.custo, 2) END AS resultado,
  CASE WHEN c.moeda = 'BRL' AND q.preco IS NOT NULL AND s.custo > 0 THEN ROUND(100.0 * (s.qtd * q.preco - s.custo) / s.custo, 2) END AS resultado_pct
FROM fin_contas c
LEFT JOIN fin_contas cr ON cr.id = c.corretora_contaid
LEFT JOIN fin_cotacoes_papel q ON q.ticker = UPPER(c.papel)
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(l.quantidade), 0) AS qtd,
         COALESCE(SUM(CASE WHEN l.conta_destinoid = c.id THEN l.valor ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN l.conta_origemid = c.id THEN l.valor ELSE 0 END), 0) AS custo,
         COALESCE(SUM(CASE WHEN l.conta_destinoid = c.id THEN l.valor_moeda ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN l.conta_origemid = c.id THEN l.valor_moeda ELSE 0 END), 0) AS custo_m
  FROM fin_lancamentos l
  WHERE (l.conta_destinoid = c.id OR l.conta_origemid = c.id) AND l.data <= COALESCE(:data, ${HOJE})
) s
WHERE c.tipo = 'investimento' AND c.ativo = 1
  AND (:papel IS NULL OR c.papel ILIKE :papel OR c.nome ILIKE :papel)
  AND (:corretora IS NULL OR cr.nome ILIKE :corretora)
  AND (:mercado IS NULL OR (COALESCE(c.mercado, 'local') = 'exterior') = (:mercado ILIKE '%exter%' OR :mercado ILIKE '%fora%' OR :mercado ILIKE '%internac%' OR :mercado ILIKE '%eua%' OR :mercado ILIKE '%estados unidos%'))
ORDER BY 4, c.papel, c.nome
LIMIT 200`,
    params: [
      { campo: "data", tipo: "date", operadorSql: "<=" },
      { campo: "papel", tipo: "string", operadorSql: "LIKE" },
      { campo: "corretora", tipo: "string", operadorSql: "LIKE" },
      { campo: "mercado", tipo: "string", operadorSql: "=" },
    ],
  },
  {
    nome: "Financeiro — Fluxo de caixa previsto por mês",
    descricao:
      "Previsão do caixa mês a mês, de hoje até data_fin (sem data_fin: 3 meses): saldo atual dos bancos e corretoras em reais, " +
      "o que vai entrar (a receber) e sair (a pagar), incluindo recorrentes e atrasados, e o saldo previsto no fim de cada mês. " +
      "Use para: como fica meu caixa, vai faltar dinheiro, quanto vou ter em março. Colunas: mes, a_receber, a_pagar, saldo_previsto.",
    sql: `WITH base AS (
  SELECT COALESCE(SUM(CASE WHEN l.conta_destinoid = c.id THEN l.valor ELSE -l.valor END), 0) AS saldo
  FROM fin_contas c
  JOIN fin_lancamentos l ON c.id IN (l.conta_origemid, l.conta_destinoid)
  WHERE c.tipo IN ('banco', 'corretora') AND c.moeda = 'BRL' AND c.ativo = 1
),
mov AS (
  SELECT to_char(date_trunc('month', GREATEST(a.vencimento, ${HOJE})), 'YYYY-MM') AS mes,
         SUM(CASE WHEN a.tipo = 'receber' THEN a.valor ELSE 0 END) AS a_receber,
         SUM(CASE WHEN a.tipo = 'pagar' THEN a.valor ELSE 0 END) AS a_pagar
  FROM fin_agenda(${HOJE}, COALESCE(:data_fin, (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '3 months - 1 day')::date)) a
  WHERE a.situacao <> 'pago'
  GROUP BY 1
)
SELECT m.mes, (SELECT saldo FROM base) AS saldo_hoje, m.a_receber, m.a_pagar,
  (SELECT saldo FROM base) + SUM(m.a_receber - m.a_pagar) OVER (ORDER BY m.mes) AS saldo_previsto
FROM mov m
ORDER BY m.mes`,
    params: [{ campo: "data_fin", tipo: "date", operadorSql: "<=" }],
  },
  {
    nome: "Financeiro — Contas cadastradas",
    descricao:
      "Lista das contas cadastradas no financeiro, com ou sem movimento: bancos, cartões, corretoras, investimentos (papéis), " +
      "grupos de despesa (Alimentação, Moradia…) e grupos de receita (Salário…). Use para: quais contas/grupos/cartões tenho, " +
      "quais grupos de despesa existem, em que conta lançar. Não traz valores (para saldo use Saldos das contas; para totais, Gastos por grupo). " +
      "tipo_conta aceita o jeito de falar: despesa/gasto, receita, banco, cartão, corretora, investimento. Contas do sistema sem uso não aparecem.",
    sql: `SELECT c.nome AS conta, c.tipo AS tipo_conta, c.papel, c.moeda, c.mercado,
  CASE WHEN c.ativo = 1 THEN 'ativa' ELSE 'inativa' END AS situacao,
  (SELECT MAX(l.data) FROM fin_lancamentos l WHERE c.id IN (l.conta_origemid, l.conta_destinoid)) AS ultimo_lancamento
FROM fin_contas c
WHERE (c.chave IS NULL OR EXISTS (SELECT 1 FROM fin_lancamentos l2 WHERE c.id IN (l2.conta_origemid, l2.conta_destinoid)))
  AND (:tipo_conta IS NULL OR c.tipo = CASE
        WHEN :tipo_conta ILIKE '%desp%' OR :tipo_conta ILIKE '%gast%' THEN 'despesa'
        WHEN :tipo_conta ILIKE '%receit%' THEN 'receita'
        WHEN :tipo_conta ILIKE '%cart%' THEN 'cartao'
        WHEN :tipo_conta ILIKE '%corret%' THEN 'corretora'
        WHEN :tipo_conta ILIKE '%invest%' OR :tipo_conta ILIKE '%papel%' OR :tipo_conta ILIKE '%a__es%' THEN 'investimento'
        WHEN :tipo_conta ILIKE '%banc%' OR :tipo_conta ILIKE '%corrente%' THEN 'banco'
        WHEN :tipo_conta ILIKE '%pagar%' THEN 'a_pagar'
        WHEN :tipo_conta ILIKE '%receber%' THEN 'a_receber'
        ELSE c.tipo END)
  AND (:conta IS NULL OR c.nome ILIKE :conta)
ORDER BY c.tipo, c.nome
LIMIT 300`,
    params: [
      { campo: "tipo_conta", tipo: "string", operadorSql: "=" },
      { campo: "conta", tipo: "string", operadorSql: "LIKE" },
    ],
  },
];


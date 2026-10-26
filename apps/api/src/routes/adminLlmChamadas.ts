import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/adminContext.js";

/**
 * Levantamento do peso das chamadas de IA (llm_chamadas): por etapa, quantas chamadas, tamanho
 * médio/máximo da instrução, da entrada e da saída (caracteres; ~4 caracteres por token), tempo e custo.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/llm-chamadas", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const q = z.object({ dias: z.coerce.number().int().min(1).max(90).default(7) }).safeParse(req.query);
    const dias = q.success ? q.data.dias : 7;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT etapa,
              COUNT(*)::int AS chamadas,
              SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END)::int AS falhas,
              ROUND(AVG(chars_sistema))::int AS sistema_medio,
              ROUND(AVG(chars_entrada))::int AS entrada_media,
              MAX(chars_sistema + chars_entrada)::int AS total_maximo,
              ROUND(AVG(chars_saida))::int AS saida_media,
              ROUND(AVG(ms))::int AS ms_medio,
              (PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ms))::int AS ms_p90,
              ROUND(SUM(custo_usd)::numeric, 6)::float AS custo_total_usd,
              STRING_AGG(DISTINCT COALESCE(modelo, '?'), ', ') AS modelos
       FROM llm_chamadas
       WHERE createdat > NOW() - (? || ' days')::interval
       GROUP BY etapa
       ORDER BY SUM(custo_usd) DESC, COUNT(*) DESC`,
      [String(dias)]
    );
    return {
      dias,
      tokensPorCaractere: 0.25,
      etapas: rows.map((r) => ({
        etapa: String(r.etapa),
        chamadas: Number(r.chamadas),
        falhas: Number(r.falhas),
        sistemaMedio: Number(r.sistema_medio),
        entradaMedia: Number(r.entrada_media),
        totalMaximo: Number(r.total_maximo),
        saidaMedia: Number(r.saida_media),
        msMedio: Number(r.ms_medio),
        msP90: Number(r.ms_p90),
        custoTotalUsd: Number(r.custo_total_usd),
        modelos: String(r.modelos ?? ""),
      })),
    };
  });
};

export default plugin;

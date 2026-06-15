#!/usr/bin/env node
/**
 * Valida a consistência do conceito "Bloco 1 LLM" para detecção de mudança em avisos.
 *
 * Envia a mesma pergunta + queryResults N vezes ao LLM com prompt de resposta concisa
 * e imprime os resultados lado a lado para avaliar se o texto é estável o suficiente
 * para ser usado como critério de comparação.
 *
 * Uso (a partir de apps/api):
 *   node scripts/test-bloco1.mjs <arquivo-entrada.json> [repeticoes]
 *
 * Formato do arquivo de entrada (JSON):
 *   {
 *     "pergunta": "Teve alguma reunião com TOP 10 clientes nos últimos 30 dias?",
 *     "queryResults": {
 *       "42": [
 *         { "cliente": "Empresa A", "data": "2024-01-10", "tipo": "reunião" },
 *         { "cliente": "Empresa B", "data": "2024-01-15", "tipo": "visita" }
 *       ]
 *     }
 *   }
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const inputFile = process.argv[2];
const repeticoes = parseInt(process.argv[3] ?? "5", 10);

if (!inputFile) {
  console.error("Uso: node scripts/test-bloco1.mjs <arquivo-entrada.json> [repeticoes]");
  process.exit(1);
}

const input = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
const { pergunta, queryResults } = input;

if (!pergunta || !queryResults) {
  console.error('O arquivo JSON deve ter os campos "pergunta" e "queryResults".');
  process.exit(1);
}

// Importa o provider LLM já configurado no projeto
const { chatIa } = await import("../dist/lib/aiProviderFactory.js").catch(() => {
  // Fallback: chamada direta via OpenAI se o build não existir
  return null;
});

if (!chatIa) {
  console.error(
    "Build da API não encontrado. Execute primeiro:\n  npm run build --workspace=@mymemory/api"
  );
  process.exit(1);
}

const SYSTEM =
  "Responda à pergunta de forma direta e concisa em no máximo 2 frases, usando apenas os dados fornecidos. Não inclua tabelas, listas ou detalhes de suporte.";

const USER = JSON.stringify({ pergunta, queryResults }, null, 2);

console.log(`\n${"═".repeat(60)}`);
console.log(`Pergunta: ${pergunta}`);
console.log(`Repetições: ${repeticoes}`);
console.log(`${"═".repeat(60)}\n`);

const resultados = [];
let custoTotal = 0;

for (let i = 1; i <= repeticoes; i++) {
  const { content, costUsd } = await chatIa(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
    { source: "test-bloco1" }
  );
  resultados.push(content.trim());
  custoTotal += costUsd;
  console.log(`[${i}/${repeticoes}] ${content.trim()}`);
}

// Avalia consistência: quantas respostas são idênticas à primeira
const identicas = resultados.filter((r) => r === resultados[0]).length;
const pct = Math.round((identicas / repeticoes) * 100);

console.log(`\n${"─".repeat(60)}`);
console.log(`Respostas idênticas à primeira: ${identicas}/${repeticoes} (${pct}%)`);
console.log(`Custo total: $${custoTotal.toFixed(6)}`);
console.log(
  pct === 100
    ? "\n✓ Texto 100% estável — Bloco 1 seria viável como critério de comparação."
    : pct >= 80
    ? "\n⚠ Texto parcialmente estável — comparação por string geraria falsos positivos."
    : "\n✗ Texto instável — não usar Bloco 1 LLM como critério de comparação."
);

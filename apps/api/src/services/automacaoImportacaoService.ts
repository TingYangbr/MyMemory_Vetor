/**
 * Importação automática ("Automatizar" na Importação em Lote).
 *
 * Uma automação vigia uma pasta (disco/rede do servidor ou WebDAV) para um grupo: a cada intervalo o
 * robô verifica a pasta e importa os arquivos com situação "Pronto" (novos, não duplicados), com o
 * nível de IA escolhido. Opcionalmente copia o arquivo para o armazenamento do MyMemory (como o
 * Catalogar); senão só referencia (Guarda própria). Os memos são de quem criou a automação, exceto
 * em categoria "Pessoal", onde valem o campo dono e a lista "Memos sem dono identificado".
 */
import fs from "node:fs/promises";
import type { RowDataPacket } from "../lib/dbTypes.js";
import type { BatchProcessResult, StorageProvider, UserIaUseLevel } from "@mymemory/shared";
import { pool } from "../db.js";
import { config } from "../config.js";
import { guessMimeFromFilename } from "../lib/media.js";
import { sendAutomacaoImportacaoEmail } from "../lib/mail.js";
import {
  assertPathAllowed,
  downloadWebDavFile,
  processBatchFile,
  scanLocalFolder,
  scanWebDavFolder,
  verifyBatchFiles,
  webDavRemotePath,
} from "./batchImportService.js";
import { processBatchFileFromBuffer } from "./batchImportBufferService.js";
import { finalizeMediaToWebDavIfNeeded, storeMemoBinaryAndGetUrl } from "./memoService.js";
import { podeGerirImportacao } from "./donoMemoService.js";
import { getCreditosStatus } from "./userUsageService.js";

export const INTERVALOS_AUTOMACAO_MIN = [15, 30, 60, 360, 1440] as const;
/** Falhas seguidas de acesso à pasta antes de pausar a automação. */
const MAX_FALHAS_SEGUIDAS = 3;
/** Execução travada há mais que isso (servidor reiniciou no meio) pode ser retomada. */
const TRAVA_EXPIRA_MIN = 120;
/** Espera para conferir se um arquivo novo ainda está sendo copiado (tamanho mudando). */
const ESPERA_ESTABILIDADE_MS = 20_000;

export interface Automacao {
  id: number;
  groupId: number;
  userId: number;
  pasta: string;
  iaLevel: UserIaUseLevel;
  intervaloMin: number;
  copiarArquivo: boolean;
  limiteExecucao: number;
  avisarEmail: boolean;
  ativo: boolean;
  proximaExecucao: string | null;
  executandoDesde: string | null;
  ultimaExecucao: string | null;
  ultimoStatus: string | null;
  ultimoResumo: string | null;
  falhasSeguidas: number;
  criador: string | null;
}

export interface AutomacaoInput {
  pasta: string;
  iaLevel: UserIaUseLevel;
  intervaloMin: number;
  copiarArquivo: boolean;
  limiteExecucao: number;
  avisarEmail: boolean;
  ativo: boolean;
}

export class AutomacaoError extends Error {}

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function isWebDavUrl(p: string): boolean {
  return /^https?:\/\//i.test(p.trim());
}

function providerDaPasta(pasta: string): StorageProvider {
  if (isWebDavUrl(pasta)) return "WEBDAV";
  return pasta.trim().startsWith("\\\\") ? "REDE" : "LOCAL";
}

type ArquivoPasta = { originalFileName: string; fullPath: string; sizeBytes: number };

async function lerPasta(pasta: string): Promise<ArquivoPasta[]> {
  return isWebDavUrl(pasta) ? scanWebDavFolder(pasta) : scanLocalFolder(pasta);
}

/** Confere se a pasta pode ser automatizada (existe, está acessível ao servidor). */
export async function verificarPastaAutomacao(pasta: string): Promise<{ ok: true; arquivos: number } | { ok: false; erro: string }> {
  const p = pasta.trim();
  if (!p) return { ok: false, erro: "Informe a pasta." };
  try {
    const arquivos = await lerPasta(p);
    return { ok: true, arquivos: arquivos.length };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : String(err) };
  }
}

function mapear(r: Record<string, unknown>): Automacao {
  return {
    id: Number(r.id),
    groupId: Number(r.groupId),
    userId: Number(r.userId),
    pasta: String(r.pasta),
    iaLevel: String(r.iaLevel) as UserIaUseLevel,
    intervaloMin: Number(r.intervaloMin),
    copiarArquivo: Number(r.copiarArquivo) === 1,
    limiteExecucao: Number(r.limiteExecucao),
    avisarEmail: Number(r.avisarEmail) === 1,
    ativo: Number(r.ativo) === 1,
    proximaExecucao: iso(r.proximaExecucao),
    executandoDesde: iso(r.executandoDesde),
    ultimaExecucao: iso(r.ultimaExecucao),
    ultimoStatus: (r.ultimoStatus as string | null) ?? null,
    ultimoResumo: (r.ultimoResumo as string | null) ?? null,
    falhasSeguidas: Number(r.falhasSeguidas ?? 0),
    criador: (r.criador as string | null) ?? null,
  };
}

const SELECT_AUTOMACAO = `
  SELECT a.id, a.groupid AS "groupId", a.userid AS "userId", a.pasta, a.ia_level AS "iaLevel",
         a.intervalo_min AS "intervaloMin", a.copiar_arquivo AS "copiarArquivo",
         a.limite_execucao AS "limiteExecucao", a.avisar_email AS "avisarEmail", a.ativo,
         a.proxima_execucao AS "proximaExecucao", a.executando_desde AS "executandoDesde",
         a.ultima_execucao AS "ultimaExecucao", a.ultimo_status AS "ultimoStatus",
         a.ultimo_resumo AS "ultimoResumo", a.falhas_seguidas AS "falhasSeguidas",
         COALESCE(u.name, u.email) AS criador
  FROM batch_automacoes a LEFT JOIN users u ON u.id = a.userid`;

export async function listarAutomacoes(groupId: number): Promise<Automacao[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_AUTOMACAO} WHERE a.groupid = ? ORDER BY a.id`, [groupId]);
  return (rows as Record<string, unknown>[]).map(mapear);
}

export async function obterAutomacao(id: number): Promise<Automacao | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_AUTOMACAO} WHERE a.id = ? LIMIT 1`, [id]);
  const r = (rows as Record<string, unknown>[])[0];
  return r ? mapear(r) : null;
}

function validar(input: AutomacaoInput): void {
  if (!(INTERVALOS_AUTOMACAO_MIN as readonly number[]).includes(input.intervaloMin)) {
    throw new AutomacaoError("Intervalo inválido.");
  }
  if (!Number.isInteger(input.limiteExecucao) || input.limiteExecucao < 1 || input.limiteExecucao > 500) {
    throw new AutomacaoError("Limite por execução deve ser de 1 a 500 arquivos.");
  }
}

export async function criarAutomacao(userId: number, groupId: number, input: AutomacaoInput): Promise<Automacao> {
  validar(input);
  const pasta = input.pasta.trim();
  const v = await verificarPastaAutomacao(pasta);
  if (!v.ok) throw new AutomacaoError(v.erro);
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO batch_automacoes (groupid, userid, pasta, ia_level, intervalo_min, copiar_arquivo, limite_execucao, avisar_email, ativo, proxima_execucao)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()) RETURNING id`,
    [groupId, userId, pasta, input.iaLevel, input.intervaloMin, input.copiarArquivo ? 1 : 0, input.limiteExecucao,
      input.avisarEmail ? 1 : 0, input.ativo ? 1 : 0]
  );
  return (await obterAutomacao(rows[0].id))!;
}

export async function atualizarAutomacao(id: number, input: AutomacaoInput): Promise<Automacao> {
  validar(input);
  const pasta = input.pasta.trim();
  const atual = await obterAutomacao(id);
  if (!atual) throw new AutomacaoError("Automação não encontrada.");
  if (pasta !== atual.pasta || (input.ativo && !atual.ativo)) {
    const v = await verificarPastaAutomacao(pasta);
    if (!v.ok) throw new AutomacaoError(v.erro);
  }
  await pool.query(
    `UPDATE batch_automacoes SET pasta = ?, ia_level = ?, intervalo_min = ?, copiar_arquivo = ?, limite_execucao = ?,
       avisar_email = ?, ativo = ?, falhas_seguidas = CASE WHEN ? = 1 THEN 0 ELSE falhas_seguidas END,
       proxima_execucao = CASE WHEN ? = 1 AND ativo = 0 THEN NOW() ELSE proxima_execucao END, updatedat = NOW()
     WHERE id = ?`,
    [pasta, input.iaLevel, input.intervaloMin, input.copiarArquivo ? 1 : 0, input.limiteExecucao,
      input.avisarEmail ? 1 : 0, input.ativo ? 1 : 0, input.ativo ? 1 : 0, input.ativo ? 1 : 0, id]
  );
  return (await obterAutomacao(id))!;
}

export async function excluirAutomacao(id: number): Promise<void> {
  await pool.query(`DELETE FROM batch_automacoes WHERE id = ?`, [id]);
}

export async function listarExecucoes(automacaoId: number, limite = 20): Promise<Record<string, unknown>[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, origem, inicio, fim, status, encontrados, importados, pulados, erros, sem_dono AS "semDono",
            mensagem, detalhes
     FROM batch_automacao_execucoes WHERE automacaoid = ? ORDER BY inicio DESC LIMIT ?`,
    [automacaoId, limite]
  );
  return (rows as Record<string, unknown>[]).map((r) => ({ ...r, inicio: iso(r.inicio), fim: iso(r.fim) }));
}

// ── Execução ────────────────────────────────────────────────────────────────

async function travar(id: number): Promise<Automacao | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `UPDATE batch_automacoes SET executando_desde = NOW()
     WHERE id = ? AND (executando_desde IS NULL OR executando_desde < NOW() - INTERVAL '${TRAVA_EXPIRA_MIN} minutes')
     RETURNING id`,
    [id]
  );
  if (!(rows as unknown[]).length) return null;
  return obterAutomacao(id);
}

async function dadosAviso(a: Automacao): Promise<{ email: string | null; grupo: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.email, g.name AS grupo FROM users u, groups g WHERE u.id = ? AND g.id = ? LIMIT 1`,
    [a.userId, a.groupId]
  );
  const r = (rows as Record<string, unknown>[])[0];
  return { email: (r?.email as string | null) ?? null, grupo: String(r?.grupo ?? `Grupo #${a.groupId}`) };
}

async function avisar(a: Automacao, titulo: string, linhas: string[]): Promise<void> {
  try {
    const { email, grupo } = await dadosAviso(a);
    if (!email) return;
    await sendAutomacaoImportacaoEmail({ to: email, pasta: a.pasta, grupo, titulo, linhas, link: `${config.publicWebUrl}/importar-lote` });
  } catch (err) {
    console.warn("[automacao] e-mail não enviado:", err instanceof Error ? err.message : err);
  }
}

async function obterBuffer(pasta: string, arq: ArquivoPasta): Promise<Buffer> {
  if (isWebDavUrl(pasta)) return downloadWebDavFile(pasta, webDavRemotePath(arq.fullPath));
  assertPathAllowed(arq.fullPath);
  return fs.readFile(arq.fullPath);
}

async function importarArquivo(a: Automacao, isAdmin: boolean, arq: ArquivoPasta): Promise<BatchProcessResult> {
  const provider = providerDaPasta(a.pasta);
  if (a.copiarArquivo) {
    // Copia para o armazenamento do MyMemory (S3/local; WebDAV do grupo quando for o padrão), como o Catalogar
    const buffer = await obterBuffer(a.pasta, arq);
    const temp = await storeMemoBinaryAndGetUrl({
      userId: a.userId,
      buffer,
      mime: guessMimeFromFilename(arq.originalFileName),
      originalName: arq.originalFileName,
      groupId: a.groupId,
    });
    const url = await finalizeMediaToWebDavIfNeeded(temp.mediaUrl, a.userId, a.groupId);
    const destino: StorageProvider = url !== temp.mediaUrl ? "WEBDAV" : config.mediaStorage === "s3" ? "S3" : "LOCAL";
    return processBatchFileFromBuffer({
      userId: a.userId, groupId: a.groupId, isAdmin, originalFileName: arq.originalFileName, buffer,
      sizeBytes: arq.sizeBytes, provider: destino, iaLevel: a.iaLevel, externalFileRef: url,
    });
  }
  if (provider === "WEBDAV") {
    const buffer = await obterBuffer(a.pasta, arq);
    return processBatchFileFromBuffer({
      userId: a.userId, groupId: a.groupId, isAdmin, originalFileName: arq.originalFileName, buffer,
      sizeBytes: arq.sizeBytes, provider, iaLevel: a.iaLevel, externalFileRef: arq.fullPath,
    });
  }
  return processBatchFile({
    userId: a.userId, groupId: a.groupId, isAdmin, originalFileName: arq.originalFileName, fullPath: arq.fullPath,
    sizeBytes: arq.sizeBytes, provider, iaLevel: a.iaLevel, folder: a.pasta,
  });
}

async function finalizar(
  a: Automacao,
  origem: string,
  inicio: Date,
  status: string,
  resumo: string,
  numeros: { encontrados: number; importados: number; pulados: number; erros: number; semDono: number },
  detalhes: unknown,
  falhou: boolean
): Promise<{ pausada: boolean }> {
  await pool.query(
    `INSERT INTO batch_automacao_execucoes (automacaoid, origem, inicio, fim, status, encontrados, importados, pulados, erros, sem_dono, mensagem, detalhes)
     VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?::jsonb)`,
    [a.id, origem, inicio, status, numeros.encontrados, numeros.importados, numeros.pulados, numeros.erros,
      numeros.semDono, resumo, JSON.stringify(detalhes ?? null)]
  );
  const falhas = falhou ? a.falhasSeguidas + 1 : 0;
  const pausar = falhou && falhas >= MAX_FALHAS_SEGUIDAS;
  await pool.query(
    `UPDATE batch_automacoes SET executando_desde = NULL, ultima_execucao = NOW(), ultimo_status = ?, ultimo_resumo = ?,
       falhas_seguidas = ?, ativo = CASE WHEN ? = 1 THEN 0 ELSE ativo END,
       proxima_execucao = NOW() + (intervalo_min || ' minutes')::interval, updatedat = NOW()
     WHERE id = ?`,
    [status, resumo, falhas, pausar ? 1 : 0, a.id]
  );
  // Só guarda as últimas 100 execuções de cada automação
  await pool.query(
    `DELETE FROM batch_automacao_execucoes WHERE automacaoid = ? AND id NOT IN (
       SELECT id FROM batch_automacao_execucoes WHERE automacaoid = ? ORDER BY inicio DESC LIMIT 100)`,
    [a.id, a.id]
  );
  return { pausada: pausar };
}

/** Executa uma automação (agendada ou "Executar agora"). Nunca lança: o resultado vai para o histórico. */
export async function executarAutomacao(id: number, origem: "agendada" | "manual"): Promise<void> {
  const a = await travar(id);
  if (!a) return; // já está rodando
  const inicio = new Date();
  const zero = { encontrados: 0, importados: 0, pulados: 0, erros: 0, semDono: 0 };
  try {
    const [adm] = await pool.query<RowDataPacket[]>(`SELECT role FROM users WHERE id = ? LIMIT 1`, [a.userId]);
    const isAdmin = String((adm as Record<string, unknown>[])[0]?.role ?? "") === "admin";
    if (!(await podeGerirImportacao(a.userId, a.groupId, isAdmin))) {
      const msg = "Quem criou a automação não é mais owner/editor do grupo. Automação pausada.";
      await finalizar(a, origem, inicio, "erro", msg, zero, null, true);
      await pool.query(`UPDATE batch_automacoes SET ativo = 0 WHERE id = ?`, [a.id]);
      await avisar(a, "Importação automática pausada", [msg]);
      return;
    }

    let lidos: ArquivoPasta[];
    try {
      lidos = await lerPasta(a.pasta);
    } catch (err) {
      const msg = `Não foi possível ler a pasta: ${err instanceof Error ? err.message : String(err)}`;
      const { pausada } = await finalizar(a, origem, inicio, "erro", msg, zero, null, true);
      if (pausada) {
        await avisar(a, "Importação automática pausada", [msg, `Pausada após ${MAX_FALHAS_SEGUIDAS} falhas seguidas. Corrija a pasta e reative.`]);
      }
      return;
    }

    const verificacao = await verifyBatchFiles({ userId: a.userId, groupId: a.groupId, files: lidos, provider: providerDaPasta(a.pasta) });
    const prontos = verificacao.files.filter((r) => r.situacao === "pronto");
    const caminhoPronto = new Set(prontos.map((r) => r.fullPath));
    let candidatos = lidos.filter((f) => caminhoPronto.has(f.fullPath));

    // Arquivo ainda sendo copiado para a pasta: o tamanho muda entre duas leituras → fica para a próxima
    let emCopia = 0;
    if (candidatos.length) {
      await new Promise((r) => setTimeout(r, ESPERA_ESTABILIDADE_MS));
      const releitura = new Map((await lerPasta(a.pasta).catch(() => [] as ArquivoPasta[])).map((f) => [f.fullPath, f.sizeBytes]));
      const estaveis = candidatos.filter((f) => releitura.get(f.fullPath) === f.sizeBytes);
      emCopia = candidatos.length - estaveis.length;
      candidatos = estaveis;
    }
    const foraDoLimite = Math.max(0, candidatos.length - a.limiteExecucao);
    candidatos = candidatos.slice(0, a.limiteExecucao);

    const numeros = { ...zero, encontrados: lidos.length };
    const errosDetalhe: { arquivo: string; erro: string }[] = [];
    for (const arq of candidatos) {
      let r: BatchProcessResult;
      try {
        r = await importarArquivo(a, isAdmin, arq);
      } catch (err) {
        r = { originalFileName: arq.originalFileName, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (r.ok) {
        numeros.importados++;
        if (r.donoPendente) numeros.semDono++;
      } else {
        numeros.erros++;
        errosDetalhe.push({ arquivo: r.originalFileName, erro: r.error ?? "erro" });
      }
    }
    numeros.pulados = lidos.length - numeros.importados - numeros.erros;

    const partes = [`${numeros.importados} importado(s)`];
    if (numeros.semDono) partes.push(`${numeros.semDono} sem dono identificado`);
    if (numeros.erros) partes.push(`${numeros.erros} com erro`);
    if (emCopia) partes.push(`${emCopia} ainda em cópia (fica para a próxima)`);
    if (foraDoLimite) partes.push(`${foraDoLimite} além do limite (fica para a próxima)`);
    const creditos = await getCreditosStatus(a.userId).catch(() => null);
    if (creditos?.excedido) partes.push("créditos de IA do mês acima do limite do plano");
    const resumo = `${partes.join(", ")}. ${lidos.length} arquivo(s) na pasta.`;
    const status = numeros.erros && !numeros.importados ? "erro" : numeros.erros ? "parcial" : numeros.importados ? "ok" : "vazio";
    await finalizar(a, origem, inicio, status, resumo, numeros, errosDetalhe.length ? { erros: errosDetalhe.slice(0, 50) } : null, false);

    if (a.avisarEmail && (numeros.importados || numeros.erros)) {
      await avisar(a, "Importação automática", [
        resumo,
        ...errosDetalhe.slice(0, 10).map((e) => `${e.arquivo}: ${e.erro}`),
      ]);
    }
  } catch (err) {
    const msg = `Falha inesperada: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[automacao ${a.id}]`, msg);
    await finalizar(a, origem, inicio, "erro", msg, zero, null, true).catch(() => {});
  }
}

/** Chamado pelo robô a cada 5 min: roda, uma por vez, as automações cuja hora chegou. */
export async function executarAutomacoesVencidas(): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM batch_automacoes WHERE ativo = 1 AND proxima_execucao <= NOW() ORDER BY proxima_execucao LIMIT 20`
  );
  for (const r of rows as Record<string, unknown>[]) {
    await executarAutomacao(Number(r.id), "agendada");
  }
}

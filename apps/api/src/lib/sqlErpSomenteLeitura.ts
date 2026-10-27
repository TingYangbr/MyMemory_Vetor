/**
 * Queries de categoria sobre o ERP (SQL Server) são só de leitura. A conferência olha o "esqueleto"
 * do SQL — sem comentários nem textos entre aspas — para que palavras dentro de valores não contem.
 *
 * Dois níveis:
 *  - ao SALVAR / verificar sintaxe: precisa começar com SELECT ou WITH, um comando só, e nada que
 *    grave, execute procedimento ou acesse outro servidor;
 *  - ao EXECUTAR: barra os comandos que gravam ou alteram o banco (queries antigas que usam
 *    DECLARE/SET continuam rodando; EXEC só é barrado ao salvar, para não quebrar o que já existe).
 */

function esqueleto(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\[[^\]]*\]/g, "[]");
}

const GRAVA =
  /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|deny|backup|restore|shutdown|dbcc|bulk|reconfigure|kill)\b/i;
const EXECUTA_OU_EXTERNO = /\b(exec|execute|openrowset|opendatasource|openquery|openxml|waitfor)\b|\b(xp|sp)_[a-z0-9_]+/i;
/** SELECT ... INTO tabela cria tabela; INTO #temporaria é permitido. */
const INTO_TABELA = /\binto\s+(?!#)/i;

/** Motivo para recusar ao EXECUTAR (null = pode). */
export function motivoSqlErpExecucao(sql: string): string | null {
  const e = esqueleto(sql);
  const m = GRAVA.exec(e) ?? INTO_TABELA.exec(e);
  return m ? `A query do ERP contém "${m[0].trim()}". Queries do ERP são somente leitura.` : null;
}

/** Motivo para recusar ao SALVAR ou verificar sintaxe (null = pode). */
export function motivoSqlErpCadastro(sql: string): string | null {
  const exec = motivoSqlErpExecucao(sql);
  if (exec) return exec;
  const e = esqueleto(sql).trim();
  if (!/^(select|with)\b/i.test(e)) return "A query do ERP deve começar com SELECT ou WITH.";
  const m = EXECUTA_OU_EXTERNO.exec(e);
  if (m) return `A query do ERP contém "${m[0].trim()}", que não é permitido.`;
  if (/;\s*\S/.test(e)) return "A query do ERP deve ter um único comando (sem ; no meio).";
  return null;
}

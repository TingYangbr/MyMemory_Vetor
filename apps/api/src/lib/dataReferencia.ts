/**
 * Linha de contexto com a data de registro do memo, incluída nos prompts de extração.
 * Sem ela a IA não sabe "hoje" e chuta o ano (pelo treinamento) ao preencher campos com datas
 * incompletas ("dia 15", "outubro") ou relativas ("amanhã", "próxima sexta").
 * Usa o fuso de São Paulo: um memo registrado às 22h de 30/09 é do dia 30/09, não 01/10 (UTC).
 */
export function linhaDataRegistro(agora: Date = new Date()): string {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  const diaSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" }).format(agora);
  return (
    `DATA DE REGISTRO DESTE MEMO: ${iso} (${diaSemana}). ` +
    `Use-a como referência para datas relativas ("hoje", "amanhã", "próxima sexta") ` +
    `ou incompletas (sem ano ou sem mês), salvo instrução diferente no campo.`
  );
}

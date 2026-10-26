/**
 * Calendário de períodos relativos ("semana que vem", "próxima sexta", "mês passado"…) calculado
 * pelo programa, no horário de Brasília, e enviado junto com a pergunta às IAs de planejamento e de
 * resposta. A IA só escolhe o período — não calcula dia da semana nem decide onde a semana começa.
 *
 * Convenções (definidas com o owner em 26/10/2026):
 *  - a semana vai de segunda a domingo;
 *  - "esta semana" = de hoje até domingo;
 *  - "semana que vem" = "próxima semana" = segunda a domingo seguintes;
 *  - "sexta" = hoje se hoje é sexta, senão a próxima; "próxima sexta" numa sexta = a da semana seguinte
 *    (o mesmo vale para os outros dias e para "fim de semana" / "próximo fim de semana").
 */

const FUSO = "America/Sao_Paulo";
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

/** Data de hoje (AAAA-MM-DD) e dia da semana no horário de Brasília. */
export function hojeBrasilia(agora: Date = new Date()): { iso: string; diaSemana: string } {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  return { iso, diaSemana: DIAS[diaDaSemana(iso)] + (diaDaSemana(iso) % 6 === 0 ? "" : "-feira") };
}

/** Datas como meia-noite UTC: soma de dias sem efeito de fuso/horário de verão. */
const paraData = (iso: string) => new Date(`${iso}T00:00:00Z`);
const paraIso = (d: Date) => d.toISOString().slice(0, 10);
const somarDias = (iso: string, n: number) => {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return paraIso(d);
};
const diaDaSemana = (iso: string) => paraData(iso).getUTCDay();
const ultimoDiaDoMes = (ano: number, mes: number) => paraIso(new Date(Date.UTC(ano, mes, 0)));
const intervalo = (ini: string, fin: string) => (ini === fin ? ini : `${ini} a ${fin}`);

export function calendarioRelativo(agora: Date = new Date()): Record<string, string> {
  const hoje = hojeBrasilia(agora).iso;
  const dow = diaDaSemana(hoje); // 0 = domingo
  const ateDomingo = (7 - dow) % 7; // dias até o domingo desta semana
  const segundaDestaSemana = somarDias(hoje, dow === 0 ? -6 : 1 - dow);
  const proximaSegunda = somarDias(segundaDestaSemana, 7);
  const [ano, mes] = hoje.split("-").map(Number) as [number, number];

  const cal: Record<string, string> = {
    "hoje": hoje,
    "amanhã": somarDias(hoje, 1),
    "depois de amanhã": somarDias(hoje, 2),
    "ontem": somarDias(hoje, -1),
    "anteontem": somarDias(hoje, -2),
    "esta semana / nesta semana (de hoje até domingo)": intervalo(hoje, somarDias(hoje, ateDomingo)),
    "semana que vem / próxima semana (segunda a domingo)": intervalo(proximaSegunda, somarDias(proximaSegunda, 6)),
    "semana passada (segunda a domingo)": intervalo(somarDias(segundaDestaSemana, -7), somarDias(segundaDestaSemana, -1)),
  };

  // Fim de semana: o sábado/domingo desta semana (hoje, se já for fim de semana); "próximo" numa
  // sábado/domingo pula para o seguinte
  const sabado = dow === 0 ? somarDias(hoje, -1) : somarDias(hoje, 6 - dow);
  const domingo = somarDias(sabado, 1);
  const fdsIni = dow === 0 ? hoje : sabado;
  cal["fim de semana / este fim de semana"] = intervalo(fdsIni, domingo);
  cal["próximo fim de semana"] =
    dow === 6 || dow === 0 ? intervalo(somarDias(sabado, 7), somarDias(domingo, 7)) : intervalo(sabado, domingo);

  // Dias da semana: "sexta" = hoje ou a próxima; "próxima sexta" numa sexta = a da semana seguinte
  for (let d = 1; d <= 7; d++) {
    const alvo = d % 7;
    const nome = DIAS[alvo];
    const ate = (alvo - dow + 7) % 7;
    cal[`${nome}${alvo === 0 || alvo === 6 ? "" : "(-feira)"}`] = somarDias(hoje, ate);
    cal[`próxim${alvo === 0 || alvo === 6 ? "o" : "a"} ${nome}`] = somarDias(hoje, ate === 0 ? 7 : ate);
    cal[`${nome} passad${alvo === 0 || alvo === 6 ? "o" : "a"}`] = somarDias(hoje, ate === 0 ? -7 : ate - 7);
  }

  cal["próximos 7 dias"] = intervalo(hoje, somarDias(hoje, 7));
  cal["próximos 15 dias"] = intervalo(hoje, somarDias(hoje, 15));
  cal["próximos 30 dias"] = intervalo(hoje, somarDias(hoje, 30));
  cal["últimos 7 dias"] = intervalo(somarDias(hoje, -7), hoje);
  cal["últimos 15 dias"] = intervalo(somarDias(hoje, -15), hoje);
  cal["últimos 30 dias"] = intervalo(somarDias(hoje, -30), hoje);

  const mesAnt = mes === 1 ? { a: ano - 1, m: 12 } : { a: ano, m: mes - 1 };
  const mesProx = mes === 12 ? { a: ano + 1, m: 1 } : { a: ano, m: mes + 1 };
  const mm = (m: number) => String(m).padStart(2, "0");
  cal["este mês"] = intervalo(`${ano}-${mm(mes)}-01`, ultimoDiaDoMes(ano, mes));
  cal["mês que vem / próximo mês"] = intervalo(`${mesProx.a}-${mm(mesProx.m)}-01`, ultimoDiaDoMes(mesProx.a, mesProx.m));
  cal["mês passado"] = intervalo(`${mesAnt.a}-${mm(mesAnt.m)}-01`, ultimoDiaDoMes(mesAnt.a, mesAnt.m));
  cal["este ano"] = intervalo(`${ano}-01-01`, `${ano}-12-31`);
  cal["ano que vem / próximo ano"] = intervalo(`${ano + 1}-01-01`, `${ano + 1}-12-31`);
  cal["ano passado"] = intervalo(`${ano - 1}-01-01`, `${ano - 1}-12-31`);
  return cal;
}

/** Bloco de entrada para as IAs: hoje (com dia da semana) + calendário pronto. */
export function contextoDatas(agora: Date = new Date()): { hoje: string; calendario: Record<string, string> } {
  const h = hojeBrasilia(agora);
  return { hoje: `${h.iso} (${h.diaSemana}, horário de Brasília)`, calendario: calendarioRelativo(agora) };
}

/** Regra para o prompt de planejamento: usar o calendário em vez de calcular. */
export const REGRA_CALENDARIO =
  'REGRA CRÍTICA 10 — PERÍODOS RELATIVOS: Para expressões como "amanhã", "esta semana", "semana que vem", "próxima semana", "fim de semana", "sexta", "próxima sexta", "próximos 7 dias", "mês que vem", "ano passado", use EXATAMENTE as datas do campo "calendario" da entrada (o intervalo "AAAA-MM-DD a AAAA-MM-DD" vira _INI e _FIN; uma data só vira _INI = _FIN). NUNCA calcule dia da semana nem datas relativas por conta própria. "Semana que vem" e "próxima semana" são o MESMO período. Para expressões fora do calendário, derive a partir de data_atual (horário de Brasília).';

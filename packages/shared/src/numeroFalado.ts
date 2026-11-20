/**
 * Número dito em voz → texto do campo ("setenta e sete vírgula cinco" → "77,5").
 * O Whisper e a Web Speech API devolvem ora dígitos ("77,5", "77 vírgula 5"), ora palavras. Aqui as duas
 * formas viram um número com vírgula decimal. Palavras que não são número ("peso", "quilos", "por cento")
 * são ignoradas, então dizer "peso oitenta e um" também vale.
 */

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const PALAVRAS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400,
  quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900,
};

/** Devolve o número com vírgula decimal; se não achar número no texto, devolve o texto original. */
export function numeroFalado(texto: string): string {
  const original = texto.trim();
  const tokens = semAcento(texto)
    .replace(/%/g, " ")
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let inteiro = 0;
  let temInteiro = false;
  let temDigitos = false; // o inteiro veio de dígitos: não soma um segundo número dito logo depois
  let naDecimal = false;
  let decimais = "";

  for (const tok0 of tokens) {
    const tok = tok0.replace(/[.,;:!?]+$/, "");
    if (!tok) continue;
    if (tok === "virgula" || tok === "ponto") {
      if (temInteiro) naDecimal = true;
      continue;
    }
    // "77,5" ou "77.5" de uma vez
    const junto = /^(\d+)[.,](\d+)$/.exec(tok);
    if (junto && !naDecimal && !temInteiro) {
      inteiro = Number(junto[1]);
      decimais = junto[2]!;
      temInteiro = true;
      temDigitos = true;
      naDecimal = true;
      continue;
    }
    if (/^\d+$/.test(tok)) {
      if (naDecimal) decimais += tok;
      else if (!temInteiro) {
        inteiro = Number(tok);
        temInteiro = true;
        temDigitos = true;
      }
      continue;
    }
    const v = PALAVRAS[tok];
    if (v == null) continue; // "e", "peso", "quilos"…
    if (naDecimal) decimais += String(v);
    else if (!temDigitos) {
      inteiro += v;
      temInteiro = true;
    }
  }

  if (!temInteiro && !decimais) return original;
  return decimais ? `${inteiro},${decimais}` : String(inteiro);
}

/** Frases que, ditas no lugar do valor, mandam pular o campo ou encerrar o preenchimento por voz. */
export function comandoDeVoz(texto: string): "pular" | "parar" | null {
  const t = semAcento(texto).replace(/[.!?,;:]+/g, " ").trim();
  if (/^(pular|pula|proximo|proxima|passa|passar|nenhum|nenhuma|sem valor|nao tem|nao medi)\b/.test(t)) return "pular";
  if (/^(parar|para|chega|pronto|terminei|terminou|fim|cancelar|cancela|encerrar)\b/.test(t)) return "parar";
  return null;
}

/**
 * Variantes de número (singular ↔ plural) em pt para LIKE na busca.
 *
 * Isto **não** é “busca expandida” de sinônimos: sinônimos vêm do fluxo
 * `POST /api/memos/search/synonyms` + UI “expandir” (LLM), não deste módulo.
 *
 * Frases: aplica só ao último token. Usado em texto, keywords e modo “tudo”.
 */
export function getSingularPluralSearchVariants(raw: string): string[] {
  const phrase = raw.trim().toLowerCase();
  if (!phrase) return [];

  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.trim().toLowerCase();
    if (t.length) out.add(t);
  };

  if (phrase.includes(" ")) {
    add(phrase);
    const parts = phrase.split(/\s+/);
    const last = parts[parts.length - 1] ?? "";
    if (last) {
      for (const v of singularPluralSingleWord(last)) {
        parts[parts.length - 1] = v;
        add(parts.join(" "));
      }
    }
    return [...out];
  }

  for (const v of singularPluralSingleWord(phrase)) add(v);
  return [...out];
}

function singularPluralSingleWord(w: string): string[] {
  const t = w.trim().toLowerCase();
  if (!t) return [];

  const forms = new Set<string>([t]);

  if (t.endsWith("éis") && t.length >= 4) {
    forms.add(t.slice(0, -3) + "el");
  }
  if (t.endsWith("eis") && t.length >= 4 && !t.endsWith("éis")) {
    forms.add(t.slice(0, -3) + "el");
  }
  if (t.endsWith("el") && t.length >= 4) {
    forms.add(t.slice(0, -2) + "éis");
    forms.add(t.slice(0, -2) + "eis");
  }

  if (t.endsWith("óis") && t.length >= 4) {
    forms.add(t.slice(0, -3) + "ol");
  }
  if (t.endsWith("ois") && t.length >= 4 && !t.endsWith("óis")) {
    forms.add(t.slice(0, -3) + "ol");
  }
  if (t.endsWith("ol") && t.length >= 3) {
    forms.add(t.slice(0, -2) + "óis");
    forms.add(t.slice(0, -2) + "ois");
  }

  if (t.endsWith("ais") && t.length > 4) {
    forms.add(t.slice(0, -3) + "al");
  }
  if (t.endsWith("al") && t.length >= 4) {
    forms.add(t.slice(0, -2) + "ais");
  }

  if (t.endsWith("ções")) {
    forms.add(t.slice(0, -4) + "ção");
  } else if (t.endsWith("ões")) {
    forms.add(t.slice(0, -3) + "ão");
  }
  if (t.endsWith("ção")) {
    forms.add(t.slice(0, -3) + "ções");
  } else if (t.endsWith("ão") && !t.endsWith("ção")) {
    forms.add(t.slice(0, -2) + "ões");
  }

  if (t.endsWith("ães") && t.length >= 4) {
    forms.add(t.slice(0, -3) + "ão");
  }

  if (t.endsWith("ns") && t.length > 2) {
    forms.add(t.slice(0, -2) + "m");
  }
  if (t.endsWith("m") && t.length > 1) {
    forms.add(t.slice(0, -1) + "ns");
  }

  const skipStripS =
    t.endsWith("éis") ||
    t.endsWith("óis") ||
    t.endsWith("ões") ||
    t.endsWith("ães") ||
    (t.endsWith("ais") && t.length > 4) ||
    (t.endsWith("is") && t.length > 2 && !t.endsWith("sis"));
  if (t.endsWith("s") && !t.endsWith("ss") && t.length > 2 && !skipStripS) {
    forms.add(t.slice(0, -1));
  }
  if (!t.endsWith("s") && t.length >= 3 && /[aeiouáéíóúâêô]$/.test(t)) {
    forms.add(t + "s");
  }

  return [...forms];
}

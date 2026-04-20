/**
 * Whisper, com áudio vazio ou só ruído, costuma devolver texto plausível mas falso
 * (ex.: créditos de legendas «Amara», agradecimentos de YouTube). Evita alimentar
 * o resumo/keywords da IA com isso.
 */

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Frases ou padrões que quase só aparecem em alucinações / metadados de legendas. */
const BOGUS_PHRASES: RegExp[] = [
  /\bamara\.org\b/,
  /\bcomunidade\s+amara\b/,
  /\bamara\s+community\b/,
  /\bcommunity\s+amara\b/,
  /\bcaptioning\s+made\s+possible\b/,
  /\bsubtitles?\s+(were\s+)?(created|made)\s+by\b/,
  /\blegendas?\s+(foram\s+)?feitas\s+(pela|por)\b/,
  /\bsubtitles?\s+by\s+the\s+amara\b/,
  /\bthank\s+you\s+for\s+watching\b/,
  /\bobrigad[oa]s?\s+por\s+assistir\b/,
  /\bplease\s+subscribe\b/,
  /\binscreva-?se\s+no\s+canal\b/,
];

/** Só «música» / símbolos — outro padrão comum sem fala. */
function looksLikeMusicOnlySymbols(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 400) return false;
  const withoutMusicGlyphs = t.replace(/[\s♪♫🎵🎶._\-–—,;:!?'"`]+/gu, "");
  return withoutMusicGlyphs.length === 0;
}

/**
 * Heurística conservadora: texto curto + marcadores típicos de lixo do Whisper.
 * Transcrições longas com menção incidental a «Amara» não são descartadas.
 */
export function transcriptLooksLikeWhisperHallucinationOrNoise(transcript: string): boolean {
  const raw = transcript.trim();
  if (!raw) return false;

  if (looksLikeMusicOnlySymbols(raw)) return true;

  const n = normalizeForMatch(raw);
  const len = raw.length;

  for (const re of BOGUS_PHRASES) {
    re.lastIndex = 0;
    if (re.test(n) && len < 2_000) return true;
  }

  if (/\bamara\b/.test(n) && len < 900) return true;

  return false;
}

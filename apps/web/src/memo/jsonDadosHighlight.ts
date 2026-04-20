/** Segmentação simples de JSON para realce (chaves vs valores) — texto igual ao do utilizador. */

export type JsonSegKind = "key" | "value" | "neutral";

export type JsonSeg = { text: string; kind: JsonSegKind };

export function segmentJsonForSyntaxHighlight(source: string): JsonSeg[] {
  const s = source;
  const out: JsonSeg[] = [];
  let i = 0;
  const n = s.length;

  const push = (text: string, kind: JsonSegKind) => {
    if (!text) return;
    const L = out.length;
    if (L && out[L - 1].kind === kind) out[L - 1].text += text;
    else out.push({ text, kind });
  };

  const skipWs = () => {
    let j = i;
    while (j < n && /\s/.test(s[j])) j++;
    if (j > i) {
      push(s.slice(i, j), "neutral");
      i = j;
    }
  };

  const readStringLiteral = (kind: JsonSegKind): boolean => {
    if (i >= n || s[i] !== '"') return false;
    const start = i;
    i++;
    while (i < n) {
      const c = s[i];
      if (c === "\\") {
        i += 1 + (i + 1 < n ? 1 : 0);
        continue;
      }
      if (c === '"') {
        i++;
        push(s.slice(start, i), kind);
        return true;
      }
      i++;
    }
    push(s.slice(start, i), "neutral");
    return false;
  };

  const readBare = (re: RegExp) => {
    const rest = s.slice(i);
    const m = rest.match(re);
    if (!m) return false;
    push(m[0], "value");
    i += m[0].length;
    return true;
  };

  const parseValue = (): void => {
    skipWs();
    if (i >= n) return;
    const c = s[i];
    if (c === '"') {
      readStringLiteral("value");
      return;
    }
    if (c === "{") {
      parseObject();
      return;
    }
    if (c === "[") {
      parseArray();
      return;
    }
    if (readBare(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return;
    if (readBare(/^(?:true|false|null)\b/)) return;
    push(s[i], "neutral");
    i++;
  };

  function parseObject() {
    push("{", "neutral");
    i++;
    skipWs();
    if (i < n && s[i] === "}") {
      push("}", "neutral");
      i++;
      return;
    }
    while (i < n) {
      skipWs();
      if (!readStringLiteral("key")) {
        push(s.slice(i), "neutral");
        i = n;
        return;
      }
      skipWs();
      if (i >= n || s[i] !== ":") {
        push(s.slice(i), "neutral");
        i = n;
        return;
      }
      push(":", "neutral");
      i++;
      parseValue();
      skipWs();
      if (i < n && s[i] === "}") {
        push("}", "neutral");
        i++;
        return;
      }
      if (i < n && s[i] === ",") {
        push(",", "neutral");
        i++;
        continue;
      }
      break;
    }
  }

  function parseArray() {
    push("[", "neutral");
    i++;
    skipWs();
    if (i < n && s[i] === "]") {
      push("]", "neutral");
      i++;
      return;
    }
    while (i < n) {
      parseValue();
      skipWs();
      if (i < n && s[i] === "]") {
        push("]", "neutral");
        i++;
        return;
      }
      if (i < n && s[i] === ",") {
        push(",", "neutral");
        i++;
        continue;
      }
      break;
    }
  }

  skipWs();
  if (i < n && s[i] === "{") parseObject();
  else if (i < n && s[i] === "[") parseArray();
  else parseValue();
  if (i < n) push(s.slice(i), "neutral");

  return out;
}

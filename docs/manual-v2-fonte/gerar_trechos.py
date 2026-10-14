"""Gera trechos (chunks) autossuficientes do manual v2 para busca semântica (pgvector).

Saída:
  <dest>/trechos/sNN-MM-slug.md   — um arquivo por trecho (texto pronto para virar memo)
  <dest>/chunks.jsonl             — mesmo conteúdo + metadados estruturados
Regras:
  - um trecho por subseção (##); ### viram trechos próprios;
  - cada linha de tabela "Erros frequentes" vira um trecho (sintoma → causa e solução);
  - tabelas com mais de 8 linhas são divididas em partes;
  - cada trecho leva o caminho completo no título e "Perguntas que este trecho responde".
"""
import io, json, os, re, sys, unicodedata

src, dest = sys.argv[1], sys.argv[2]
linhas = io.open(src, encoding="utf-8").read().split("\n")
VERSAO = "2"
MAX_LINHAS_TABELA = 8

PERFIL_POR_SECAO = {}
for n in range(1, 13): PERFIL_POR_SECAO[n] = "usuário"
for n in (13, 15, 16): PERFIL_POR_SECAO[n] = "usuário"
for n in (14, 17, 18): PERFIL_POR_SECAO[n] = "owner"
for n in range(19, 29): PERFIL_POR_SECAO[n] = "admin"
PERFIL_POR_SECAO[29] = "suporte"
PERFIL_POR_SECAO[30] = "admin"

def slug(s: str) -> str:
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:50]

def tela_curta(titulo: str) -> str:
    return re.sub(r"\s*\(.*?\)\s*$", "", titulo).strip()

# ── Estrutura: seção → subseções com linhas ─────────────────────────────────
secoes = []  # {num, titulo, rota, subs: [{titulo, linhas, nivel}]}
atual = None
for l in linhas:
    m = re.match(r"^# SEÇÃO (\d+) — (.*)$", l)
    if m:
        atual = {"num": int(m.group(1)), "titulo": m.group(2).strip(), "rota": "", "subs": [{"titulo": "Visão geral", "linhas": []}]}
        secoes.append(atual)
        continue
    if l.startswith("# NOVIDADES"):
        atual = {"num": 0, "titulo": "Novidades da versão 2", "rota": "", "subs": [{"titulo": "Resumo", "linhas": []}]}
        secoes.append(atual)
        continue
    if l.startswith("# ") or atual is None or l.startswith("Fim do documento"):
        if l.startswith("# ÍNDICE"):
            atual = None
        continue
    if re.match(r"^(Rota|Rotas|Componente|Componentes):", l):
        atual["rota"] = (atual["rota"] + " · " if atual["rota"] else "") + l
        continue
    m2 = re.match(r"^(##|###) (.*)$", l)
    if m2:
        atual["subs"].append({"titulo": m2.group(2).strip(), "linhas": []})
        continue
    atual["subs"][-1]["linhas"].append(l)

# ── Conversão de linhas Markdown em texto corrido ────────────────────────────
def tabela_para_texto(rows: list[list[str]]) -> list[str]:
    cab = rows[0]
    out = []
    for r in rows[1:]:
        if len(cab) == 2:
            out.append(f"- {r[0]}: {r[1]}")
        else:
            out.append("- " + "; ".join(f"{c}: {v}" for c, v in zip(cab, r)))
    return out

def blocos(ls: list[str]):
    """Divide em blocos: ('texto', [linhas]) e ('tabela', rows)."""
    i, out, buf = 0, [], []
    while i < len(ls):
        if ls[i].startswith("|"):
            if buf: out.append(("texto", buf)); buf = []
            rows = []
            while i < len(ls) and ls[i].startswith("|"):
                if not re.match(r"^\|[-|\s]+\|?$", ls[i]):
                    rows.append([c.strip() for c in ls[i].strip().strip("|").split("|")])
                i += 1
            out.append(("tabela", rows))
            continue
        if ls[i].strip():
            buf.append(ls[i])
        i += 1
    if buf: out.append(("texto", buf))
    return out

def limpar(l: str) -> str:
    l = re.sub(r"^- (\d+\.)", r"\1", l)
    return l

GENERICOS = {
    "propósito": ["Para que serve {tela}?", "O que dá para fazer em {tela}?"],
    "objetivo": ["Para que serve {tela}?", "O que dá para fazer em {tela}?"],
    "visão geral": ["O que é {tela}?", "Como funciona {tela}?"],
    "acesso": ["Como acesso {tela}?", "Quem pode usar {tela}?"],
    "campos": ["Quais campos tem {tela}?", "O que significa cada campo de {tela}?"],
    "comportamentos": ["Como {tela} se comporta?", "O que acontece depois de usar {tela}?"],
    "como usar": ["Como usar {tela}?", "Qual o passo a passo de {tela}?"],
    "funcionamento": ["Como funciona {tela}?", "Quando {tela} é executado?"],
    "casos especiais": ["Quais são os casos especiais de {tela}?", "O que acontece em situações fora do comum em {tela}?"],
    "fluxo": ["Qual o fluxo de {tela}?", "Como funciona o passo a passo de {tela}?"],
    "regras importantes": ["Quais as regras de {tela}?", "O que preciso saber antes de usar {tela}?"],
    "resumo": ["O que mudou na versão 2 do MyMemory?", "Quais são as novidades do MyMemory?"],
}

def perguntas(tipo: str, sub: str, tela: str, extra: str = "") -> list[str]:
    chave = re.sub(r"\s*\(parte.*$", "", sub).strip().lower()
    for k, modelos in GENERICOS.items():
        if chave == k or chave.startswith(k + " "):
            return [m.format(tela=tela) for m in modelos]
    s = sub[0].lower() + sub[1:] if sub else sub
    if tipo == "erro":
        return [f"O que fazer quando aparece \"{extra}\"?", f"Por que acontece \"{extra}\" em {tela}?"]
    if tipo == "passo a passo":
        return [f"Como {s.lower()} em {tela}?", f"Qual o passo a passo de {s.lower()}?"]
    if tipo == "campos":
        return [f"Quais são as opções de {s.lower()} em {tela}?", f"O que significa cada item de {s.lower()}?"]
    return [f"O que é {s.lower()} em {tela}?", f"Como funciona {s.lower()} no MyMemory?"]

trechos = []

def novo_trecho(sec, sub_titulo: str, corpo: list[str], tipo: str, extra: str = "", parte: str = ""):
    tela = tela_curta(sec["titulo"])
    secao_rotulo = f"Seção {sec['num']}" if sec["num"] else "Novidades"
    titulo = f"Manual MyMemory › {tela} › {sub_titulo}{parte}"
    cab = [titulo, f"Seção: {secao_rotulo} — {sec['titulo']}"]
    if sec["rota"]:
        cab.append(sec["rota"])
    cab.append(f"Perfil: {PERFIL_POR_SECAO.get(sec['num'], 'usuário')} · Tipo: {tipo} · Versão do manual: {VERSAO}")
    pq = perguntas(tipo, sub_titulo + parte, tela, extra)
    texto = "\n".join(cab + [""] + corpo + ["", "Perguntas que este trecho responde:"] + [f"- {p}" for p in pq])
    n = sum(1 for t in trechos if t["secao_num"] == sec["num"]) + 1
    tid = f"s{sec['num']:02d}-{n:02d}-{slug(sub_titulo + parte)}"
    trechos.append({
        "id": tid, "titulo": titulo, "texto": texto,
        "secao_num": sec["num"], "secao": sec["titulo"], "tela": tela, "subsecao": sub_titulo,
        "rota": sec["rota"], "perfil": PERFIL_POR_SECAO.get(sec["num"], "usuário"), "tipo": tipo,
        "versao": VERSAO, "palavras": len(texto.split()),
    })

for sec in secoes:
    for sub in sec["subs"]:
        if not any(x.strip() for x in sub["linhas"]):
            continue
        bs = blocos(sub["linhas"])
        eh_erro = sub["titulo"].lower().startswith("erros")
        if eh_erro:
            # texto solto antes da tabela vai junto de cada erro; cada linha da tabela = 1 trecho
            intro = [limpar(l) for k, b in bs if k == "texto" for l in b]
            for k, b in bs:
                if k != "tabela":
                    continue
                for r in b[1:]:
                    corpo = intro + [f"Sintoma: {r[0]}", f"Causa e solução: {r[1] if len(r) > 1 else ''}"]
                    novo_trecho(sec, f"{sub['titulo']}: {r[0][:70]}", corpo, "erro", extra=r[0])
            continue
        tem_passos = any(re.match(r"^(- )?\d+\.\s", l) for k, b in bs if k == "texto" for l in b)
        tem_tabela = any(k == "tabela" for k, _ in bs)
        tipo = "passo a passo" if tem_passos else "campos" if tem_tabela else "conceito"
        # tabelas grandes: divide em partes, repetindo o texto introdutório
        grandes = [b for k, b in bs if k == "tabela" and len(b) - 1 > MAX_LINHAS_TABELA]
        if grandes and len(bs) <= 3:
            intro = [limpar(l) for k, b in bs if k == "texto" for l in b]
            tb = grandes[0]
            partes = [tb[1:][i:i + MAX_LINHAS_TABELA] for i in range(0, len(tb) - 1, MAX_LINHAS_TABELA)]
            for pi, rows in enumerate(partes, 1):
                novo_trecho(sec, sub["titulo"], intro + tabela_para_texto([tb[0]] + rows), tipo, parte=f" (parte {pi}/{len(partes)})")
            continue
        corpo = []
        for k, b in bs:
            corpo += [limpar(l) for l in b] if k == "texto" else tabela_para_texto(b)
        novo_trecho(sec, sub["titulo"], corpo, tipo)

os.makedirs(os.path.join(dest, "trechos"), exist_ok=True)
for f in os.listdir(os.path.join(dest, "trechos")):
    os.remove(os.path.join(dest, "trechos", f))
for t in trechos:
    io.open(os.path.join(dest, "trechos", t["id"] + ".md"), "w", encoding="utf-8").write(t["texto"] + "\n")
with io.open(os.path.join(dest, "chunks.jsonl"), "w", encoding="utf-8") as fh:
    for t in trechos:
        fh.write(json.dumps(t, ensure_ascii=False) + "\n")

pal = sorted(t["palavras"] for t in trechos)
print(f"trechos: {len(trechos)} · palavras min/mediana/max: {pal[0]}/{pal[len(pal)//2]}/{pal[-1]}")
from collections import Counter
print(Counter(t["tipo"] for t in trechos))

#!/usr/bin/env python3
"""Gera os trechos (chunks.jsonl) do Manual técnico a partir de fonte/manual-tecnico.md.

Mesmo formato do manual operacional do Softing-erp (Docs/manual-operacional/gerar_trechos.py), para
importar pelo Admin → Importar conhecimento na categoria "Manual técnico".

Uso:  python gerar_trechos.py            # lê fonte/manual-tecnico.md, grava chunks.jsonl

Convenções do texto-fonte:
  # SEÇÃO N — Título        (a linha seguinte é "Rota: ...")
  ## Subseção                (vira um trecho; "Passo a passo" vira tipo "passo a passo")
  Tabelas de 2 colunas       "Campo / Elemento | Descrição" → trechos de campos (até 8 linhas cada)
                             "Mensagem / Sintoma | Causa e solução" → um trecho de erro por linha
  Nunca usar "|" dentro de uma célula.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

AQUI = Path(__file__).parent
FONTE = AQUI / "fonte" / "manual-tecnico.md"
SAIDA = AQUI / "chunks.jsonl"
VERSAO = "1"
MODULO = "Integração e perfis"
PERFIL = "admin"
PREFIXO = "Manual técnico"
MAX_LINHAS_TABELA = 8


def slug(s: str) -> str:
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:50]


def tela_curta(titulo: str) -> str:
    return re.sub(r"\s*\(.*?\)\s*$", "", titulo).strip()


def ler_secoes(linhas):
    secoes, atual, sub = [], None, None
    for l in linhas:
        m = re.match(r"^# SEÇÃO (\d+) — (.+)$", l)
        if m:
            atual = {"num": int(m.group(1)), "titulo": m.group(2).strip(), "rota": "", "subs": []}
            secoes.append(atual)
            sub = None
            continue
        if atual is None:
            continue
        if l.startswith("Rota:") and not atual["rota"] and sub is None:
            atual["rota"] = l.strip()
            continue
        m = re.match(r"^## (.+)$", l)
        if m:
            sub = {"titulo": m.group(1).strip(), "linhas": []}
            atual["subs"].append(sub)
            continue
        if sub is not None:
            sub["linhas"].append(l.rstrip())
    return secoes


def linhas_tabela(linhas):
    """Devolve (cabeçalho, [(c1, c2), ...]) se o bloco for uma tabela de 2 colunas, senão (None, [])."""
    rows = [l for l in linhas if l.strip().startswith("|")]
    if len(rows) < 3:
        return None, []
    cel = lambda l: [c.strip() for c in l.strip().strip("|").split("|")]
    cab = cel(rows[0])
    dados = [cel(r) for r in rows[2:]]
    return cab, [(d[0], d[1]) for d in dados if len(d) >= 2]


def perguntas(tipo, tela, sub, extra=None):
    if tipo == "erro":
        return [f'O que fazer quando aparece "{extra}"?', f'Por que acontece "{extra}" em {tela}?']
    if tipo == "passo a passo":
        return [f"Como configurar {tela}?", f"Qual o passo a passo de {tela}?"]
    if tipo == "campos":
        return [f"Quais são os campos e botões de {tela}?", f"Para que serve cada elemento de {tela}?"]
    return [f"Para que serve {tela}?", f"O que dá para fazer em {tela}?"]


def montar(secao, sub_titulo, tipo, corpo, extra=None):
    tela = tela_curta(secao["titulo"])
    cab = f"{PREFIXO} › {MODULO} › {tela} › {sub_titulo}"
    texto = (
        f"{cab}\n"
        f"Seção: Seção {secao['num']} — {secao['titulo']}\n"
        f"{secao['rota']}\n"
        f"Módulo: {MODULO} · Perfil: {PERFIL} · Tipo: {tipo} · Versão do manual: {VERSAO}\n\n"
        f"{corpo.strip()}\n\n"
        "Perguntas que este trecho responde:\n" + "\n".join(f"- {p}" for p in perguntas(tipo, tela, sub_titulo, extra))
    )
    return {
        "titulo": cab,
        "texto": texto,
        "secao_num": secao["num"],
        "secao": secao["titulo"],
        "tela": tela,
        "subsecao": sub_titulo,
        "modulo": MODULO,
        "rota": secao["rota"],
        "perfil": PERFIL,
        "tipo": tipo,
        "versao": VERSAO,
        "palavras": len(texto.split()),
    }


def main():
    secoes = ler_secoes(FONTE.read_text(encoding="utf-8").splitlines())
    nums = [s["num"] for s in secoes]
    assert nums == list(range(1, len(nums) + 1)), f"numeração fora de ordem: {nums}"

    trechos = []
    for s in secoes:
        for i, sub in enumerate(s["subs"], 1):
            cab, dados = linhas_tabela(sub["linhas"])
            prefixo_id = f"t{s['num']:02d}-{i:02d}"
            if cab and cab[0].lower().startswith("mensagem"):
                for j, (msg, sol) in enumerate(dados, 1):
                    corpo = f"Sintoma: {msg}\nCausa e solução: {sol}"
                    t = montar(s, f"Erros frequentes: {msg}", "erro", corpo, extra=msg)
                    t["id"] = f"{prefixo_id}-{j:02d}-{slug(msg)}"
                    trechos.append(t)
            elif cab:
                for j in range(0, len(dados), MAX_LINHAS_TABELA):
                    parte = dados[j:j + MAX_LINHAS_TABELA]
                    corpo = "\n".join(f"- {a}: {b}" for a, b in parte)
                    nome = sub["titulo"] if len(dados) <= MAX_LINHAS_TABELA else f"{sub['titulo']} (parte {j // MAX_LINHAS_TABELA + 1})"
                    t = montar(s, nome, "campos", corpo)
                    t["id"] = f"{prefixo_id}-{j // MAX_LINHAS_TABELA + 1}-{slug(sub['titulo'])}"
                    trechos.append(t)
            else:
                corpo = "\n".join(sub["linhas"]).strip()
                if not corpo:
                    continue
                tipo = "passo a passo" if "passo a passo" in sub["titulo"].lower() else "conceito"
                t = montar(s, sub["titulo"], tipo, corpo)
                t["id"] = f"{prefixo_id}-{slug(sub['titulo'])}"
                trechos.append(t)

    ids = [t["id"] for t in trechos]
    assert len(ids) == len(set(ids)), "ids duplicados"
    with SAIDA.open("w", encoding="utf-8", newline="\n") as f:
        for t in trechos:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    por_tipo = {}
    for t in trechos:
        por_tipo[t["tipo"]] = por_tipo.get(t["tipo"], 0) + 1
    print(f"{len(secoes)} seções, {len(trechos)} trechos → {SAIDA.name}  {por_tipo}")
    maior = max(trechos, key=lambda t: len(t["texto"]))
    print(f"maior trecho: {len(maior['texto'])} caracteres ({maior['id']})")


if __name__ == "__main__":
    sys.exit(main())

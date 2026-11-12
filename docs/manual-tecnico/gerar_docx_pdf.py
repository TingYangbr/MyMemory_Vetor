"""Gera MyMemory_Manual_Tecnico.docx e .pdf (raiz do repositório) a partir de fonte/manual-tecnico.md.

Uso (na pasta docs/manual-tecnico):
    python gerar_docx_pdf.py <pasta node_modules com o pacote docx>

Monta capa + índice + seções e chama o mesmo gerador do manual operacional
(../manual-v2-fonte/gerar_docx.js). O PDF é exportado pelo Word (Windows, via PowerShell).
"""
import io, os, re, subprocess, sys, tempfile
from datetime import date

base = os.path.dirname(os.path.abspath(__file__))
raiz = os.path.abspath(os.path.join(base, "..", ".."))
fonte = io.open(os.path.join(base, "fonte", "manual-tecnico.md"), encoding="utf-8").read()

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
         "setembro", "outubro", "novembro", "dezembro"]
hoje = date.today()
secoes = re.findall(r"^# SEÇÃO (\d+) — (.*)$", fonte, flags=re.M)

capa = [
    "MyMemory",
    "Manual Técnico — Integração, perfis de acesso e suporte",
    f"Versão 2 — {MESES[hoje.month - 1]} de {hoje.year}",
    "Para administradores do sistema, donos de grupo e suporte: perfis de acesso, ligação com o ERP, "
    "chaves de integração, segurança, renomeação de campos e montagem da resposta estruturada.",
    "# ÍNDICE",
    *[f"- Seção {n} — {t}" for n, t in secoes],
]
md = "\n".join(capa) + "\n\n" + fonte.strip() + "\n\nFim do documento — MyMemory Manual Técnico · Versão 2\n"

modulos = sys.argv[1] if len(sys.argv) > 1 else ""
docx = os.path.join(raiz, "MyMemory_Manual_Tecnico.docx")
pdf = os.path.join(raiz, "MyMemory_Manual_Tecnico.pdf")

with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
    f.write(md)
    tmp = f.name
try:
    env = dict(os.environ, NODE_PATH=modulos) if modulos else None
    subprocess.run(
        ["node", os.path.join(base, "..", "manual-v2-fonte", "gerar_docx.js"), tmp, docx,
         "MyMemory — Manual Técnico — Versão 2", "MyMemory — Manual Técnico · Versão 2"],
        check=True, env=env,
    )
finally:
    os.unlink(tmp)

ps = (
    "$w = New-Object -ComObject Word.Application; $w.Visible = $false; "
    f"try {{ $d = $w.Documents.Open('{docx}', $false, $true); $d.SaveAs([ref]'{pdf}', [ref]17); "
    "'paginas: ' + $d.ComputeStatistics(2); $d.Close([ref]0) } finally { $w.Quit() }"
)
subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
print(f"seções: {len(secoes)} · {docx} · {pdf}")

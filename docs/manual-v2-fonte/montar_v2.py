"""Monta o manual v2 (Markdown) a partir do v1 extraído + blocos novos/revisados."""
import io, re, sys, os

base = os.path.dirname(os.path.abspath(__file__))
v1 = io.open(os.path.join(base, "v1.md"), encoding="utf-8").read()
novos_raw = io.open(os.path.join(base, "novos.md"), encoding="utf-8").read()
novos = dict(re.findall(r"@@(\w+)\n(.*?)\n@@FIM", novos_raw, flags=re.S))

linhas = v1.split("\n")
# Cabeçalho (até o índice) e corpo
i_indice = linhas.index("# ÍNDICE")
cabecalho = linhas[:i_indice]
corpo = linhas[i_indice + 1:]
while corpo and corpo[0].startswith("- Seção"):
    corpo.pop(0)
fim = [l for l in corpo if l.startswith("Fim do documento")]
corpo = [l for l in corpo if not l.startswith("Fim do documento")]

# Separa seções antigas
secoes = []  # (num_antigo, titulo, linhas)
for l in corpo:
    m = re.match(r"^# SEÇÃO (\d+) — (.*)$", l)
    if m:
        secoes.append([int(m.group(1)), m.group(2), []])
    else:
        secoes[-1][2].append(l)

mapa = {}
for n in range(1, 9): mapa[n] = n
for n in range(9, 17): mapa[n] = n + 1
for n in range(17, 25): mapa[n] = n + 2
mapa[25] = 29
mapa[26] = 30

def renumerar(texto: str) -> str:
    return re.sub(r"Seção (\d+)", lambda m: f"Seção {mapa.get(int(m.group(1)), int(m.group(1)))}", texto)

def bloco(chave: str) -> list[str]:
    return novos[chave].strip("\n").split("\n")

def inserir_antes(ls: list[str], marcador: str, novas: list[str]) -> list[str]:
    i = ls.index(marcador)
    return ls[:i] + novas + ls[i:]

def trocar(ls: list[str], antigo: str, novo: str) -> list[str]:
    assert antigo in ls, antigo
    return [novo if l == antigo else l for l in ls]

saida_secoes = []  # (titulo, linhas) — números atribuídos no fim
for num, titulo, ls in secoes:
    ls = [renumerar(l) for l in ls]
    if num == 5:
        ls = inserir_antes(ls, "## Erros frequentes", bloco("SEC5ADD"))
        ls = trocar(ls, "| Documento | PDF, Word, Excel, PowerPoint e similares. |",
                    "| Documento | PDF, Word, Excel, PowerPoint e similares, enviados pelo seletor de arquivo. |")
        ls = inserir_antes(ls, "", ["| Guarda própria | Atalho para a Importação em Lote: arquivos que ficam no servidor do cliente. |"]) if False else ls
        i = ls.index("| URL | Endereço web. O sistema faz scraping do conteúdo. |")
        ls.insert(i + 1, "| 📂 Guarda própria ↗ | Atalho para a Importação em Lote: catalogar arquivos que continuam no servidor do cliente. |")
    if num == 8:
        saida_secoes.append(("Perguntar ao MyMemory", bloco("SEC8")[1:]))
        saida_secoes.append(("Perguntas salvas com parâmetros", bloco("SEC9NOVA")[1:]))
        continue
    if num == 10:
        ls = trocar(ls, "Lista todas as perguntas salvas pelo usuário. Por pergunta: texto, anotações, estrelas (1–5), grupo ou pessoal.",
                    "Lista todas as perguntas salvas pelo usuário. Por pergunta: texto, anotações, estrelas (1–5), grupo ou pessoal. Perguntas com ⚡ guardam também o plano com parâmetros (Seção 9); editar o texto remove o plano.")
    if num == 11:
        saida_secoes.append(("Avisos", bloco("SEC11AVISOS")[1:]))
        continue
    if num == 15:
        ls = trocar(ls, "| OneDrive | Upload de arquivos do OneDrive via seleção de arquivo. |",
                    "| OneDrive (em breve) | Ainda sem integração real: aparece desabilitado com a indicação \"em breve\". |")
        ls = trocar(ls, "| Google Drive | Upload de arquivos do Google Drive via seleção de arquivo. |",
                    "| Google Drive (em breve) | Ainda sem integração real: aparece desabilitado com a indicação \"em breve\". |")
        ls = trocar(ls, "| URL Externa | Disponível em breve. |", "| URL Externa (em breve) | Disponível em breve. |")
        ls = inserir_antes(ls, "## Fluxo de importação",
                           ["NOTA: A Importação em Lote também é aberta pelo tile \"📂 Guarda própria\" do Catalogar (Seção 5)."])
    if num == 16:
        ls = trocar(ls, "| Padrões | Regex ou padrões para identificar o campo no texto. |",
                    "| Padrões | Termos normalizados: valores aceitos separados por vírgula, usados para padronizar o que a IA extrai. Deixar vazio em datas e horas. |")
        ls = trocar(ls, "| Label | Nome exibido ao usuário. |",
                    "| Descrição | Significado do campo. Enviada à IA na extração e no planejamento das consultas — preencher sempre. |")
        ls = trocar(ls, "Consultas SQL Server parametrizadas vinculadas a uma categoria. Usadas para enriquecer memos com dados externos (ex.: dado que a IA extraiu 'Código 12345', buscar nome do produto no ERP).",
                    "Consultas parametrizadas vinculadas a uma categoria, usadas pelo Perguntar para respostas estruturadas. Podem rodar no PostgreSQL interno (sobre os memos) ou em um SQL Server externo (ERP), conforme a conexão escolhida.")
        ls = trocar(ls, "| SQL | Consulta SELECT com parâmetros marcados como @campo_nome. |",
                    "| SQL | Consulta SELECT com parâmetros :param (interno) ou @param (SQL Server). Somente leitura. |")
        ls = trocar(ls, "| Conexão BD | A conexão SQL Server usada para executar a query. |",
                    "| Conexão BD externa | Vazia = PostgreSQL interno. Preenchida = SQL Server da conexão escolhida. |")
        ls = inserir_antes(ls, "## Permissões de edição", bloco("SEC17ADD"))
        i = ls.index("| Query falhou no teste | SQL com erro de sintaxe ou conexão BD indisponível. |")
        ls[i + 1:i + 1] = [
            "| ✎ e 🗑 não aparecem | Tela em modo \"Só visualização\": selecionar no escopo o grupo do qual é owner (ou o escopo admin para categorias globais). |",
            "| Query com conexão pendente | Query clonada de outro grupo. Escolher a \"Conexão BD externa\" do grupo atual. |",
            "| cross_query_filter: parâmetro não cadastrado | Cadastrar o parâmetro _in com tipo lista_texto e operador IN na query destino. |",
        ]
        saida_secoes.append(("Estrutura de Contexto / Categorias", ls))
        saida_secoes.append(("Lembretes por e-mail", bloco("SEC18NOVA")[1:]))
        continue
    if num == 17:
        ls = trocar(ls, "Visualização e edição dos templates de prompt enviados à IA para cada tipo de processamento. Ver Seção 24.",
                    "Edição dos prompts de sistema de cada etapa (classificação, planejamento, síntese, extração por tipo de mídia), com override por categoria. O último prompt efetivamente enviado pode ser conferido em /admin/llm-prompt (Seção 24).")
        ls = trocar(ls, "| Configurações de Mídia | → /admin/midia |", "| Mídia por plano | → /admin/midia |")
        ls = trocar(ls, "| Documento IA | → /admin/documento-ia |", "| Documento — roteamento IA | → /admin/documento-ia |")
        ls = trocar(ls, "| Prompts LLM | → /admin/llm-prompt |", "| Último prompt LLM | → /admin/llm-prompt |")
        i = ls.index("| Assinaturas | → /admin/assinaturas |")
        ls.insert(i + 1, "| Importar conhecimento | → /admin/conhecimento |")
    if num == 18:
        saida_secoes.append(("Admin: Mídia por plano", ["Rota: /admin/midia"] + bloco("ADM_MIDIA")))
        continue
    if num == 19:
        saida_secoes.append(("Admin: Documento — roteamento IA", ["Rota: /admin/documento-ia"] + bloco("ADM_DOCIA")))
        continue
    if num == 20:
        saida_secoes.append(("Admin: CAD/BIM — Pipeline IA", ["Rota: /admin/cad-pipeline"] + bloco("ADM_CAD")))
        continue
    if num == 21:
        saida_secoes.append((titulo, ["Rota: /admin/system-config"] + bloco("ADM_SYS")))
        continue
    if num == 22:
        saida_secoes.append(("Admin: Último prompt LLM", ["Rota: /admin/llm-prompt"] + bloco("ADM_PROMPT")))
        continue
    if num == 24:
        ls = inserir_antes(ls, "## Erros frequentes", bloco("ADM_STORAGE_ADD"))
        saida_secoes.append((titulo, ls))
        saida_secoes.append(("Admin: Importar conhecimento", bloco("SEC_IMPORTAR")[1:]))
        saida_secoes.append(("Integrações externas (chave de API)", bloco("SEC27NOVA")[1:]))
        continue
    if num == 25:
        ls = ls + [
            "## Erros de perguntas e queries",
            "| Mensagem / Sintoma | Causa e solução |",
            "|---|---|",
            "| Query #N \"nome\": invalid input syntax for type numeric | Campo numérico com texto. Query padrão já é tolerante; em query editada, trocar ::numeric por mymemory_parse_number(...). |",
            "| Query #N \"nome\": invalid input syntax for type date | Campo de data com texto. Usar mymemory_parse_date(...) no lugar de ::date. |",
            "| Divide by zero (SQL Server) | Erro dentro da view do ERP. Abrir \"ver etapas\" para identificar a query e corrigir a view no banco. |",
            "| Invalid column name 'X' (SQL Server) | Coluna inexistente na view/tabela do banco usado pela conexão. Conferir se a view é a mesma em todos os bancos (ex.: Demo × produção). |",
            "| Resposta com filtro ignorado | Parâmetro com nome errado no SQL (nunca recebe valor). Conferir os nomes @param no trace. |",
            "",
        ]
    if num == 26:
        ls = trocar(ls, "| /admin/midia | Configurações de mídia |", "| /admin/midia | Mídia por plano (limites e opções por tipo) |")
        ls = trocar(ls, "| /admin/documento-ia | Documento de conhecimento para IA de suporte |", "| /admin/documento-ia | Roteamento de documentos para os extratores de texto |")
        ls = trocar(ls, "| /admin/cad-pipeline | Pipeline CAD/DWG |", "| /admin/cad-pipeline | Processamento CAD/BIM (.ifc) |")
        ls = trocar(ls, "| /admin/llm-prompt | Prompts de IA |", "| /admin/llm-prompt | Último prompt enviado à IA (diagnóstico) |")
        ls = trocar(ls, "| /estrutura-memo | Categorias e contexto (owner e admin) |",
                    "| /estrutura-memo | Categorias, queries e lembretes 🔔 (owner e admin) |")
        i = ls.index("| /estrutura-memo | Categorias, queries e lembretes 🔔 (owner e admin) |")
        ls.insert(i + 1, "| /avisos | Avisos do usuário (monitoramento de perguntas) |")
        ls.insert(i, "| /admin/conhecimento | Importar conhecimento em trechos para um grupo |")
        i = ls.index("| USE_DEV_FALLBACK | 1 para desativar auth em dev local (não usar em prod!). |")
        ls.insert(i, "| Migrations | Aplicadas automaticamente quando a API sobe (inclui as funções mymemory_parse_date e mymemory_parse_number). |")
    saida_secoes.append((titulo, ls))

# Cabeçalho v2
cab = []
for l in cabecalho:
    if l.startswith("Indexado por telas"):
        l = "Indexado por telas · Versão 2 — outubro de 2026"
    cab.append(l)

out = cab + ["# ÍNDICE", "- Novidades da versão 2"]
for n, (t, _) in enumerate(saida_secoes, 1):
    out.append(f"- Seção {n} — {t}")
out += bloco("NOVIDADES")
for n, (t, ls) in enumerate(saida_secoes, 1):
    out.append(f"# SEÇÃO {n} — {t}")
    out += ls
out.append("Fim do documento — MyMemory Manual Operacional · Versão 2 (outubro de 2026)")

io.open(os.path.join(base, "MyMemory_Manual_Operacional_v2.md"), "w", encoding="utf-8").write("\n".join(out) + "\n")
print("seções:", len(saida_secoes))
for n, (t, _) in enumerate(saida_secoes, 1):
    print(n, t)

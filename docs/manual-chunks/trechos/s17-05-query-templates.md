Manual MyMemory › Categorias › Query templates
Seção: Seção 17 — Categorias (Painel Owners)
Rota: /grupo/:groupId/admin → Categorias (a antiga /estrutura-memo leva para cá)
Perfil: owner · Tipo: campos · Versão do manual: 2

Consultas parametrizadas vinculadas a uma categoria, usadas pelo Fale comigo para respostas estruturadas. Podem rodar no PostgreSQL interno (sobre os memos) ou em um SQL Server externo (ERP), conforme a conexão escolhida.
- Nome da query: Identificador amigável.
- SQL: Consulta SELECT com parâmetros :param (interno) ou @param (SQL Server). Somente leitura.
- Parâmetros: Cada parâmetro lista o campo do memo de onde vem o valor.
- Conexão BD externa: Vazia = PostgreSQL interno. Preenchida = SQL Server da conexão escolhida.

Perguntas que este trecho responde:
- Quais são as opções de query templates em Categorias?
- O que significa cada item de query templates?

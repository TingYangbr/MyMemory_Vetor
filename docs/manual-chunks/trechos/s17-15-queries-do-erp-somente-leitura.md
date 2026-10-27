Manual MyMemory › Estrutura de Contexto / Categorias › Queries do ERP somente leitura
Seção: Seção 17 — Estrutura de Contexto / Categorias
Rota: /estrutura-memo
Perfil: owner · Tipo: conceito · Versão do manual: 2

Queries de SQL Server são conferidas ao salvar, ao verificar a sintaxe e a cada execução.
- Devem começar com SELECT ou WITH e ter um único comando (sem ; no meio).
- São recusadas se contiverem comandos que gravam ou alteram (INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, CREATE, TRUNCATE…), EXEC, procedures xp_/sp_ ou OPENROWSET/OPENQUERY.
- SELECT … INTO só é aceito para tabela temporária (#tabela).
- Mesmo assim, o usuário SQL da conexão deve ter só permissão de leitura no banco do ERP.

Perguntas que este trecho responde:
- O que é queries do erp somente leitura em Estrutura de Contexto / Categorias?
- Como funciona queries do erp somente leitura no MyMemory?

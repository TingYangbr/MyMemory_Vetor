Manual MyMemory › Categorias › Isolamento por grupo
Seção: Seção 17 — Categorias (Administrar grupo)
Rota: /grupo/:groupId/admin → Categorias (a antiga /estrutura-memo leva para cá)
Perfil: owner · Tipo: conceito · Versão do manual: 2

Queries internas (PostgreSQL) rodam em modo somente leitura e com papel restrito: cada grupo só enxerga os próprios memos, mesmo que o SQL da query tente ler outros grupos. O SQL não pode usar set_config, current_setting nem funções pg_*; a query é recusada ao salvar e ao executar.

Perguntas que este trecho responde:
- O que é isolamento por grupo em Categorias?
- Como funciona isolamento por grupo no MyMemory?

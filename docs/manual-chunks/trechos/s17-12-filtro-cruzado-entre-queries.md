Manual MyMemory › Estrutura de Contexto / Categorias › Filtro cruzado entre queries
Seção: Seção 17 — Estrutura de Contexto / Categorias
Rota: /estrutura-memo
Perfil: owner · Tipo: conceito · Versão do manual: 2

Quando a pergunta encadeia consultas (ex.: "dos pedidos do período, qual o estoque de cada produto"), o resultado de uma query filtra a seguinte via parâmetro IN.
- Se o parâmetro de destino não estiver cadastrado mas existir no SQL como IN(@param), o sistema o usa assim mesmo.
- Se a coluna de origem não existir no resultado da primeira query, a query destino é pulada e o motivo aparece nas limitações da resposta.
- Se a lista de origem vier vazia, uma query com IN retorna 0 linhas (e não "tudo").

Perguntas que este trecho responde:
- O que é filtro cruzado entre queries em Estrutura de Contexto / Categorias?
- Como funciona filtro cruzado entre queries no MyMemory?

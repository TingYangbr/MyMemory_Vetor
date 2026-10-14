Manual MyMemory › Estrutura de Contexto / Categorias › Query padrão automática
Seção: Seção 17 — Estrutura de Contexto / Categorias
Rota: /estrutura-memo
Perfil: owner · Tipo: conceito · Versão do manual: 2

Toda categoria pode ter uma "Query padrão — Nome da categoria", consulta interna (PostgreSQL) sobre os memos da categoria, com um filtro por campo.
- É gerada e atualizada automaticamente quando a categoria ou seus campos mudam.
- Para cada campo: filtro "contém" (ILIKE); campos de data ganham também _ini/_fin (faixa de datas); campos de número ganham _ini/_fin (faixa de valores).
- Se o SQL for editado à mão, a query deixa de ser automática e não é mais tocada pelo sistema.
- O botão "✦ Gerar Query padrão" substitui o SQL pela versão atual. Salvando sem alterar, a query volta a ser automática.

Perguntas que este trecho responde:
- O que é query padrão automática em Estrutura de Contexto / Categorias?
- Como funciona query padrão automática no MyMemory?

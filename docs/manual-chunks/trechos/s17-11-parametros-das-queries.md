Manual MyMemory › Estrutura de Contexto / Categorias › Parâmetros das queries
Seção: Seção 17 — Estrutura de Contexto / Categorias
Rota: /estrutura-memo
Perfil: owner · Tipo: campos · Versão do manual: 2

- :param (PostgreSQL) / @param (SQL Server): Placeholder no SQL. O nome do parâmetro é o nome do campo sem acento, em minúsculas, com "_" (ex.: Abrev_Empresa → abrev_empresa).
- Operador LIKE: Por padrão o sistema faz comparação exata; usa "contém" só quando a pergunta pede busca parcial ("contendo", "começa com").
- Sufixos _ini / _fin: Limite inferior e superior de faixa (datas, valores, durações em horas).
- Sufixos _in / _nin: Listas para IN / NOT IN. Cadastrar com tipo lista_texto e operador IN ou NOT IN. Necessários para o filtro cruzado.
- userId / groupId: Injetados pelo sistema. Nunca são pedidos ao usuário.
DICA: O botão que detecta :param e @param no SQL cria automaticamente os parâmetros que faltam. Depois ajuste com ✎ o tipo e o operador.

Perguntas que este trecho responde:
- Quais são as opções de parâmetros das queries em Estrutura de Contexto / Categorias?
- O que significa cada item de parâmetros das queries?

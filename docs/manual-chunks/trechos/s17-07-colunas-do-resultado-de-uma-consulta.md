Manual MyMemory › Categorias › Colunas do resultado de uma consulta
Seção: Seção 17 — Categorias (Painel Owners)
Rota: /grupo/:groupId/admin → Categorias (a antiga /estrutura-memo leva para cá)
Perfil: owner · Tipo: conceito · Versão do manual: 2

No editor de cada consulta (DB interno ou ERP), a seção **Colunas do resultado** configura a tabela e o gráfico das respostas, como os campos do memo:
- **▶ Ler colunas** roda a consulta sem filtros e traz as colunas do resultado (a consulta precisa estar salva).
- **Nome para exibir**: aparece no título da coluna e na legenda do gráfico no lugar do nome técnico.
- **Ordem**: 1, 2, 3… primeiro, nessa ordem; vazio = ordem da consulta; **-1 oculta** a coluna (ela aparece se a pergunta a citar). Com alguma ordem configurada, a tabela mostra todas as colunas da consulta, não só as que a IA escolheu.
- **Gráfico**: **X** = rótulos (ex.: código do produto), **Y** = valores (uma cor cada; vários Y = barras lado a lado, ex.: lucro × faturamento).
- **Unidade**: R$, %, kg… no título e no eixo; colunas em **%** vão para o eixo da direita.
Só as colunas com alguma configuração são gravadas. A configuração vai junto quando a categoria é copiada. Sem configuração, o gráfico escolhe sozinho: colunas citadas na pergunta (as auxiliares `ord_…` ficam de fora) e, quando a pergunta fala em faturado/faturamento, a coluna de faturamento ao lado.

Perguntas que este trecho responde:
- O que é colunas do resultado de uma consulta em Categorias?
- Como funciona colunas do resultado de uma consulta no MyMemory?

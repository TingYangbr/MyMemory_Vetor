Manual MyMemory › Painel Admin › Tabelas do banco (suporte)
Seção: Seção 19 — Painel Admin
Rota: /admin (cada seção com endereço próprio: /admin/planos, /admin/custos…)
Perfil: admin · Tipo: conceito · Versão do manual: 2

Admin → Sistema → **Tabelas do banco** mostra o conteúdo das tabelas do banco (Postgres), **só para leitura**. Serve para conferir o que foi gravado.
- **No topo:** o tamanho do banco inteiro (dados e índices), o número de tabelas e de views e a hora da medição. O botão **Medir de novo** atualiza.
- **Por grupo:** o seletor **Ver** filtra pelo grupo ativo, por outro grupo ou pelos espaços pessoais (sem grupo).
  - As tabelas com coluna de grupo mostram só as linhas daquele grupo, e a lista traz quantas são.
  - As tabelas **compartilhadas**, marcadas com **\***, não têm coluna de grupo e aparecem sempre inteiras.
- **Armazenagem por grupo:** o botão mostra quanto cada grupo ocupa no banco, com linhas, tamanho estimado e % do banco, além da parte compartilhada.
  - É uma estimativa: em cada tabela, o tamanho é repartido pela proporção de linhas de cada grupo.
  - Arquivos guardados no S3 ou em disco não entram.
  - Clicar no nome de um grupo passa a ver só os dados dele.
- **Escolher a tabela:** a lista à esquerda traz todas as tabelas e views, com o número aproximado de linhas e o tamanho de cada tabela. O campo no topo filtra a lista pelo nome.
- **Lotes de 1000:** os registros vêm de 1000 em 1000. Use "Próximo lote" e "Lote anterior" para navegar; o topo mostra "1–1000 de N".
- **Ordem:**
  - **Última modificação primeiro** (padrão): usa a coluna de atualização da tabela (`updatedat`, `atualizado_em`…) ou, na falta dela, a de criação;
  - sem nenhuma coluna de data, usa a ordem interna de gravação do Postgres, que é aproximada: o que foi gravado ou alterado por último vem antes;
  - **Ordem natural** mostra a ordem em que o banco devolve os registros.
  A linha "Ordenado no banco por…" diz qual critério foi usado.
- **No lote carregado:**
  - o campo "Buscar em todas as colunas" procura em tudo;
  - a caixa embaixo de cada título filtra só aquela coluna (contém o texto);
  - clicar no título ordena: crescente, decrescente e de novo a ordem do banco.
- **Ver um valor inteiro:** clique na célula. O valor aparece embaixo da grade, com JSON formatado e o botão **Copiar**.
- **Proteções:**
  - senhas, hashes, tokens e chaves de API aparecem como "••••••";
  - textos com mais de 2.000 caracteres aparecem cortados;
  - vetores (embeddings) e binários aparecem resumidos;
  - nada pode ser alterado por esta tela.

Perguntas que este trecho responde:
- O que é tabelas do banco (suporte) em Painel Admin?
- Como funciona tabelas do banco (suporte) no MyMemory?

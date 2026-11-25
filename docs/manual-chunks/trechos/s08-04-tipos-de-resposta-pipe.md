Manual MyMemory › Fale comigo › Tipos de resposta (pipe)
Seção: Seção 8 — Fale comigo (perguntas ao proMemory)
Rota: / (aba Fale comigo) · Componente: PerguntaPage
Perfil: usuário · Tipo: campos · Versão do manual: 2

- Semântica: A resposta depende de interpretar textos dos memos (explicação, resumo, notícias). Usa busca por similaridade (pgvector).
- Estruturada: Listagens, contagens, somas, médias, agrupamentos e filtros por critério. Usa as queries cadastradas nas categorias.
- Híbrida: A pergunta pede números e interpretação textual ao mesmo tempo. Roda as duas partes e combina o resultado.
NOTA: O tipo é escolhido pela IA.
- **↺ Refazer (um toque):** "não era isso". Sem IA, o sistema procura outra categoria com consultas que tenha pelo menos 2 palavras da pergunta (no nome, na descrição ou nas consultas) e refaz nela, como estruturada; se nenhuma passar desse limiar, refaz pela busca nos textos dos memos, em todo o grupo. A resposta mostra "↺ Refeito com: <categoria>" ou "textos dos memos". A categoria da resposta anterior não é repetida.
- **⋯ (ao lado):** as opções de sempre — forçar Semântico, Estruturado ou Híbrido, e "No manual".
- **Resposta com tabela:** o texto aparece em 2 linhas, com "Mais…" para abrir (a tabela abaixo traz os dados).

Perguntas que este trecho responde:
- Quais são as opções de tipos de resposta (pipe) em Fale comigo?
- O que significa cada item de tipos de resposta (pipe)?

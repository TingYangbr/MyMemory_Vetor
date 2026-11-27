Manual MyMemory › Painel Admin › Histórico de preços (B3)
Seção: Seção 19 — Painel Admin
Rota: /admin (cada seção com endereço próprio: /admin/planos, /admin/custos…)
Perfil: admin · Tipo: conceito · Versão do manual: 2

Admin → Sistema → **Histórico de preços (B3)** guarda o fechamento de cada pregão dos papéis da bolsa, pelo arquivo oficial e gratuito da B3. Com ele, o Fale comigo responde a "quanto a PETR4 subiu no mês?" e "evolução do preço do ITSA4 em 2026".
- **Carga dos anos anteriores:** marque os anos e clique em **Carregar**. Cada ano tem ~90 MB e leva alguns minutos; a tela se atualiza sozinha enquanto carrega.
- **Dias novos:** entram sozinhos todo dia, a partir das 20h.
- **Papéis guardados:** só os que alguém da base tem ou já teve.
- **Papel novo:** o robô das 20h procura papéis sem fechamento desde a primeira compra (ex.: cadastrado depois da carga dos anos) e baixa sozinho os anos que faltam (até 5 anos para trás), gravando só esses papéis. Cada papel e ano aparece na tabela como **B:PAPEL:ANO**; um ano já lido não é baixado de novo, e com erro tenta na noite seguinte. Para ter na hora, ainda dá para clicar em **Carregar**; o que já existe não duplica.
- **Tabela de importações:** mostra cada arquivo lido com a situação:
  - **importado**;
  - **sem arquivo**: feriado, sem pregão;
  - **sem papéis**;
  - **erro**, com a mensagem.
NOTA: Os preços não são ajustados por desdobramento, grupamento ou proventos. Num desdobramento, o preço "cai" no dia do evento.

Perguntas que este trecho responde:
- O que é histórico de preços (b3) em Painel Admin?
- Como funciona histórico de preços (b3) no MyMemory?

Manual MyMemory › Painel Admin › Rendimento da carteira
Seção: Seção 19 — Painel Admin
Rota: /admin (cada seção com endereço próprio: /admin/planos, /admin/custos…)
Perfil: admin · Tipo: conceito · Versão do manual: 2

"Qual foi o rendimento da carteira de ações no mês passado?" usa a consulta **Financeiro — Rendimento da carteira** (Saldos e investimentos), por papel da B3 em reais:
- **Valor no início:** quantidade × fechamento do último pregão antes do período. **Valor no fim:** quantidade × fechamento do último pregão do período (se o período vai até hoje, a cotação atual, quando houver).
- **Rendimento** = valor no fim − valor no início − compras + vendas + proventos do período. Compra não é rendimento (é dinheiro posto); venda e provento são dinheiro que saiu do papel.
- **Rendimento %** = rendimento ÷ (valor no início + compras). O % da carteira é a soma dos rendimentos ÷ a soma das bases, não a média dos %.
- Papel sem fechamento da B3 importado na data fica com valor e rendimento vazios (o robô busca sozinho o histórico de papel novo; para ter na hora, carregue o ano em **Histórico de preços (B3)**).
- **Só Brasil:** o rendimento é calculado só para papéis da B3 em reais. "E no exterior?" responde que o rendimento no exterior não está disponível (não há histórico de preços fora da B3); a posição no exterior (quantidade e custo) continua na Posição de investimentos.
- A **Posição de investimentos** com data passada ("posição em 31/10") usa o fechamento daquela data; sem data, a cotação atual ou, sem ela, o último fechamento.

Perguntas que este trecho responde:
- O que é rendimento da carteira em Painel Admin?
- Como funciona rendimento da carteira no MyMemory?

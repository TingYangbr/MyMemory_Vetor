# Controle financeiro PF no proMemory — desenho consolidado

*16/11/2026. Cópia em Markdown do documento publicado. Ainda não substitui o `levantamento-planilha-fonte-dados.md` (v5), que não tem estas decisões.*

## 1. Objetivo e escopo

O objetivo é a pessoa ou a família perguntar ao proMemory sobre o próprio dinheiro, como já pergunta sobre o ERP, começando por investimentos. O proMemory não vira um painel de carteira: as tabelas financeiras são a fonte de dados da conversa, junto com os memos.

- **Dentro da etapa 1:** investimentos de renda variável e Tesouro, registrados por linguagem natural e por arquivos da B3, com posição e custo médio calculados.
- **Fora por enquanto:** cartão e orçamento (próximos controles), cotações de mercado, relatório para o IR, Open Finance.
- **Dono dos dados:** o grupo ou o espaço pessoal, como os memos.
- **Limite regulatório:** responder sobre a carteira é aceitável; recomendar o que comprar não é.

## 2. Decisões já tomadas

- **Duas portas de entrada:** o memo em linguagem natural (uma operação por memo, com a tela de confirmação) e o importador de documentos em lote, sem memo.
- **A B3 como fonte única** para posição e movimentação. A planilha da B3 é lida por parser fixo, sem IA.
- **Onboarding em três níveis:** Posição da B3, depois Movimentação da B3, depois notas e relatórios. O usuário comum não pode ter onboarding pesado.
- **O fato é separado do relato:** o movimento consolidado fica em uma tabela, e cada memo ou linha de arquivo é uma evidência ligada a ele.
- **Custo médio e posição em view**, não gravados. Corrigir o movimento corrige tudo.
- **Subdocumentos** (um memo por operação de um documento) e **campos por subcategoria:** adiados, pela complexidade.
- **Controles como plugins:** o framework genérico só é extraído depois do segundo controle (cartão ou despesas).
- **Já implementado:** o marcador "Confirmar antes de alterar" nas categorias atualizáveis (migration 171), ainda sem efeito prático.

## 3. Como o dado entra

O dado entra por duas portas que gravam nas mesmas tabelas, e cada movimento guarda de onde veio.

```
 Porta 1: memo                 Porta 2: importador
 (texto, voz ou foto,          (planilhas B3, notas,
  uma operação por memo)        uma revisão por documento)
          \                          /
           v                        v
              EVIDÊNCIAS  (cada relato guardado, com hash)
                          |
                      concilia
                          v
                 FATO  (movimento consolidado)
                          |
                          v
                PERGUNTAR  (lê as views de posição e custo)
```

O memo continua como relato; só o fato responde perguntas numéricas.

- **Porta 1, memo:** a operação digitada, falada ou fotografada vira um memo (uma operação por memo) com a tela de confirmação. Serve também para âncoras ("tenho 800 AGRO3 com preço médio de R$ 17,50"), o que resolve a falta de preço médio.
- **Porta 2, importador:** planilhas da B3, notas de corretagem e extratos entram em lote, sem memo. O documento fica guardado em `fin_documentos`, há uma revisão por documento e a conferência é pelo total (soma das operações mais taxas igual ao líquido da nota). Por isso um documento com várias operações não é problema aqui.
- **Planilha da B3:** parser fixo, sem IA e sem criar centenas de memos.

### Arquivos reais analisados

| Fonte | Formato | Traz | Não traz |
| --- | --- | --- | --- |
| Posição da B3 | XLSX | Quantidade, preço de fechamento, instituição e conta | Preço médio |
| Movimentação da B3 | XLSX | Vendas (Transferência - Liquidação com Débito), proventos, direitos | Taxas; a amostra cobre só um mês |
| Posição Detalhada da Clear | XLSX | Preço médio e proventos provisionados | Outras contas além da Clear |
| Nota de corretagem da Clear | PDF com texto | Negócios, taxas e líquido, que fecham | Ticker (vem "COPEL ON") |
| Avenue | PDF e CSV, em USD | Trade#, preço médio, dividendos | Custo em reais |
| Itaú | PDF e HTML | Valor investido por papel | Quantidade e preço médio |

## 4. Modelo de dados

O fato fica numa tabela e cada relato fica como evidência ligada a ele: o JSON do memo é o relato, a tabela é a verdade. Posição e custo médio não são gravados, saem de views.

| Tabela | Guarda | Observação |
| --- | --- | --- |
| `fin_ativos` | Cadastro dos papéis: ticker, classe, moeda | Criada na primeira vez que o papel aparece; nome resolvido para ticker |
| `fin_mov_investimentos` | O fato: compra, venda, provento, evento | Uma linha por operação consolidada, com a origem, o grupo e o dono |
| `fin_evidencias` | Cada relato: memo, linha de arquivo, nota, com hash | Nunca apagada; liga-se ao fato |
| `fin_ancoras` | Posição e preço médio informados numa data | Vem do relatório, do memo ou do usuário. É referência de conferência, não um cálculo: o custo médio existe só na view |
| `fin_documentos` | Arquivo, hash, tipo, situação, resultado da conferência | Só da porta do importador |
| Views de posição e custo médio | Quantidade e custo por ativo | Precisam de GRANT para o usuário de leitura das consultas (`mm_query_reader`) |

### Regras entre memo e tabela

O mesmo dado aparece no JSON do memo, em `dadosespecificos` e na tabela.

1. **Uma só direção, memo para tabela.** O funil apaga e refaz a linha do `memoId` a cada salvamento. Refazer é idempotente.
2. **O memo não é reescrito** quando a conciliação ou uma correção muda o fato. Ele continua sendo o que o usuário disse, e isso ajuda a auditoria.
3. **Perguntas numéricas leem só a tabela.** A consulta da categoria financeira aponta para `fin_`, e não para `dadosespecificos`, para o Pipe 1 e o Pipe 2 não divergirem.
4. **Correção por comando vai na origem:** no memo, se ainda não foi conciliado; no fato, com marca de correção manual, se já foi conciliado ou veio de documento.
5. **Conversão sem silêncio.** O memo guarda texto e a tabela guarda número. Se falhar, o movimento fica com situação de erro e avisa no sino. Hoje o funil engole erros de propósito, e para dinheiro isso não pode valer.
6. **Mapeamento num só lugar:** o nome do campo do memo para a coluna da tabela fica na rotina da categoria.

## 5. Duplicidade e conciliação

A mesma operação pode chegar por mais de um caminho (um memo, depois a B3, depois a nota), e dois membros da família podem narrar a mesma despesa. A solução é casar relatos que descrevem o mesmo fato, de forma determinística e explicável, sem apagar nenhuma evidência.

| Confiança | O que o sistema faz | Exemplo em investimentos |
| --- | --- | --- |
| Alta | Liga sozinho e registra o motivo do casamento | Mesmo ticker, sentido, quantidade e preço, data compatível com a liquidação (D+2) |
| Média | Pergunta ao usuário | Mesmo ticker e dia, quantidade diferente (ordem executada em partes) |
| Baixa | Mantém separado | Ticker igual, datas distantes |

- **Autoridade entre fontes:** documento da corretora vale mais que o texto digitado, e a correção manual do usuário vale mais que os dois e não é sobrescrita por importação posterior sem aviso.
- **Reenvio do mesmo arquivo:** o hash da evidência impede duplicar.
- **Família:** dois relatos do mesmo fato viram duas evidências e um fato.
- **Despesas nunca se unem sozinhas:** dois cafés iguais no mesmo dia são fatos diferentes. Em investimentos o casamento é mais seguro porque os dados são limpos.
- **Desfazer:** toda ligação pode ser desfeita, e o histórico fica.
- **Em aberto:** a conciliação é a parte mais difícil do projeto e não sei estimar o esforço. A sua experiência com a conciliação de conta corrente no sistema legado pode simplificar a regra (a linha do extrato como referência, casada uma única vez).

## 6. Comandos em linguagem natural

O usuário altera ou registra por texto ("adiar a agenda com Wilson", "acrescentar banana na lista do mercado", "corrija a venda de CYRE3 para R$ 100") por uma camada de ações que serve a memos e a tabelas. A base já existe: `alterarMemo` confere permissão, grava histórico em `memo_alteracoes` e devolve um lote para o Desfazer.

1. A classificação do Perguntar reconhece um comando (intenção nova "alterar"), só em categorias atualizáveis.
2. A busca acha os candidatos entre os memos que o usuário pode alterar.
3. A confiança decide: um candidato claro altera e responde com o Desfazer; nenhum responde que não achou; vários pedem a escolha.
4. Uma chamada de IA transforma o comando em campos e valores, e `alterarMemo` aplica.

**Confirmar antes de alterar.** Marcador por categoria atualizável, já implementado (migration 171, API, tela da categoria). Desligado, a alteração grava direto com o Desfazer. Ligado, o sistema mostra antes → depois e só grava depois do sim. Para categorias financeiras, a recomendação é ligar. Ele ainda não tem efeito, porque a alteração por texto não existe.

**Riscos:** confundir comando com relato ("adiei a agenda para o dia 20"), "adiar" sem data, memo errado, e a escolha pendente entre mensagens. Não li as rotas do Perguntar nem a tela, então o esforço (médio) é estimativa.

**Próximas ideias:** os atributos de categoria propostos estão na seção seguinte, e listas de compras e tarefas rápidas têm seção própria.

## 7. Atributos de categoria

*Resumo. A especificação completa de cada atributo está em [plano-atributos-categoria.md](plano-atributos-categoria.md), seção 5.*

O plano depende de atributos novos na categoria, e só um está implementado. Os demais são propostas ou foram adiados.

| Atributo | Para quê | Depende de | Situação |
| --- | --- | --- | --- |
| Pessoal e campo dono | Cada memo pertence a uma pessoa; "minha" e "meus" nas perguntas filtram pelo dono; o campo dono identifica a pessoa na importação em lote. No financeiro, separa as operações de cada membro da família dentro do mesmo grupo | Nada | Já existe; as tabelas `fin_` precisam guardar o dono além do grupo |
| Atualizável e campo de situação | O memo muda de situação (Ativo, Concluído, Cancelado) e é alterado pela resposta | Nada | Já existe |
| Revisão sempre e % mínimo | Controla quando a tela de revisão abre. Para categorias financeiras: revisão sempre ligada | O % mínimo só vale com Revisão sempre desligada | Já existe; basta configurar |
| Confirmar antes de alterar | Alteração por texto mostra antes → depois e só grava após o sim | Atualizável (a API devolve falso sem ele) e a alteração por texto | Implementado (migration 171), sem efeito até existir a alteração por texto |
| Lista de estados (baixa, conciliação) | Estados além da situação, cada um com valores permitidos e verbos (baixar, pagar, conciliar). A conciliação automática grava o estado, com origem `sistema` no histórico | Atualizável e a camada de comandos | Proposto; validado por leitura do código, ver o plano de atributos |
| Controle de duplicidade (antes "Chave única") | Campos que formam a chave, política (avisar, somar, bloquear), coluna de chave e índice parcial. Serve a cadastros, como o papel em `fin_ativos` | Atualizável (a regra vale só entre itens Ativos) e o funil de criação de memo | Proposto |
| Rotina após gravar | Nome de um serviço registrado que o funil chama ao salvar o memo (grava `fin_` a partir do memo) | As tabelas `fin_`; Revisão sempre ligada nas categorias financeiras | Proposto; peça central da porta 1 |
| Dividir documento em itens | Um documento com várias operações vira um memo por operação | Rotina após gravar | Adiado: o importador resolve sem memo |
| Campos por subcategoria | Campos próprios por subcategoria, via `subcategoryid` em `categorycampos` | Nada | Adiado: categoria por tipo de documento basta |

## 8. Registro oficial

*Esta seção foi reescrita. Não há "dois tipos de categoria": toda categoria tem um **registro oficial**, o registro que vale quando dois lugares discordam. Ele não é um atributo guardado, e sim deduzido dos outros atributos. A definição completa está em [plano-atributos-categoria.md](plano-atributos-categoria.md), seções 2 e 3.*

- **Memo:** o registro oficial é o próprio memo, que funciona como tabela plana. A Query padrão responde. Exemplos: Agenda, Lista de compras, To-do, Empreitadas.
- **DB interno (tabelas do proMemory):** o registro oficial é um fato consolidado em tabelas tipadas, e o memo é um relato. Acontece quando há outra fonte além dos memos, ou o mesmo fato chega por duas fontes e é preciso conciliar. A categoria tem a rotina após gravar. Exemplo: Investimentos.
- **DB externo:** o registro oficial mora no ERP ou em outro banco, e as consultas da categoria têm conexão.

**Fonte para conciliação** é o relato externo com que o registro oficial é conferido. Em Investimentos, são a nota de corretagem e a Movimentação da B3; numa conta bancária, o extrato; no cartão, a fatura.

O teste é se a Query padrão da categoria responde às perguntas que importam. Um cálculo derivado, como o custo médio, não decide sozinho. A fronteira é um gradiente: o registro oficial pode passar do memo para tabelas depois, sem refazer os atributos.

## 9. Etapa 1 e ordem de entrega

*Movido. Os atributos de categoria, os pilotos (Agenda, Lista de compras, To-do e Empreitadas), o fluxo do comando de alteração e a ordem de entrega estão em [plano-atributos-categoria.md](plano-atributos-categoria.md), seções 5, 6, 8 e 10. Este desenho trata só do controle financeiro, que vem depois dessa etapa: a rotina após gravar e as tabelas `fin_` para Investimentos (seções 3 e 4 deste desenho).*

## 10. Listas e tarefas rápidas

*Superada em 17/11: ver a nota no fim desta seção e o [plano de atributos](plano-atributos-categoria.md), seção 8.2.*

Lista de compras e tarefas rápidas ficam melhor em tabelas próprias que em memos, e usam a mesma camada de comandos. A regra: item com conteúdo e pouca frequência (agenda, contrato, operação de investimento) é memo; linha de lista de alta frequência é tabela.

| Critério | Memo (categoria atualizável) | Tabelas no Postgres |
| --- | --- | --- |
| Unicidade (banana na lista Mercado) | Coluna de chave e índice parcial na tabela genérica `memos` | Natural: único por lista e item enquanto ativo |
| Custo por item | Vetor por memo e reescrita de resumo por IA a cada alteração | Uma linha pequena, sem IA |
| Volume | Centenas de itens por mês poluem a lista de memos e a busca | Sem problema |
| Checklist e ações em lote | Um comando por memo | Consulta direta e um UPDATE |
| Captura por linguagem natural | Já existe, com revisão | Precisa da camada de comandos |

- **Controle de duplicidade só entre itens ativos:** "acrescentar banana" com banana ativa na lista avisa ou soma a quantidade; com banana concluída cria um item novo, e o antigo vira histórico.
- **Família:** dois membros acrescentando o mesmo item ao mesmo tempo só ficam seguros com um índice único parcial no banco.
- **"Comprei banana" conclui o item** e "tirar banana" o cancela. "Comprei tudo do mercado" é ação em lote e pede confirmação.
- **Ressalva:** a comparação de custo vem da leitura do código, não de medição.

> **Nota:** esta seção ficou superada em 17/11. A lista de compras passou a ser um memo por lista, com os itens em texto, e o valor por item vem do cupom fiscal (plano de atributos, seção 8.2). Fica aqui só como referência para listas de alto volume.

## 11. Etapas sugeridas e perguntas em aberto

A ordem proposta testa o modelo de fato e evidência com o caso mais simples antes de investir na conciliação.

1. **Memos em linguagem natural** (operação e âncora) gravando em `fin_`, com aviso de duplicidade provável e sem união automática. A Posição da B3 só confere a quantidade.
2. **Movimentação da B3** pelo importador, e aí a conciliação, já com dados reais de uso.
3. **Notas de corretagem** pelo importador, completando preço e taxas de fatos já existentes.
4. **Cartão e despesas**, com a fatura como caminho principal e a linguagem natural para o que não aparece em fatura.

O custo dessa ordem é que o histórico completo da B3 só chega no passo 2.

### Perguntas em aberto

- [ ] A primeira etapa leva só memos em linguagem natural ou já a Movimentação da B3?
- [ ] A regra de conciliação: como era no sistema legado de conta corrente?
- [ ] Um estado de baixa ou conciliação por categoria: pode haver mais de um campo de estado, e o usuário pode desfazer uma conciliação automática?
- [ ] Lista de compras e tarefas rápidas em tabelas próprias, como plugin?
- [ ] Registrar estas decisões como v6 do levantamento no repositório.

**Ainda sem receber:** a Movimentação da B3 com o período máximo e o relatório com preço médio da Itaú (conta 1073394) e da XP conta 3394753.

**Ainda não li:** a tela de revisão do Catalogar (já li `createMemoTextReviewed`, só a parte do backend), `entityResolutionService`, os demais pontos de criação de memo e a tela do Perguntar. Das rotas do Perguntar li só a lista (`/api/perguntas` e as de alteração).

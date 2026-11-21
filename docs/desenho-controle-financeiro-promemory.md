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

## 12. Despesas e receitas (controle de gastos)

*Acrescentada em 19/11/2026, a partir da análise da demonstração do concorrente meuassessor e da discussão com a Ting.*

### 12.1 Decisão: comando grava direto nas tabelas, sem memo

No controle de gastos o registro oficial é o **DB interno**. O comando do Fale comigo ("gastei 62 na farmácia", "Uber 23,90, débito") grava direto nas tabelas `fin_`. **Não cria memo.** O relato (frase digitada, áudio transcrito, foto do cupom ou do boleto) fica em `fin_evidencias`, ligado aos fatos que gerou.

Motivos:
- **A relação 1:1 entre memo e registro não se sustenta.** Uma frase pode ter vários lançamentos ("50 mercado, 30 farmácia e 20 de uber"); um parcelado gera 6 títulos; uma recorrência gera títulos futuros. Evidência e fato são N:M por natureza.
- **Volume e custo.** São muitos lançamentos por dia. Um memo por gasto teria vetor e resumo por IA a cada um e encheria a busca de memos pequenos.
- **A regra do plano de atributos continua valendo:** memo quando o item tem conteúdo e é manipulado sozinho (agenda, contrato). Lançamento de gasto é linha de tabela.

Consequências:
- **Confirmação:** o comando mostra um cartão com as linhas que vai gravar (valor, data, grupo, forma de pagamento) e grava após o sim. Com várias linhas, uma confirmação só.
- **Alteração e Desfazer:** precisam de histórico próprio das tabelas `fin_` (equivalente ao `memo_alteracoes`), com lote para o Desfazer.
- **Perguntas:** as consultas da categoria leem as tabelas (o Pipe 2). A busca semântica de memos não enxerga gastos, e não precisa.
- **Em aberto:** se Investimentos (seção 3, porta 1) também deve deixar de criar memo, para as categorias de DB interno terem uma regra só. Recomendação: sim.

### 12.2 O que o concorrente faz (demonstração com 25 frases)

| Capacidade | Exemplo | Situação no proMemory |
| --- | --- | --- |
| Lançar gasto por texto ou voz, retroativo, valor por extenso | "almoço de ontem, 39", "sessenta e oito na pizza" | Falta gravar em tabela |
| Forma de pagamento | "Uber 23,90, débito", "180 de luz no pix" | Desenhado |
| Vários lançamentos numa frase | "50 mercado, 30 farmácia e 20 de uber" | Falta |
| Receita | "recebi 800 do freela" | Desenhado (título a receber) |
| Parcelado | "cadeira em 6x de 95" | Desenhado (6 títulos) |
| Recorrência | "toda segunda 89,90 da academia" | Falta (regra que gera títulos futuros) |
| Foto do boleto (conta a pagar com vencimento) e da nota | condomínio, posto | Parcial: o Catalogar lê fotos, mas não gera título |
| Orçamento por grupo e quanto sobrou | "800 por mês pra alimentação" | Desenhado (`fin_orcamento`), sem comando |
| Meta de receita | "meta de receita é 15 mil" | Falta |
| Corrigir e apagar por texto | "foi 45, não 54", "apaga o ifood de ontem" | Existe para memos; falta para tabelas |
| Apagar em lote | "apaga todos de julho, foi teste" | Falta; exige confirmação forte |
| Regras de classificação | "guincho é sempre Manutenção do Carro" | Falta |
| Reclassificar em lote | "transferências pra Michelle → Lavanderia" | Falta |
| Criar grupo de gasto | "cria uma categoria Pets" | Falta |
| Explicar um total | "de onde vem 1.240?" | Falta: listar os lançamentos que somam o valor |
| Recorrências e maiores gastos | "gasto que se repete todo mês?", "3 maiores" | Maiores já existe (destaques); recorrência falta |

Onde o proMemory já ganha: memos e documentos com busca, ERP na versão empresarial, grupos familiares com dono por pessoa, investimentos com custo médio.

### 12.3 Modelo de dados (rascunho)

Uma categoria (Controle de gastos) com várias tabelas, como o Faturamento do ERP lê nota, itens e títulos.

| Tabela | Guarda | Paralelo no ERP |
| --- | --- | --- |
| `fin_lancamentos` | Cabeçalho: data, sentido (despesa ou receita), estabelecimento ou origem, valor total, forma de pagamento, conta ou cartão, grupo de gasto, dono | Nota de entrada ou saída |
| `fin_lancamento_itens` | Itens do cupom, quando houver | Itens da nota |
| `fin_titulos` | Parcelas com vencimento, valor e situação (aberto, pago ou recebido); sentido a pagar ou a receber | Contas a pagar e a receber |
| `fin_recorrencias` | Regra: valor, grupo, periodicidade, início e fim; **não gera títulos adiantados** — a previsão é calculada pelo motor (ver 13.7) | Contrato recorrente |
| `fin_grupos_gasto` | Lista de grupos do espaço (Alimentação, Pets…) | Plano de contas |
| `fin_regras_grupo` | "guincho → Manutenção do Carro" | Regra de classificação |
| `fin_orcamento` e metas | Valor por grupo e mês; meta de receita | Orçamento |
| `fin_movimentos` (conta corrente) | Extrato; a baixa liga título a movimento | Conta corrente e conciliação |

- **"Grupo de gasto", não "categoria":** no proMemory "categoria" é a categoria do memo. A decisão de 14/11 (grupo como texto livre da fonte) é revista: o usuário quer criar grupos, regras e reclassificar.
- **PIX e débito:** o lançamento já nasce pago (título e baixa juntos, ou sem título).
- **Cartão de crédito:** as compras se juntam na fatura, que vira um título a pagar.
- **Parcelas:** podem vir de uma condição de pagamento, o mesmo conceito do item 1 do backlog do Softing-erp.
- **Fluxo de caixa:** previsto = títulos em aberto por vencimento; realizado = movimentos.

### 12.4 Etapas sugeridas

1. **Lançamentos e títulos:** despesas e receitas por texto, voz e foto (inclusive várias numa frase), forma de pagamento, parcelado e boleto como títulos, grupos de gasto com regras, corrigir e apagar com Desfazer.
2. **Orçamento, metas e recorrência.**
3. **Conta corrente, baixa e conciliação; fluxo de caixa.**

### 12.6 Uma categoria ou várias

*Análise de 19/11/2026.*

**Várias tabelas numa categoria: sim.** A categoria não é dona de tabela, é dona de consultas; cada consulta pode juntar quantas tabelas quiser, como o Faturamento do ERP. Falta só, para as tabelas `fin_`, dar leitura ao `mm_query_reader` e aplicar a proteção por grupo e dono (RLS), como foi feito para `memo_alteracoes`.

**A mesma tabela em várias categorias: sim.** Duas categorias podem ter consultas sobre a mesma tabela (no ERP, Faturamento e Contas a Receber leem as mesmas). Cuidado: cada consulta precisa filtrar o seu pedaço, senão uma categoria permitida enxerga dados da outra.

**Como a IA escolhe o que responde (leitura):**
1. Classificação: lê nome e descrição de todas as categorias do espaço e escolhe uma ou mais.
2. Planejamento: lê as consultas dessas categorias (nome, descrição, parâmetros) e escolhe qual rodar e com quais filtros.
3. O sistema executa; a IA só redige a resposta.

| Separar em mais categorias | Efeito |
| --- | --- |
| A favor | Descrições mais específicas; menos consultas por categoria no planejamento (prompt menor) |
| Contra | Perguntas que cruzam categorias ("quanto sobrou no mês?" = receitas − despesas) dependem de a classificação escolher as duas; a lista que a classificação lê cresce |

**Como gravar (escrita): nunca SQL escrito pela IA.**
- A classificação já reconhece comandos (criar, alterar) e os desvia das consultas, que são só leitura de propósito.
- Cada categoria de DB interno declara uma **rotina de gravação** (código nosso, a "rotina após gravar" da seção 7).
- A IA só extrai os dados no formato definido pela categoria (lista de lançamentos: valor, data, grupo, forma de pagamento, parcelas); o código confere e grava.
- Uma frase que mistura despesa e receita ("paguei 50 de mercado e recebi 800 do freela") é simples com uma categoria e uma rotina; com duas categorias, o comando teria de ser dividido entre elas.

**Outros impactos:**

| Ponto | Impacto |
| --- | --- |
| Perfis de acesso | Permissão é por categoria. Separar só vale se alguém deve ver despesas e não receitas. Com tabela compartilhada, cada consulta filtra o seu pedaço |
| Pessoal e dono | As tabelas `fin_` guardam o dono; as consultas respeitam "minha" e "de todos" |
| Query padrão | Não se aplica (é para memos). As consultas de `fin_` são escritas por nós e vêm prontas com a categoria |
| Categorias Modelos | "Controle de gastos" vira modelo pronto: consultas, rotina, grupos de gasto iniciais |
| Lembretes e avisos | Hoje leem memos. "Conta vence amanhã" precisa da origem títulos (como a etapa 2 dos lembretes, origem ERP) |
| Buscar e Recentes | Não mostram lançamentos (não são memos). Talvez "Lançamentos recentes" no próprio controle |
| Desfazer e histórico | Histórico próprio das tabelas `fin_` |
| Custo de IA | Uma extração por comando; perguntas custam o mesmo de hoje |

**Recomendação:** uma categoria só, **Controle de gastos** (despesas e receitas), com várias consultas (lançamentos por período e grupo, títulos em aberto, orçamento × realizado, saldo do mês) e uma rotina de gravação. Separar só por motivo de permissão, ou quando a área já é naturalmente outra (Investimentos continua categoria própria).

### 12.5 Perguntas em aberto

- [ ] Investimentos também deixa de criar memo na porta 1 (12.1)?
- [ ] Cartão de crédito: a fatura entra na etapa 1 ou na 3?
- [ ] Grupos de gasto: lista inicial padrão (Alimentação, Transporte, Moradia…) ou vazia?
- [ ] Apagar em lote: que confirmação (digitar o mês, como o ELIMINAR do Painel Admin)?
- [ ] Uma categoria só (Controle de gastos) ou separar despesas e receitas (12.6)? Recomendação: uma só.

## 13. Núcleo contábil e o papel da IA

*Discussão de 19/11/2026.*

### 13.1 Por que integrar tudo

O saldo da conta corrente só fecha se **todo** movimento que toca a conta for registrado: despesas pagas, recebimentos, transferências entre contas próprias, pagamento da fatura do cartão, aplicações e resgates, tarifas e rendimentos. Se faltar um tipo, a conta não bate, como no estoque que ignora a devolução. Por isso Recebíveis, Despesas, Investimentos, Cartão, Conta Corrente e Lançamentos formam **um modelo só**, e o controle de bancos é a última etapa, que fecha o conjunto.

### 13.2 Decisão: partidas dobradas por dentro, linguagem do dia a dia por fora

Cada evento grava **dois lados** (de onde sai, para onde vai). É a regra contábil usada como mecanismo, não como relatório; o usuário nunca vê débito e crédito.

| Evento | De onde sai | Para onde vai |
| --- | --- | --- |
| Mercado no débito | Conta Itaú | Despesa Alimentação |
| Compra no cartão | Cartão Nubank (dívida) | Despesa Alimentação |
| Pagar a fatura | Conta Itaú | Cartão Nubank (quita a dívida) |
| Transferência entre contas próprias | Conta Itaú | Conta Nubank (não é despesa) |
| Aplicar no Tesouro | Conta Itaú | Investimento Tesouro |
| Salário | Receita Salário | Conta Itaú |

Assim saldo de banco, dívida do cartão, posição dos investimentos e resultado do mês saem do mesmo livro e sempre batem. Evita os erros clássicos: transferência contada como gasto e fatura contada duas vezes.

### 13.3 Competência e caixa (o caso do recebível)

- **Ao registrar o recebível:** nasce o **título** (direito a receber com vencimento). Na visão de competência já é receita do período; na de caixa ainda não é nada.
- **Ao receber:** a **baixa** gera o movimento de caixa e quita o título.

As duas visões saem dos mesmos dados. **ERP:** competência e plano de contas completo. **Pessoa física:** caixa por padrão, poucas contas. Um núcleo só serve aos dois produtos.

### 13.4 Efeito no modelo de dados (revisa 12.3)

O núcleo passa a ser um **livro único de lançamentos com dois lados**. Por cima dele:
- **títulos:** compromissos a pagar e a receber (competência);
- **contas:** banco, cartão, investimento, grupos de gasto e de receita (o "plano de contas" simplificado);
- **visões:** caixa, competência, saldos e fluxo de caixa.

A ordem das etapas (12.4) não muda; desde a primeira cada lançamento já grava os dois lados, e o controle de bancos no fim só liga o extrato. Não é preciso refazer nada.

### 13.5 O papel da IA: tradutora, não contadora

A IA **não aprende sozinha** com o uso (não guarda memória entre chamadas). Ela é ensinada **com texto** a cada chamada, e o trabalho fica dividido em três partes:

1. **Catálogo fechado de eventos (no prompt):** despesa paga, compra no cartão, pagamento de fatura, transferência própria, aplicação/resgate, receita, título a pagar/receber — cada um com frases de exemplo. A IA só escolhe o tipo e extrai valor, data, conta e grupo. **Os dois lados quem monta é o código**, sempre igual para cada tipo.
2. **Regras do usuário (no banco):** quando a pessoa corrige ("isso é transferência para minha outra conta"), grava-se uma regra ("Pix para CPF X = conta própria", "Michelle → Lavanderia"). O código aplica a regra **antes** de chamar a IA; as mais usadas também vão no prompt como exemplo. A "memória" fica no banco, não na IA.
3. **Na dúvida, perguntar:** se a frase cabe em dois eventos ("mandei 500 para o João": despesa ou empréstimo?), a IA devolve "ambíguo" e o cartão de confirmação pergunta.

**Ao responder,** a IA escolhe a visão pelo jeito da pergunta e diz qual usou: "quanto **gastei**" = competência (data da compra); "quanto **saiu da conta**" = caixa (data do pagamento); "quanto **tenho**" = saldos.

**Onde erra mais:** transferência própria × pagamento a terceiro, estorno, compra parcelada, "paguei o cartão" (fatura inteira ou uma compra?). **Proteções:** o cartão de confirmação mostra sempre de onde sai e para onde vai ("Saem R$ 2.300 do Itaú e a fatura de outubro do Nubank fica paga"); regras gravadas reduzem as escolhas da IA; nos bancos, o **extrato é a verdade final** e a conciliação acusa o que não bate.

### 13.7 Recorrência: o motor e quando nasce o título

*Decisão de 19/11/2026.*

**A pergunta-chave é se a obrigação já existe.**

| Situação | Como gravar |
| --- | --- |
| Prazo determinado: compra parcelada em 6x, financiamento, acordo | A dívida já nasceu: **gravar todos os títulos de uma vez** |
| Prazo indeterminado: mensalidade, aluguel, salário, conta de luz | **Só a regra no motor** (`fin_recorrencias`); nada é gravado adiantado |

Pela contabilidade, a previsão de um recorrente não é recebível nem conta a pagar: o direito só nasce com o fato (serviço prestado, NF, pagamento).

**O título de uma recorrência nasce no primeiro fato real, nunca por agendamento:**

| Fato | Exemplo | Quem usa |
| --- | --- | --- |
| Pagamento ou recebimento | "paguei o aluguel de novembro": título já quitado + lançamento com dois lados | PF e ERP (caso normal) |
| Documento emitido | NF ou boleto da mensalidade do cliente | ERP |

**Exceção num mês** ("em dezembro o aluguel é 2.000", "este mês não tem") fica gravada **na regra** (`fin_recorrencia_excecoes`), não vira título: ainda não é obrigação, e assim Contas a Pagar/Receber continuam conferindo com os títulos (13.8).

**O motor calcula na hora, sem gravar:**
- **previsão** ("quanto vou receber em março?") = títulos existentes + ocorrências das regras ainda sem título; a resposta separa "confirmado" de "previsto";
- **atraso**: mês com vencimento passado e sem título = pendente;
- **lembretes** ("aluguel vence amanhã").

**Cuidado único:** o título nascido de uma regra guarda **a regra e o mês de referência**. Assim a previsão pula esse mês, o mesmo mês não é pago duas vezes, e pagar adiantado ou atrasado não confunde. Essa junção (títulos + projeção) fica numa rotina única, usada por todas as consultas e pela IA. Mudar a regra (reajuste, cancelamento) afeta só os meses que ainda não viraram título.

### 13.8 Contas a Receber e a Pagar conferem com os títulos

No livro de dois lados, **Contas a Receber** e **Contas a Pagar** são contas como as outras, e o saldo delas **é** a soma dos títulos em aberto (é o "razão auxiliar" da contabilidade).

| Momento | De onde sai | Para onde vai |
| --- | --- | --- |
| Venda a prazo / NF emitida (título nasce aberto) | Receita | Contas a Receber |
| Recebimento (baixa) | Contas a Receber | Conta Itaú |
| Compra parcelada em 6x no boleto (6 títulos) | Contas a Pagar | Despesa |
| Pagamento de cada parcela | Conta Itaú | Contas a Pagar |
| Recorrente com título nascido no pagamento | Receita (ou Conta Itaú) | Conta Itaú (ou Despesa), direto, sem passar por Receber/Pagar |

- **Cartão de crédito** faz o papel de conta a pagar própria: a compra entra na conta Cartão, e o pagamento da fatura a quita.
- **O saldo não é guardado em dois lugares:** vem dos lançamentos. Título e lançamento são gravados na **mesma transação**, então batem sempre; uma conferência periódica ("soma dos títulos abertos = saldo da conta") é só o teste de sanidade, como o inventário no estoque.
- **Pessoa física:** essas contas ficam escondidas; a pessoa vê "contas a pagar" como lista de títulos. **ERP:** aparecem no balancete.

### 13.6 Perguntas em aberto

- [ ] Plano de contas inicial da pessoa física: quais contas e grupos vêm prontos?
- [ ] Lista final do catálogo de eventos (estorno, empréstimo a terceiros, adiantamento entram na etapa 1?).
- [ ] Visão padrão das respostas quando a pergunta não deixa claro: caixa (proposta) ou competência?
- [ ] O mesmo núcleo vira base do financeiro do Softing-erp (backlog item 5)?

### 13.9 Etapa 1 implementada (19/11/2026)

- **Tabelas** (migration 180): `fin_contas`, `fin_lancamentos` (dois lados + quantidade/preço), `fin_titulos`, `fin_recorrencias`, `fin_recorrencia_excecoes`; RLS por espaço para as consultas de categoria.
- **Motor** em `packages/shared/src/financeiro.ts` (ocorrências, dia 31 e 29/02, parcelas em centavos) — reaproveitável no Softing-erp.
- **Serviço** `apps/api/src/services/financeiroService.ts` e rotas `/api/fin/*`: contas com saldo inicial; recorrência com reajuste, fim e exceções; parcelado (todos os títulos + despesa/receita na data da compra); pagar/receber (juros e desconto vão para contas próprias); desfazer pagamento; lançamento livre (cartão, fatura, transferência, aplicação, desdobramento); venda pelo custo médio com ganho/perda; conferência 13.8.
- **Tela** `/financeiro` "Contas a pagar e receber" (agenda do mês, lançamentos, contas e saldos, recorrências). No menu só para admin, marcada "teste".
- **Regras de atraso:** ocorrência de recorrência conta como atraso a partir do mês em que a regra foi cadastrada (o anterior é histórico) e no máximo 1 ano.
- **Testado** contra Postgres real (PGlite): 30 verificações, incluindo partidas dobradas fechando e isolamento entre usuários.
- **Próxima etapa:** comandos pela IA, consultas para o Fale comigo, lembretes de vencimento.

### 13.10 Moedas (etapa 1.1, 19/11/2026)

**Decisão:** o livro fecha em **reais**; cada conta tem uma moeda (real por padrão) e o lado em outra moeda guarda também o **valor na moeda e a cotação**.

| Situação | Como é gravado |
| --- | --- |
| Câmbio de ida (Itaú → Avenue) | Informa os dois valores (R$ 5.500 e US$ 1.000); a cotação sai deles (5,50) |
| Entrada sem câmbio (dividendo, saldo inicial em dólar) | Reais = informado ou cotação PTAX da data |
| Saída da conta em moeda (comprar AAPL, despesa em dólar) | Sai pelo **custo médio em reais** da conta — o dólar se comporta como um investimento |
| Câmbio de volta (Avenue → Itaú) | Sai pelo custo médio; a diferença para o que entrou em reais é **ganho ou perda cambial realizado** |
| Venda de papel em moeda | Custo e ganho na moeda; o ganho entra em reais pela cotação da data; recebe numa conta da mesma moeda |
| Valor de hoje | Saldo na moeda × cotação de hoje, **calculado, não gravado**; a diferença para o custo é a variação cambial não realizada |

- **Cotação:** PTAX de fechamento (venda) do Banco Central, guardada em `fin_cotacoes`; dia sem cotação usa a anterior. Moedas: USD, EUR, GBP, CHF, CAD, AUD, JPY.
- **Contas a pagar e receber continuam em reais:** título e recorrência são pagos só por conta em real; câmbio é um lançamento à parte.
- **Grupos de despesa e receita são sempre em real** (despesa em dólar entra em reais pelo custo, guardando o valor em dólar).
- **IR:** as regras do exterior (Lei 14.754/2023) e de moeda em espécie são diferentes das de ações no Brasil; com valor na moeda, valor em reais e cotação de cada data, o cálculo pode ser feito depois.
- **Compra no cartão brasileiro em dólar:** já vem em reais na fatura (com IOF); a moeda original fica só como informação (futuro).
- **Implementado:** migration 181, `finCotacaoService.ts`, regras em `financeiroService.ts`, campos na tela. Testado contra Postgres real com PTAX real (câmbio, custo médio em dólar, AAPL, câmbio de volta com ganho, livro fechando em reais).

### 13.11 Etapa 2a: o Fale comigo responde sobre o financeiro (20/11/2026)

**Três categorias-modelo**, separadas pelo tempo da pergunta (sugestão do Ting, pela experiência do ERP: categorias menores deixam a classificação e a escolha da consulta mais certeiras; revê a recomendação de categoria única da 12.6):

| Categoria | Pergunta sobre | Consultas |
| --- | --- | --- |
| Fin - A pagar e receber | o futuro | Agenda (vencimentos, atrasados, pagos, com a previsão das recorrentes); Fluxo de caixa previsto por mês |
| Fin - Gastos e lançamentos | o passado | Gastos e receitas por grupo (competência); Resultado por mês; Entradas e saídas por conta (caixa); Lançamentos (extrato) |
| Fin - Saldos e investimentos | a posição | Saldos das contas (inclui moeda e valor de hoje); Posição de investimentos |

- **Onde ficam:** no Catálogo de modelos (Categorias Modelos). O dono habilita num grupo; a cópia leva as consultas. No espaço Pessoal valem as categorias dos grupos de que a pessoa participa, e as consultas leem os dados do espaço em que a pergunta foi feita.
- **Motor em SQL:** função `fin_agenda(de, ate)`, igual à agenda da tela (comparada nos testes: mesmo resultado em 4 períodos, incluindo dia 31, 29/02, quinzenal, exceções e pagos).
- **Segurança:** as consultas rodam pelo papel restrito com RLS por espaço; testado que outro usuário não aparece e que o papel não lê outras tabelas.
- **Filtros tolerantes:** tipo ("contas a pagar", "gastos") e situação ("atrasadas", "em aberto", "pagas") aceitam o jeito de falar; nomes de conta e grupo sem acento.
- **Limites:** cotação do dólar nas consultas = a última que o app já buscou (aparece a data); preço de mercado de ações não existe ainda.
- **Implementado:** migration 182, `apps/api/src/services/finConsultas.ts`.
- **Próxima etapa (2b):** comandos de gravação pela IA ("paguei o aluguel", "aluguel de 2.500 todo dia 5").

### 13.12 Mercado: Brasil ou exterior (20/11/2026)

- **Campo da conta** (banco, corretora, cartão, investimento): `mercado` = local ou exterior. O padrão segue a moeda, mas é independente dela: BDR e fundo cambial são do Brasil em reais; Avenue e Nomad são exterior.
- **Consultas** Saldos das contas e Posição de investimentos ganham a coluna e o filtro `mercado` ("no exterior", "no Brasil", "lá fora") e a instrução: separar a resposta por mercado e moeda, **nunca somar moedas diferentes**; valores em reais podem ser somados.
- **Tela:** escolha do mercado ao criar a conta; etiqueta "exterior" e o link Marcar como Brasil/exterior na lista.
- **Implementado:** migration 183 (coluna, preenchimento pelo padrão e atualização das duas consultas no modelo e nas cópias não editadas).


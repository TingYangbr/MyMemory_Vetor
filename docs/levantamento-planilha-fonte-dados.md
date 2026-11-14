# Levantamento: fontes de dados financeiros no Perguntar (planilha, Open Finance, apps)

*Versão 3 (14/11/2026). Ainda não é desenho de implementação: é para decidir o caminho.*

**O que mudou na v3:**
- tabela pai de contas, com fotos de saldo e de posição;
- estimativa de volume;
- sincronização incremental por origem;
- fonte por espaço;
- regra "receita → uma categoria";
- grupos como texto livre da fonte;
- limites por plano;
- PIX: API do banco × Pluggy.

## 1. Objetivo

Deixar o usuário, PF ou PJ sem SQL Server, perguntar sobre seus dados financeiros, do mesmo jeito que hoje pergunta sobre o ERP. Por exemplo:

- "Quanto gastei com mercado por mês em 2026, variação %?"
- "Orçado × realizado de outubro por grupo de despesa"
- "Quanto tenho em renda fixa e quanto rendeu no ano?"

Cada contexto (**Extrato**, **Orçamento**, **Investimentos**) é atribuído a uma **categoria** do espaço, como em Categorias hoje.

## 2. Princípio central: modelo canônico por tipo

Um **modelo canônico** é o **formato único e oficial, definido por nós**, em que os dados de um tipo são sempre gravados, qualquer que seja a origem.

As origens chegam diferentes:

| Origem | Como o dado chega |
|---|---|
| Planilha do usuário A | colunas "Dt", "Histórico", "Débito", "Crédito" |
| Planilha do usuário B | "Data", "O que foi", "Valor (R$)", com os meses em colunas |
| Pluggy (Open Finance) | JSON com `date`, `description`, `amount`, `status`, `category` |
| Organizze | JSON com `date`, `description`, `amount_cents` (em centavos) |

Todas são convertidas para o mesmo formato:

| data | descrição | valor | grupo | conta | situação | origem |
|---|---|---|---|---|---|---|
| 2026-10-05 | Supermercado X | -235,40 | Mercado | Itaú CC | efetivado | pluggy |
| 2026-10-06 | Salário | 8.500,00 | Receita | Itaú CC | efetivado | planilha |

**Por que isso importa:**
- As consultas do Perguntar são **escritas e testadas uma vez por tipo**, e não geradas a cada planilha.
- Uma **origem nova** só precisa do seu conversor; as consultas não mudam.
- A **bagunça fica na entrada**: cada conversor resolve as diferenças da sua origem, e por dentro o sistema conhece um formato só.

O que for próprio de uma origem e não couber nas colunas canônicas vai para um campo `extras` (JSONB), sem se perder.

### 2.1 Tabelas

```
fontes_dados          (id, groupId|null, userId, categoryId,
                       origem: planilha|modelo|gsheet|pluggy|organizze|ofx,
                       nome, config JSON [arquivo, aba, intervalo, receita, itemId…],
                       ultimaSync, hashConteudo, status, erro)

fin_contas  ← PAI     (id, groupId|null, fonteId, nome, instituicao,
                       tipo: corrente|poupanca|cartao|corretora|carteira|outra,
                       idOrigem, ativa)

fin_movimentos        (contaId, fonteId, data, descricao, valor, grupo,
                       situacao: pendente|efetivado, idOrigem, hashLinha, extras JSONB)   ← extrato
fin_saldos            (contaId, data, saldo, tipo: informado|calculado)                  ← foto do saldo
fin_posicoes          (contaId, data, ativo, classe, quantidade, valor)                  ← foto da carteira
fin_mov_investimentos (contaId, fonteId, data, ativo, classe, tipo: aplicacao|resgate|rendimento|…,
                       quantidade, valor, idOrigem, extras JSONB)
fin_orcamento         (groupId|null, fonteId, mes, grupo, item, valorOrcado, extras JSONB)
```

- **`fin_contas` é a tabela pai.** Ela tem cada conta corrente, cartão, corretora ou carteira do espaço, e movimentos, saldos e posições apontam para ela.
- **Saldo e posição são gravados como fotos** (`fin_saldos`, `fin_posicoes`), e não calculados somando movimentos. O histórico quase nunca está completo: falta o saldo inicial, ou o Open Finance traz só os últimos meses, e a soma daria errado.
  - A foto pode ser **informada** pela origem (o Pluggy manda o saldo) ou **calculada** quando a origem não informa.
  - Com isso, "quanto tenho hoje" e "quanto tenho por classe" viram consultas de poucas linhas.
- O **orçamento** não aponta para conta, e sim para grupo e mês.
- **Índices** em (grupo, conta, data) em todas as filhas.
- Todas as tabelas têm a mesma proteção por espaço dos memos, com `SELECT` liberado para `mm_query_reader`.
- **Consultas canônicas por tipo**, escritas uma vez: gasto por período e grupo, orçado × realizado (junta `fin_orcamento` e `fin_movimentos`), saldo atual por conta, posição por classe, evolução mensal.
- O Perguntar não muda: o planejador vê a categoria Extrato com suas consultas, como vê Faturamento.

### 2.2 Grupos de despesa: texto livre vindo da fonte

O grupo ("Mercado", "Moradia") é gravado **como veio da fonte**, e as consultas agrupam por esse texto. Cada espaço tem naturalmente a sua lista: o conjunto de valores que existem nas tabelas dele. **Não há lista nem de-para no começo.**

No Pluggy, o grupo vem da categorização automática deles (o banco não tem a lista do usuário).

*Melhoria futura, só se aparecer na prática: um de-para de nomes para quando duas fontes precisam conversar. Por exemplo:*
- *orçamento com "Alimentação" e extrato com "Mercado";*
- *extrato antigo da planilha com "Supermercado" e o novo do Pluggy com outro nome;*
- *o usuário querer os seus nomes em vez dos do Pluggy.*

### 2.3 Espaço dono dos dados

A fonte e os dados pertencem ao **espaço**, como os memos hoje: um **grupo** ou o **espaço pessoal** (sem grupo). Quem quer privacidade usa o pessoal ou um grupo só seu. Grupo não quer dizer PJ: pode ser família, sócios, um casal.

Num grupo, os **perfis de acesso** existentes podem restringir quais categorias financeiras cada membro consulta. Por exemplo, nem todos da família veem o extrato.

### 2.4 Volume estimado

| Perfil | Lançamentos/ano | 5 anos |
|---|---|---|
| PF ou família (2–3 contas + cartão) | 2–4 mil | 10–20 mil |
| Pequena empresa | 20–60 mil | 100–300 mil |

Saldos e posições são fotos mensais, ou só quando mudam, e por isso pesam pouco.

| Base | Linhas | Tamanho com índices |
|---|---|---|
| 1.000 espaços × 30 mil | 30 milhões | ~10 GB |
| 10.000 espaços | 300 milhões | ~100 GB |

**Não inviabiliza:**
- Toda consulta é filtrada pelo espaço, como a proteção por grupo já obriga. Com o índice, uma pergunta lê só as linhas daquele espaço, então **o desempenho depende do tamanho de cada espaço, não do total**.
- Se crescer muito: particionar por espaço e usar os limites do plano (seção 8).
- Comparação: a tabela de memos com embeddings já pesa mais por linha.

## 3. O que já existe e pode ser reaproveitado

| Peça atual | Como serve |
|---|---|
| `queries_categoria` com `conexaoId = NULL` roda no **próprio PostgreSQL**, isolada por grupo (`queryIsoladaPorGrupo`: papel `mm_query_reader`, somente leitura, grupo protegido por `mm_query_contexto`; migrations 148 e 163). | As consultas canônicas rodam pelo mesmo caminho seguro. |
| Planejador do Pipe2: agregação (`SUM`/`AVG`, `group_by_trunc` por mês), comparação de períodos, coluna "var. %", destaques, gráfico e PDF. | Funciona sem mudança. |
| Query padrão automática (`gerarQueryPadraoMemos`, migration 150). | É o padrão a seguir: consulta gerada ou escrita pelo sistema, nunca SQL livre da IA na hora da pergunta. |
| `mymemory_parse_date` e `mymemory_parse_number` (tolera "R$ 1.500,25"). | Úteis nos conversores de planilha. |
| Biblioteca `xlsx` (`documentExtractService.ts`). | Leitura de xlsx e csv. **Atenção:** a versão 0.18.5 do npm tem falhas conhecidas (prototype pollution e ReDoS). As versões corrigidas (0.20.x) só são distribuídas pelo CDN da SheetJS. Precisa ser trocada antes de aceitar planilhas de usuários. |
| Automação de importação (`automacaoImportacaoService.ts`) vigia uma pasta local ou WebDAV. | Pode vigiar um xlsx e reimportar quando ele mudar. |
| Perfis de acesso por grupo. | Restringem quem consulta as categorias financeiras. |
| Robôs periódicos (lembretes, avisos, automação) e o sino. | Padrão para sincronização, conferência noturna e avisos como "reconecte seu banco". |

## 4. Origens

### 4.1 Três jeitos de usar planilha

| | O que é | Receita? | Arquivo do usuário |
|---|---|---|---|
| **Planilha modelo** | Arquivo nosso, com as colunas canônicas, que o usuário **preenche direto** | Não precisa | É o próprio modelo |
| **Converter para o modelo** | **Uma vez**: a IA gera um arquivo novo no nosso formato com os dados da planilha bagunçada. O usuário passa a manter esse arquivo e abandona o antigo. | Não (conversão única) | Arquivo novo |
| **Planilha livre** | O usuário continua mantendo a planilha **do jeito dele** | Sim | **Não é alterado**: a receita roda no nosso servidor e grava direto nas tabelas canônicas |

A única "duplicação" é a cópia nas nossas tabelas, que existe para qualquer origem (Pluggy também).

### 4.2 Planilha livre: receita de conversão com conferência pelos totais

**O problema.** Uma planilha pessoal pode ter qualquer forma:
- meses em colunas (Jan, Fev, Mar…);
- grupos como linhas de título ("Moradia", seguida dos itens);
- totais e subtotais no meio;
- células mescladas, linhas em branco, observações;
- duas tabelas na mesma aba.

**A solução, em três partes:**

1. **A IA monta uma "receita" de conversão, uma vez.** Ela analisa o cabeçalho e uma amostra e propõe passos simples que o **código** executa:
   - cabeçalho na linha N;
   - colunas D:O são meses, então viram linhas;
   - linha de título de grupo é copiada para baixo como coluna "grupo";
   - ignorar linhas cujo rótulo contém "total";
   - desfazer células mescladas;
   - coluna B = data, C = descrição, F = valor;
   - estas linhas pertencem à conta "Itaú CC".
2. **Conferência pelos totais da planilha.** Os totais e subtotais são descartados dos dados, mas usados para **validar** a conversão: o sistema soma o que converteu e compara com os totais que a planilha mostrava. Se bate, a conversão está certa. Se não bate, mostra a diferença antes de gravar, por exemplo "Moradia: planilha diz R$ 3.200, convertido soma R$ 2.950".
3. **O usuário confere uma vez.** Na primeira importação, ele vê o que a IA entendeu e uma **prévia da tabela já convertida**, e confirma ou corrige. A receita fica guardada.
   - Nas atualizações seguintes **roda só a receita**: sem IA, sem custo, com o mesmo resultado e com como auditar.
   - Se o layout mudar (coluna nova, cabeçalho em outro lugar), a receita falha na validação e o sistema pede para conferir de novo.

**Regra: cada receita produz dados para exatamente uma categoria.**
- Uma planilha com abas Extrato e Orçamento tem **duas receitas**.
- Uma aba com extrato e orçamento lado a lado também tem duas receitas, cada uma num intervalo da mesma aba.
- Uma categoria pode ter **várias fontes**, por exemplo Extrato vindo de dois bancos pelo Pluggy mais uma planilha da conta antiga, cada fonte com sua receita ou conversor.

**Planilha caótica demais** (painel com gráficos, várias tabelas misturadas) tem duas saídas: escolher só a aba ou o intervalo que interessa, ou "converter para o modelo".

### 4.3 xlsx enviado × planilha Google ligada

| | **xlsx ou csv enviado** | **Planilha Google ligada** |
|---|---|---|
| Natureza | Uma **foto**: os dados do momento do envio. | **Viva**: o MyMemory relê a planilha original. |
| Atualizar | Enviar de novo, ou pasta vigiada (WebDAV/OneDrive do grupo). | Verificação periódica automática. |
| Acesso | Nenhum: o arquivo vem junto com o envio. | O usuário **autoriza pela conta Google** (OAuth). |
| Liberação no Google | Não se aplica. | Depende da permissão. `drive.file` com o *Google Picker* (o usuário escolhe só aquela planilha) é a mais leve. `spreadsheets.readonly` exige verificação do app. `drive.readonly` exige avaliação de segurança paga. **Recomendo `drive.file` + Picker.** |
| Esforço | Baixo. | Médio: login do Google, token por usuário, acesso revogado. |
| Sem login | Não precisa. | "Publicar na web como CSV" gera link público. **Não recomendo para dados financeiros.** |

### 4.4 Open Finance via Pluggy

**O que é o Open Finance Brasil.** Um sistema **regulado pelo Banco Central e pelo CMN** (Resolução Conjunta nº 1/2020).
- É obrigatório para os maiores bancos e opcional para os demais.
- Todas as instituições seguem o mesmo padrão de APIs, de campos e de segurança.
- O cliente autoriza no app do próprio banco, escolhe o que compartilha e por quanto tempo, e pode revogar.
- Cobre contas, extrato, cartões, crédito, iniciação de pagamento (PIX) e **investimentos** (renda fixa, fundos, Tesouro, renda variável).

Para receber dados direto dos bancos é preciso ser **participante autorizado** pelo Banco Central, com certificados e homologação. O MyMemory não é.

**O que é o Pluggy (e concorrentes como Belvo e Quanto).** Uma empresa terceira que fica no meio: integra com os bancos via Open Finance e oferece **uma API só**. Ele trata:
- a diferença de cada banco, os certificados e a renovação de consentimento;
- uma tela de consentimento pronta (Pluggy Connect);
- extras próprios, como a categorização automática dos lançamentos.

Cobra mensalidade e/ou por conexão.

**Fluxo:**
1. **Conectar (uma vez):**
   - o proMemory pede ao Pluggy um token de conexão e abre o Pluggy Connect;
   - o usuário escolhe o banco e autoriza no app do banco;
   - o Pluggy devolve um **`itemId`**. Só isso é guardado: **nunca vemos a senha do banco**.
2. **Primeira carga:** contas (que viram `fin_contas`), lançamentos, saldos e posições de investimento.
3. **Atualização:** ver 4.7.
4. **Botão "Atualizar agora":** pede uma sincronização na hora, e o webhook avisa ao terminar.
5. **Conexão quebrada** (consentimento expirado, senha trocada): aviso no sino "reconecte seu banco".

**O que vem:**

| Dado | Observação |
|---|---|
| Lançamentos da conta | Podem vir **pendentes** e virar **efetivados**, atualizados pelo Pluggy. "Realizado" considera só os efetivados. |
| Cartão | Lançamentos e **faturas**, inclusive a aberta. Compras parceladas trazem o número da parcela. |
| Saldos | Viram fotos em `fin_saldos`. |
| Investimentos | **Posição** por ativo (vira foto em `fin_posicoes`) e movimentações. |
| Empréstimos | Contratos e parcelas a vencer. |
| **Não vem** | Títulos a pagar e a receber, boletos que vão chegar e agendamentos (não encontrados no Open Finance). |

**Por que manter os dados no nosso PostgreSQL:**
- a API não aceita consulta, só lista recursos com filtros;
- a pergunta não pode esperar chamadas externas paginadas;
- o histórico fica guardado mesmo se o consentimento expirar;
- todas as origens caem no mesmo modelo canônico.

**Custo:** relatos de desenvolvedores falam em R$ 1.500 a R$ 6.000 por mês no plano comercial; não é tabela oficial. O **Meu Pluggy** é gratuito para uso pessoal, com limites, e serve para testar com as próprias contas, com atualização manual (auto-sync só existe no plano de produção).

**LGPD:** o termo de uso precisa cobrir dados bancários, e excluir a conexão apaga os dados.

### 4.5 Organizze

App **brasileiro** de finanças pessoais com API REST pública.
- **Acesso:** o usuário gera uma chave de API (Configurações → Chaves de API), de preferência só leitura, e informa o e-mail da conta. Exige **licença paga ativa** no Organizze.
- **O que dá para ler:** lançamentos (valor em centavos, categoria, conta, cartão, pago, parcelas, recorrência, tags), contas, cartões, faturas, transferências, categorias, **metas (orçamento)** e saldos.
- **Não tem investimentos.**
- **Não aceita consulta livre:** só recursos fixos, com filtro de período (na prática, mês inteiro), conta e página.
- **Não tem webhook.**

Avaliação: conector simples, mas **limita o mercado** a quem usa o Organizze. Entra depois, sob demanda.

### 4.6 OFX e outros

**OFX:** formato dos anos 90, padronizado mas **pobre**: não tem categoria, a descrição vem cortada, não identifica a contraparte do PIX e não traz investimentos. Está sendo substituído pelo Open Finance e sobrevive por causa de contadores e ERPs antigos. **Não é aposta**: no máximo um conversor barato no fim da fila.

| Origem | Situação |
|---|---|
| B3, APIs da Área do Investidor (posição e movimentação) | Contrato de licença e tarifação (nova tabela desde 02/01/2025), voltado a fintechs. Caro e burocrático. |
| Gorila (GorilaCORE) | API só para empresas, mediante demonstração. |
| Kinvo, Mobills | Sem API pública. Entram pela planilha exportada. |

### 4.7 Sincronização: incremental, não o histórico todo

A **carga completa é só a primeira**. Depois:

| Origem | Como atualiza | Chave para não duplicar |
|---|---|---|
| **Pluggy** | Auto-sync deles (diário, ou 24/12/8 h conforme o plano). O **webhook** diz quais lançamentos foram criados, alterados ou excluídos; buscamos só esses. **Conferência noturna** dos últimos 7–30 dias, caso algum aviso se perca. | id do Pluggy (`idOrigem`), com *upsert* |
| **Organizze** | Relê só o **mês atual e o anterior**, onde as mudanças acontecem, de hora em hora ou diariamente. Conferência mais funda **semanal**. | id do Organizze, com *upsert* |
| **Planilha** (xlsx, pasta vigiada, Google) | Só reimporta quando o arquivo **mudou** (hash do arquivo). Substitui as linhas daquela fonte numa transação, o que leva segundos para milhares de linhas, e quem pergunta durante a importação vê a versão antiga inteira. Se uma planilha ficar grande: **hash por linha** e gravar só a diferença. | hash do arquivo / da linha |
| **Planilha Google** | Consulta só a data de modificação a cada ~15 min. O aviso instantâneo do Drive (`files.watch`) expira em 24 h e exige domínio verificado; só vale se 15 min incomodar. | idem |

**O aviso do webhook é tratado só como um "vá buscar":** os dados são sempre lidos na API da origem com a nossa chave, nunca do conteúdo do aviso. O aviso de lançamento do Pluggy não traz o usuário, só o `itemId`; `fontes_dados` faz essa ligação.

## 5. A IA no processo

| Momento | Papel da IA | Custo |
|---|---|---|
| Primeira importação de planilha livre | Monta a receita de conversão para a categoria escolhida | 1 chamada por receita |
| Planilha caótica | "Converter para o modelo", uma vez | 1 chamada |
| Atualizações | **Nenhum**: roda a receita | zero |
| Pergunta | Como hoje: o planejador escolhe consulta, filtros e agregação. **Não escreve SQL livre.** | como hoje |
| Opcional | Sugerir consultas extras ao dono (saldo acumulado, orçado × realizado) | sob demanda |

**Alternativa descartada:** cada lançamento virar um memo.
- 3.000 lançamentos virariam 3.000 memos poluindo Buscar e Recentes;
- custo de embeddings por memo;
- sincronizar edições e exclusões seria complicado.

## 6. Aplicação ao Softing-erp (financeiro ainda no legado)

O mesmo desenho serve, com outro foco: no MyMemory o objetivo é **perguntar**; no ERP é **operar e conciliar**.

**Aproveita direto:**
- **Extrato via Open Finance/Pluggy para a conciliação bancária.** O Pluggy tem conectores de conta PJ. O extrato chega sozinho, com webhook e conferência noturna, em vez de OFX ou CNAB importado à mão.
- **Modelo canônico de "movimento bancário"**, gravado no banco do ERP, para qualquer origem (Pluggy, OFX, CNAB de retorno, digitação), com a mesma ideia de tabela pai de contas e fotos de saldo.
- **Receita + conferência pelos totais na migração do legado:** saldos e totais do legado batidos com o migrado, conta por conta e mês a mês, antes de virar a chave.
- **A mesma peça de integração com o Pluggy** (conexão, webhook, conferência), compartilhada ou com o desenho copiado. Um único contrato com o Pluggy, se o modelo de cobrança permitir, dilui o custo comercial.

**Muda:**
- **A fonte da verdade é o ERP.** O extrato serve para **conciliar**: casar cada movimento com o título a pagar ou receber, a tarifa ou a transferência. A tela sugere casamentos por valor, data e CNPJ, e a IA pode ajudar nos difíceis.
- **Escopo:** o dado é da empresa (tenant). A LGPD pesa menos, mas a permissão por perfil (quem vê o extrato, quem pode pagar) pesa mais.
- **Planilha livre** quase não entra; no máximo para importar orçamento ou plano de contas na implantação.

### 6.1 Pagamentos: API PIX do próprio banco × Pluggy

O legado já tem pagamento PIX pela API do próprio banco, feito por um colega.

| | API do próprio banco | Pluggy (iniciação via Open Finance) |
|---|---|---|
| Quem integra | A empresa, titular da conta, com o certificado ou credencial dela nesse banco | Um terceiro, que paga em nome do cliente |
| Aprovação | Fica no contrato com o banco; dá para pagar em lote sem abrir o app a cada vez (às vezes com aprovação no internet banking) | Cada pagamento aprovado no app do banco, salvo os pré-autorizados (PIX Automático, Smart Transfers) |
| Bancos | **Um por integração**: a API de envio de PIX é própria de cada banco | **Todos** com uma integração só |
| Receber PIX (cobrança, QR, aviso de pagamento) | Sim. A API PIX de **recebimento** é padronizada pelo Banco Central entre os bancos. | Limitado |
| Custo | Só as tarifas do banco | Contrato com o Pluggy |

O que o Pluggy oferece em pagamentos:

| Ação | Suporte |
|---|---|
| PIX imediato para qualquer chave ou conta | Sim |
| PIX agendado, único ou recorrente | Sim |
| PIX Automático e Smart Transfers | Sim |
| Pagamento em lote | Anunciado; confirmar condições |
| **Pagar boleto** | **Não.** Exceção: boleto com QR Code PIX ("bolepix") |
| TED, DOC, comandos genéricos na conta | Não |

**Conclusão:**
- **Pagar e receber:** a API do próprio banco é o caminho nos bancos que o cliente mais usa, como o colega fez.
- **Ler vários bancos:** o Pluggy complementa no extrato para conciliação e nos bancos sem integração própria.
- **Boletos** (emitir cobrança ou pagar) continuam por CNAB (remessa/retorno, SISPAG e similares) ou pela API de cobrança e pagamentos de cada banco.

Próximo passo sugerido: um levantamento próprio no repositório do Softing-erp sobre o que o financeiro do legado faz hoje (contas a pagar e receber, conciliação, CNAB, boletos, PIX já implantado) e onde Open Finance e Pluggy entram ou não.

## 7. Etapas sugeridas (MyMemory)

1. **Base:**
   - tabelas canônicas (contas, movimentos, saldos, posições, orçamento) e consultas por tipo;
   - **planilha modelo** (xlsx);
   - **planilha livre** com receita por categoria, prévia e conferência pelos totais;
   - botão "Atualizar agora", data dos dados na resposta e limites por plano.

   Antes, trocar a biblioteca `xlsx`.
2. **Atualização automática do xlsx** por pasta vigiada (automação de importação).
3. **Open Finance com o Meu Pluggy**, testado com as próprias contas: conexão, primeira carga, atualização manual.
4. **Pluggy comercial:** auto-sync, webhook, conferência noturna, aviso de reconexão. Avaliar o contrato junto com o Softing-erp.
5. **Planilha Google ligada** (`drive.file` + Picker, verificação a cada 15 min).
6. **Organizze** e **OFX**, sob demanda.

## 8. Limites por plano

| Limite | Por quê |
|---|---|
| Linhas por espaço (somando as tabelas financeiras) | Volume e custo de armazenamento |
| Conexões bancárias (Pluggy) | É o custo por conexão do agregador |
| Frequência de atualização | Auto-sync de 8/12/24 h tem preço diferente no Pluggy |
| Anos de histórico guardados | Volume |
| Fontes de planilha por espaço | Processamento |

Os valores ficam para quando houver a proposta comercial do agregador.

## 9. Decisões

**Tomadas:**
- Fonte e dados por **espaço** (grupo ou pessoal), como os memos. Grupo não quer dizer PJ.
- **Receita → exatamente uma categoria**; uma categoria pode ter várias fontes.
- **Grupos de despesa como texto livre vindo da fonte**, sem lista nem de-para no começo.
- **Prever limites por plano** (linhas, conexões, frequência, histórico).
- Saldo e posição gravados como **fotos**, sob a tabela pai `fin_contas`.
- Tabelas do módulo com o prefixo **`fin_`** (de "financeiro"): agrupa as tabelas, evita confusão com outras e facilita a permissão de leitura do conjunto.

**Em aberto:**
1. Planilha com várias abas: uma fonte por aba ou uma fonte com várias receitas? Decidir quando houver casos reais.
2. Pedir proposta comercial a Pluggy, Belvo e Quanto, avaliando um contrato conjunto com o Softing-erp.
3. Valores dos limites por plano.

## Fontes

- [Organizze REST API v2](https://developers.organizze.com.br/) · [api-doc (GitHub)](https://github.com/organizze/api-doc)
- [Pluggy: cobertura de instituições](https://docs.pluggy.ai/docs/open-finance-institutions-coverage) · [Item e auto-sync](https://docs.pluggy.ai/docs/item) · [Webhooks](https://docs.pluggy.ai/docs/webhooks) · [Atualizar um Item](https://docs.pluggy.ai/docs/data-sync-update-an-item) · [Sincronização com webhooks](https://docs.pluggy.ai/docs/setup-two-way-sync-with-webhooks) · [Changelog (pendente → efetivado)](https://v2.docs.pluggy.ai/en/changelog/2026.03)
- [Pluggy: iniciação de pagamento](https://docs.pluggy.ai/docs/payment-initiation-introduction) · [PIX transacional](https://docs.pluggy.ai/docs/transactional-pix) · [Pagamentos agendados](https://docs.pluggy.ai/docs/scheduled-payments) · [PIX Automático](https://docs.pluggy.ai/docs/getting-started-with-pix-automático) · [Receber pagamento (boleto)](https://docs.pluggy.ai/docs/receiving-a-payment) · [Visão geral de pagamentos](https://v2.docs.pluggy.ai/docs/payments/overview)
- [Meu Pluggy (GitHub)](https://github.com/pluggyai/meu-pluggy) · [TabNews: custos de Open Finance](https://www.tabnews.com.br/GuilhermeVieira/estou-desenvolvendo-um-app-de-financas-pessoais-e-nao-consigo-pagar-o-open-finance-pluggy-r2-5k-mes-belvo-r6k-mes-tecnospeed-r1-5k-de-entrada-r540)
- [B3: integrações da Área do Investidor](https://b3.com.br/pt_br/produtos-e-servicos/central-depositaria/canal-com-investidores/integracoes-da-area-do-investidor-apis/) · [B3: nova tarifação (OC 177/2024)](https://b3.com.br/data/files/D8/E6/92/49/4BAB39107A1B8539AC094EA8/OC%20177-2024%20PRE%20Nova%20tarifacao%20-%20APIs%20Area%20do%20Investidor%20da%20B3%20(PT).pdf)
- [GorilaCORE](https://gorila.com.br/gorila-core)
- [Google Drive API: push](https://developers.google.com/drive/push) · [Nango: files.watch × changes.watch](https://nango.dev/docs/api-integrations/google-drive/webhooks)

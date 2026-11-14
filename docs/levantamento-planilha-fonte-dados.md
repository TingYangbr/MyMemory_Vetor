# Levantamento: fontes de dados financeiros no Perguntar (planilha, Open Finance, apps)

*Versão 2 (14/11/2026). Ainda não é desenho de implementação: é para decidir o caminho.*

## 1. Objetivo

Deixar o usuário, PF ou PJ sem SQL Server, perguntar sobre seus dados financeiros, do mesmo jeito que hoje pergunta sobre o ERP. Por exemplo:

- "Quanto gastei com mercado por mês em 2026, variação %?"
- "Orçado × realizado de outubro por grupo de despesa"
- "Quanto tenho em renda fixa e quanto rendeu no ano?"

Tipos previstos, um por categoria, como em Categorias hoje: **Extrato**, **Orçamento** e **Investimentos**.

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

**Os três modelos:**

| Tipo | Colunas canônicas |
|---|---|
| **Extrato** | data, descrição, valor (negativo = saída), grupo, conta, situação (pendente/efetivado), origem, id na origem |
| **Orçamento** | mês, grupo, item, valor orçado, origem |
| **Investimentos** | data, ativo, classe, quantidade, valor, instituição, tipo (posição/movimento), origem, id na origem |

O que for próprio de uma origem e não couber nas colunas canônicas vai para um campo `extras` (JSONB), sem se perder.

**Por que isso importa:**
- As consultas do Perguntar são **escritas e testadas uma vez por tipo**, e não geradas a cada planilha.
- Uma **origem nova** só precisa do seu conversor; as consultas não mudam.
- A **bagunça fica na entrada**: cada conversor resolve as diferenças da sua origem, e por dentro o sistema conhece um formato só.

> Isso substitui a versão 1, em que as colunas da planilha viravam campos da categoria. Aquilo só funciona com planilha já arrumada.

## 3. O que já existe e pode ser reaproveitado

| Peça atual | Como serve |
|---|---|
| `queries_categoria` com `conexaoId = NULL` roda no **próprio PostgreSQL**, isolada por grupo (`queryIsoladaPorGrupo`: papel `mm_query_reader`, somente leitura, grupo protegido por `mm_query_contexto`; migrations 148 e 163). | As tabelas canônicas ficam no PostgreSQL, e as consultas de cada tipo rodam pelo mesmo caminho seguro. |
| Planejador do Pipe2: agregação (`SUM`/`AVG`, `group_by_trunc` por mês), comparação de períodos, coluna "var. %", destaques, gráfico e PDF. | Funciona sem mudança sobre as consultas canônicas. |
| Query padrão automática (`gerarQueryPadraoMemos`, migration 150). | É o padrão a seguir: consulta gerada pelo sistema, nunca SQL livre da IA na hora da pergunta. |
| `mymemory_parse_date` e `mymemory_parse_number` (tolera "R$ 1.500,25"). | Úteis nos conversores de planilha. |
| Biblioteca `xlsx` (`documentExtractService.ts`). | Leitura de xlsx e csv. **Atenção:** a versão 0.18.5 do npm tem falhas conhecidas (prototype pollution e ReDoS). As versões corrigidas (0.20.x) só são distribuídas pelo CDN da SheetJS. Precisa ser trocada antes de aceitar planilhas de usuários. |
| Automação de importação (`automacaoImportacaoService.ts`) vigia uma pasta local ou WebDAV. | Pode vigiar um xlsx e reimportar quando ele mudar. |
| Robôs periódicos (lembretes, avisos, automação) e o sino de avisos. | Padrão para a conferência noturna e para avisos como "reconecte seu banco". |

## 4. Origens

### 4.1 Planilha livre: receita de conversão com validação pelos totais

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
   - coluna B = data, C = descrição, F = valor.
2. **Conferência pelos totais da planilha.** Os totais e subtotais são descartados dos dados, mas usados para **validar** a conversão: o sistema soma o que converteu e compara com os totais que a planilha mostrava. Se bate, a conversão está certa. Se não bate, mostra a diferença antes de gravar, por exemplo "Moradia: planilha diz R$ 3.200, convertido soma R$ 2.950".
3. **O usuário confere uma vez.** Na primeira importação, ele vê o que a IA entendeu e uma **prévia da tabela já convertida**, e confirma ou corrige. A receita fica guardada.
   - Nas atualizações seguintes **roda só a receita**: sem IA, sem custo, com o mesmo resultado e com como auditar.
   - Se o layout mudar (coluna nova, cabeçalho em outro lugar), a receita falha na validação e o sistema pede para conferir de novo.

**Planilha caótica demais** (painel com gráficos, várias tabelas misturadas) tem duas saídas: escolher só a aba ou o intervalo que interessa, ou "converter para o modelo MyMemory" (seção 4.2).

**Reimportação:** a planilha é pequena (um extrato de 5 anos tem poucos milhares de linhas). O sistema substitui todas as linhas daquela fonte numa única transação, e quem pergunta durante a importação vê a versão antiga inteira. Isso cobre linhas editadas e apagadas sem precisar de chave por linha.

### 4.2 Planilha modelo do MyMemory

Um xlsx pronto por tipo (Extrato, Orçamento, Investimentos), com as colunas canônicas. Não precisa de receita nem de conferência. É também o destino de "converter para o modelo": a IA transforma uma planilha caótica uma vez e o usuário passa a manter o modelo.

### 4.3 xlsx enviado × planilha Google ligada

| | **xlsx ou csv enviado** | **Planilha Google ligada** |
|---|---|---|
| Natureza | Uma **foto**: os dados do momento do envio. | **Viva**: o MyMemory relê a planilha original. |
| Atualizar | Enviar de novo, ou pasta vigiada (WebDAV/OneDrive do grupo). | Verificação periódica automática. |
| Acesso | Nenhum: o arquivo vem junto com o envio. | O usuário **autoriza pela conta Google** (OAuth). |
| Liberação no Google | Não se aplica. | Depende da permissão. `drive.file` com o *Google Picker* (o usuário escolhe só aquela planilha) é a mais leve. `spreadsheets.readonly` exige verificação do app. `drive.readonly` exige avaliação de segurança paga. **Recomendo `drive.file` + Picker.** |
| Esforço | Baixo. | Médio: login do Google, token por usuário, acesso revogado. |
| Sem login | Não precisa. | "Publicar na web como CSV" gera link público. **Não recomendo para dados financeiros.** |

**Atualização automática da planilha Google:**
- A cada ~15 minutos, o sistema consulta só a data de modificação do arquivo e reimporta se mudou.
- O aviso instantâneo do Drive (`files.watch`) expira em até 24 h e exige domínio verificado; só vale se 15 minutos de atraso incomodar.

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
   - o proMemory pede ao Pluggy um token de conexão para o usuário e abre o Pluggy Connect;
   - o usuário escolhe o banco e autoriza no app do banco;
   - o Pluggy devolve um **`itemId`**. Só isso é guardado: **nunca vemos a senha do banco**.
2. **Primeira carga:** com o `itemId`, o sistema busca contas, lançamentos (por período, paginados) e posições de investimento, e grava nas tabelas canônicas.
3. **Atualização:**
   - **Auto-sync:** o Pluggy sincroniza sozinho com o banco, diariamente ou a cada 24, 12 ou 8 h conforme o plano. Só existe no plano de produção.
   - **Webhook:** quando chegam dados novos, o Pluggy chama um endereço da nossa API. Há eventos para conexão atualizada, lançamentos novos, alterados e excluídos.
   - O aviso é tratado só como um "vá buscar": os dados são sempre lidos na API do Pluggy com a nossa chave, e gravados por *upsert* pelo id do lançamento.
   - O aviso de lançamento não traz o usuário, só o `itemId`. A tabela de conexões faz essa ligação.
4. **Botão "Atualizar agora":** pede uma sincronização na hora, e o webhook avisa ao terminar.
5. **Conferência noturna:** uma rotina nossa compara os últimos dias, caso algum aviso se perca. Também detecta conexão quebrada (consentimento expirado, senha trocada) e avisa no sino "reconecte seu banco".

**O que vem:**

| Dado | Observação |
|---|---|
| Lançamentos da conta | Podem vir **pendentes** e virar **efetivados**, atualizados pelo Pluggy. "Realizado" considera só os efetivados. |
| Cartão | Lançamentos e **faturas**, inclusive a aberta. Compras parceladas trazem o número da parcela. |
| Saldos | Foto do momento, não são lançamentos. |
| Investimentos | **Posição** por ativo e movimentações. |
| Empréstimos | Contratos e parcelas a vencer. |
| **Não vem** | Títulos a pagar e a receber, boletos que vão chegar e agendamentos (não encontrados no Open Finance). |

**Por que manter os dados no nosso PostgreSQL:**
- a API não aceita consulta, só lista recursos com filtros;
- a pergunta não pode esperar chamadas externas paginadas;
- o histórico fica guardado mesmo se o consentimento expirar;
- todas as origens caem no mesmo modelo canônico.

**Custo:** relatos de desenvolvedores falam em R$ 1.500 a R$ 6.000 por mês no plano comercial; não é tabela oficial. O **Meu Pluggy** é gratuito para uso pessoal, com limites, e serve para testar com as próprias contas, com atualização manual.

**LGPD:**
- a fonte é **do usuário** por padrão, não do grupo;
- o termo de uso precisa cobrir isso;
- excluir a conexão apaga os dados.

### 4.5 Organizze

App **brasileiro** de finanças pessoais com API REST pública.
- **Acesso:** o usuário gera uma chave de API (Configurações → Chaves de API), de preferência só leitura, e informa o e-mail da conta. Exige **licença paga ativa** no Organizze.
- **O que dá para ler:** lançamentos (valor em centavos, categoria, conta, cartão, pago, parcelas, recorrência, tags), contas, cartões, faturas, transferências, categorias, **metas (orçamento)** e saldos.
- **Não tem investimentos.**
- **Não aceita consulta livre:** só recursos fixos, com filtro de período (na prática, mês inteiro), conta e página.
- **Não tem webhook:** a sincronização é periódica (de hora em hora ou diária), mais o botão "Atualizar agora".

Avaliação: conector simples, mas **limita o mercado** a quem usa o Organizze. Entra depois, sob demanda.

### 4.6 OFX (extra)

Formato dos anos 90, padronizado mas **pobre**: não tem categoria, a descrição vem cortada, não identifica a contraparte do PIX e não traz investimentos. Está sendo substituído pelo Open Finance e sobrevive por causa de contadores e ERPs antigos. **Não é aposta**: no máximo um conversor barato no fim da fila.

### 4.7 Outros

| Origem | Situação |
|---|---|
| B3, APIs da Área do Investidor (posição e movimentação) | Contrato de licença e tarifação (nova tabela desde 02/01/2025), voltado a fintechs. Caro e burocrático. |
| Gorila (GorilaCORE) | API só para empresas, mediante demonstração. |
| Kinvo, Mobills | Sem API pública. Entram pela planilha exportada. |

## 5. A IA no processo

| Momento | Papel da IA | Custo |
|---|---|---|
| Primeira importação de planilha livre | Monta a receita de conversão e sugere o tipo (Extrato, Orçamento, Investimentos) | 1 chamada por planilha |
| Planilha caótica | "Converter para o modelo MyMemory", uma vez | 1 chamada |
| Atualizações | **Nenhum**: roda a receita | zero |
| Pergunta | Como hoje: o planejador escolhe consulta, filtros e agregação. **Não escreve SQL livre.** | como hoje |
| Opcional | Sugerir consultas extras ao dono (saldo acumulado, orçado × realizado) | sob demanda |

## 6. Desenho de tabelas (para discutir)

```
fontes_dados        (id, groupId, userId, categoryId, tipo: extrato|orcamento|investimentos,
                     origem: planilha|modelo|gsheet|pluggy|organizze|ofx,
                     nome, config JSON [aba, intervalo, receita, itemId…],
                     ultimaSync, hashConteudo, status, erro)
fin_extrato         (fonteId, groupId, userId, data, descricao, valor, grupo, conta,
                     situacao, idOrigem, extras JSONB)
fin_orcamento       (fonteId, groupId, userId, mes, grupo, item, valorOrcado, extras JSONB)
fin_investimentos   (fonteId, groupId, userId, data, ativo, classe, quantidade, valor,
                     instituicao, tipo, idOrigem, extras JSONB)
```

- Cada tabela tem a mesma proteção por grupo e usuário dos memos, com `SELECT` liberado para `mm_query_reader`.
- **Consultas canônicas por tipo**, escritas uma vez: gasto por período e grupo, orçado × realizado (junta `fin_orcamento` e `fin_extrato`), posição por classe, evolução mensal.
- O Perguntar não muda: o planejador vê a categoria Extrato com suas consultas, como vê Faturamento.

**Alternativa descartada:** cada linha virar um memo.
- 3.000 lançamentos virariam 3.000 memos poluindo Buscar e Recentes;
- custo de embeddings por memo;
- sincronizar edições e exclusões seria complicado.

## 7. Aplicação ao Softing-erp (financeiro ainda no legado)

O mesmo desenho serve, com outro foco: no MyMemory o objetivo é **perguntar**; no ERP é **operar e conciliar**.

**Aproveita direto:**
- **Extrato via Open Finance/Pluggy para a conciliação bancária.** O Pluggy tem conectores de conta PJ. O extrato chega sozinho, com webhook e conferência noturna, em vez de OFX ou CNAB importado à mão.
- **Modelo canônico de "movimento bancário"**, gravado no banco do ERP, para qualquer origem (Pluggy, OFX, CNAB de retorno, digitação).
- **Receita + conferência pelos totais na migração do legado:** saldos e totais do legado batidos com o migrado, conta por conta e mês a mês, antes de virar a chave.
- **A mesma peça de integração com o Pluggy** (conexão, webhook, conferência), compartilhada ou com o desenho copiado. Um único contrato com o Pluggy, se o modelo de cobrança permitir, dilui o custo comercial.

**Muda:**
- **A fonte da verdade é o ERP.** O extrato serve para **conciliar**: casar cada movimento com o título a pagar ou receber, a tarifa ou a transferência. A tela sugere casamentos por valor, data e CNPJ, e a IA pode ajudar nos difíceis.
- **Pagamentos.** O Pluggy tem **iniciação de pagamento por PIX**:

  | Ação | Suporte |
  |---|---|
  | PIX imediato para qualquer chave ou conta (é a "transferência") | Sim |
  | PIX agendado, único ou recorrente | Sim |
  | PIX Automático e Smart Transfers (pré-autorizados, sem aprovar cada vez) | Sim |
  | Pagamento em lote | Anunciado; confirmar condições |
  | **Pagar boleto** | **Não.** Exceção: boleto com QR Code PIX ("bolepix") |
  | TED, DOC, comandos genéricos na conta | Não |

  Cada pagamento é **autorizado pelo usuário no app do banco**, exceto os pré-autorizados dentro dos limites aprovados. Combina com contas a pagar com aprovação e é mais seguro que guardar senha de banco.
- **Boletos** (emitir cobrança ou pagar) continuam fora do Open Finance: CNAB (remessa/retorno, SISPAG e similares) ou API de cobrança e pagamentos de cada banco.
- **Escopo:** o dado é da empresa (tenant). A LGPD pesa menos, mas a permissão por perfil (quem vê o extrato, quem pode pagar) pesa mais.
- **Planilha livre** quase não entra; no máximo para importar orçamento ou plano de contas na implantação.

Próximo passo sugerido: um levantamento próprio no repositório do Softing-erp sobre o que o financeiro do legado faz hoje (contas a pagar e receber, conciliação, CNAB, boletos) e onde Open Finance e Pluggy entram ou não.

## 8. Etapas sugeridas (MyMemory)

1. **Base:**
   - tabelas canônicas e consultas por tipo;
   - **planilha modelo** (xlsx);
   - **planilha livre** com receita, prévia e conferência pelos totais;
   - botão "Atualizar agora" e data dos dados na resposta.

   Antes, trocar a biblioteca `xlsx`.
2. **Atualização automática do xlsx** por pasta vigiada (automação de importação).
3. **Open Finance com o Meu Pluggy**, testado com as próprias contas: conexão, primeira carga, atualização manual.
4. **Pluggy comercial:** auto-sync, webhook, conferência noturna, aviso de reconexão. Avaliar o contrato junto com o Softing-erp.
5. **Planilha Google ligada** (`drive.file` + Picker, verificação a cada 15 min).
6. **Organizze** e **OFX**, sob demanda.

## 9. Decisões em aberto

1. A fonte é do **usuário** por padrão (recomendado para dados financeiros PF) ou do **grupo** (PJ)?
2. Planilha com várias abas vira **uma fonte por aba**?
3. Limite de linhas e de conexões bancárias por plano?
4. Contratar o Pluggy (ou concorrente) em conjunto para MyMemory e Softing-erp? Pedir proposta comercial a Pluggy, Belvo e Quanto.
5. Os grupos das despesas: usar a categorização do Pluggy, uma lista nossa ou a do usuário?

## Fontes

- [Organizze REST API v2](https://developers.organizze.com.br/) · [api-doc (GitHub)](https://github.com/organizze/api-doc)
- [Pluggy: cobertura de instituições](https://docs.pluggy.ai/docs/open-finance-institutions-coverage) · [Item e auto-sync](https://docs.pluggy.ai/docs/item) · [Webhooks](https://docs.pluggy.ai/docs/webhooks) · [Atualizar um Item](https://docs.pluggy.ai/docs/data-sync-update-an-item) · [Sincronização com webhooks](https://docs.pluggy.ai/docs/setup-two-way-sync-with-webhooks) · [Changelog (pendente → efetivado)](https://v2.docs.pluggy.ai/en/changelog/2026.03)
- [Pluggy: iniciação de pagamento](https://docs.pluggy.ai/docs/payment-initiation-introduction) · [PIX transacional](https://docs.pluggy.ai/docs/transactional-pix) · [Pagamentos agendados](https://docs.pluggy.ai/docs/scheduled-payments) · [PIX Automático](https://docs.pluggy.ai/docs/getting-started-with-pix-automático) · [Receber pagamento (boleto)](https://docs.pluggy.ai/docs/receiving-a-payment) · [Visão geral de pagamentos](https://v2.docs.pluggy.ai/docs/payments/overview)
- [Meu Pluggy (GitHub)](https://github.com/pluggyai/meu-pluggy) · [TabNews: custos de Open Finance](https://www.tabnews.com.br/GuilhermeVieira/estou-desenvolvendo-um-app-de-financas-pessoais-e-nao-consigo-pagar-o-open-finance-pluggy-r2-5k-mes-belvo-r6k-mes-tecnospeed-r1-5k-de-entrada-r540)
- [B3: integrações da Área do Investidor](https://b3.com.br/pt_br/produtos-e-servicos/central-depositaria/canal-com-investidores/integracoes-da-area-do-investidor-apis/) · [B3: nova tarifação (OC 177/2024)](https://b3.com.br/data/files/D8/E6/92/49/4BAB39107A1B8539AC094EA8/OC%20177-2024%20PRE%20Nova%20tarifacao%20-%20APIs%20Area%20do%20Investidor%20da%20B3%20(PT).pdf)
- [GorilaCORE](https://gorila.com.br/gorila-core)
- [Google Drive API: push](https://developers.google.com/drive/push) · [Nango: files.watch × changes.watch](https://nango.dev/docs/api-integrations/google-drive/webhooks)

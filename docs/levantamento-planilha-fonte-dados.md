# Levantamento: planilha como fonte de dados do Perguntar

*14/11/2026. Ainda não é desenho de implementação: é para decidir o caminho.*

## 1. Objetivo

Deixar o usuário, PF ou PJ sem SQL Server, perguntar sobre dados que ele mantém numa planilha, do mesmo jeito que hoje pergunta sobre o ERP. Por exemplo:

- "Quanto gastei com mercado por mês em 2026, variação %?"
- "Orçado × realizado de outubro por grupo de despesa"
- "Quanto tenho em renda fixa e quanto rendeu no ano?"

Tipos previstos, um por categoria, como em Categorias hoje: **Extrato**, **Orçamento** e **Investimentos**.

## 2. O que já existe e pode ser reaproveitado

| Peça atual | Como serve para planilha |
|---|---|
| `queries_categoria` com `conexaoId = NULL` roda no **próprio PostgreSQL**, isolada por grupo (`queryIsoladaPorGrupo`: papel `mm_query_reader`, somente leitura, grupo protegido por `mm_query_contexto`; migrations 148 e 163). | As linhas da planilha ficam numa tabela do PostgreSQL. A query da categoria lê essa tabela no mesmo caminho seguro. |
| **Query padrão automática** (`gerarQueryPadraoMemos` em `packages/shared/src/queryPadrao.ts`, migration 150) gera o SQL a partir dos campos da categoria: filtro por texto, faixa de data e faixa de número. Ela se regenera quando os campos mudam. | Um gerador irmão, `gerarQueryPadraoPlanilha`, faz o mesmo a partir das colunas da planilha. |
| Planejador do Pipe2: agregação (`SUM`/`AVG`, `group_by_trunc` por mês), comparação de períodos, coluna "var. %", destaques, gráfico e PDF. | Funciona sem mudança: o planejador só precisa de uma query com colunas tipadas. |
| `mymemory_parse_date` e `mymemory_parse_number` (este último tolera "R$ 1.500,25"). | Datas e valores no formato brasileiro, comuns em planilha, já são tratados. |
| Biblioteca `xlsx` já instalada (`documentExtractService.ts`). | Leitura de xlsx e csv. **Atenção:** a versão 0.18.5 do npm tem falhas conhecidas (prototype pollution e ReDoS). As versões corrigidas (0.20.x) só são distribuídas pelo CDN da SheetJS. Isso precisa ser resolvido antes de ler planilhas enviadas por usuários. |
| Automação de importação (`automacaoImportacaoService.ts`) vigia uma pasta local ou WebDAV e importa arquivos novos. | Pode vigiar um xlsx numa pasta e reimportar quando ele mudar. |

## 3. As quatro dúvidas

### 3.1 Qual a diferença entre usar um xlsx e uma planilha Google ligada?

| | **xlsx ou csv enviado** | **Planilha Google ligada** |
|---|---|---|
| Natureza | Uma **foto**: os dados do momento do envio. | **Viva**: o MyMemory relê a planilha original. |
| Atualizar | Enviar de novo. Também pode ser automático se o arquivo estiver numa pasta vigiada (WebDAV/OneDrive do grupo, ver 3.2). | Automático, por verificação periódica. |
| Acesso | Nenhum: o arquivo vem junto com o envio. | Exige que o usuário **autorize o acesso pela conta Google** (OAuth). |
| Liberação no Google | Não se aplica. | Depende da permissão pedida. `drive.file` com o *Google Picker* (o usuário escolhe só aquela planilha) é a mais leve. `spreadsheets.readonly` exige verificação do app pelo Google. `drive.readonly` exige avaliação de segurança paga. **Recomendo `drive.file` + Picker.** |
| Fórmulas | Lê o valor calculado que foi salvo no arquivo. | A API devolve o valor já calculado. |
| Várias abas | Sim. | Sim. |
| Esforço | Baixo: reaproveita o upload e a leitura de xlsx. | Médio: tela de login do Google, guardar o token de cada usuário, renovar acesso, tratar acesso revogado. |
| Alternativa sem login | Não precisa. | "Publicar na web como CSV" gera um link público. **Não recomendo para dados financeiros**: qualquer pessoa com o link vê os dados. |

**Recomendação:** começar pelo **xlsx/csv**, que também atende quem exporta do banco ou de outro app. A planilha Google entra numa segunda etapa.

### 3.2 Dá para atualizar o PostgreSQL automaticamente quando a planilha muda?

Sim. O jeito depende da origem:

- **Planilha Google: verificação periódica (recomendado).** A cada N minutos (15, por exemplo), o robô consulta só a data de modificação do arquivo, uma chamada barata. Se mudou, relê a planilha e reimporta. Isso se encaixa no padrão dos robôs que já existem (lembretes, avisos, automação de importação).
- **Planilha Google: aviso instantâneo (*push*).** A API do Drive (`files.watch`) chama um endereço do MyMemory quando o arquivo muda. Custos disso:
  - o canal de aviso **expira em até 24 h** e precisa ser renovado;
  - o domínio precisa ser verificado no Google;
  - o aviso só diz *que* mudou, não *o que* mudou; é preciso reler de qualquer jeito.

  Só vale a pena se 15 minutos de atraso incomodar.
- **xlsx numa pasta vigiada.** A automação de importação passa a reconhecer "este arquivo já é uma fonte de dados" e, quando a data ou o hash do arquivo muda, reimporta em vez de criar memo.
- **Sempre:** um botão **"Atualizar agora"** na fonte, e a data da última atualização mostrada na resposta do Perguntar, por exemplo "dados da planilha de 14/11 10:32".

**Como reimportar.** Planilha pessoal é pequena (um extrato de 5 anos tem poucos milhares de linhas). O mais simples e seguro é **substituir todas as linhas daquela fonte numa única transação**: apaga e insere de novo, e quem pergunta durante a importação vê a versão antiga inteira. Isso cobre de graça as linhas apagadas e editadas na planilha, sem precisar de chave por linha.

### 3.3 A IA consegue montar as queries direto a partir das colunas da planilha?

Sim, de duas formas. Proponho usar as duas, cada uma no seu momento:

1. **Na primeira importação, a IA faz o mapeamento** (uma chamada só, com cabeçalho e uma amostra de ~20 linhas). Ela:
   - acha a linha do cabeçalho, ignorando título e linhas em branco acima;
   - define o tipo de cada coluna (data, valor em R$, quantidade, texto, categoria);
   - aponta linhas que não são dados, como "Total" e subtotais;
   - sugere o tipo (Extrato, Orçamento ou Investimentos) e nomes amigáveis para as colunas.

   O usuário confere numa tela parecida com o de-para do ERP e confirma.
2. **A query é gerada pelo sistema, não escrita pela IA.** Com as colunas tipadas, o `gerarQueryPadraoPlanilha` monta o SQL de forma determinística, como a Query padrão das categorias faz hoje. Na hora da pergunta, o planejador escolhe filtros e agregação (soma por mês, comparação de períodos), como já faz com o ERP. Isso mantém o que já funciona: a IA não escreve SQL livre na hora da pergunta, então não erra sintaxe nem consegue ler fora do grupo.

Opcional: na tela de mapeamento, a IA pode **sugerir queries extras** para o dono aprovar, como saldo acumulado ou orçado × realizado juntando duas planilhas.

### 3.4 Existem apps de controle financeiro e de investimentos com API para integrar?

Sim, mas poucos são abertos para quem não é empresa. Resumo do que achei:

| Origem | O que oferece | Acesso | Avaliação |
|---|---|---|---|
| **Organizze** | API REST v2 (contas, categorias, lançamentos, cartões). | Chave de API criada pelo próprio usuário (Configurações → Chaves de API), com opção só leitura. Exige licença ativa no Organizze. | **Melhor candidato a primeiro conector.** O usuário cola a chave e pronto. |
| **Open Finance via Pluggy** (ou Belvo) | Extrato bancário, cartões e investimentos direto dos bancos, com consentimento regulado pelo Banco Central. | Comercial: relatos de desenvolvedores falam em R$ 1.500 a R$ 6.000 por mês. O **Meu Pluggy** é gratuito para uso pessoal, com limites, e o titular precisa conectar as contas lá primeiro. | Ótimo quando houver volume de usuários. Para teste pessoal, o Meu Pluggy serve. |
| **B3, APIs da Área do Investidor** | Posição e movimentação de ações, FIIs, Tesouro e renda fixa, com autorização do investidor. | Contrato de licença com a B3 e tarifação (nova tabela desde 02/01/2025). Voltado a fintechs e instituições. | Caro e burocrático para começar. |
| **Gorila** (GorilaCORE) | Consolidação de investimentos via API. | Empresarial, começa com uma demonstração. | Fora do alcance agora. |
| **Kinvo, Mobills** | Não achei API pública. | Exportação manual (csv/xlsx). | Entra pelo caminho da planilha. |

**Conclusão:** a planilha resolve todos os casos agora, já que quase todo app e banco exporta xlsx ou csv. O Organizze seria o primeiro conector direto, se você ou os usuários usarem. O Open Finance fica para quando houver escala, mas o desenho já deve prever uma "fonte" que não seja planilha.

## 4. Desenho proposto (para discutir)

**Ideia central:** criar um novo tipo de **fonte de dados ligada a uma categoria**, ao lado de "memos" e "conexão ERP".

```
planilha_fontes   (id, groupId, userId, categoryId, origem: xlsx|csv|gsheet|organizze…,
                   nome, aba, linhaCabecalho, mapeamento JSON [coluna → campo, tipo, formato],
                   ultimaSync, hashConteudo, status, erro)
planilha_linhas   (fonteId, groupId, userId, dados JSONB, importadoEm)
                   → mesma proteção por grupo dos memos; SELECT liberado para mm_query_reader
```

- **Colunas da planilha = campos da categoria.** Elas aparecem no painel do grupo como os campos de hoje, marcados como "vêm da planilha".
- **Query padrão da categoria** gerada por `gerarQueryPadraoPlanilha`, lendo de `planilha_linhas` (`l.dados->>'Valor'`, com `mymemory_parse_number` e `mymemory_parse_date`).
- O **Perguntar** não muda: o planejador vê a categoria Extrato com sua query, como vê Faturamento.

**Alternativa considerada: cada linha vira um memo** (sem IA, com os dados específicos preenchidos). Vantagem: reaproveita 100% do que existe, inclusive o Buscar. Desvantagens:

- um extrato de 3.000 linhas viraria 3.000 memos poluindo Buscar e Recentes;
- custo de embeddings por memo;
- sincronizar edições e exclusões da planilha seria complicado.

**Não recomendo.**

### Exemplos de mapeamento

| Categoria | Colunas típicas | Perguntas que passam a funcionar |
|---|---|---|
| Extrato | Data, Descrição, Categoria/Grupo, Valor (±), Conta | Gasto por mês e por grupo, variação %, maiores despesas, recorrentes |
| Orçamento | Mês, Grupo, Valor orçado | Orçado × realizado (cruzando com Extrato), estouros |
| Investimentos | Data, Ativo, Classe, Qtde, Preço/Valor, Instituição | Posição por classe, evolução mensal, rentabilidade aproximada |

## 5. Etapas sugeridas

1. **Base:** tabelas, importação de xlsx/csv com tela de mapeamento (IA sugere, usuário confirma), query padrão gerada e botão "Atualizar agora". Antes, atualizar a biblioteca `xlsx`.
2. **Atualização automática do xlsx** pela automação de importação (pasta WebDAV/OneDrive) e data dos dados na resposta.
3. **Planilha Google ligada** (OAuth `drive.file` + Picker, verificação a cada 15 min).
4. **Conector Organizze** (chave do usuário, importa lançamentos para a mesma tabela).
5. **Open Finance** (Meu Pluggy para teste; plano comercial quando houver escala).

## 6. Decisões em aberto

1. A fonte pertence ao **grupo** (todos do grupo perguntam) ou ao **usuário** (só o dono vê, como "Pessoal")? Para PF provavelmente usuário; para PJ, grupo.
2. Uma planilha com várias abas (extrato e orçamento no mesmo arquivo) vira **uma fonte por aba**?
3. Limite de linhas por plano (por exemplo 20 mil no PF básico)?
4. O Organizze é usado por você ou pelos usuários-alvo? Isso define se a etapa 4 sobe de prioridade.

## Fontes

- [Organizze REST API v2](https://developers.organizze.com.br/)
- [Pluggy: cobertura de instituições no Open Finance](https://docs.pluggy.ai/docs/open-finance-institutions-coverage)
- [Meu Pluggy (GitHub)](https://github.com/pluggyai/meu-pluggy)
- [TabNews: custos de Open Finance para app pessoal](https://www.tabnews.com.br/GuilhermeVieira/estou-desenvolvendo-um-app-de-financas-pessoais-e-nao-consigo-pagar-o-open-finance-pluggy-r2-5k-mes-belvo-r6k-mes-tecnospeed-r1-5k-de-entrada-r540)
- [B3: integrações da Área do Investidor (APIs)](https://b3.com.br/pt_br/produtos-e-servicos/central-depositaria/canal-com-investidores/integracoes-da-area-do-investidor-apis/)
- [B3: nova tarifação das APIs da Área do Investidor (OC 177/2024)](https://b3.com.br/data/files/D8/E6/92/49/4BAB39107A1B8539AC094EA8/OC%20177-2024%20PRE%20Nova%20tarifacao%20-%20APIs%20Area%20do%20Investidor%20da%20B3%20(PT).pdf)
- [GorilaCORE](https://gorila.com.br/gorila-core)
- [Google Drive API: notificações de mudança (push)](https://developers.google.com/drive/push)
- [Nango: files.watch × changes.watch e expiração](https://nango.dev/docs/api-integrations/google-drive/webhooks)

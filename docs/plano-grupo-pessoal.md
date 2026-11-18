# Plano — Grupo pessoal automático e catálogo de modelos

*18/11/2026 · plano para revisão, nada implementado. Decisão de origem: `docs/estudo-categorias-plugin.md` e conversa de 18/11.*

## 1. Objetivo em 1 minuto

- **Todo usuário é dono do próprio espaço desde o cadastro.** O sistema cria um **grupo pessoal** automático (na tela: "Meu espaço"), com o usuário como owner. Ele tem tudo o que um owner tem — modelos, categorias próprias, lembretes, perfis — sem precisar "virar dono" de um grupo.
- **Memo e categoria de usuário sempre têm grupo.** O caso especial "grupo vazio = pessoal, filtra pelo autor" deixa de existir.
- **As únicas categorias sem grupo são os modelos do catálogo** (as globais de hoje): moldes copiados ao habilitar, sem memos.
- **O plano (assinatura) libera recursos, não o papel.** Base para cobrar por modelo no futuro.

## 2. Como é hoje (lido no código)

| Ponto | Hoje |
| --- | --- |
| Memo pessoal | `memos.groupid = NULL`, filtrado por `userid` |
| Categorias do pessoal | Só as globais (`categories.groupid IS NULL`); não existe categoria "de uma pessoa" |
| Globais | Carregadas para todos (grupos e pessoal); só o admin edita |
| Grupo | Exige `groups.subscriptionid` (assinatura); dono = `group_members.role = 'owner'` |
| Assinatura | `subscriptions.type` = `individual` (pessoal) ou `group`; o cadastro cria a `individual` |
| Quem edita categorias | Admin, owner de grupo ou dono de assinatura `group` (`memoContextAccess`) |
| Lembretes | **Não funcionam no pessoal:** a regra exige categoria com grupo (`lembreteService`) |
| Espaço de trabalho | `users.lastworkspacegroupid`; `null` = pessoal |

**Tamanho:** cerca de **130 pontos em 32 arquivos** do servidor tratam o grupo vazio (`groupId IS NULL`, `IS NOT DISTINCT FROM`, `groupId == null`), mais a tela (`workspaceGroupId == null`). Os maiores: `memoService` (18), `memoContextService` (17), `textMemoProcessService` (12), `textMemoMaxSummary` (10), `perguntas` (9), `perguntaModelos` (8), `memoSearchService` (7), `acessoQueriesService` (6).

Esses pontos são de três tipos, e cada tipo muda de um jeito:

| Tipo | Exemplo | Depois da mudança |
| --- | --- | --- |
| **A. Escopo do memo** | `(groupid IS NULL AND userid = ?)` = "meus memos pessoais" | Vira `groupid = <grupo pessoal>` — igual a qualquer grupo |
| **B. Globais junto com as do grupo** | `groupId IS NULL OR groupId = ?` nas categorias | Tira o `IS NULL` (o catálogo não entra mais nas consultas) |
| **C. Regras só de grupo** | lembrete, chaves de API, armazenamento, perfis exigem grupo | Passam a valer no pessoal sem mudança (ele agora é grupo) |

## 3. Decisões a tomar antes de codificar

1. **Assinatura do grupo pessoal.** `groups.subscriptionid` é obrigatório. Proposta: o grupo pessoal aponta para a assinatura **individual** do usuário. Cuidado: limites e custos hoje distinguem `individual` × `group` (`mediaLimitsService`, `userUsageService`, `adminCostReportService`) — o grupo pessoal tem de continuar contando como individual.
2. **Marca do grupo pessoal.** Nova coluna `groups.pessoal` (1 = pessoal). Ele não aparece em "convidar pessoas" até o usuário decidir abrir o espaço para outros — ou nunca (abrir = criar grupo novo). *Proposta: nunca; para compartilhar, cria-se um grupo.*
3. **Quem vira membro.** Só o dono. Admin do sistema continua vendo tudo pela regra de admin.
4. **Categorias globais que os memos pessoais usam.** Na migração, cada usuário recebe **cópias** (com origem) só das globais em que já tem memos. As demais ficam no catálogo para ele habilitar.
5. **"Contexto pessoal" dentro de grupos** (`groups.allowpersonalcontext`): verificar o que faz hoje antes de migrar (não li o uso).
6. **Nome na tela:** "Meu espaço" (sugestão).

## 4. Etapas

Cada etapa é publicada e testada antes da próxima. As etapas 1 e 2 não mudam o comportamento de ninguém.

| # | Etapa | O que muda | Risco |
| --- | --- | --- | --- |
| 0 | **Rede de segurança** | Conjunto de perguntas e telas de teste com respostas esperadas (busca, Perguntar, comandos, lembretes, custos) rodado numa **cópia do banco de produção** | — |
| 1 | **Catálogo (Etapa A do estudo)** | Global marcada "só catálogo" com descrição, exemplos e versão; Habilitar = copiar para um grupo com origem; tela "Modelos prontos". Globais antigas continuam visíveis | Baixo |
| 2 | **Criar o grupo pessoal** | Migration cria o grupo pessoal de cada usuário (e o cadastro passa a criar). **Nada é movido ainda**: o grupo existe, vazio | Baixo |
| 3 | **Ler dos dois jeitos** | Código do tipo A aceita memo pessoal com grupo vazio **ou** no grupo pessoal; espaço "pessoal" na tela passa a ser o grupo pessoal | Médio |
| 4 | **Mover os dados** | Memos pessoais (`groupid NULL`) → grupo pessoal; cópia das globais em uso (decisão 4); vetores de busca, alterações, relações, lembretes acompanham. Primeiro um usuário de teste, depois todos | **Alto** — testar na cópia do banco antes |
| 5 | **Esconder as globais** | Tipo B: tira o `groupId IS NULL` das consultas; globais viram só catálogo | Médio |
| 6 | **Limpar** | Remove os caminhos de grupo vazio que sobraram; `memos.groupid` passa a NOT NULL | Baixo, se 3–5 estiverem certas |

## 5. Testes e volta atrás

- **Antes/depois na cópia do banco:** as mesmas perguntas devem trazer os mesmos memos; contagens por usuário (memos, custos) iguais.
- **Volta atrás da etapa 4:** guardar, na migration, o `groupid` original de cada memo movido (tabela de controle), para desfazer.
- **Usuário de teste primeiro**, depois os demais.
- **Pontos de atenção:** busca semântica (vetores com `groupid`), Pipe 2 (queries com `:groupId IS NULL`), importação em lote, relatórios de custo, chaves de API por grupo.

## 6. O que fica mais simples depois

- Lembretes, perfis, chaves de API, armazenamento e modelos passam a valer também no pessoal, sem código à parte.
- Cobrança por plano do espaço e por modelo.
- Uma regra de escopo só ("memos do grupo X") em vez de duas.

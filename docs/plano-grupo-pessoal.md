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

## 2.1 Assinaturas, créditos e limites hoje (lido no código em 18/11)

| Regra | Como funciona hoje | Onde |
| --- | --- | --- |
| Assinatura do usuário | Todo cadastro cria uma assinatura **individual** (plano escolhido no cadastro) | `routes/auth.ts` |
| Assinatura do grupo | **Outra assinatura, adicional**, do tipo `group`, paga pelo dono do grupo; o grupo aponta para ela (`groups.subscriptionid`) | `groupService` |
| Membro de grupo | Entra com a **própria** assinatura individual | `groupInviteService.hasActiveIndividualSubscription` |
| **Créditos de IA do mês** | Contados **por pessoa**, somando tudo o que ela fez (pessoal e todos os grupos). Limite = o do **plano individual** dela; o plano do grupo só vale para quem não tem individual. **Não somam** dono + membros. Hoje o limite só avisa, não bloqueia | `userUsageService` |
| Nº de memos e armazenamento | Por pessoa, somando tudo; limite do plano individual | `userUsageService` |
| Tamanho de arquivo (áudio, vídeo…) | **Pelo espaço em uso:** no pessoal vale o plano individual; dentro do grupo vale o plano do grupo | `mediaLimitsService.resolvePlanIdForUserWorkspace` |
| Custo no relatório de assinaturas (admin) | Assinatura individual = gasto do dono **nos memos sem grupo**; assinatura de grupo = gasto **só do dono** dentro daquele grupo. O gasto dos membros dentro do grupo não aparece em nenhuma linha | `routes/adminSubscriptions.ts` |

**O que é pouco intuitivo hoje:** o plano do grupo define o tamanho de arquivo, mas não os créditos; e no relatório o gasto dos membros dentro do grupo não é atribuído a nenhuma assinatura.

**Impacto do grupo pessoal (se ele apontar para a assinatura individual):**

- **Tamanho de arquivo:** passa a sair do mesmo lugar para todos (`grupo → assinatura → plano`); o pessoal continua com o plano individual. Simplifica.
- **Créditos, memos, armazenamento:** contados por pessoa — **não mudam**.
- **Relatório de assinaturas:** a regra "individual = memos sem grupo" quebra e tem de virar "individual = memos do grupo pessoal" (mesma junção usada para grupo). Simplifica.
- **Quem edita categorias** (`memoContextAccess`): todo usuário passa a ser owner do próprio grupo pessoal, então pode criar categorias no espaço dele. Desejado.
- **Listas do admin** (grupos, assinaturas de grupo, contagens): têm de **filtrar os grupos pessoais**, senão cada usuário aparece como um grupo.

**Decisões de negócio que continuam abertas (independentes desta migração):**

- Créditos do grupo: o plano do grupo deve dar créditos que **os membros usam** dentro do grupo (um "pote" do grupo), ou cada um continua gastando do próprio plano?
- O gasto dos membros dentro do grupo deve aparecer na conta do grupo no relatório?

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

### Andamento

- **Etapas 1 e 2 implementadas (local, migration 177):** `groups.tipo` (normal / pessoal / catalogo) e `groups.pessoal_userid`; grupo "Catálogo de modelos" (sem assinatura nem membros); grupo pessoal "Meu espaço" para cada usuário, ligado à assinatura individual, **sem membros e sem memos** (o cadastro também cria). Listas de grupos (espaço de trabalho, painel, admin, assinaturas) e o "é dono de algum grupo" ignoram os grupos pessoal e catálogo.
- **Catálogo:** modelos são categorias do grupo catálogo, com `modelo_resumo`, `modelo_exemplos`, `modelo_versao`. O admin publica pela edição da categoria ("Publicar no catálogo de modelos…"; mesmo nome = nova versão). O dono habilita em Categorias → "Modelos prontos" (cópia com `origem_categoria_id` e `origem_versao`). Rotas em `routes/catalogoModelos.ts`.
- Decisão tomada: os membros do grupo pessoal só entram na etapa 3 (assim nada muda agora).

## 5. Testes e volta atrás

- **Antes/depois na cópia do banco:** as mesmas perguntas devem trazer os mesmos memos; contagens por usuário (memos, custos) iguais.
- **Volta atrás da etapa 4:** guardar, na migration, o `groupid` original de cada memo movido (tabela de controle), para desfazer.
- **Usuário de teste primeiro**, depois os demais.
- **Pontos de atenção:** busca semântica (vetores com `groupid`), Pipe 2 (queries com `:groupId IS NULL`), importação em lote, relatórios de custo, chaves de API por grupo.

## 6. O que fica mais simples depois

- Lembretes, perfis, chaves de API, armazenamento e modelos passam a valer também no pessoal, sem código à parte.
- Cobrança por plano do espaço e por modelo.
- Uma regra de escopo só ("memos do grupo X") em vez de duas.

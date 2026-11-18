# Plano: atributos de categoria (antes do controle financeiro)

*Versão de 17/11/2026, segunda revisão. Este plano vem antes do [desenho do controle financeiro](desenho-controle-financeiro-promemory.md). O objetivo é implementar e testar os atributos de categoria e os comandos no Perguntar em Agenda, To-do, Lista de compras e Controle de recebimentos (empreitadas), e validar no papel como Investimentos, Cartão, Contrato e o ERP usariam os mesmos atributos, para não os redefinirmos depois.*

*Tudo aqui é desenho. Só o marcador "Confirmar antes de alterar" está implementado (migration 171, sem commit). O que li no código e o que não li está marcado ao longo do texto e na seção 11.*

## Situação da implementação (18/11/2026)

O que já foi feito, a partir deste plano e dos testes com a Lista de compras. Os itens em produção foram publicados pela branch `production`; os marcados "local" ainda não.

| Recurso | Onde | Situação |
| --- | --- | --- |
| Confirmar antes de alterar (atributo) | Categoria atualizável | Em produção (migration 171). Por enquanto todo comando pede confirmação, com o marcador ligado ou não |
| Tipo de campo "lista" (um item por linha) | Campos de categoria | Em produção |
| Comando de alteração no Perguntar | Qualquer categoria atualizável | Em produção. A lista é alterada por operações aplicadas por regra (acrescentar, remover, trocar, concluir, cancelar, reabrir), não reescrita pela IA |
| Criar pelo Perguntar | Qualquer categoria | Em produção, pelo processamento do Catalogar e com cartão de memo novo |
| Cartão de comando (mudança no formato do usuário, Confirmar, Ajustar, Cancelar, Desfazer) | Perguntar | Em produção. O Confirmar avisa data estranha (local) |
| Visão de lista (cartão, uma linha de resumo, item perguntado destacado) | Respostas com campo do tipo lista | Em produção |
| Estado por item (✓ concluído, ✗ cancelado) com marcador | Campo do tipo lista | Em produção |
| Muitas listas: 3 mais recentes e "ver mais" com confirmação | Visão de lista | Em produção |
| Encerrar lista com confirmação e Reativar lista | Visão de lista | Em produção |
| Encerra pela data (atributo) | Categoria atualizável | Em produção (migration 172). Calculado na consulta, nada é gravado no memo |
| Copiar categoria para outro grupo; cópia das globais com tipos e atributos | Edição da categoria | Em produção |
| Relações entre memos: "Concluir e registrar resultado" e sugestão da IA após salvar | Cartão de alteração, Catalogar, Perguntar | Em produção (migration 173). Uso nas respostas do Pipe 1 ainda não |
| Perguntas por situação ("canceladas", "concluídas", "encerradas") | Perguntar | Em produção. Estado atual usa a Query padrão; histórico usa a consulta de alterações |
| Tipo de campo **Status** (valores fixos e verbos), no lugar da "lista de estados" | Campos de categoria | Local (migration 174). Seção 5.4 |
| Situação com vocabulário único: Pendente ☐ · Concluído ☑ · Cancelado ☒; tipo da categoria (a fazer / registro: Válido · Cancelado); nome do Concluído por categoria (Comprado, Pago) | Categoria atualizável, Catalogar, Perguntar | Local (migration 175). Seção 3.3 |
| Separar por, Controle de duplicidade | — | Não implementados |
| Reativar por comando, marcador de situação na tabela (To-do) | — | Não implementados |

## 1. Resumo em 1 minuto

- **Uso simples sem configurar.** Todo atributo novo nasce desligado. Sem configuração há uma agenda, uma lista de compras, um cartão.
- **O memo é a unidade que se manipula de uma vez.** Agenda: um memo por compromisso. Lista de compras: um memo por lista, com os itens em texto.
- **Alterar é sempre no próprio memo**, com histórico e Desfazer. Remover por comando é **cancelar**, nunca apagar.
- **O Perguntar vira a entrada única:** a classificação que já existe passa a dizer se o texto (ou a voz) quer **consultar, criar ou alterar**. Criar segue o processamento do Catalogar sem o usuário trocar de tela. Da voz, guarda-se só o texto.
- **Confirmação dentro do Perguntar:** um cartão de memo novo, no modelo do cartão de alteração que já existe, em vez de reaproveitar a tela de revisão do Catalogar.
- **Registro oficial** é o registro que vale quando dois lugares discordam: **Memo**, **DB interno** ou **DB externo**. É deduzido, não guardado.
- **Estados são três perguntas:** situação, baixa e conciliação, numa **lista de estados**. Novo atributo **Encerra pela data**: a agenda passada sai das respostas sem intervenção.
- **Duplicidade, conciliação e conferência** são mecanismos diferentes. O hash só pega repetição técnica.
- **Pilotos:** Agenda, To-do, Lista de compras (como memo de texto) e Controle de recebimentos (empreitadas).
- **Nenhum atributo precisa ser redefinido para Investimentos.**

## 2. Registro oficial

O registro oficial é o registro que vale quando dois lugares discordam. Toda categoria tem o seu em um destes lugares:

| Lugar | O que é o registro oficial | Como se responde | Exemplos |
| --- | --- | --- | --- |
| **Memo** | O próprio memo, que funciona como uma tabela plana (uma linha por memo, uma coluna por campo) | A Query padrão filtra, lista, conta e soma | Agenda, To-do, Lista de compras, Controle de recebimentos, Contrato |
| **DB interno** | Um fato consolidado em tabelas tipadas do proMemory. O memo, os arquivos e os importadores são relatos | Views e consultas sobre as tabelas | Investimentos, Cartão, conta bancária |
| **DB externo** | Um registro num banco de fora, pela conexão que já existe (`conexaoid`) | Consultas da categoria pela conexão | Faturamento do ERP |

**O teste:** a Query padrão da categoria responde às perguntas que importam? Se sim, o registro oficial é o memo.

**Quando o memo deixa de bastar:** cálculo que depende da história de vários registros (custo médio, saldo de conta); outra fonte além dos memos, ou o mesmo fato chegando por duas fontes, o que exige conciliação; cadastro compartilhado entre categorias; tipos fortes ou volume. Os três primeiros quase sempre levam a mais de uma tabela. Um cálculo derivado sozinho não decide, e a fronteira é um gradiente: o registro oficial pode passar do memo para o DB interno depois, sem refazer os atributos.

**Não é um atributo guardado.** É deduzido: DB interno, se a categoria tem a rotina após gravar; DB externo, se as consultas têm conexão (`queries_categoria.conexaoid`); Memo, nos demais casos. Pode aparecer como rótulo somente leitura na tela da categoria.

**Fonte para conciliação** é o relato externo com que o registro oficial é conferido: a nota de corretagem, a Movimentação da B3, o extrato, a fatura. Só existe quando o registro oficial está no DB interno.

**O que a Query padrão faz hoje** (li `packages/shared/src/queryPadrao.ts`): filtra cada campo por texto, filtra campos `date` e `number` por faixa (com leitura tolerante de datas e números), e esconde Concluído e Cancelado quando a pergunta não pede a situação. *Não verifiquei se ela soma; o filtro e a listagem estão confirmados.*

## 3. Estados e mecanismos de qualidade

### 3.1 Três perguntas de estado, independentes

| Pergunta sobre o registro | Valores | Onde se usa |
| --- | --- | --- |
| **Situação:** está valendo? | Ativo, Concluído, Cancelado | Ciclo de vida. Já existe. Cancelado = lançado errado, desistido ou removido |
| **Baixa:** já foi pago? | Aberto, Baixado | Contas a pagar e a receber, fatura do cartão |
| **Conciliação:** bate com a fonte para conciliação? | Pendente, Conciliado | Só onde há duas fontes |

Eles são independentes: uma operação pode ser Ativa e Pendente ao mesmo tempo. Estados técnicos (com erro, aguardando revisão) ficam fora. Uma data passada ("atrasado", "vencido") é calculada, não gravada.

### 3.3 Situação: um vocabulário só (decidido em 18/11)

- **Mesmas palavras e símbolos no memo e no item da lista:** Pendente ☐ · Concluído ☑ · Cancelado ☒. "Ativo" (memos antigos) e vazio contam como Pendente; "Encerrada" não é estado, só sinônimo de Concluído ou Cancelado nas perguntas.
- **Uma pergunta ao ligar Atualizável — "Cada memo é…":** *algo a fazer ou a acontecer* (Pendente · Concluído · Cancelado: Agenda, To-do, Lista, Contas a pagar) ou *um registro que vale* (Válido · Cancelado: Regras, Despesas, Operações). Em `categories.situacao_tipo`.
- **Nome do Concluído por categoria**, só na tela (`categories.rotulo_concluido`): Comprado, Pago, Realizado, Recebido. O gravado continua "Concluído", e os verbos do dia a dia (comprei, paguei, fui, desisti, reabrir) levam ao estado certo.
- **O tipo Status fica para etapas próprias** (Orçada → Entregue): Baixa vira o Concluído de uma cobrança.
- **Conciliação não é estado do usuário:** é um selo que o sistema põe ao casar com a fonte (fatura, B3).
- **Lista:** quando todos os itens estão ☑/☒, o sistema oferece concluir a lista.

### 3.2 Três mecanismos, que não são a mesma coisa

| Mecanismo | O que resolve | Como |
| --- | --- | --- |
| **Duplicidade** | O mesmo item ou fato registrado duas vezes | Hash para repetição técnica; campos da chave e heurística para o resto (seção 5.3) |
| **Conciliação** | Relatos diferentes do mesmo fato (memo, B3, nota) | Casamento por pontuação, com faixas de confiança |
| **Conferência** | Os totais batem? | Validação; não liga registros |

Quando uma resposta depende de dado ainda não conciliado, ela avisa: "considerando 3 operações ainda pendentes".

## 4. Como as categorias atualizáveis se comportam

### 4.1 O memo é a unidade que se manipula de uma vez

| Categoria | O que se manipula | Memo |
| --- | --- | --- |
| Agenda | Um compromisso por vez | Um memo por compromisso |
| Controle de recebimentos | Um pagamento por vez | Um memo por pagamento |
| To-do | Uma tarefa, com prazo e lembrete próprios | Um memo por tarefa |
| Lista de compras | A lista inteira (copiar, colar, riscar) | **Um memo por lista** |

Uma segunda condição confirma a regra: o item tem dados próprios que importam (data, prazo, valor, lembrete)? Se sim, um memo por item. O item da lista de compras não tem, e por isso a lista é um memo só (seção 8.2).

### 4.2 Alterar é no próprio memo; remover é cancelar

Verifiquei como a tela altera hoje (`memoAlteracaoService`), e os comandos seguem o mesmo modelo:

- **`alterarMemo` grava os campos novos no mesmo memo.** Não apaga e insere de novo, nem cancela e cria outro.
- **Cada campo alterado vira uma linha em `memo_alteracoes`**: o memo, o campo, o valor antes e depois, quem, quando, a origem (edição, situação, desfazer) e um **lote** que agrupa os campos de um mesmo "Salvar".
- **O Desfazer** volta o lote inteiro.
- **A IA reescreve o resumo** a partir das mudanças, e o vetor é refeito.
- **A Consulta de alterações**, automática nas categorias atualizáveis, já responde "o que foi remarcado esta semana?" a partir desse histórico.

`memo_alteracoes` já existe (migration 159), serve a todas as categorias atualizáveis e fica no mesmo banco dos memos. O plano só acrescenta a origem `sistema` (seção 5.4).

**Por que alterar e não "cancelar e criar outro":** mantém uma identidade só (lembretes e relações apontam para o mesmo memo), e o histórico já responde às perguntas. Cancelar e criar duplicaria a reunião e quebraria lembretes e ligações.

**Remover por comando é cancelar.** "Tirar banana", "cancelar a reunião" deixam o registro Cancelado (ou, na lista de texto, tiram a linha, com a versão anterior no histórico). Um comando nunca apaga. A exclusão pela tela continua existindo e também é lógica (`isactive = 0`).

### 4.3 Encerra pela data

Novo atributo, desligado por padrão: **"Encerra pela data: [campo]"**.

- **Ligado**, o registro com a data passada sai das respostas, a não ser que a pergunta peça ("reuniões de ontem"). É **calculado na consulta**, não gravado, então não exige intervenção manual.
- **Agenda:** ligado. A reunião de ontem não aparece em "o que tenho hoje".
- **To-do:** desligado. Prazo passado não é encerrado, é **atrasado**, e tem de aparecer.
- Hoje essa regra **não existe**: a Query padrão só esconde Concluído e Cancelado.

## 5. Os atributos

| Atributo | O que faz | Onde guarda | Situação |
| --- | --- | --- | --- |
| Atualizável e campo de situação | O memo muda de situação (Ativo, Concluído, Cancelado) | `categories.atualizavel`, `campo_situacao` | Já existe |
| Pessoal e campo dono | De quem é o memo; "minha" filtra pelo dono | `categories.meus_por_padrao`, `campo_dono` | Já existe |
| **Separar por** | Em qual lista está o memo (várias agendas, cartões) | `categories` (chave e campo) | Novo |
| Revisão sempre e % mínimo | Quando a tela de revisão abre | `categories.revisao_sempre`, `revisao_min_pct` | Já existe |
| Confirmar antes de alterar | Alteração por texto mostra antes → depois e espera o sim | `categories.confirmar_alteracao` | Feito (migration 171) |
| **Controle de duplicidade** | Detecta o mesmo item ou fato duas vezes | `categories` (campos e política) e `memos.chave_unica` | Novo |
| **Lista de estados** | Estados além da situação, com valores e verbos | `categories` (coluna JSON) | Novo |
| **Encerra pela data** | Registro com data passada sai das respostas (seção 4.3) | `categories` (campo) | Novo |
| Lembrete | Avisos por data (agenda, prazo, vencimento) | Regras por categoria (`lembreteService`) | Já existe |
| **Relações entre memos** | Liga um memo a outro com um tipo (resultado de, aditivo de) | Tabela nova de relações | Novo |
| Rotina após gravar | Serviço chamado ao salvar o memo, que grava no DB interno | `categories` (nome do serviço) | Só o contrato agora |

### 5.1 Pessoal e Separar por

| | Pessoal | Separar por |
| --- | --- | --- |
| Responde | **De quem é?** | **Em qual lista está?** |
| O valor é | Uma **pessoa** do grupo (usuário) | Um **texto livre**: consultório, Visa, Itaú |
| Muda | Permissão e o filtro "minha" | Só o filtro e o agrupamento |
| Exemplo | "agenda do Pedro hoje" | "agenda do consultório", "cartão Visa" |

**Pessoal, como funciona hoje** (pelos comentários do código e pelo `donoMemoService`, não por teste): numa categoria Pessoal, o dono é quem cadastrou, ou a pessoa citada no campo dono, e nesse caso o memo passa a pertencer a ela (`criado_por` guarda quem catalogou). Numa categoria não Pessoal, não há dono: o memo é de todos do grupo.

**Separar por:** uma chave liga e desliga, mais a escolha do campo, no padrão de Pessoal e de Atualizável. Desligado, a lista é única. É campo, e não subcategoria, porque os nomes nascem da fala do usuário. Ligado, o campo de separação entra sozinho no controle de duplicidade. Um comando sem o nome, com várias listas ativas, pergunta qual. *Não verifiquei se a Query padrão filtra pelo campo de separação sem ajuste.*

Na lista de compras como memo de texto, várias listas são vários memos, e o nome da lista é um campo comum. Separar por não é necessário ali.

### 5.2 Confirmar antes de alterar

- Vale só em categoria atualizável. Ligado: mostra antes → depois e só grava depois do sim. Desligado: grava e mostra o Desfazer.
- **Ação em lote sempre confirma**, com o marcador ligado ou não.

### 5.3 Controle de duplicidade

*Antes chamado "Chave única". O nome mudou porque o "é outro" permite dois iguais.*

Desligado por padrão. Ligado, tem três partes:

1. **Campos da chave**, já normalizados (sem acento, minúsculo, singular simples; "trezentos" vira 300; "hoje" vira a data). Se Separar por estiver ligado, o campo de separação entra sozinho.
2. **Política** quando acha um igual: **somar**, **avisar** (com "é outro" para salvar mesmo assim) ou **bloquear**.
3. **Só entre itens ativos:** concluir ou cancelar libera a chave.

**Fora do atributo:** o **hash do reenvio técnico** (mesmo arquivo, mesmo áudio ou texto em poucos segundos), sempre ligado em todas as categorias. Ele não pega dois memos criados separadamente com palavras diferentes. E a **heurística para parecidos**, numa segunda versão.

| Caso | Hash | Campos da chave | Heurística |
| --- | --- | --- | --- |
| Toque duplo, mesmo áudio em 3 segundos | Pega | Pega | Pega |
| "Recebi 300 do João" e depois "recebi trezentos do sr. João" | Não pega | Pega | Pega |
| Dois pagamentos reais de 300 no mesmo dia | Erraria, se o texto fosse igual | Avisa; o usuário diz "é outro" | Pergunta |
| Duas pessoas narram a mesma despesa, com palavras diferentes | Não pega | Pega, se a chave cobrir valor e data | Pega com mais confiança |
| O mesmo extrato importado de novo | Pega | Não se aplica | Não se aplica |

**Nenhum método sabe a intenção**: a palavra final é do usuário. **Garantia no banco:** índice único parcial sobre a chave, com número de sequência para o "é outro"; ele impede duplicata quando duas pessoas salvam no mesmo segundo. **Onde calcula:** um auxiliar único, chamado pelo funil de criação (`trySyncMemoDadosEspecificosRows`, hoje em 10 pontos) e por `alterarMemo`.

| Categoria | Campos da chave | Política |
| --- | --- | --- |
| Controle de recebimentos | Cliente, Obra, Tipo, Valor, Data | Avisar |
| Cadastro do papel (investimentos) | Ticker, Conta | Bloquear |
| Contrato | Número do contrato | Bloquear |
| Lista de compras (memo de texto) | Desligado: ao reescrever o texto, a IA vê o item repetido | Não se aplica |
| Agenda, To-do | Desligado | Não se aplica |
| Operação de investimento | Desligado (tratada pela conciliação) | Não se aplica |

### 5.4 Lista de estados → tipo de campo Status

*Decidido em 18/11:* em vez de uma coluna JSON na categoria, cada estado é um **campo do tipo Status** (ao lado de texto, data, número e lista), configurado na mesma tela de campos. O nome do conceito fica no nome do campo (Baixa, Conciliação, Etapa); "Status" diz só como ele se comporta.

- **Valores:** os padrões do campo, na ordem; o primeiro é o inicial (todo pagamento nasce Aberto).
- **Verbos:** uma linha por valor, "Baixado: pagar, paguei, quitar, recebi, dar baixa". Ficam em `categorycampos.verbos` (migration 174).
- **Só valores da lista são gravados:** no Catalogar o que não corresponder fica com o inicial; na alteração (tela ou comando) um valor fora da lista é recusado com "Baixa aceita só: Aberto, Baixado".
- **A regra que traduz o que foi dito** (`resolverValorStatus`, em `packages/shared/src/campoStatus.ts`): o próprio valor, outra flexão dele ("abertas", "em aberto" → Aberto; "pagas" → Pago) ou um verbo ("recebi 5 mil do Joaquim" → Baixado). Na ordem do texto, a primeira palavra decide ("estornar o pagamento" → Aberto). Verbo depois de "a", "falta", "não", "vou" não conta ("a receber", "falta pagar").
- **Perguntas:** o filtro do Perguntar usa o valor da lista, inteiro ("o que está em aberto?").
- **Telas:** seletor no Catalogar (botões, como a Situação), no cartão de alteração e no cartão de memo novo.
- A situação (Ativo, Concluído, Cancelado) continua como está, ligada a "Atualizável".

**Ainda não:** memos gravados antes de o campo virar Status ficam vazios até serem alterados (o vazio não aparece em "em aberto"); o POST de confirmação do Catalogar não revalida o valor (a tela só oferece os da lista); a **sequência** (Orçada → Fechada → Em execução → Entregue) não é imposta.

O texto original desta seção, para referência: cada estado é um campo comum da categoria, marcado como estado, com nome, valores permitidos e verbos. Exemplo: Baixa = Aberto e Baixado; "baixar", "pagar" e "quitar" levam a Baixado. O verbo escolhe o valor por regra, não pela IA. A situação continua como está.

**Confirmado na leitura do código:** a situação já é um campo comum com os valores em `normalizedterms`; a Query padrão só trata a situação de forma especial; `lembreteService` e `donoMemoService` só olham o `campo_situacao`. Estados adicionais não colidem com nada disso.

**Falta construir:** **impor os valores** (hoje são só dica para a IA, e `alterarMemo` não os valida); guardar quais campos são estados e os verbos, numa coluna JSON; a origem `sistema` em `memo_alteracoes`, para a conciliação automática; e a **sequência** (Orçada, Fechada, Em execução, Entregue).

### 5.5 Relações entre memos

Para registrar o resultado de uma reunião, recomendo **memo novo ligado ao memo da agenda**, e não um campo de texto: aceita áudio ou documento, vários resultados por evento, campos próprios, e não faz a IA reescrever o resumo da agenda a cada edição.

**Semelhança semântica não é ligação**: serve para sugerir, nunca para ser a ligação.

**Requisitos de uma ligação robusta:** (1) explícita e gravada numa tabela de relações, com origem, destino, tipo, quem e quando; hoje não existe nenhuma; (2) tipo nomeado ("resultado de", "aditivo de", "recebimento de", "estorno de"); (3) alvo resolvido na criação, com confirmação, pela mesma busca de candidatos dos comandos; (4) só entre memos que o usuário pode ver, do mesmo grupo; (5) se um lado é apagado, some da resposta mas fica no histórico; (6) o Pipe 1 traz os memos ligados junto; (7) relações permitidas declaradas por categoria.

Outros usos: recebimento ligado à empreitada, aditivo ao contrato, estorno à operação de investimento. Na memória do projeto há uma decisão anterior de GraphRAG; esta tabela seria um primeiro passo nessa direção. Não reli essa decisão.

**Como a ligação é criada: automática, não manual.** *Decidido em 17/11.* Quando o memo do resultado é criado ("resultado da reunião com Wilson"), o sistema procura o memo de origem com a mesma busca de candidatos dos comandos, usando três pistas:

- **a data:** "a reunião de hoje" ou "de ontem", ou o registro feito logo depois do horário marcado;
- **as pessoas:** "Wilson", "Fapesp";
- **o assunto:** "reunião interna Softing".

A confiança decide: **alta** liga sozinho e avisa ("Liguei à reunião de 15/11 com Wilson", com desfazer); **média** pergunta ("É da reunião de 15/11 com Wilson?", com botões); **nenhuma** não liga, e o usuário pode ligar depois pelo cartão.

**Cuidado:** essa busca precisa incluir os registros que **já passaram**. "Encerra pela data" tira a reunião de ontem das respostas, mas não pode tirá-la da busca de ligação. Pelo mesmo motivo, a busca não pode se limitar aos memos ativos, como faz hoje a busca dos comandos.

### 5.6 Rotina após gravar (só o contrato, agora)

Recebe o evento (criado, alterado, apagado), o `memoId` e a categoria; é idempotente; e não engole erro, ao contrário do funil de hoje.

## 6. Comandos no Perguntar

### 6.1 A intenção vem da classificação que já existe

O Perguntar já começa com uma chamada de IA de classificação (`classificarPergunta`), que escolhe o caminho antes de qualquer resposta. Essa mesma chamada passa a devolver a **intenção**: consultar, criar ou alterar, com a categoria. Não há chamada a mais.

- **Consultar:** segue como hoje.
- **Criar:** processa o texto como o Catalogar faz (`/api/memos/text/process`, com a categoria indicada em `categoriaForcadaId`), mostra o cartão de memo novo e grava pelo mesmo caminho do Catalogar (`/api/memos/text/confirm`). O usuário não troca de tela.
- **Alterar:** acha os candidatos, extrai os campos e mostra o cartão de alteração.
- **Dúvida:** afirmação e pergunta podem ser ambíguas ("Tenho reunião com Wilson amanhã" pode ser registro ou consulta). Com pouca certeza, a resposta oferece "Registrar na Agenda" ou "Consultar", em vez de adivinhar.

**Voz:** o Perguntar já transcreve (`/api/perguntas/transcribe`). Quando a fala vira memo, **guarda-se só o texto transcrito**, sem o arquivo de áudio. *Decidido em 17/11.*

**O desvio fica oculto, o resultado não:** o usuário vê o que foi feito ("Registrei na Agenda: reunião interna Softing, 10/12 às 10h") com o Desfazer. Uma criação mal classificada é pega pelo cartão antes de gravar.

O Catalogar continua funcionando como hoje, para quem preferir.

**Linguagem livre, sem palavras-chave.** *Decidido em 17/11.* Quem entende o comando é a IA, lendo a frase. Os verbos citados no prompt ("adiar", "remarcar", "cancelar", "tirar") são exemplos, não uma lista fechada: "joga a reunião do Wilson pra quinta", "não vou mais na reunião interna" e "passa a reunião pra depois do almoço" devem funcionar. O único vocabulário fixo é o dos **valores** de um estado (Aberto, Baixado), não o das palavras: "paguei", "quitei" e "já acertei" levam a Baixado.

**Conjunto de frases reais para teste:** juntar umas 20 frases do jeito que os usuários falam de verdade (criar, adiar, cancelar, acrescentar e tirar da lista, perguntas parecidas com comandos) e testar uma por uma quando o app estiver rodando. Onde a IA errar, ajusta-se o prompt. Isso ainda não foi testado.

### 6.2 Fluxo

```
Texto ou voz no Perguntar (a voz vira texto)
        |
 Classificação (a chamada de hoje) devolve a intenção
        |
   +-------------+----------------+-------------------+
   | consultar   | criar          | alterar           | dúvida
   v             v                v                   v
 Pipes de      Processa como    Acha os candidatos  Oferece "Registrar"
 resposta      o Catalogar      0: não achou        ou "Consultar"
 (como hoje)   (categoria       vários: escolher
               indicada)        1: IA extrai campos
                 |                |
          Cartão de memo     Cartão de alteração
          novo (confirmar)   (antes → depois se "Confirmar
                 |            antes de alterar" ou lote)
                 v                v
          grava pelo         alterarMemo grava
          Catalogar          (histórico por lote)
                  \              /
           Resposta: o que foi feito + Desfazer
```

O servidor não guarda escolha pendente: a resposta traz a proposta (candidatos, memo novo ou antes → depois) e cada botão chama uma rota que já existe.

### 6.3 A tela de confirmação dentro do Perguntar

**O que li no frontend:**

| Peça | O que é | Serve para o Perguntar? |
| --- | --- | --- |
| `RevisarMemoPage.tsx` (715 linhas) | A revisão do Catalogar: página inteira com rota própria, estado passado pela navegação, fases (decidindo, pergunta, gravando, revisão) e todos os tipos de mídia. Depois de salvar, volta para a tela inicial | **Não diretamente.** Está presa à navegação e à mídia; embutir no Perguntar seria o trabalho maior |
| `lib/revisaoNova.ts` (234 linhas) | A lógica da revisão sem tela: ler e montar os campos, percentual preenchido e `gravarMemoRevisado`, que grava texto por `/api/memos/text/confirm` | **Sim**, inteira |
| `MemoAlteracaoCartao.tsx` (267 linhas) | O cartão que **já aparece dentro do Perguntar** quando se clica no lápis: campos editáveis, ditado por voz em cada campo, leitura de hora falada ("15h30"), aviso de data estranha e gravação por `/api/memos/:id/alterar`. Depois o Perguntar mostra o aviso com Desfazer | **Sim**, como modelo e para a alteração |

**Recomendação:** não embutir a revisão do Catalogar. Fazer um **cartão de memo novo** dentro do Perguntar, no mesmo formato do cartão de alteração:

- **Mostra:** a categoria escolhida (com opção de trocar), os campos extraídos e editáveis, o aviso de duplicidade quando houver, e os botões Salvar e Cancelar.
- **Reaproveita:** a lógica de `revisaoNova.ts` para montar os campos e gravar, e as utilidades do cartão de alteração (voz por campo, hora falada, aviso de data estranha).
- **Saída para casos raros:** um link "Abrir revisão completa", que leva à `RevisarMemoPage` com o texto já processado, para quem quiser a revisão inteira.
- **Depois de salvar:** o mesmo aviso com Desfazer. O Desfazer de uma **criação** é excluir o memo recém-criado (exclusão lógica, que já existe), diferente do Desfazer de alteração, que volta o lote.

**Para a alteração, o cartão que já existe resolve:** com "Confirmar antes de alterar" ligado, ou em ação em lote, o comando abre o `MemoAlteracaoCartao` já preenchido com os valores propostos e os campos mudados em destaque, e o usuário confirma. Falta só aceitar valores iniciais e destacar o que mudou.

**Esforço:** o cartão de memo novo deve ficar no tamanho do cartão de alteração (perto de 270 linhas), bem menos que adaptar a revisão inteira. *Não li como a `PerguntaPage` (2.952 linhas) organiza o estado das respostas além do trecho que mostra o cartão de alteração; é onde pode haver surpresa.*

## 7. Validação por categoria

A primeira tabela parte da sua análise de 16/11. A segunda completa com os atributos que faltavam. São propostas a validar, **não verificadas** com as categorias reais.

| Categoria | Registro oficial | Pessoal (dono) | Separar por | Alterável | Estados |
| --- | --- | --- | --- | --- | --- |
| Agenda | Memo | Opcional (vazio = todos) | Opcional: nome da agenda | Sim, por texto e por tela | Situação; encerra pela data |
| To-do | Memo | Opcional | Opcional: nome da lista | Sim, por texto e por tela | Situação |
| Lista de compras | Memo (um por lista) | Não | Não (nome da lista é campo comum) | Sim, por texto e por tela | Situação (Ativa, Concluída) |
| Controle de recebimentos (empreitadas) | Memo | Não, nesta etapa | Opcional: obra | Sim, por texto e por tela | Situação; Andamento opcional |
| Investimentos | DB interno | Não | Opcional: conta ou corretora | Correção antes de conciliar; estorno depois | Conciliação |
| Contrato | Memo | Não | Não | Não (mudança é aditivo) | Nenhum; vigência calculada pela data |
| Cartão | DB interno | Opcional | Opcional: nome do cartão | Sim (lançamento manual) | Conciliação; a fatura: Baixa |
| Faturamento ERP | DB externo (fixo) | Não (fixo) | Do ERP | Não (fixo) | Do ERP |

| Categoria | Controle de duplicidade | Revisão sempre | Confirmar alteração | Lembrete | Fonte para conciliação | Relações |
| --- | --- | --- | --- | --- | --- | --- |
| Agenda | Desligado | Não | Não | Sim (data e hora) | Não | Resultado da reunião |
| To-do | Desligado | Não | Não | Sim (prazo) | Não | Não |
| Lista de compras | Desligado | Não | Não | Não | Não | Não |
| Controle de recebimentos | Cliente, Obra, Tipo, Valor, Data; avisar | Sim | Sim | Opcional (cobrança) | Extrato, no futuro | Recebimento da empreitada |
| Investimentos | Só no cadastro do papel | Sim | Sim | Não | B3 e nota | Estorno da operação |
| Contrato | Número do contrato; bloquear | Sim | Não | Sim (vencimento) | Não | Aditivo do contrato |
| Cartão | Hash da fatura | Sim | Sim | Sim (vencimento) | Fatura | Não |
| Faturamento ERP | Do ERP | Não | Não | Não | Não | Não |

**Investimentos, "Alterável": correção antes de conciliar, estorno depois.** *Decidido em 17/11.*

- **Antes de conciliar:** **correção**. O lançamento ainda é só o que o usuário disse; corrige-se o próprio memo, com confirmação, e o histórico guarda o valor antigo.
- **Depois de conciliar** com a B3 ou a nota: **estorno**. O lançamento já casou com um documento; não se toca nele. Lança-se outro que o anula e um novo, correto, ligados entre si (Relações entre memos), como na contabilidade.
- **Por quê:** para a IA, entender o comando é igual nos dois casos (achar o lançamento e o valor novo; o estorno é gerado por regra). A diferença está em responder depois: com correção há um lançamento por operação, já certo; com estorno há três (o errado, o estorno e o certo), e a IA pode contar duas vezes. Usar a correção sempre que possível mantém os dados limpos para a IA, e o estorno preserva a auditoria onde ela importa.
- **Proteções do estorno:** as views de posição descontam os estornos, e o lançamento estornado fica Cancelado, que a Query padrão já esconde.

**Particularidades:** Contrato segue a lógica do estorno (a mudança é um aditivo). Contas a pagar mostra o gradiente: começa no memo com Baixa e passa ao DB interno se casar o pagamento com o extrato, com dois estados. Pedidos têm uma ordem de estados. Cartão e conta têm dois níveis, a fatura e o lançamento.

## 8. Pilotos

As categorias são cadastradas pela tela de categorias. Os tipos de campo disponíveis são `text`, `date` e `number`. A Agenda já existe; os campos abaixo são proposta, e eu **não verifiquei** os campos atuais dela.

| | Agenda | To-do | Lista de compras | Controle de recebimentos |
| --- | --- | --- | --- | --- |
| Campos | Data, Hora, Assunto, Com quem, Local | Tarefa, Prazo, Prioridade, Lista | Nome da lista, Data, **Itens** (tipo "lista", um item por linha) | Tipo, Cliente, Obra, Valor, Data, Forma de pagamento, Descrição |
| Memo | Um por compromisso | Um por tarefa | **Um por lista** | Um por lançamento |
| Encerra pela data | **Sim** (Data) | Não | Não | Não |
| Controle de duplicidade | Desligado | Desligado | Desligado | Cliente, Obra, Tipo, Valor, Data; avisar |
| Revisão sempre | Não | Não | Não | **Sim** |
| Confirmar antes de alterar | Não | Não | Não | **Sim** |
| Comandos de teste | "criar reunião interna Softing dia 10/12 às 10h", "adiar a reunião interna para 14h", "cancelar a reunião com Wilson" | "concluir a tarefa de ligar para o contador", "mudar a prioridade para alta" | "nova lista do mercado a partir da anterior", "acrescentar 2 kg de arroz, uma dúzia de bananas e 2 pacotes de macarrão", "tirar banana" | "fechei empreitada com sr. João por mil reais", "recebi 300 do sr. João" |

### 8.1 Controle de recebimentos (empreitadas)

Para quem executa serviços de mão de obra e quer registrar por voz o que combinou e o que recebeu. **Uma categoria só, com uma tabela plana:**

- **Tipo**: Combinado, Recebido, Adicional ou Desconto. "Fechei empreitada com sr. João por mil reais" vira Combinado, 1.000. "Recebi 300 do sr. João" vira Recebido, 300.
- **Saldo** por cliente e obra: (Combinado + Adicional − Desconto) − Recebido, calculado numa consulta e não gravado.
- **Revisão sempre** (a voz erra números) e **Confirmar antes de alterar** (mexe no saldo).
- **Duplicidade:** principal pelos campos da chave, com o "é outro"; nomes ("sr. João" e "João da Silva") pelo `entityResolutionService`, que eu **não li**, ou pela relação com a empreitada; "hoje" vira data antes da chave; hash só para o reenvio técnico.
- **Crescimento:** conferir os pix com o extrato torna o extrato fonte para conciliação, e o registro oficial passa ao DB interno, sem mudar os outros atributos.
- *Não verifiquei se a soma com sinal sai da Query padrão ou exige uma consulta salva da categoria.*

### 8.2 Lista de compras como memo de texto

A entrevista de 17/11 mostrou que a lista é usada como **um texto**: copia-se a anterior e edita-se, como no WhatsApp. Por isso:

- **Um memo por lista**, com Nome da lista, Data, Situação (Ativa, Concluída) e o campo **Itens** com o texto inteiro: "2 kg de arroz, 1 dúzia de bananas, 2 pacotes de macarrão".
- **Sem campos por item.** O Perguntar acha a lista pela categoria, pelo nome e pela situação Ativa, e a IA lê o texto, que é curto. Não é preciso busca por vetor.
- **"Nova lista a partir da anterior"** cria um memo novo com os Itens copiados, e a anterior fica Concluída.
- **Importar do WhatsApp** é colar o texto como lista nova.
- **"Acrescentar..." ou "tirar banana"** reescreve o campo Itens pela alteração que já existe: `memo_alteracoes` guarda cada versão e o Desfazer funciona. **Vários itens num comando deixam de ser problema**, porque é uma única alteração de texto.
- **O que se perde, conscientemente:** situação por item (dá para marcar ✓ no texto), perguntas por item e controle de duplicidade por item.
- **Detalhe técnico:** hoje os valores de campo são gravados sem acento ("maçã" vira "maca"). Numa lista em texto isso aparece para o usuário e precisa ser tratado nesse campo.

**Tipo de campo "lista" (novo):** o campo Itens usa um tipo novo, além de `text`, `date` e `number`.

- **Guarda um item por linha**, como numa lista do WhatsApp. O separador é a **quebra de linha, não a vírgula**: em português a vírgula é separador decimal, e "1,5 kg de carne" viraria dois itens.
- **Entrada:** quem separa os itens de "acrescentar 2 kg de arroz, uma dúzia de bananas e 2 pacotes de macarrão" é a IA, instruída a devolver um item por linha. Nada de dividir por vírgula às cegas. Uma lista colada do WhatsApp já vem com um item por linha.
- **Tela:** mostra um item por linha (ou com marcadores) e edita numa caixa de várias linhas.
- **Verificado no código:** o backend mantém as quebras de linha dentro do valor (tira só acentos e os espaços das pontas). O cartão de alteração (`MemoAlteracaoCartao`) edita com campo de **uma linha** (`<input>`), que juntaria a lista; para o tipo "lista" ele precisa de uma caixa de várias linhas (`<textarea>`).
- **Outros usos:** pauta de reunião, itens de um orçamento.

**Onde está o valor de verdade:** não na lista, mas no **cupom fiscal**. Foto do cupom depois da compra, com itens, preços, mercado e data, responde "quanto gastei com banana este ano?" e "o arroz subiu?". Isso é a força do proMemory (capturar um documento e responder) e entra no controle de despesas, no desenho financeiro. Gerenciar a lista item por item é terreno do WhatsApp e dos aplicativos de notas, e o proMemory não deve competir ali. Integrar o WhatsApp como **canal de captura** para o produto inteiro é uma decisão de produto à parte (API do WhatsApp Business, custo, aprovação da Meta).

## 9. Teste de encaixe: Investimentos no papel

| Atributo | Operação de investimento | Ativo (cadastro do papel) |
| --- | --- | --- |
| Registro oficial (deduzido) | DB interno | DB interno |
| Atualizável | Correção antes de conciliar; estorno depois (seção 7) | Sim |
| Pessoal | Não, nesta etapa | Não |
| Separar por | Opcional: conta ou corretora | Não |
| Revisão sempre | Sim | Não |
| Confirmar antes de alterar | Sim | Não |
| Controle de duplicidade | **Desligado** (duas compras iguais podem ser reais) | **Ticker, Conta; bloquear** |
| Lista de estados | Conciliação: Pendente, Conciliado | Não |
| Relações | Estorno da operação | Não |
| Rotina após gravar | Sim (grava o fato no DB interno) | Sim (grava `fin_ativos`) |

**O que o financeiro exige e os atributos ainda não dão:** (1) estado escrito pelo sistema, resolvido com a origem `sistema`; (2) a correção por comando com dois destinos, o memo ou o fato, então a camada de ação nasce com a interface de destino; (3) moeda vira campo de texto, sem bloquear; (4) controle de duplicidade desligado nas operações, tratado pela conciliação; (5) o contrato da rotina após gravar; (6) o dono nas tabelas `fin_`; (7) ação em lote sempre confirma.

**Conclusão:** nenhum atributo precisa ser redefinido. Faltam dois pontos de extensão baratos, a origem `sistema` e o destino da ação.

## 10. Ordem de entrega

1. **Comandos no Perguntar: alterar.** Intenção na classificação, busca de candidatos, extração, `MemoAlteracaoCartao` aceitando valores propostos com destaque do que mudou, confirmação em lote, a interface de destino da ação e o **tipo de campo "lista"** (um item por linha, caixa de várias linhas). *Pronto quando:* "adiar a reunião interna para 14h" altera o memo e mostra o Desfazer; com duas reuniões parecidas pede a escolha; "tirar banana" reescreve a lista com Desfazer; a Consulta de alterações mostra a remarcação.
2. **Comandos no Perguntar: criar.** Intenção "criar", processamento como o Catalogar com a categoria indicada, cartão de memo novo, gravação por `/api/memos/text/confirm`, Desfazer da criação e a saída para a revisão completa. *Pronto quando:* "criar reunião interna Softing dia 10/12 às 10h", digitado ou falado, cria o memo na Agenda sem trocar de tela; "tenho reunião com Wilson amanhã" oferece Registrar ou Consultar.
3. **Encerra pela data.** Coluna, tela da categoria e o filtro na Query padrão. *Pronto quando:* "o que tenho hoje?" não mostra a reunião de ontem, e "reuniões de ontem" mostra.
4. **Separar por e Controle de duplicidade.** Andam juntos. *Pronto quando:* "recebi 300 do sr. João" duas vezes avisa, e "é outro" salva o segundo; duas pessoas salvando o mesmo lançamento no mesmo segundo não duplicam.
5. **Lista de estados.** Coluna JSON, tela, verbos, **validação dos valores** em `alterarMemo` e a origem `sistema`. *Pronto quando:* "paguei a conta de luz" muda a Baixa; um valor fora da lista é recusado.
6. **Relações entre memos**, se entrarem nesta etapa. *Pronto quando:* "resultado da reunião com Wilson de ontem" cria um memo ligado à agenda certa, e "o que foi decidido?" responde com ele.
7. **Contrato da rotina após gravar.** Só a interface e a coluna reservada.

Os comandos vieram para o começo porque Agenda e Lista de compras dependem deles, e os testes da sua esposa e os seus são justamente comandos. O projeto não tem scripts de teste: a verificação é o `tsc`, os cenários manuais das seções 8 e 10 e o **conjunto de frases reais** da seção 6.1.

**Situação em 17/11:** os passos 1 (comando de alteração e tipo "lista") e o marcador "Confirmar antes de alterar" estão implementados no commit `4f388a6`, verificados só com `tsc`. Ainda não foram testados com o app rodando.

## 11. Decisões e o que não li

**Decisões suas, em aberto:**

1. **Nome do atributo "Separar por".**
2. **Relações entre memos** nesta etapa, ou na próxima.
3. **Lista de estados**, com o estado separado da situação (já inclinado a sim).
4. **Ação em lote sempre confirma.**
5. **Nomes** dos campos dos pilotos (seção 8).
6. **Encerra pela data** como atributo, com Agenda ligada e To-do desligado.

**Já decidido:**

- 16/11: o registro oficial não vira atributo guardado; é deduzido.
- 16/11: "fonte para conciliação" como termo geral.
- 16/11: Controle de recebimentos (empreitadas) entra como piloto.
- 17/11: os lugares do registro oficial se chamam Memo, DB interno e DB externo.
- 17/11: "Chave única" passa a se chamar Controle de duplicidade, com o hash fora do atributo.
- 17/11: sem configurar, o uso é simples; todo atributo novo nasce desligado.
- 17/11: alterar é no próprio memo, com histórico e Desfazer; remover por comando é cancelar, nunca apagar.
- 17/11: um pipe só, configurado pelos atributos da categoria.
- 17/11: o Perguntar recebe consultar, criar e alterar pela mesma classificação; o desvio entre telas com botões foi descartado.
- 17/11: quando a voz vira memo, guarda-se só o texto.
- 17/11: lista de compras é um memo por lista, com os itens em texto; o valor por item vem do cupom fiscal, no controle de despesas.
- 17/11: a confirmação no Perguntar é um cartão próprio, no modelo do cartão de alteração, e não a revisão do Catalogar embutida.
- 17/11: Investimentos: correção antes de conciliar, estorno depois (seção 7).
- 17/11: novo tipo de campo "lista", com um item por linha; a quebra de linha é o separador, nunca a vírgula.

**Pendente, pedido em 17/11: "Copiar para outro grupo".** Enquanto as categorias não viram plugins, copiar uma categoria de um grupo para outro vai ser muito usado. Hoje só existe "Copiar das categorias globais" (só administrador, só de categorias sem grupo), e ela **perde** o tipo dos campos (lista e data viram texto), o Atualizável, o campo de situação, a revisão, o "Confirmar antes de alterar" e o Pessoal. A cópia nova deve:

- copiar de um grupo para outro, para quem é owner dos dois grupos (ou administrador);
- levar os campos com tipo, descrição, valores padronizados e resolução de nome abreviado, as subcategorias e todos os atributos da categoria;
- não copiar as consultas automáticas (Query padrão e Consulta de alterações): elas são geradas de novo no destino; as consultas escritas à mão são copiadas sem conexão;
- não copiar memos;
- corrigir também a cópia das globais, que hoje perde os tipos e os atributos.

**Não li, e pode mudar o desenho:**

- Como a `PerguntaPage` organiza o estado das respostas, além do trecho do cartão de alteração.
- Os campos atuais da Agenda.
- As regras de lembrete por categoria, em detalhe (`lembreteService`).
- `entityResolutionService` (nomes de cliente, "sr. João").
- Se a Query padrão filtra pelo campo de separação e faz soma com sinal.
- O tratamento de acentos ao gravar os campos, para o campo Itens da lista.
- Os componentes de campo da revisão do Catalogar: se também usam campo de uma linha, o tipo "lista" precisa da mesma mudança ali.
- Os memos já existentes, que não têm chave de duplicidade e precisam de uma carga inicial.

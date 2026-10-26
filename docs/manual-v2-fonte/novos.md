@@NOVIDADES
# NOVIDADES DA VERSÃO 2
Resumo do que mudou no sistema entre julho e outubro de 2026. Cada item remete à seção onde está descrito.
| Novidade | Onde |
|---|---|
| Perguntas salvas com parâmetros (chips trocáveis por teclado ou voz, reexecução sem replanejar) | Seção 9 |
| Ao salvar uma pergunta: escolha entre "Salvar só o texto" (padrão) e "⚡ Com parâmetros" | Seções 8 e 9 |
| Lista de Perguntas salvas lembra a última pergunta escolhida e os filtros, na mesma sessão | Seção 8 |
| "Ver etapas" (trace das chamadas de IA e SQL) também quando a pergunta dá erro | Seção 8 |
| Modo híbrido não perde a resposta inteira quando uma das partes falha | Seção 8 |
| Gráfico da resposta: até 3 séries, datas curtas (dd/mm/aaaa) e omitido com mais de 20 rótulos no eixo X | Seção 8 |
| Lembretes por e-mail antes da data dos memos (Agenda e similares) | Seção 18 |
| Tile "Guarda própria" no Catalogar (arquivos que ficam no servidor do cliente) | Seção 5 |
| OneDrive, Google Drive e URL externa na Importação em Lote marcados como "em breve" | Seção 16 |
| Query padrão gerada e atualizada automaticamente a partir dos campos da categoria | Seção 17 |
| Número da query (#id) exibido na Estrutura do contexto | Seção 17 |
| Queries clonadas ficam com "conexão pendente" até escolher a conexão do grupo destino | Seção 17 |
| Descrição dos campos usada pela IA na extração e no planejamento das consultas | Seção 17 |
| Campos de data e número tolerantes a texto ("4 horas", "1h30", "AAAA/MM/DD") | Seção 17 |
| Filtro cruzado entre queries mais tolerante (parâmetro não cadastrado, coluna inexistente, lista vazia) | Seção 17 |
| Isolamento por grupo nas queries internas (cada grupo só lê os próprios memos) | Seção 17 |
| Ícones ✎ e 🗑 visíveis no tema escuro | Seção 17 |
| Média (AVG) no SQL Server sem truncar para inteiro | Seção 17 |
| Importar conhecimento em trechos (ex.: o próprio manual) para responder perguntas no grupo | Seção 27 |
| Importar conhecimento: campo "Nome do manual (origem)"; Substituir e Remover agem só nos trechos desse manual, e vários manuais podem dividir a mesma categoria | Seção 27 |
| Importação automática de pasta (⏱ Automatizar) e lista "Memos sem dono identificado" | Seção 16 |
| Categoria Pessoal e campo dono configurados na própria categoria | Seção 17 |
| Campo dono aplicado também no Catalogar e na edição; pergunta que cita um membro ("agenda do Suporte") mostra os memos dele | Seção 17 |
| Renomear um campo atualiza os memos já gravados e as queries da categoria | Seção 17 |
| Extração mais fiel: endereços e nomes copiados como no texto, tempo sempre com unidade, "eu/me" = autor do memo | Seção 17 |
| Perguntas comparam texto dos memos por palavras ("sr. Wilson" acha "Sr. Wilson da FAPESP") | Seção 17 |
| Sem resultado nos seus memos Pessoal, a pergunta busca nos de todos (com aviso); resposta vazia com confiança baixa | Seção 17 |
| Categoria Atualizável: alterar, concluir ou cancelar memos (ex.: agenda) direto na resposta do Perguntar, com ↶ Desfazer | Seções 8 e 17 |
| Períodos relativos ("semana que vem", "próxima sexta", "fim de semana"…) calculados pelo sistema no horário de Brasília | Seção 8 |
| Autenticação por chave de API para integrações externas (ex.: Softing-erp) com contexto da tela | Seção 28 |
| Correção: descrição das telas admin Mídia por plano, Documento — roteamento IA, CAD/BIM, Config. do Sistema e Último prompt LLM (estavam incorretas na v1) | Seções 20 a 24 |
@@FIM

@@SEC8
# SEÇÃO 8 — Perguntar ao MyMemory
Rota: / (aba Perguntar) · Componente: PerguntaPage
## Propósito
Permite ao usuário fazer perguntas em linguagem natural sobre os memos do espaço ativo e sobre os dados estruturados (queries das categorias, inclusive bancos SQL Server de ERP). A IA classifica a pergunta, escolhe o caminho de resposta e mostra o resultado com as fontes usadas.
## Como usar
1. Digitar a pergunta no campo de texto ou falar clicando no microfone 🎤.
2. Clicar "Perguntar →" ou pressionar Enter.
3. A resposta aparece em um card, com os memos e dados usados.
4. Clicar em "Memo #id" abre o memo; a tabela de dados estruturados pode ser rolada e ordenada.
5. Para reutilizar, salvar a pergunta pelo ícone de salvar do card (ver "Salvar pergunta" abaixo).
## Tipos de resposta (pipe)
| Tipo | Quando é usado |
|---|---|
| Semântica | A resposta depende de interpretar textos dos memos (explicação, resumo, notícias). Usa busca por similaridade (pgvector). |
| Estruturada | Listagens, contagens, somas, médias, agrupamentos e filtros por critério. Usa as queries cadastradas nas categorias. |
| Híbrida | A pergunta pede números e interpretação textual ao mesmo tempo. Roda as duas partes e combina o resultado. |
NOTA: O tipo é escolhido pela IA. No card da resposta há botões para refazer a pergunta forçando outro tipo (ex.: "tentar semântica").
## Etapas da resposta estruturada
1. Classificação: identifica o tipo e as categorias envolvidas.
2. Planejamento: escolhe as queries da categoria e preenche os parâmetros (cliente, período, produto…).
3. Execução: roda as queries (PostgreSQL interno ou SQL Server do ERP).
4. Síntese: a IA redige a resposta usando somente as linhas retornadas.
## Ver etapas (trace)
Para usuários com o trace habilitado, o card mostra o botão de trace com o número de chamadas. Ele abre a janela "LLM Trace" com cada etapa: classificação, planejamento, SQL executado com os parâmetros, linhas entregues à IA e síntese. O cabeçalho da janela mostra a pergunta daquele card.
- Quando a pergunta dá erro, a mensagem de erro traz o botão "ver etapas (N)" com as etapas que rodaram até a falha, incluindo o SQL que falhou e o número da query (ex.: Query #56).
DICA: Para diagnosticar uma resposta errada, abra "ver etapas" no card da própria pergunta e confira a etapa planejamento_estruturado (parâmetros escolhidos) e consulta_sql (SQL e linhas retornadas).
## Modo híbrido tolerante a falha
Se a parte estruturada falhar (ex.: erro de SQL), a resposta sai com a parte dos memos e a falha aparece nas limitações. Se a busca nos memos falhar, sai a parte estruturada. Quando não há memos relevantes, o botão "Ampliar busca" é oferecido.
## Gráfico da resposta estruturada
- Quando o resultado tem colunas numéricas, aparece um gráfico de barras ao lado da tabela.
- No máximo 3 séries (as colunas mais relevantes para a pergunta).
- Datas aparecem no formato curto dd/mm/aaaa.
- Com mais de 20 rótulos distintos no eixo X o gráfico é omitido (ficaria ilegível) e só a tabela é exibida.
## Salvar pergunta
Clicar no ícone de salvar do card guarda a pergunta em "Perguntas salvas".
- Se a resposta não tem parâmetros trocáveis, salva direto, como texto.
- Se tem parâmetros (cliente, produto, período…), aparecem duas opções: "Salvar só o texto" (padrão, já com foco) e "⚡ Com parâmetros". Ver Seção 9.
## Carregar pergunta salva
O botão "Perguntas salvas" abre a lista do espaço ativo, com busca por texto e filtro por categoria.
- Na mesma sessão do navegador, a lista reabre com os mesmos filtros e rola até a última pergunta escolhida, que fica destacada.
- A memória é por grupo (e pelo espaço pessoal) e some ao fechar a aba.
- Perguntas com ⚡ têm parâmetros (Seção 9). As demais são carregadas como texto na caixa de pergunta.
## Histórico da sessão
As perguntas e respostas da sessão ficam como cards na tela e são enviadas como contexto às perguntas seguintes (ex.: "e desses, quais…"). O botão "↺ Nova sessão" limpa o histórico.
DICA: Ao testar várias vezes a mesma pergunta, use "Nova sessão": respostas anteriores erradas no histórico podem influenciar o planejamento.
## Períodos relativos
Expressões de tempo na pergunta são calculadas pelo sistema, no horário de Brasília, e enviadas prontas à IA — a pergunta não é reescrita. A semana vai de segunda a domingo. Exemplo com hoje = segunda-feira, 26/10/2026:
| Expressão | Período | Exemplo |
|---|---|---|
| hoje / amanhã / depois de amanhã / ontem | o dia | 26/10 · 27/10 · 28/10 · 25/10 |
| esta semana | de hoje até domingo | 26/10 a 01/11 |
| semana que vem = próxima semana | segunda a domingo seguintes | 02/11 a 08/11 |
| semana passada | segunda a domingo anteriores | 19/10 a 25/10 |
| fim de semana | sábado e domingo desta semana (hoje, se já for fim de semana) | 31/10 a 01/11 |
| próximo fim de semana | o mesmo; num sábado ou domingo, o seguinte | 31/10 a 01/11 |
| sexta (ou outro dia) | hoje, se hoje for sexta; senão a próxima | 30/10 |
| próxima sexta | a próxima; numa sexta-feira, a da semana seguinte | 30/10 |
| próximos 7 / 15 / 30 dias | de hoje até hoje + N | 26/10 a 02/11 (7) |
| últimos 7 / 15 / 30 dias | de hoje − N até hoje | 19/10 a 26/10 (7) |
| este mês / mês que vem / mês passado | o mês inteiro | out · nov · set |
| este ano / ano que vem / ano passado | o ano inteiro | 2026 · 2027 · 2025 |
NOTA: "Próximos 7 dias" é diferente de "semana que vem": conta a partir de hoje, não da próxima segunda.
## Alterar, concluir ou cancelar pela resposta
Em categorias marcadas como Atualizável (ex.: Agenda), os memos da resposta aparecem com ✎ ao lado do número e a linha da tabela fica clicável. Aparecem só para quem pode alterar: o dono do memo, quem o catalogou e owners/editores do grupo.
1. Toque (celular) ou clique (computador) na linha ou no ✎ — abre o cartão do memo com os campos preenchidos.
2. Mude os campos digitando ou pelo 🎤 de cada campo (encerra sozinho após 1,5 s de silêncio; no computador o texto aparece enquanto você fala). Hora falada ("15 horas", "15h30") vira 15:00/15:30; data vira dd/mm/aaaa.
3. Toque em "Salvar alterações". Não há confirmação extra: aparece "Alterado: … ↶ Desfazer" por 10 segundos.
- "✓ Marcar como concluído" e "✕ Marcar como cancelado" mudam a situação com um toque (também com ↶ Desfazer). Memo concluído ou cancelado mostra "↺ Reativar".
- O × do cartão (ou Esc) fecha sem alterar nada.
- A linha alterada mostra os valores novos na própria resposta; cancelada ou concluída aparece riscada.
- Depois de salvar, a IA reescreve o resumo do memo com os valores novos e o vetor do memo é refeito (busca semântica). O texto original do memo nunca é alterado.
- Cada alteração fica registrada (quem, quando, antes e depois); o ↶ Desfazer usa esse registro.
## Avisos a partir da resposta
O card pode sugerir "🔔 Me avise quando a resposta desta pergunta mudar". Ver Seção 12.
## Narração por voz
Se o áudio estiver habilitado nas preferências, a resposta pode ser narrada pela síntese de voz do navegador. A velocidade é controlável em Minha Conta → Preferências (0.5× a 2.0×).
## Custo de IA
Cada pergunta consome créditos de IA. O custo estimado é exibido no card de resposta quando a preferência de exibir custo está ativa.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Sem memos suficientes para responder | Base de memos do espaço ativo vazia ou sem conteúdo relevante. Usar "Ampliar busca" ou reformular. |
| Não encontrei dados estruturados para essa pergunta | Nenhuma categoria identificada. Conferir nome e descrição das categorias na Estrutura do contexto. |
| Erro ao processar a pergunta: Query #N "nome": … | Falha no SQL da query N. Abrir "ver etapas" para ver o SQL e os parâmetros; corrigir a query ou os parâmetros na Estrutura do contexto. |
| invalid input syntax for type numeric / date | Campo de memo com texto onde se esperava número ou data. Desde a v2 a Query padrão converte com tolerância; em queries editadas à mão, usar mymemory_parse_number / mymemory_parse_date (Seção 17). |
| A query "X" foi clonada e ainda não tem conexão definida | Query clonada com conexão pendente. Escolher a "Conexão BD externa" dela na Estrutura do contexto. |
| Resposta traz registros de outros clientes | Filtro do template não está sendo aplicado (ex.: nome de parâmetro digitado errado no SQL, como @Abrev_Abrev_Empresa). Conferir o SQL em "ver etapas". |
| Resposta cita dados fora do contexto | O planejador associou o termo ao campo errado. Preencher a descrição do campo (Seção 17) e refazer em Nova sessão. |
| Os servidores de IA estão temporariamente sobrecarregados | Provedor de IA indisponível. Tentar novamente em alguns segundos ou minutos. |
| Créditos de IA esgotados | Limite do plano atingido. Aguardar renovação ou fazer upgrade. |
@@FIM

@@SEC9NOVA
# SEÇÃO 9 — Perguntas salvas com parâmetros
Rota: / (aba Perguntar) · Componentes: PerguntaPage, PerguntaChips
## Propósito
Uma pergunta salva com parâmetros guarda, além do texto, o plano da consulta (classificação, queries e parâmetros). Ao reutilizá-la, os parâmetros viram chips clicáveis na frase. O usuário troca só o que precisa (outro cliente, outro período) e a pergunta é reexecutada direto, sem as etapas de classificação e planejamento — mais rápida e com resultado consistente.
## Como salvar
1. Fazer a pergunta normalmente e conferir se a resposta está correta.
2. Clicar no ícone de salvar do card.
3. Escolher "⚡ Com parâmetros". A opção "Salvar só o texto" mantém o comportamento antigo.
NOTA: Só respostas estruturadas com parâmetros trocáveis oferecem a opção. Perguntas semânticas e híbridas sempre são salvas como texto.
## Como usar
1. Abrir "Perguntas salvas" e escolher uma pergunta marcada com ⚡.
2. A frase aparece com os chips no lugar dos valores. Ex.: "faturamento do cliente [Cliente: Diguinho] [Período: nos últimos 6 meses]".
3. Clicar em um chip para trocar o valor.
4. Clicar "Perguntar →". O card da resposta mostra ⚡ indicando que o plano salvo foi reaproveitado.
## Seletor do chip
| Elemento | Descrição |
|---|---|
| Caixa de texto | Digitar o novo valor. A partir de 2 letras aparecem sugestões com valores reais da própria query (autocomplete). Enter confirma. |
| 🎤 Microfone | Fala o valor. A gravação termina sozinha após cerca de 1,5 s de silêncio. Se só um valor da base corresponde ao que foi dito, ele é escolhido automaticamente. |
| Atalhos de período | Hoje, este mês, mês passado, últimos 3/6/12 meses, este ano, ano passado, próximos 30 dias. |
| Datas De / Até | Período personalizado. |
| Texto de período | Aceita "mês passado", "últimos três meses", "março de 2025", "2025", "outubro". |
| ↺ voltar ao valor salvo | Desfaz a troca do chip. |
Chips alterados ficam com borda tracejada. Os botões ao lado da frase são: ✎ (editar como texto livre, segue o caminho normal) e ✕ (fechar a pergunta salva).
## Regras importantes
- Curingas do plano são mantidos: se o valor salvo era "GAMA%" (começa com) e o usuário escolhe "Genea", o sistema busca "Genea%".
- Se alguma query do plano mudou desde o salvamento (SQL, parâmetros ou conexão), a pergunta é refeita pelo caminho normal automaticamente.
- Editar o texto de uma pergunta salva em "Perguntas salvas" remove o plano: ela volta a ser uma pergunta salva comum.
- Perguntas salvas antes da v2 não têm plano. Para ter chips, refazer a pergunta e salvar com parâmetros.
- O autocomplete só funciona quando o parâmetro corresponde a uma coluna do SELECT da query (ex.: parâmetro abrev_empresa ↔ coluna Abrev_Empresa). Sem isso, é possível digitar o valor livremente.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Opção "⚡ Com parâmetros" não aparece | A resposta não era estruturada ou não tinha parâmetros trocáveis. Salvar só o texto. |
| Chip sem sugestões | Parâmetro não ligado a uma coluna do SELECT, ou termo com menos de 2 letras. Digitar o valor completo. |
| Microfone não funciona no chip | Permissão de microfone negada ou navegador sem reconhecimento de voz (no desktop usar Chrome ou Edge). |
| A pergunta foi replanejada em vez de reexecutada | A query mudou desde o salvamento. Comportamento esperado; salvar de novo para atualizar o plano. |
@@FIM

@@SEC11AVISOS
# SEÇÃO 11 — Avisos
Rota: /avisos (também em Minha Conta → 🔔 Meus Avisos)
## Propósito
Avisos monitoram uma pergunta e notificam o usuário quando a resposta dela muda (ex.: "me avise quando surgir nova nota fiscal do cliente X").
## Como criar
1. No card de uma resposta, clicar na sugestão "🔔 Me avise quando a resposta desta pergunta mudar".
2. Revisar a descrição do aviso e confirmar.
3. O sistema reexecuta a pergunta periodicamente com o mesmo caminho (semântico, estruturado ou híbrido) e compara o resultado.
## Tela Meus Avisos
| Campo / Elemento | Descrição |
|---|---|
| Lista de avisos | Cada aviso mostra a descrição, o tipo de resposta (semântica, estruturada ou híbrida) e a situação: Ativo ou Pausado. |
| Frequência | Intervalo em que a pergunta é reexecutada. |
| Canal | Destino da notificação (e-mail). |
| Próxima execução | Data e hora da próxima verificação. |
| Ver resposta | Mostra a última resposta obtida. |
| Pausar / Reativar | Suspende ou retoma o monitoramento. |
| Excluir | Remove o aviso. |
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Nenhum aviso disponível | Situação normal — nenhum aviso foi criado. |
| Aviso nunca dispara | A resposta não mudou, ou a query usada mudou de formato. Recriar o aviso a partir de uma nova pergunta. |
@@FIM

@@SEC5ADD
## Guarda própria
O último tile do Catalogar, "📂 Guarda própria ↗ — arquivos no seu servidor", abre a Importação em Lote (Seção 16). Serve para catalogar arquivos que continuam no disco, na rede ou no WebDAV do cliente, sem copiá-los para o MyMemory. Substitui o antigo tile "Documento / arquivo"; documentos avulsos continuam sendo enviados pelo seletor de arquivo.
@@FIM

@@SEC17ADD
## Query padrão automática
Toda categoria pode ter uma "Query padrão — Nome da categoria", consulta interna (PostgreSQL) sobre os memos da categoria, com um filtro por campo.
- É gerada e atualizada automaticamente quando a categoria ou seus campos mudam.
- Para cada campo: filtro "contém" (ILIKE); campos de data ganham também _ini/_fin (faixa de datas); campos de número ganham _ini/_fin (faixa de valores).
- Se o SQL for editado à mão, a query deixa de ser automática e não é mais tocada pelo sistema.
- O botão "✦ Gerar Query padrão" substitui o SQL pela versão atual. Salvando sem alterar, a query volta a ser automática.
## Número da query
Cada query mostra o seu número (#id) ao lado do nome. É o mesmo número citado nas mensagens de erro e no trace (ex.: Query #56 "Estoque_Produto").
## Tipos de campo e conversão tolerante
| Tipo | Como é lido nos filtros |
|---|---|
| Texto | Comparação por palavras: cada palavra da pergunta precisa aparecer inteira no campo, em qualquer ordem, sem acento e sem diferenciar maiúsculas. Tratamentos e palavras de ligação (sr., sra., dr., o, a, de, da, do, com…) são ignorados. Ex.: "sr. Wilson", "Wilson da FAPESP" e "FAPESP" acham "Sr. Wilson da FAPESP"; "Wilson" não acha "Wilsons Ltda". Vale para as queries de memos; nas queries de ERP (SQL Server) a comparação continua exata, salvo quando a pergunta pede "contendo". |
| Data | mymemory_parse_date: aceita dd/mm/aaaa, aaaa-mm-dd, AAAA/MM/DD, "10 de outubro de 2026" e texto após a data. Data inválida fica fora do filtro, sem erro. |
| Número | mymemory_parse_number: aceita vírgula decimal e milhar ("R$ 1.500,25" = 1500,25) e o primeiro número do texto ("3 quartos" = 3). Durações viram horas: "4 horas" = 4, "1h30" = "1:30" = "uma hora e meia" = "90 minutos" = 1,5, "meia hora" = 0,5. Sem número, fica fora do filtro, sem erro. |
NOTA: Em queries editadas à mão, use mymemory_parse_date(...) e mymemory_parse_number(...) em vez de ::date e ::numeric para não quebrar a pergunta quando um memo tiver texto livre.
## Descrição do campo
A descrição de cada campo é enviada à IA na extração dos memos e no planejamento das consultas. Ela é o principal meio de evitar que um termo da pergunta seja ligado ao campo errado (ex.: "cliente Genea" indo para Vendedor). Descreva o significado e, se útil, valores possíveis (ex.: "Situação do título: EM ABERTO ou LIQUIDADO").
- "Padrões" (termos normalizados) são valores aceitos separados por vírgula, usados para normalizar o que a IA extrai. Deixe vazio em campos de data e hora.
- A IA copia nomes, endereços e números como estão no texto (não "corrige" uma rua por outra), grava tempos sempre com unidade ("2 horas") e não mistura duração do evento com antecedência do aviso.
- "Eu", "me", "meu" no texto referem-se ao autor do memo (quem está catalogando): campos de pessoa que se refiram a ele recebem o nome ou e-mail do autor.
- Quando dois campos podem ser confundidos, diga na descrição de cada um quem é quem. Exemplo na Agenda — Dono Agenda: "Pessoa dona da agenda, que vai cumprir o compromisso. Em 'agendar para X' ou 'agenda do X', X é o dono. Em primeira pessoa ou sem indicação, use o autor do memo." Com quem: "Outras pessoas ou empresas que participam do compromisso, a contraparte do dono (ex.: 'reunião com Maria', 'reunião com a Petrobras'). Nunca a pessoa depois de 'agendar para'."
## Renomear um campo
Ao trocar o nome de um campo (✎), o sistema leva o novo nome a tudo o que já existe na categoria: os memos já gravados, o campo dono da categoria, os parâmetros das queries e o nome entre aspas simples (ex.: 'Proprietario') no SQL das queries de memos escritas à mão. Ao final, uma mensagem informa quantos memos e queries foram atualizados.
- Prefira nomes que não se confundam com outras categorias (ex.: "Dono Agenda" em vez de "Proprietario", que também aparece em imóveis e veículos).
- Queries de ERP (SQL Server) não são alteradas: os nomes ali são colunas do banco do ERP.
## Parâmetros das queries
| Convenção | Uso |
|---|---|
| :param (PostgreSQL) / @param (SQL Server) | Placeholder no SQL. O nome do parâmetro é o nome do campo sem acento, em minúsculas, com "_" (ex.: Abrev_Empresa → abrev_empresa). |
| Operador LIKE | Queries de memos: comparação por palavras (ver Tipos de campo). Queries de ERP: comparação exata; "contém" só quando a pergunta pede busca parcial ("contendo", "começa com"). |
| Sufixos _ini / _fin | Limite inferior e superior de faixa (datas, valores, durações em horas). |
| Sufixos _in / _nin | Listas para IN / NOT IN. Cadastrar com tipo lista_texto e operador IN ou NOT IN. Necessários para o filtro cruzado. |
| userId / groupId | Injetados pelo sistema. Nunca são pedidos ao usuário. |
DICA: O botão que detecta :param e @param no SQL cria automaticamente os parâmetros que faltam. Depois ajuste com ✎ o tipo e o operador.
## Filtro cruzado entre queries
Quando a pergunta encadeia consultas (ex.: "dos pedidos do período, qual o estoque de cada produto"), o resultado de uma query filtra a seguinte via parâmetro IN.
- Se o parâmetro de destino não estiver cadastrado mas existir no SQL como IN(@param), o sistema o usa assim mesmo.
- Se a coluna de origem não existir no resultado da primeira query, a query destino é pulada e o motivo aparece nas limitações da resposta.
- Se a lista de origem vier vazia, uma query com IN retorna 0 linhas (e não "tudo").
## Clonar estrutura e conexão pendente
Ao clonar categorias de um grupo para outro, as queries de SQL Server clonadas ficam com "conexão pendente" (destacadas na lista). Até escolher a "Conexão BD externa" do grupo destino, elas não executam e a pergunta informa o motivo.
## Isolamento por grupo
Queries internas (PostgreSQL) rodam em modo somente leitura e com papel restrito: cada grupo só enxerga os próprios memos, mesmo que o SQL da query tente ler outros grupos.
## Agregações no SQL Server
Médias (AVG) são calculadas com casas decimais; antes, colunas inteiras eram truncadas (0,8 dia virava 0).
## Ícones de ação
Em cada linha (categoria, campo, query, parâmetro) há ✎ para editar e 🗑 para excluir. Só aparecem quando a tela está em modo de edição (admin, ou owner do grupo selecionado); em "Só visualização" ficam ocultos.
@@FIM

@@SEC18NOVA
# SEÇÃO 18 — Lembretes por e-mail
Rota: /estrutura-memo (botão 🔔 na categoria)
## Propósito
Envia e-mail antes da data/hora de cada memo de uma categoria (Agenda, vencimentos, renovações). O memo pode sobrepor o padrão da categoria (ex.: "me lembre 30 min antes", "avisar o João", "não precisa lembrar").
## Acesso
Na Estrutura do contexto, clicar no ícone de lembrete da categoria. Disponível para admin e owner do grupo.
| Ícone | Significado |
|---|---|
| 🔔 | Lembretes ligados nesta categoria. Clique para ver ou alterar. |
| 🔕 esmaecido | Lembretes desligados. Clique para configurar. |
| 🔕 desabilitado | Indisponível: a categoria é global (lembretes só em categorias do grupo) ou não tem nenhum campo do tipo data. Passe o mouse para ver o motivo. |
## Campos da configuração
| Campo / Elemento | Descrição |
|---|---|
| Enviar lembretes desta categoria | Liga ou desliga os lembretes da categoria. |
| Campo de data * | Campo do memo com a data do compromisso. |
| Campo de horário | Campo do memo com a hora (opcional). |
| Horário quando o memo não tiver | Hora usada quando o memo só tem data. |
| Verificar a cada | Intervalo de verificação: 5, 15, 30 ou 60 minutos. |
| Antecedência padrão * | Uma ou mais: 15 min, 30 min, 1 hora, 2 horas, 1 dia, 2 dias… |
| Destinatário padrão | Quem registrou o memo, todos do grupo, owner do grupo ou e-mail fixo (vários separados por vírgula). |
| Lembrar também memos da importação em lote | Inclui memos criados pelo lote. |
| Campos que sobrepõem o padrão (avançado) | Seção recolhida "Campos do memo que sobrepõem o padrão": indica quais campos da categoria o sistema lê para "Lembrar antes", "Destinatário" e "Lembrete" (sim/não). |
| Texto da mensagem | Modelo do e-mail com variáveis. Padrão: "Lembrete: {categoria} em {data} às {hora}". Aceita nomes de campos, ex.: {Com quem}, {Aonde}. |
| Próximos lembretes (até 60 dias) | Prévia dos envios: memo, compromisso, antecedência, envio, para e situação. |
| Salvar / Excluir / Fechar | Grava, remove a configuração ou fecha sem salvar. |
## Antecedência por memo (campo "Lembrar antes")
Cada memo pode ter a própria antecedência, no lugar da antecedência padrão da categoria.
1. Na categoria (ex.: Agenda), criar o campo "Lembrar antes", do tipo texto, com uma descrição como "Antecedência do lembrete, ex.: 30 min, 2 horas, 1 dia; 2 dias; 1 hora".
2. No ícone de lembrete da categoria, abrir "Campos do memo que sobrepõem o padrão" e escolher o campo no seletor "Lembrar antes". Em regras novas o campo é sugerido sozinho.
3. Salvar. A partir daí a IA preenche o campo ao catalogar (ex.: "me avise 2 dias antes"), e o campo pode ser editado no memo.
| Texto no campo | Lembretes enviados |
|---|---|
| 30 min antes / meia hora | 1, 30 min antes |
| 1h30 / 1 hora e meia / 1,5 hora | 1, 1h30 antes |
| 2 dias e 1 hora | 1, 49 horas antes (as partes ligadas por "e" somam) |
| 2 dias; 1 hora | 2: um 2 dias antes e outro 1 hora antes |
| 2 dias, 1 hora | 2 (vírgula seguida de espaço também separa) |
| uma semana, 1 dia, 2 horas | 3 |
| vazio ou não entendido | vale a antecedência padrão da categoria |
NOTA: A antecedência do memo substitui a da categoria (não soma). Vírgula sem espaço ("1,5") é decimal; para separar lembretes use ";" ou ", ".
DICA: O campo não precisa entrar na Query padrão para os lembretes funcionarem: o envio lê o campo direto do memo.
## Funcionamento
- Um agendador no servidor verifica os memos a cada 5 minutos e envia os lembretes cujo horário chegou.
- Cada antecedência gera um lembrete, enviado uma única vez (ex.: 1 dia e 30 min marcados = 2 e-mails por compromisso).
- Lembrete cujo horário de envio já tinha passado quando o memo (ou a regra) foi criado não é enviado.
- Memos sem data válida são ignorados.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Lembrete não chegou | Conferir se a categoria está ativa para lembretes, se o memo tem data válida e se o e-mail não foi para o spam. Ver a prévia "Próximos lembretes". |
| Prévia vazia | Nenhum memo com data nos próximos 60 dias, ou "Campo de data" errado. |
| Horário errado | Memo sem hora: usa "Horário quando o memo não tiver". |
@@FIM

@@SEC27NOVA
# SEÇÃO 27 — Integrações externas (chave de API)
## Propósito
Sistemas externos, como o Softing-erp, podem fazer perguntas ao MyMemory em nome de um grupo sem login de usuário, usando uma chave de API do grupo.
## Funcionamento
- A chave é criada por um administrador e vinculada a um grupo e a um usuário de referência. Só o prefixo da chave fica visível depois de criada.
- O sistema externo envia a chave no cabeçalho da requisição para /api/perguntas.
- Pode enviar também o "contexto da tela" (tela, filtros e seleção de onde a pergunta partiu); a IA usa esse contexto para interpretar a pergunta.
- Chaves podem ser revogadas a qualquer momento; o uso fica registrado (último uso).
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| unauthorized | Chave ausente, revogada ou expirada. Gerar nova chave. |
| forbidden_group | A chave não pertence ao grupo informado. |
@@FIM

@@ADM_MIDIA
## Propósito
Define, para cada plano de assinatura, os limites e opções de processamento de cada tipo de mídia (tabela media_settings: uma linha por plano × tipo de mídia).
| Campo / Elemento | Descrição |
|---|---|
| Plano de assinatura | Seleciona o plano cujas configurações serão editadas. |
| Tipo de mídia | Texto, imagem, áudio, vídeo, documento, URL. |
| Arquivo grande (áudio / vídeo) | Tratamento de arquivos acima do limite (segmentação). |
| Texto / revisão | Opções de texto e da tela de revisão para o tipo. |
| Comprimir antes da IA | Reduz o arquivo antes de enviar à IA. |
| Segmento (min) | Duração de cada segmento de áudio/vídeo processado. |
| Máx. grande (KB) | Tamanho máximo aceito para o tipo. |
| Máx. chars resumo | Limite de caracteres do resumo gerado. |
| Mín. OCR imagem | Confiança mínima do OCR antes de recorrer à visão IA. |
NOTA: As configurações valem para todos os usuários do plano selecionado.
@@FIM

@@ADM_DOCIA
## Propósito
Define o roteamento dos documentos para os extratores de texto (JSON em ai_config.documentRoutingJson). Não é uma base de conhecimento: decide qual pipeline lê cada tipo de arquivo.
| Campo / Elemento | Descrição |
|---|---|
| Regras preprocess | Lista de regras por tipo/extensão; a primeira que coincidir é usada (a ordem importa). |
| Pipelines | extract_utf8_text (texto, .md, .csv), extract_pdf_text, extract_msg_text (Outlook .msg), extract_eml_text (e-mail .eml), extract_docx_text (Word), extract_xlsx_text (Excel) ou unsupported. |
| Salvar JSON | Grava o roteamento. Sem JSON gravado, vale o padrão do sistema (exibido na tela). |
NOTA: Um JSON inválido impede a extração de documentos. Copie o conteúdo atual antes de editar.
@@FIM

@@ADM_CAD
## Propósito
Habilita o processamento de arquivos CAD/BIM (.ifc). Quando desabilitado, o upload é aceito, mas o processamento retorna "Formato não suportado neste plano".
| Campo / Elemento | Descrição |
|---|---|
| Habilitar processamento CAD/BIM (.ifc) | Liga ou desliga a extração de arquivos IFC. |
| Arquivos .dwg | Aceitos em modo semIA (registro sem extração). A extração de DWG requer componente adicional no servidor. |
@@FIM

@@ADM_SYS
## Propósito
Parâmetros globais que afetam todos os usuários.
| Campo / Elemento | Descrição |
|---|---|
| Pesquisa semântica — limiares (Perguntar) | Limiar inicial e mínimo de similaridade. Quando a busca retorna vazio, o sistema reduz o limiar em 10% a cada tentativa até o mínimo. Valores de 0,01 a 1,00. |
| Busca Semântica de Memos | Limiar da busca semântica da tela Buscar (top 40 resultados acima do mínimo). Valores de 0 a 1,00. |
| Multiplicador USD → créditos (fatorCredCost) | Multiplica o custo em USD para calcular os créditos exibidos e descontados. Padrão: 100. |
@@FIM

@@ADM_PROMPT
## Propósito
Tela de diagnóstico: mostra fielmente o último payload enviado à API de IA (mensagens system/user) e a resposta recebida. O registro fica só na memória da API e se perde ao reiniciar.
| Campo / Elemento | Descrição |
|---|---|
| Último prompt | Provedor, modelo e origem (classificação, planejamento, extração…) da última chamada. |
| Mensagens | Conteúdo exato enviado e recebido. |
| Atualizar | Recarrega o último registro. |
NOTA: A edição dos prompts (com override por categoria) fica no Painel Admin → aba Prompts LLM. Para ver todas as etapas de uma pergunta específica, use "ver etapas" no card da resposta (Seção 8).
@@FIM

@@ADM_STORAGE_ADD
## Limpeza de arquivos órfãos
Na mesma tela, "Limpeza de Arquivos Órfãos" → "Verificar" lista arquivos no armazenamento que não pertencem mais a nenhum memo, para remoção. Quando não há nada a limpar, exibe "Nenhum arquivo órfão encontrado".
@@FIM

@@SEC_IMPORTAR
# SEÇÃO — Admin: Importar conhecimento
Rota: /admin/conhecimento (Painel Admin → Importar conhecimento)
## Propósito
Importa conhecimento já dividido em trechos — por exemplo o próprio Manual MyMemory (docs/manual-chunks/chunks-mymemory-operacional.jsonl) ou um FAQ interno — para dentro de um grupo. Cada trecho vira um memo de texto com categoria, campos e vetores da busca semântica, sem passar pela IA de extração. Depois disso, as perguntas feitas no grupo passam a ser respondidas também com esses trechos.
Cada importação leva um Nome do manual (origem). Vários manuais podem dividir a mesma categoria: Substituir e Remover só afetam os trechos do manual com o mesmo nome.
## Antes de importar
1. Na Estrutura do contexto, criar a categoria de destino (ex.: "Manual MyMemory") no grupo ou como global.
2. Criar nela os campos Seção, Tela, Rota, Perfil, Tipo e Versão. Os nomes são casados com ou sem acento ("Secao" = "Seção").
3. Ter o arquivo .jsonl com um trecho por linha (campos obrigatórios: id e texto).
## Como importar
1. Abrir Admin → Importar conhecimento.
2. Escolher o grupo que vai consultar o conhecimento.
3. Escolher a categoria (as globais aparecem com "(global)"). Uma categoria com "manual" no nome é pré-selecionada.
4. Escolher o arquivo .jsonl. A tela mostra quantos trechos foram lidos.
5. Conferir o Nome do manual (origem). Ele vem preenchido com o nome do arquivo; trocar por um nome que identifique o manual (ex.: "Manual e-Pedidos — Suporte"). É obrigatório e deve ser diferente para cada manual.
6. Manter marcado "Substituir os trechos já importados deste manual nesta categoria" só ao reimportar uma versão nova do mesmo manual. Para acrescentar um manual novo à categoria, o nome diferente já protege os outros.
7. Clicar Importar. Leva de um a dois minutos para 200 trechos (o sistema gera os vetores de cada um).
## Campos da tela
| Campo / Elemento | Descrição |
|---|---|
| Grupo | Grupo onde os memos serão criados. Só os membros desse grupo terão respostas a partir deles. |
| Categoria | Categoria dos memos. Precisa estar disponível para o grupo (do grupo ou global). |
| Arquivo de trechos | .jsonl (um JSON por linha) ou .json com uma lista. Cada trecho: id, texto e, opcionalmente, secao, tela, rota, perfil, tipo, versao. |
| Nome do manual (origem) | Identifica de qual manual são os trechos. Aparece depois de escolher o arquivo, preenchido com o nome do arquivo, e é obrigatório. |
| Substituir | Desativa, antes de criar os novos, apenas os trechos já importados com o mesmo Nome do manual na mesma categoria e grupo. Trechos de outros manuais da categoria não são alterados. |
| Importar | Cria os memos e mostra o resultado: criados, substituídos e erros. |
| Já importado neste grupo | Lista, por categoria e manual (origem), a quantidade de trechos, a versão e a data da última importação, com o botão Remover de cada manual. |
## Regras importantes
- O texto entra exatamente como no arquivo (sem acentos, como todos os memos do sistema); a IA não reescreve nem classifica.
- Não há custo de IA de extração; só a geração dos vetores da busca semântica (alguns centavos para 200 trechos).
- Os memos importados aparecem nos Recentes do grupo e podem ser abertos e editados como qualquer memo de texto.
- Remover desativa os memos do manual da linha (exclusão lógica); eles deixam de ser usados nas respostas. Os outros manuais da categoria continuam ativos.
- Antes desta versão o Substituir e o Remover desativavam todos os trechos importados da categoria, de qualquer manual. Por isso, vale usar um Nome do manual diferente para cada manual e conferir a lista "Já importado" antes de marcar Substituir.
- Trechos importados antes do campo de origem usam o nome do arquivo como origem.
- A Importação em Lote (Seção 16) não serve para isso: pelo WebDAV ela não lê o conteúdo dos arquivos e não aplica IA.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Linha N não é JSON válido | O arquivo não está no formato JSON Lines. Gerar de novo com docs/manual-v2-fonte/gerar_trechos.py. |
| Trecho N sem "id" ou "texto" | Cada linha precisa ter os campos id e texto. |
| Categoria não disponível para este grupo | A categoria é de outro grupo. Usar uma categoria do grupo ou global. |
| Importei um manual e os trechos de outro sumiram | Importação feita antes desta versão, ou com o mesmo Nome do manual com Substituir marcado. Os trechos só foram desativados: pedir à equipe técnica para reativá-los (script docs/sql/recuperar_conhecimento_substituido.sql) ou reimportar os arquivos originais com outro nome de manual. |
| Perguntas não usam os trechos importados | Conferir se a pergunta foi feita no mesmo grupo da importação e se a busca semântica está ativa (OPENAI_API_KEY configurada). |
@@FIM

@@SEC16_AUTO
## Automatizar (importação automática)
O botão "⏱ Automatizar" (ao lado de Verificar e Processar, em espaço de grupo) faz o servidor verificar a pasta periodicamente e importar sozinho os arquivos novos com situação Pronto. Suspeitos e já cadastrados ficam de fora. Disponível para Disco Local, Rede Local e WebDAV; owner e editor do grupo podem criar.
1. Informe a pasta e o nível de IA na tela e clique em "⏱ Automatizar".
2. A janela verifica a pasta na hora. Se não der, mostra o motivo em vermelho (ex.: pasta não encontrada, fora da whitelist, WebDAV fora do ar) e o botão "Verificar de novo". Só salva com a pasta acessível.
3. Escolha o intervalo, o nível de IA, o máximo de arquivos por execução e as opções, e clique em Salvar.
| Campo / Elemento | Descrição |
|---|---|
| Verificar a cada | 15 minutos, 30 minutos, 1 hora, 6 horas ou 1 dia. |
| Nível de IA | Sem IA, Básico ou Completo. Só o Completo gera os vetores da busca semântica do Perguntar. |
| Máximo por execução | Limite de arquivos importados por vez (1 a 500). O que passar fica para a próxima. |
| Copiar o arquivo para o armazenamento | Marcado: copia o arquivo como o Catalogar (S3/local ou WebDAV padrão do grupo). Desmarcado: só referencia o arquivo na pasta (Guarda própria). |
| Enviar resumo por e-mail | Resumo para quem criou a automação quando importar algo ou der erro. |
| Ativa | Desmarcada = pausada. |
## Lista de importações automáticas
Abaixo do formulário aparecem as automações do espaço com pasta, intervalo, nível de IA, situação (Ativa, Pausada ou Executando), última execução com o resultado e a próxima execução. Ações: Executar agora, Pausar/Reativar, Editar, Histórico (últimas execuções com os erros por arquivo) e Excluir (os memos já importados continuam).
## Como a automação roda
- Um robô no servidor confere a cada 5 minutos quais automações chegaram na hora; cada uma roda no seu intervalo.
- Arquivo que ainda está sendo copiado para a pasta (tamanho mudando) fica para a próxima execução.
- Se o servidor reiniciar no meio, a próxima execução continua: o que já foi importado aparece como "Já cadastrado".
- Os memos são de quem criou a automação, exceto em categoria Pessoal (campo dono).
- Pausa sozinha após 3 falhas seguidas de acesso à pasta, ou se quem criou deixar de ser owner/editor do grupo, e avisa por e-mail.
- Créditos de IA do mês acima do limite do plano aparecem no resumo; por enquanto a importação continua.
## Enviar arquivos para a pasta automaticamente
A automação importa o que chega na pasta; quem coloca os arquivos lá é um aplicativo ou equipamento, fora do MyMemory. Use como destino o servidor WebDAV (URL, usuário e senha) e a mesma pasta da automação.
| Origem | Como configurar |
|---|---|
| Celular Android | App FolderSync (ou o app do Nextcloud, opção "Envio automático"): crie uma conta WebDAV, escolha a pasta do celular (Câmera, Downloads, Documentos do WhatsApp…) e a pasta de destino no WebDAV, com sincronização "só enviar" e agendamento ou envio imediato. |
| iPhone | App PhotoSync ou Documents (Readdle): adicione o servidor WebDAV e ative o envio automático de fotos/arquivos para a pasta. O app Atalhos também permite automações como "ao salvar um arquivo, enviar para o WebDAV". |
| Scanner ou multifuncional | Configure o destino "digitalizar para pasta de rede/WebDAV" apontando para a pasta da automação. |
| E-mail | Use um serviço de automação (Make, Zapier ou n8n) com a regra "e-mail recebido → salvar anexos (ou o texto como .txt) na pasta WebDAV". Um filtro no Gmail/Outlook encaminhando só o que interessa completa o fluxo. |
DICA: Prefira formatos que a importação lê bem (PDF, imagens, documentos do Office, .txt). Áudio e vídeo ainda não são transcritos na importação em lote.
NOTA: A URL do WebDAV precisa estar liberada no servidor (BATCH_ALLOWED_WEBDAV_URLS); se a janela do Automatizar mostrar "fora da whitelist", peça ao administrador.
## Memos sem dono identificado
Em categoria Pessoal, a importação (manual ou automática) grava o memo para o membro do grupo cujo e-mail (exato) ou nome (único no grupo) está no campo dono da categoria. Não identificado, o memo fica com quem importou e entra na lista "Memos sem dono identificado", com o valor encontrado e o motivo. Escolha o membro em "Atribuir a" e clique em Atribuir.
@@FIM

@@SEC17_PESSOAL
## Categoria Pessoal e campo dono
Em "Editar categoria" há a opção "Pessoal — cada memo pertence a uma pessoa". Nas perguntas, "minha agenda" ou "meus registros" mostram só os memos da própria pessoa; para ver todos, pergunte "de todos".
- Marcada a opção, escolha o "Campo dono do memo": o campo com o e-mail ou o nome da pessoa (crie um campo como "Dono Agenda" se não existir).
- Na importação em lote, manual ou automática, o memo passa a ser do membro do grupo indicado nesse campo. Não identificado, vai para "Memos sem dono identificado" na Importação em Lote.
- No Catalogar e ao editar um memo, vale a mesma regra: se o campo dono indicar outro membro do grupo, o memo passa a ser dele ao salvar. Vazio, o próprio autor ou nome não reconhecido: o memo continua de quem salvou (sem ir para a lista de pendentes).
- Só o dono edita o memo: depois de passar para outro membro, quem catalogou não consegue mais editá-lo.
- O membro é reconhecido pelo e-mail, pelo nome completo ou pelo primeiro nome (quando único no grupo), sem diferenciar acento e maiúsculas.
### De quem são os memos na pergunta
| Pergunta | Memos considerados nas categorias Pessoal |
|---|---|
| Sem citar ninguém ("qual minha agenda amanhã") | Os de quem pergunta. |
| Citando um membro ("qual a agenda do Suporte amanhã") | Os desse membro. |
| Citando mais de um membro, ou nome que serve a vários | Os de todos, com aviso na resposta. |
| "de todos", "do grupo", "da equipe" | Os de todos. |
A resposta informa o escopo aplicado (ex.: Mostrando só os memos de Suporte em "Agenda").
- Se a pergunta não cita ninguém e nada é encontrado nos seus memos, a busca é refeita nos memos de todos e a resposta avisa: "Nada encontrado nos seus memos; mostrando os de todos."
- Uma mesma expressão da pergunta ("sr. Wilson da FAPESP") é buscada inteira num só campo (o de descrição mais adequada, ex.: Com quem), nunca dividida entre dois campos.
- Resposta sem nenhum resultado aparece com confiança baixa: não encontrar não é certeza de que o registro não existe. Tente "Ampliar busca" ou "de todos".
NOTA: Membro com nome de palavra comum (ex.: "Suporte") é reconhecido mesmo quando a palavra aparece em outro sentido ("agenda de suporte técnico").
## Categoria Atualizável
Em "Editar categoria", a opção "Atualizável — os memos mudam de situação" serve para agenda, tarefas, pedidos: registros que depois são remarcados, concluídos ou cancelados.
- Ao marcar, o sistema usa o campo "Situação" da categoria (ou cria um), com os padrões Ativo, Concluído e Cancelado — as mesmas três situações em todas as categorias atualizáveis. Memo sem situação conta como Ativo.
- Nas respostas do Perguntar, os memos da categoria podem ser alterados, concluídos ou cancelados (ver seção 8).
- Perguntas: a Query padrão esconde Concluído e Cancelado, a menos que a pergunta peça pela situação ("o que foi cancelado este mês?"). Queries editadas à mão não ganham esse filtro automaticamente.
- Lembretes: memos concluídos ou cancelados não geram aviso. Remarcar (mudar data ou hora) já reprograma o lembrete.
| Situação | Significa | Agenda | Tarefa | Pedido |
|---|---|---|---|---|
| Ativo | vale, em andamento | marcado | aberta | em aberto |
| Concluído | terminou | aconteceu | feita | entregue |
| Cancelado | não vai acontecer | desmarcado | desistida | cancelado |
NOTA: Remarcar não é uma situação: o memo continua Ativo e a mudança de data ou hora fica no registro de alterações.
- A aba Perfis do painel mostra a marca Pessoal só para leitura; a configuração fica na categoria.
@@FIM

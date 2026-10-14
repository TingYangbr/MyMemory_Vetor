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
| Autenticação por chave de API para integrações externas (ex.: Softing-erp) com contexto da tela | Seção 27 |
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
| Texto | Comparação "contém", sem acento e sem diferenciar maiúsculas. |
| Data | mymemory_parse_date: aceita dd/mm/aaaa, aaaa-mm-dd, AAAA/MM/DD, "10 de outubro de 2026" e texto após a data. Data inválida fica fora do filtro, sem erro. |
| Número | mymemory_parse_number: aceita vírgula decimal e milhar ("R$ 1.500,25" = 1500,25) e o primeiro número do texto ("3 quartos" = 3). Durações viram horas: "4 horas" = 4, "1h30" = "1:30" = "uma hora e meia" = "90 minutos" = 1,5, "meia hora" = 0,5. Sem número, fica fora do filtro, sem erro. |
NOTA: Em queries editadas à mão, use mymemory_parse_date(...) e mymemory_parse_number(...) em vez de ::date e ::numeric para não quebrar a pergunta quando um memo tiver texto livre.
## Descrição do campo
A descrição de cada campo é enviada à IA na extração dos memos e no planejamento das consultas. Ela é o principal meio de evitar que um termo da pergunta seja ligado ao campo errado (ex.: "cliente Genea" indo para Vendedor). Descreva o significado e, se útil, valores possíveis (ex.: "Situação do título: EM ABERTO ou LIQUIDADO").
- "Padrões" (termos normalizados) são valores aceitos separados por vírgula, usados para normalizar o que a IA extrai. Deixe vazio em campos de data e hora.
## Parâmetros das queries
| Convenção | Uso |
|---|---|
| :param (PostgreSQL) / @param (SQL Server) | Placeholder no SQL. O nome do parâmetro é o nome do campo sem acento, em minúsculas, com "_" (ex.: Abrev_Empresa → abrev_empresa). |
| Operador LIKE | Por padrão o sistema faz comparação exata; usa "contém" só quando a pergunta pede busca parcial ("contendo", "começa com"). |
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
Na Estrutura do contexto, clicar no 🔔 da categoria. Disponível para admin e owner do grupo.
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
| Campos que sobrepõem o padrão (avançado) | Campos do memo para "Lembrar antes", "Destinatário" e "Lembrete" (sim/não). |
| Texto da mensagem | Modelo do e-mail com variáveis. Padrão: "Lembrete: {categoria} em {data} às {hora}". Aceita nomes de campos, ex.: {Com quem}, {Aonde}. |
| Próximos lembretes (até 60 dias) | Prévia dos envios: memo, compromisso, antecedência, envio, para e situação. |
| Salvar / Excluir / Fechar | Grava, remove a configuração ou fecha sem salvar. |
## Funcionamento
- Um agendador no servidor verifica os memos a cada 5 minutos e envia os lembretes cujo horário chegou.
- Cada lembrete é enviado uma única vez por memo e antecedência.
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

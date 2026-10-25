MyMemory
Manual Operacional de Suporte
Indexado por telas · Versão 2 — outubro de 2026
Este documento descreve todas as telas do sistema MyMemory, seus campos, comportamentos e procedimentos de suporte ao usuário. Destinado a atendentes, administradores e equipe técnica.
# ÍNDICE
- Novidades da versão 2
- Seção 1 — Login
- Seção 2 — Criar Conta / Selecionar Plano
- Seção 3 — Verificação de E-mail / Recuperação de Senha
- Seção 4 — Tela Principal (Home)
- Seção 5 — Catalogar Memo (todos os tipos de mídia)
- Seção 6 — Telas de Revisão pós-upload
- Seção 7 — Buscar Memos
- Seção 8 — Perguntar ao MyMemory
- Seção 9 — Perguntas salvas com parâmetros
- Seção 10 — Editar Memo
- Seção 11 — Minha Conta / Preferências
- Seção 12 — Avisos
- Seção 13 — Grupos: Criar / Entrar
- Seção 14 — Painel do Owner do Grupo
- Seção 15 — Aceitar Convite de Grupo
- Seção 16 — Importação em Lote
- Seção 17 — Estrutura de Contexto / Categorias
- Seção 18 — Lembretes por e-mail
- Seção 19 — Painel Admin Principal
- Seção 20 — Admin: Mídia por plano
- Seção 21 — Admin: Documento — roteamento IA
- Seção 22 — Admin: CAD/BIM — Pipeline IA
- Seção 23 — Admin: Config. do Sistema
- Seção 24 — Admin: Último prompt LLM
- Seção 25 — Admin: Assinaturas
- Seção 26 — Admin: Storage por Grupo
- Seção 27 — Admin: Importar conhecimento
- Seção 28 — Integrações externas (chave de API)
- Seção 29 — Erros Comuns e Soluções
- Seção 30 — Referência Rápida Admin
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
| Importação automática de pasta (⏱ Automatizar) e lista "Memos sem dono identificado" | Seção 16 |
| Categoria Pessoal e campo dono configurados na própria categoria | Seção 17 |
| Campo dono aplicado também no Catalogar e na edição; pergunta que cita um membro ("agenda do Suporte") mostra os memos dele | Seção 17 |
| Renomear um campo atualiza os memos já gravados e as queries da categoria | Seção 17 |
| Extração mais fiel: endereços e nomes copiados como no texto, tempo sempre com unidade, "eu/me" = autor do memo | Seção 17 |
| Perguntas comparam texto dos memos por palavras ("sr. Wilson" acha "Sr. Wilson da FAPESP") | Seção 17 |
| Sem resultado nos seus memos Pessoal, a pergunta busca nos de todos (com aviso); resposta vazia com confiança baixa | Seção 17 |
| Autenticação por chave de API para integrações externas (ex.: Softing-erp) com contexto da tela | Seção 28 |
| Correção: descrição das telas admin Mídia por plano, Documento — roteamento IA, CAD/BIM, Config. do Sistema e Último prompt LLM (estavam incorretas na v1) | Seções 20 a 24 |
# SEÇÃO 1 — Login
Rota: /login
## Objetivo
Permite que um usuário cadastrado acesse o sistema inserindo e-mail e senha.
## Campos
| Campo / Elemento | Descrição |
|---|---|
| E-mail | Campo de texto do tipo e-mail. Obrigatório. |
| Senha | Campo de senha (ocultado). Obrigatório. |
| Botão Entrar | Envia as credenciais. Fica desabilitado enquanto autentica. |
| Link Criar conta | Redireciona para /select-plan para novo cadastro. |
| Link Esqueci a senha | Redireciona para /esqueci-senha. |

## Comportamentos
- Após login bem-sucedido, redireciona para a página de origem (parâmetro ?next=) ou para / (home).
- Se o e-mail não estiver verificado, exibe erro com código email_not_verified e botão 'Reenviar e-mail de confirmação'.
- O reenvio chama o endpoint /api/auth/resend-verification e exibe mensagem de sucesso ou falha inline.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Senha ou e-mail incorretos | Credenciais erradas. Usuário deve tentar novamente ou usar 'Esqueci a senha'. |
| Confirme seu e-mail antes de entrar | Conta criada mas e-mail não verificado. Usar botão 'Reenviar' exibido na mesma tela. |
| Não foi possível conectar à API | Servidor da API inacessível. Verificar se o container da API está em execução (docker compose ps). |

# SEÇÃO 2 — Criar Conta / Selecionar Plano
Rotas: /select-plan → /cadastro
## Fluxo de cadastro
- 1. Usuário acessa /select-plan e escolhe um plano (individual, pode ser gratuito).
- 2. Sistema redireciona para /cadastro?planId=X, onde X é o ID do plano escolhido.
- 3. Usuário preenche nome, e-mail e senha (mínimo 8 caracteres).
- 4. Sistema cria a conta e envia e-mail de confirmação via Resend.
- 5. Tela exibe mensagem de sucesso pedindo que o usuário verifique o e-mail.
## Campos do formulário de cadastro
| Campo / Elemento | Descrição |
|---|---|
| Nome | Texto. Obrigatório. Mínimo 2 caracteres. |
| E-mail | E-mail único no sistema. Obrigatório. |
| Senha | Mínimo 8 caracteres. Obrigatório. |
| Botão Cadastrar | Desabilitado enquanto processa. |

## Casos especiais
- Se o e-mail já estiver cadastrado, exibe erro email_taken com links para Login e Esqueci a senha.
- Se o envio do e-mail falhar (Resend), o registro continua e a tela exibe instruções detalhadas de diagnóstico (verificar logs Resend, aba spam, etc.).
- Se o usuário vier de um convite de grupo (?inviteToken=), o cadastro já vincula ao grupo automaticamente.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| E-mail já cadastrado | Usuário já tem conta. Usar link 'Entrar' ou 'Esqueci a senha'. |
| E-mail de confirmação não chegou | Verificar spam / Promoções. Se ainda não chegou, usar botão 'Reenviar' na tela de login. |
| Senha muito curta | Senha precisa ter ao menos 8 caracteres. |

# SEÇÃO 3 — Verificação de E-mail / Recuperação de Senha
Rotas: /verificar-email · /esqueci-senha · /redefinir-senha
## Verificação de E-mail (/verificar-email)
O usuário chega a esta tela pelo link enviado por e-mail. O token da URL é consumido automaticamente. Se válido, a conta é ativada e o usuário pode fazer login. Se expirado ou inválido, exibe erro e botão para reenviar.
## Esqueci a senha (/esqueci-senha)
- Usuário informa o e-mail cadastrado.
- Sistema envia e-mail com link para redefinição (válido por tempo limitado).
- Mensagem de sucesso é exibida mesmo que o e-mail não exista (segurança).
## Redefinir senha (/redefinir-senha)
- Usuário chega pelo link recebido no e-mail.
- Preenche nova senha (mínimo 8 caracteres) e confirmação.
- Após sucesso, redireciona para login.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Link de verificação inválido ou expirado | Reenviar e-mail via tela de Login → botão 'Reenviar'. |
| Link de redefinição expirado | Refazer o processo em /esqueci-senha para gerar novo link. |
| E-mail não chegou para redefinição | Verificar spam. Se persistir, conferir config Resend no servidor. |

# SEÇÃO 4 — Tela Principal (Home)
Rota: /
## Visão geral
A tela principal é o ponto central do sistema. Ela tem três abas: Perguntar, Buscar e Catalogar. A aba ativa é salva no localStorage (mm_home_tab) e restaurada na próxima visita.
## Cabeçalho (Header)
| Campo / Elemento | Descrição |
|---|---|
| Logotipo / Nome do sistema | Clique retorna à home. |
| Indicador de espaço ativo | Mostra o grupo atual ou 'Pessoal'. Clique abre o Seletor de Espaço. |
| Menu de usuário | Acesso a Minha Conta, Importação em Lote, Estrutura de Contexto, Avisos, Admin (se admin), Sair. |

## Seletor de Espaço (Workspace Picker)
Aparece quando o usuário clica no indicador de espaço ou acessa /?escolherEspaco=1.
- Exibe card 'Meus Memos Pessoais' e cards de cada grupo do qual faz parte.
- Card do grupo com isOwner=true exibe link extra 'Painel do owner'.
- Botões: 'Criar novo grupo' → /grupo/novo · 'Entrar em outro Grupo' → /grupo/entrar · 'Cancelar'.
## Aba Perguntar
Ver Seção 8 — Perguntar ao MyMemory.
## Aba Buscar
Ver Seção 7 — Buscar Memos.
## Aba Catalogar
Ver Seção 5 — Catalogar Memo.
Abaixo do painel de catalogação, a lista de Memos Recentes exibe os últimos registros do espaço ativo.
## Comportamentos importantes
- Redireciona para /login se sessão inválida (HTTP 401 na chamada /api/me).
- Limites de mídia são carregados de /api/me/media-limits e bloqueiam tipos de upload quando o plano está esgotado.
- Ao voltar da edição de um memo (MemoEditPage), a lista de recentes é recarregada automaticamente (state.memoSavedAt).
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Não foi possível validar a sessão (HTTP 4xx) | Sessão expirada. Fazer login novamente. |
| Não foi possível conectar à API | API offline. Verificar container. |
| Não é possível catalogar este tipo de arquivo | Limite do plano atingido para aquele tipo de mídia. |

# SEÇÃO 5 — Catalogar Memo (todos os tipos de mídia)
Componente: MemoRegisterPanel (dentro da aba Catalogar na Home)
## Tipos de memo suportados
| Campo / Elemento | Descrição |
|---|---|
| Texto | Digitado diretamente na caixa de texto. |
| Imagem | Upload de foto ou imagem (JPG, PNG, WebP, etc.). |
| Áudio | Upload ou gravação direta pelo microfone. |
| Vídeo | Upload de arquivo de vídeo. |
| Documento | PDF, Word, Excel, PowerPoint e similares, enviados pelo seletor de arquivo. |
| URL | Endereço web. O sistema faz scraping do conteúdo. |
| 📂 Guarda própria ↗ | Atalho para a Importação em Lote: catalogar arquivos que continuam no servidor do cliente. |

## Fluxo geral de catalogação
- 1. Usuário seleciona o tipo de mídia (abas ou ícones no painel).
- 2. Insere o conteúdo (texto digitado, arquivo arrastado/selecionado, ou URL digitada).
- 3. Se confirmEnabled=true (configuração do usuário), aparece tela de confirmação antes do envio.
- 4. Arquivo é enviado ao backend → pipeline de IA extrai texto, palavras-chave, categoria e dados específicos.
- 5. Memo aparece na lista de Recentes abaixo do painel.
- 6. Se soundEnabled=true, toca som ao concluir.
## Níveis de IA por tipo de mídia
| Campo / Elemento | Descrição |
|---|---|
| semIA | Armazena o conteúdo bruto. Nenhuma extração. Mais rápido e sem custo de API. |
| basico | Extrai palavras-chave e tenta classificar a categoria. Custo baixo. |
| completo | Extrai campos estruturados (dadosEspecificosJson) além de palavras-chave e categoria. Custo maior. |

NOTA: O nível de IA é configurável por tipo de mídia em Minha Conta → Preferências.
## Processamento de imagem
- 1. OCR via Tesseract.js extrai texto da imagem.
- 2. Se a confiança do OCR ficar abaixo do limiar configurado (imageOcrVisionMinConfidence), o sistema usa visão IA (OpenAI Vision) para re-extrair.
- 3. O texto resultante segue o pipeline normal (keywords, categoria, campos).
## Processamento de áudio e vídeo
- Áudio: transcrição via OpenAI Whisper.
- Vídeo: extração do áudio com FFmpeg → transcrição Whisper → pipeline de texto.
NOTA: FFmpeg precisa estar instalado no servidor. Sem ele, upload de vídeo falha.
## Processamento de documento
- PDF/Office: extração de texto via biblioteca de parsing de documentos → pipeline de texto.
## Processamento de URL
- Sistema faz scraping da URL e extrai o texto principal da página.
- Se a URL apontar diretamente para um arquivo de áudio, ou a página tiver pouco ou nenhum texto mas houver um player de áudio embutido, o sistema transcreve a narração automaticamente via IA (OpenAI Whisper), respeitando um limite de 20 MB por áudio.
- O texto segue o pipeline normal.
## Espaço ativo (workspace)
O memo é sempre criado no espaço ativo exibido no header. Para mudar, usar o Seletor de Espaço.
## Guarda própria
O último tile do Catalogar, "📂 Guarda própria ↗ — arquivos no seu servidor", abre a Importação em Lote (Seção 16). Serve para catalogar arquivos que continuam no disco, na rede ou no WebDAV do cliente, sem copiá-los para o MyMemory. Substitui o antigo tile "Documento / arquivo"; documentos avulsos continuam sendo enviados pelo seletor de arquivo.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Arquivo muito grande / tipo não suportado | Verificar limites do plano em Minha Conta → Sua utilização. |
| Transcrição falhou (áudio/vídeo) | FFmpeg pode não estar instalado ou áudio corrompido. |
| OCR retornou texto vazio | Imagem pode ser muito baixa resolução ou texto muito pequeno. |
| URL não acessível | Site bloqueou scraping. O memo será criado com texto mínimo. |
| Áudio da URL muito grande (acima de 20 MB) | Limite de transcrição automática via Whisper; catalogar o áudio separadamente pelo tipo Áudio. |

# SEÇÃO 6 — Telas de Revisão pós-upload
Rotas: /revisao/memo-texto · /revisao/memo-imagem · /revisao/memo-audio · /revisao/memo-video · /revisao/memo-documento
## Propósito
Essas telas são exibidas quando confirmEnabled=true (preferência do usuário). O usuário vê o conteúdo capturado e pode revisar antes de enviar ao processamento de IA.
## Campos comuns a todas as telas de revisão
| Campo / Elemento | Descrição |
|---|---|
| Pré-visualização do conteúdo | Texto extraído, imagem miniatura, áudio reproduzível, etc. |
| Botão Confirmar e catalogar | Envia para o pipeline de IA. |
| Botão Descartar | Cancela e volta à home sem salvar. |

## Comportamentos específicos
- Memo Áudio: exibe player de áudio para o usuário ouvir a gravação antes de confirmar.
- Memo Imagem: exibe a imagem em miniatura e o texto extraído pelo OCR (se houver).
- Memo Vídeo: exibe miniatura do vídeo.
- Memo Documento: exibe o nome do arquivo e tamanho.
NOTA: Se o usuário fechar o navegador antes de confirmar, o arquivo não é salvo. Nenhuma ação de recuperação é possível.
# SEÇÃO 7 — Buscar Memos
Rota: / (aba Buscar) · Componente: MemoSearchPage
## Modos de busca
| Campo / Elemento | Descrição |
|---|---|
| Textual | Pesquisa por palavras-chave no texto dos memos (full-text search com expansão de sinônimos). |
| Semântica | Pesquisa por similaridade de significado usando embeddings vetoriais. Encontra memos relacionados mesmo sem as mesmas palavras. |

## Filtros disponíveis
| Campo / Elemento | Descrição |
|---|---|
| Texto da busca | Campo principal. Aceita texto livre. |
| Tipo de mídia | Filtro por texto, áudio, imagem, vídeo, documento, URL. |
| Categoria | Filtro pela categoria atribuída ao memo. |
| Data início / Data fim | Filtra por data de criação do memo. |
| Grupo | Busca dentro do espaço ativo (pessoal ou grupo selecionado). |

## Resultados
- Exibidos em lista paginada (botão 'Carregar mais').
- Cada card mostra: tipo, data, resumo, palavras-chave, categoria, custo de IA.
- Clique no card abre o memo para edição (/memo/:id/editar).
- Na busca semântica, cada resultado exibe o score de similaridade.
## Microfone (se soundEnabled=true)
Ícone de microfone ao lado do campo de texto. Clique inicia gravação por voz; o texto transcrito é inserido automaticamente no campo de busca.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Nenhum resultado encontrado | Nenhum memo corresponde aos filtros. Tentar termos mais amplos ou remover filtros. |
| Busca semântica indisponível | Módulo de embeddings não configurado ou sem créditos de IA. |
| Microfone bloqueado | Permissão de microfone negada no navegador. Liberar em configurações do browser. |

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
# SEÇÃO 10 — Editar Memo
Rota: /memo/:id/editar
## Acesso
Clique em 'Editar' em qualquer card de memo na busca, na lista de recentes ou em resultados do Perguntar.
## Campos editáveis
| Campo / Elemento | Descrição |
|---|---|
| Texto do memo (mediaText) | Corpo principal do memo. Textarea de edição livre. |
| Palavras-chave | Separadas por vírgula. Sistema deduplica automaticamente ao salvar. |
| Categoria | Dropdown com as categorias disponíveis para o espaço ativo. |
| Dados específicos | JSON de campos estruturados (chave: valor). Editor colorido: chaves em cinza, valores em verde. |

## Campos somente leitura (exibidos, não editáveis)
| Campo / Elemento | Descrição |
|---|---|
| Metadados do arquivo (mediaMetadata) | JSON com informações técnicas do arquivo (codec, resolução, duração, etc.). Exibido como texto formatado. |
| Tipo de mídia | Texto, Imagem, Áudio, etc. |
| Data de criação | Data e hora do registro. |
| Custo de IA | Custo em USD e créditos consumidos no processamento. |

## Badge de Storage
Se o memo estiver armazenado em WebDAV (armazenamento externo), aparece um badge colorido no cabeçalho com o nome do provedor (ex.: 'WEBDAV'). Clicar no badge abre um modal com:
- Provedor de armazenamento
- Nome do arquivo original
- URL/localização do arquivo no servidor externo
DICA: Este badge é útil para diagnóstico: confirma que o arquivo foi enviado ao destino correto.
## Ações
| Campo / Elemento | Descrição |
|---|---|
| Salvar alterações | Persiste as edições. Redireciona de volta para a tela de origem. |
| Cancelar | Volta para a origem sem salvar. |

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Você não tem permissão para editar este memo | Memo pertence a outro usuário ou o usuário não é editor do grupo. |
| Memo não encontrado | ID inexistente ou memo excluído. |
| Informe o texto do memo | Campo mediaText está vazio — obrigatório para salvar. |

# SEÇÃO 11 — Minha Conta / Preferências
Rota: /conta/preferencias
## Abas disponíveis
| Campo / Elemento | Descrição |
|---|---|
| Preferências de memo | Configurações de comportamento ao catalogar. |
| Sua utilização | Dashboard de uso do plano. |
| Perguntas salvas | Lista de perguntas salvas no Perguntar. |
| Meus Avisos (link) | Redireciona para /avisos. |

## Aba: Preferências de memo
| Campo / Elemento | Descrição |
|---|---|
| Confirmar antes do envio à IA | Se ativo, exibe tela de revisão antes de processar. Se desativo, envia direto. |
| Dados específicos livres | Se ativo, IA pode preencher campos estruturados mesmo sem match de categoria. |
| Áudio habilitado | Ativa narração de respostas e microfone para busca/perguntas. |
| Velocidade de narração | Slider de 0.5× (lento) a 2.0× (rápido). Aparece somente se áudio ativado. |
| Confiança mínima do OCR | Valor 1–100. Abaixo deste valor, aciona visão IA para imagens. Deixar em branco = desligado. |
| Uso de IA por tipo de mídia | Para cada tipo (Texto, Imagem, Vídeo, Áudio, Documento, URL): semIA / basico / completo. |

## Aba: Sua utilização
| Campo / Elemento | Descrição |
|---|---|
| Memos | Total de memos criados vs. limite do plano. |
| Armazenamento | GB usados vs. limite do plano. |
| Créditos IA (mês) | Créditos consumidos no mês atual vs. limite mensal. |
| Downloads (mês) | GB de downloads no mês atual vs. limite mensal. |

NOTA: Créditos e downloads são contados no mês civil atual. Limites vêm do plano individual ou do plano de grupo (se o usuário for owner de um grupo assinante).
## Aba: Perguntas salvas
Lista todas as perguntas salvas pelo usuário. Por pergunta: texto, anotações, estrelas (1–5), grupo ou pessoal. Perguntas com ⚡ guardam também o plano com parâmetros (Seção 9); editar o texto remove o plano.
- Clicar no texto da pergunta abre o modo edição inline.
- Botão ✕ exclui a pergunta.
- No modo edição: campos de texto e anotações + seletor de estrelas + Salvar / Cancelar / Excluir.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| O banco de dados ainda não inclui colunas de preferências | Migração pendente. Admin deve executar: npm run migration:run no container da API. |
| Preferências não salvas | Verificar erro exibido abaixo do botão. Pode ser falha de API. |

# SEÇÃO 12 — Avisos
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
# SEÇÃO 13 — Grupos: Criar / Entrar
Rotas: /grupo/novo · /grupo/entrar
## Criar novo grupo (/grupo/novo)
| Campo / Elemento | Descrição |
|---|---|
| Nome do grupo | Texto. Obrigatório. |
| Descrição | Texto opcional. |
| Botão Criar | Cria o grupo. O criador torna-se owner automaticamente. |

Após criar, o sistema redireciona para o Seletor de Espaço ou para o Painel do Owner.
## Entrar em grupo (/grupo/entrar)
Tela de instrução: para entrar em um grupo, o usuário precisa de um convite enviado pelo owner. O link de convite chegará por e-mail.
DICA: O owner envia convites pelo Painel do Owner → aba Convites.
# SEÇÃO 14 — Painel do Owner do Grupo
Rota: /grupo/:groupId/painel
## Acesso
Disponível apenas para o owner do grupo. Link visível no Seletor de Espaço e no menu de navegação superior.
## Abas do painel
### Configurações avulsas
| Campo / Elemento | Descrição |
|---|---|
| Dados específicos livres | Igual à preferência pessoal, mas aplicada a todos os memos do grupo. Quando ativo, pipeline de texto pode gerar dados específicos mesmo sem match de categoria. |

### Convites
Permite convidar novos membros ao grupo.
| Campo / Elemento | Descrição |
|---|---|
| E-mail do convidado | E-mail da pessoa a ser convidada (pode não ter conta ainda). |
| Perfil no grupo | Editor (pode criar e editar memos) ou Viewer (apenas consulta). |
| Botão Enviar convite | Envia e-mail com link de convite. |

Abaixo do formulário: tabela de convites recentes com status (pendente, aceito, recusado, expirado).
NOTA: Convites têm prazo de validade. Se expirar, o owner deve reenviar.
### Estrutura do contexto
Abre o editor de categorias (/estrutura-memo) já filtrado para o grupo atual. Ver Seção 17.
### Consulta de Memos
Ferramenta de consulta avançada de memos do grupo com filtros e exportação.
| Campo / Elemento | Descrição |
|---|---|
| Grupo de categorias | Filtro pelo grupo de contexto de onde vêm as categorias. |
| Categoria | Filtro por categoria específica. |
| Grupo de memos * | Obrigatório. Grupo cujos memos serão consultados. |
| Data início / Data fim | Filtros de período. |
| Filtros por coluna | Linha de filtros acima dos dados: digitar e pressionar Enter. |
| Ordenação | Clicar em qualquer cabeçalho de coluna para ordenar. Clicar novamente inverte. |
| Imprimir / PDF | Botão de impressão para exportar o resultado como PDF pelo browser. |

Paginação: 50 registros por página. Botões Anterior / Próximo.
### Conexões BD
Gerenciamento de conexões SQL Server para query templates do grupo.
| Campo / Elemento | Descrição |
|---|---|
| Nome * | Identificador amigável da conexão. |
| Descrição | Texto opcional. |
| Host * | Endereço do servidor SQL Server. |
| Porta | Padrão: 1433. |
| Banco de dados * | Nome do banco. |
| Usuário * | Login SQL. |
| Senha * | Senha SQL. Não exibida após salvar. |
| Criptografar | Ativa TLS/SSL na conexão. |
| Confiar no certificado | Bypass de verificação de certificado (útil em dev/testes). |
| Conexão principal | Marcada como principal para resolução de Nome/Abreviatura. |
| Botão Testar | Testa a conexão e exibe latência. |
| Botão Desativar | Desativa a conexão (soft delete). |

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Não é possível carregar o painel | Token expirado ou usuário não é owner deste grupo. |
| Convite: e-mail não enviado | Falha no Resend. Convite registrado no banco — usuário pode acessar pelo link direto se disponível. |
| Teste de conexão BD falhou | Verificar host, porta, credenciais e se o SQL Server está acessível da rede do servidor. |

# SEÇÃO 15 — Aceitar Convite de Grupo
Rota: /convite/grupo
## Fluxo
- 1. Convidado recebe e-mail com link contendo token.
- 2. Ao clicar, chega a /convite/grupo?token=XXX.
- 3. Se não estiver logado, sistema redireciona para /login (preservando ?next= para retornar).
- 4. Após login, processa o convite automaticamente.
- 5. Usuário é adicionado ao grupo com o perfil definido (editor ou viewer).
- 6. Sistema redireciona para a home já com o novo grupo disponível.
## Casos especiais
- Se o convidado não tiver conta, ao criar conta (com link do convite na URL), é vinculado ao grupo automaticamente no cadastro.
- Convite expirado: exibe mensagem de erro. Owner deve reenviar.
- Convite já utilizado: exibe mensagem informativa.
# SEÇÃO 16 — Importação em Lote
Rota: /importar-lote
## Propósito
Permite registrar múltiplos arquivos de uma vez, a partir de uma pasta no servidor, rede local, WebDAV ou por upload direto. Os arquivos são referenciados externamente — não são copiados para a nuvem MyMemory.
## Indicador de destino
No topo direito da tela: 'Destino: [nome do espaço ativo]'. Os memos serão criados no espaço ativo (pessoal ou grupo selecionado no Seletor de Espaço).
## Origens disponíveis
| Campo / Elemento | Descrição |
|---|---|
| Disco Local | Caminho absoluto no servidor onde a API está instalada (ex.: C:\Documentos). |
| Rede Local | Caminho UNC (ex.: \\servidor\pasta). O servidor da API precisa de acesso à rede. |
| WebDAV | URL do servidor WebDAV. Se houver configs de WebDAV cadastradas para o grupo ativo, exibe dropdown de seleção em vez de campo manual. |
| OneDrive (em breve) | Ainda sem integração real: aparece desabilitado com a indicação "em breve". |
| Google Drive (em breve) | Ainda sem integração real: aparece desabilitado com a indicação "em breve". |
| URL Externa (em breve) | Disponível em breve. |

## Modos de processamento de IA
| Campo / Elemento | Descrição |
|---|---|
| Sem IA | Armazena o arquivo com texto bruto. Tag [Edição Pendente] no memo. |
| Básico | Palavras-chave + categoria. |
| Completo | Campos estruturados + palavras-chave + categoria. |

NOTA: A Importação em Lote também é aberta pelo tile "📂 Guarda própria" do Catalogar (Seção 5).
## Fluxo de importação
- 1. Selecionar origem e informar caminho da pasta (ou selecionar arquivos para upload).
- 2. Escolher modo de processamento de IA.
- 3. Clicar 'Verificar' — lista todos os arquivos encontrados com situação: Pronto, Suspeito (possível duplicado), Já Cadastrado ou Bloqueado (tipo não suportado, etc.). O checkbox “Ocultar já cadastrados” (ativo por padrão) oculta automaticamente os arquivos já cadastrados da tabela, exibindo só o que precisa de atenção.
- 4. Revisar a tabela e a estimativa de créditos.
- 5. Clicar 'Processar (N)' — importa apenas os arquivos com situação Pronto ou Suspeito.
- 6. Ver resultado: X criados, Y erros (listados).
## Tabela de verificação — situações
| Campo / Elemento | Descrição |
|---|---|
| Pronto | Arquivo elegível para importação. |
| Suspeito (duplicidade) | Possível duplicado já existente. Ainda pode ser importado. |
| Já cadastrado | Arquivo idêntico já existe. Bloqueado para evitar duplicata. A detecção verifica o nome do arquivo (memos importados via batch) e a URL WebDAV do memo (arquivos catalogados via câmera), incluindo escopo por grupo. |
| Tipo não suportado | Extensão de arquivo não reconhecida pelo sistema. |

## WebDAV com configs de grupo
Quando o espaço ativo é um grupo e esse grupo tem configs de WebDAV cadastradas (/admin/storage), ao selecionar WebDAV como origem, aparece um dropdown com os servidores configurados. Selecionar um preenche o campo de caminho automaticamente com a URL + prefixo de pasta da config.
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
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Pasta não encontrada / acesso negado | Caminho incorreto ou permissão negada ao processo da API no sistema de arquivos. |
| Nenhum arquivo encontrado na pasta | Pasta vazia ou extensões não suportadas. |
| Erro ao processar arquivo X: ... | Falha específica do arquivo. Ver lista de erros no resultado. Outros arquivos não são afetados. |
| WebDAV: falha de conexão | URL do WebDAV incorreta, credenciais inválidas ou servidor offline. |

# SEÇÃO 17 — Estrutura de Contexto / Categorias
Rota: /estrutura-memo
## Propósito
Editor de categorias, subcategorias, campos específicos e query templates. Define como a IA classifica e extrai dados dos memos. Admins veem todos os grupos; owners veem somente o seu grupo.
## Filtros disponíveis
| Campo / Elemento | Descrição |
|---|---|
| Grupo | Filtra categorias globais (sem grupo) ou de um grupo específico. |
| Tipo de mídia | Filtra categorias aplicáveis a determinado tipo de mídia. |

## Estrutura de uma categoria
| Campo / Elemento | Descrição |
|---|---|
| Nome da categoria | Texto único. A IA usa este nome para classificar memos. |
| Tipo de mídia | Restringe a categoria a um tipo específico, ou 'Qualquer mídia'. |
| Ativa | Categorias inativas não são enviadas ao pipeline de IA. |
| Subcategorias | Subdivisões dentro da categoria. |
| Campos específicos | Lista de campos que a IA extrai (ex.: CNPJ, Valor, Data). |
| Query templates | Consultas SQL parametrizadas para resolução de dados externos (ex.: buscar nome do produto pelo código). |

## Campos específicos
| Campo / Elemento | Descrição |
|---|---|
| Nome do campo | Chave usada no dadosEspecificosJson. |
| Descrição | Significado do campo. Enviada à IA na extração e no planejamento das consultas — preencher sempre. |
| Padrões | Termos normalizados: valores aceitos separados por vírgula, usados para padronizar o que a IA extrai. Deixar vazio em datas e horas. |
| Operador SQL | Operador usado ao filtrar por este campo (=, LIKE, >=, etc.). |
| Ativo | Campo inativo não é enviado à IA. |

## Query templates
Consultas parametrizadas vinculadas a uma categoria, usadas pelo Perguntar para respostas estruturadas. Podem rodar no PostgreSQL interno (sobre os memos) ou em um SQL Server externo (ERP), conforme a conexão escolhida.
| Campo / Elemento | Descrição |
|---|---|
| Nome da query | Identificador amigável. |
| SQL | Consulta SELECT com parâmetros :param (interno) ou @param (SQL Server). Somente leitura. |
| Parâmetros | Cada parâmetro lista o campo do memo de onde vem o valor. |
| Conexão BD externa | Vazia = PostgreSQL interno. Preenchida = SQL Server da conexão escolhida. |

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
- A aba Perfis do painel mostra a marca Pessoal só para leitura; a configuração fica na categoria.
## Permissões de edição
- Admin do sistema: pode criar/editar/excluir qualquer categoria (global ou de grupo).
- Owner do grupo: pode criar/editar/excluir categorias do próprio grupo. Não pode alterar categorias globais.
- Membros comuns: acesso somente leitura (veem as categorias disponíveis, mas não editam).
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Acesso negado ao editor | Usuário não é admin nem owner de nenhum grupo. |
| Nome de categoria duplicado | Categoria com mesmo nome já existe no mesmo escopo (global ou grupo). |
| Query falhou no teste | SQL com erro de sintaxe ou conexão BD indisponível. |
| ✎ e 🗑 não aparecem | Tela em modo "Só visualização": selecionar no escopo o grupo do qual é owner (ou o escopo admin para categorias globais). |
| Query com conexão pendente | Query clonada de outro grupo. Escolher a "Conexão BD externa" do grupo atual. |
| cross_query_filter: parâmetro não cadastrado | Cadastrar o parâmetro _in com tipo lista_texto e operador IN na query destino. |

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
# SEÇÃO 19 — Painel Admin Principal
Rota: /admin
## Acesso
Visível no menu apenas para usuários com perfil admin. Redireciona para login se não autenticado.
## Links rápidos no topo
| Campo / Elemento | Descrição |
|---|---|
| Storage por Grupo | → /admin/storage |
| Mídia por plano | → /admin/midia |
| Documento — roteamento IA | → /admin/documento-ia |
| CAD Pipeline | → /admin/cad-pipeline |
| Config. Sistema | → /admin/system-config |
| Último prompt LLM | → /admin/llm-prompt |
| Assinaturas | → /admin/assinaturas |
| Importar conhecimento | → /admin/conhecimento |

## Aba: Planos
CRUD de planos de assinatura.
| Campo / Elemento | Descrição |
|---|---|
| Nome | Nome do plano (ex.: Gratuito, Pro). |
| Preço | Valor em R$. 0 = gratuito. |
| Limite de memos | Quantidade máxima de memos. |
| Armazenamento (GB) | Limite de armazenamento. |
| Créditos IA/mês | Limite mensal de créditos de IA. |
| Downloads/mês (GB) | Limite mensal de downloads. |
| Ativo | Planos inativos não aparecem para novos cadastros. |

NOTA: Não é possível excluir um plano com assinaturas ativas. O botão de excluir fica desabilitado e informa quantas assinaturas estão vinculadas.
## Aba: Outros (Diagnósticos)
Painel de diagnósticos técnicos do sistema: versão, status dos serviços, variáveis de ambiente configuradas. Informações de leitura para troubleshooting.
## Aba: Eliminação
Relatório mensal de memos excluídos (soft-delete). Permite executar hard-delete permanente dos memos excluídos de um mês específico para liberar espaço no banco de dados.
NOTA: Hard-delete é irreversível. Confirmar com o responsável técnico antes de executar.
## Aba: Custos de IA
Relatório de custos de chamadas à API de IA, filtrado por período e tipo de mídia.
| Campo / Elemento | Descrição |
|---|---|
| Data início / Data fim | Período de análise (padrão: mês atual). |
| Tipo de mídia | Filtro por tipo (Todas, Texto, Áudio, Imagem, Vídeo, Documento, URL). |
| Relatório | Total em USD, quantidade de chamadas, custo médio por chamada. |

## Aba: Consulta de Memos (Admin)
Igual à consulta do Painel do Owner, mas com acesso a todos os grupos do sistema. Filtros por grupo de categorias, categoria, grupo de memos, data.
## Aba: Prompts LLM
Edição dos prompts de sistema de cada etapa (classificação, planejamento, síntese, extração por tipo de mídia), com override por categoria. O último prompt efetivamente enviado pode ser conferido em /admin/llm-prompt (Seção 24).
## Aba: Config. IA (Provedores)
Configuração de provedores de IA (OpenAI, forge/customizado). Permite alternar entre provedores sem reiniciar o servidor.
| Campo / Elemento | Descrição |
|---|---|
| Provedor | openai ou forge (API customizada compatível). |
| Modelo | Nome do modelo (ex.: gpt-4o-mini). |
| Base URL | Para forge: URL base da API alternativa. |
| API Key | Chave de acesso. Exibida mascarada após salvar. |
| Ativo | Somente um provedor pode estar ativo por vez. |

## Aba: Conexões BD (Admin)
Gerenciamento global de conexões SQL Server. Similar à aba do Owner, mas com visibilidade de todos os grupos.
## Aba: Convites e Usuários
Visão geral de todos os convites pendentes no sistema e gestão de usuários. Permite ver status de verificação de e-mail e planos.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Acesso negado ao Admin | Usuário não tem perfil admin. Verificar no banco (tabela users, coluna is_admin). |
| Falha ao carregar custos | Nenhum registro no período. Resultado vazio é normal. |
| Não é possível excluir plano | Existem assinaturas vinculadas. Migrar usuários para outro plano antes. |

# SEÇÃO 20 — Admin: Mídia por plano
Rota: /admin/midia
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
# SEÇÃO 21 — Admin: Documento — roteamento IA
Rota: /admin/documento-ia
## Propósito
Define o roteamento dos documentos para os extratores de texto (JSON em ai_config.documentRoutingJson). Não é uma base de conhecimento: decide qual pipeline lê cada tipo de arquivo.
| Campo / Elemento | Descrição |
|---|---|
| Regras preprocess | Lista de regras por tipo/extensão; a primeira que coincidir é usada (a ordem importa). |
| Pipelines | extract_utf8_text (texto, .md, .csv), extract_pdf_text, extract_msg_text (Outlook .msg), extract_eml_text (e-mail .eml), extract_docx_text (Word), extract_xlsx_text (Excel) ou unsupported. |
| Salvar JSON | Grava o roteamento. Sem JSON gravado, vale o padrão do sistema (exibido na tela). |
NOTA: Um JSON inválido impede a extração de documentos. Copie o conteúdo atual antes de editar.
# SEÇÃO 22 — Admin: CAD/BIM — Pipeline IA
Rota: /admin/cad-pipeline
## Propósito
Habilita o processamento de arquivos CAD/BIM (.ifc). Quando desabilitado, o upload é aceito, mas o processamento retorna "Formato não suportado neste plano".
| Campo / Elemento | Descrição |
|---|---|
| Habilitar processamento CAD/BIM (.ifc) | Liga ou desliga a extração de arquivos IFC. |
| Arquivos .dwg | Aceitos em modo semIA (registro sem extração). A extração de DWG requer componente adicional no servidor. |
# SEÇÃO 23 — Admin: Config. do Sistema
Rota: /admin/system-config
## Propósito
Parâmetros globais que afetam todos os usuários.
| Campo / Elemento | Descrição |
|---|---|
| Pesquisa semântica — limiares (Perguntar) | Limiar inicial e mínimo de similaridade. Quando a busca retorna vazio, o sistema reduz o limiar em 10% a cada tentativa até o mínimo. Valores de 0,01 a 1,00. |
| Busca Semântica de Memos | Limiar da busca semântica da tela Buscar (top 40 resultados acima do mínimo). Valores de 0 a 1,00. |
| Multiplicador USD → créditos (fatorCredCost) | Multiplica o custo em USD para calcular os créditos exibidos e descontados. Padrão: 100. |
# SEÇÃO 24 — Admin: Último prompt LLM
Rota: /admin/llm-prompt
## Propósito
Tela de diagnóstico: mostra fielmente o último payload enviado à API de IA (mensagens system/user) e a resposta recebida. O registro fica só na memória da API e se perde ao reiniciar.
| Campo / Elemento | Descrição |
|---|---|
| Último prompt | Provedor, modelo e origem (classificação, planejamento, extração…) da última chamada. |
| Mensagens | Conteúdo exato enviado e recebido. |
| Atualizar | Recarrega o último registro. |
NOTA: A edição dos prompts (com override por categoria) fica no Painel Admin → aba Prompts LLM. Para ver todas as etapas de uma pergunta específica, use "ver etapas" no card da resposta (Seção 8).
# SEÇÃO 25 — Admin: Assinaturas
Rota: /admin/assinaturas
## Propósito
Gerenciamento de assinaturas de usuários e grupos. O admin pode criar, editar, cancelar assinaturas e vincular usuários a planos.
| Campo / Elemento | Descrição |
|---|---|
| Lista de assinaturas | Todas as assinaturas do sistema com status (ativa, expirada, cancelada). |
| Filtros | Por plano, por status, por usuário/grupo. |
| Criar assinatura | Vincula um usuário ou grupo a um plano com data de início e vencimento. |
| Editar / Cancelar | Alterar plano ou status da assinatura. |

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Usuário sem assinatura ativa | Criar assinatura nesta tela ou verificar se a assinatura expirou. |
| Limite do plano excedido pelo usuário | Upgrade do plano ou aumentar os limites do plano atual. |

# SEÇÃO 26 — Admin: Storage por Grupo
Rota: /admin/storage
## Propósito
Configuração de armazenamento WebDAV por grupo. Permite que cada grupo tenha seu próprio servidor WebDAV para armazenar os arquivos dos memos (alternativa ao S3/armazenamento padrão).
## Fluxo de uso
- 1. Selecionar o grupo no dropdown 'Grupo'.
- 2. Ver as configurações existentes na tabela.
- 3. Preencher o formulário para criar ou editar uma configuração.
- 4. Testar a conexão antes de salvar.
- 5. Marcar como 'Padrão' para que seja usada automaticamente no Catalogar.
## Campos do formulário de config WebDAV
| Campo / Elemento | Descrição |
|---|---|
| Label | Nome identificador da configuração (ex.: 'Servidor NAS Principal'). |
| URL do servidor | URL base do WebDAV (ex.: http://192.168.1.10:19401). |
| Prefixo de pasta | Subpasta dentro do WebDAV (ex.: /mymemory/grupo1). Opcional. |
| Usuário | Login WebDAV. Opcional se o servidor não exigir autenticação. |
| Senha | Senha WebDAV. Criptografada com AES-256-CBC no banco de dados. |
| É padrão | Se ativo, esta config é usada automaticamente ao catalogar novos memos do grupo. |
| Está ativa | Config inativa não aparece nos dropdowns. |
| Botão Testar Conexão | Verifica se o servidor WebDAV está acessível com as credenciais informadas. |
| Salvar / Atualizar | Persiste a configuração. |

## Criptografia de senhas
As senhas WebDAV são criptografadas com AES-256-CBC usando a chave definida em STORAGE_ENCRYPTION_KEY no .env do servidor. Se esta variável não estiver definida, as senhas são salvas em texto puro (não recomendado para produção).
DICA: Para gerar uma chave segura: openssl rand -hex 32. Inserir no .env do servidor como STORAGE_ENCRYPTION_KEY=<valor>.
## Comportamento no Catalogar
- Quando um memo é criado em um grupo com config WebDAV padrão ativa, o arquivo é enviado ao WebDAV automaticamente.
- Se não houver config WebDAV (ou se a config estiver inativa), o sistema usa o armazenamento padrão (S3 ou local).
- Na tela de Edição do Memo, um badge mostra onde o arquivo está armazenado.
## Comportamento no Batch Import com WebDAV
- Ao selecionar WebDAV como origem, se o grupo ativo tiver configs, aparece dropdown de seleção em vez de campo manual de URL.
## Limpeza de arquivos órfãos
Na mesma tela, "Limpeza de Arquivos Órfãos" → "Verificar" lista arquivos no armazenamento que não pertencem mais a nenhum memo, para remoção. Quando não há nada a limpar, exibe "Nenhum arquivo órfão encontrado".
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Teste de conexão falhou | URL incorreta, servidor offline, credenciais inválidas ou firewall bloqueando. |
| Arquivo não chegou ao WebDAV | Verificar se a config está marcada como 'Padrão' e 'Ativa'. Ver logs da API. |
| Senha mostrada em texto puro após salvar | STORAGE_ENCRYPTION_KEY não configurada no servidor. Configurar e regerar as senhas. |
| Não aparece dropdown de WebDAV no Batch Import | Verificar se há config ativa e padrão para o grupo no /admin/storage. |

# SEÇÃO 27 — Admin: Importar conhecimento
Rota: /admin/conhecimento (Painel Admin → Importar conhecimento)
## Propósito
Importa conhecimento já dividido em trechos — por exemplo o próprio Manual MyMemory (docs/manual-chunks/chunks.jsonl) ou um FAQ interno — para dentro de um grupo. Cada trecho vira um memo de texto com categoria, campos e vetores da busca semântica, sem passar pela IA de extração. Depois disso, as perguntas feitas no grupo passam a ser respondidas também com esses trechos.
## Antes de importar
1. Na Estrutura do contexto, criar a categoria de destino (ex.: "Manual MyMemory") no grupo ou como global.
2. Criar nela os campos Seção, Tela, Rota, Perfil, Tipo e Versão. Os nomes são casados com ou sem acento ("Secao" = "Seção").
3. Ter o arquivo .jsonl com um trecho por linha (campos obrigatórios: id e texto).
## Como importar
1. Abrir Admin → Importar conhecimento.
2. Escolher o grupo que vai consultar o conhecimento.
3. Escolher a categoria (as globais aparecem com "(global)"). Uma categoria com "manual" no nome é pré-selecionada.
4. Escolher o arquivo .jsonl. A tela mostra quantos trechos foram lidos.
5. Manter marcado "Substituir os trechos importados antes nesta categoria" para trocar a versão anterior.
6. Clicar Importar. Leva de um a dois minutos para 200 trechos (o sistema gera os vetores de cada um).
## Campos da tela
| Campo / Elemento | Descrição |
|---|---|
| Grupo | Grupo onde os memos serão criados. Só os membros desse grupo terão respostas a partir deles. |
| Categoria | Categoria dos memos. Precisa estar disponível para o grupo (do grupo ou global). |
| Arquivo de trechos | .jsonl (um JSON por linha) ou .json com uma lista. Cada trecho: id, texto e, opcionalmente, secao, tela, rota, perfil, tipo, versao. |
| Substituir | Desativa os trechos importados antes na mesma categoria e grupo antes de criar os novos. |
| Importar | Cria os memos e mostra o resultado: criados, substituídos e erros. |
| Já importado neste grupo | Lista categoria, quantidade de trechos, versão e data da última importação, com o botão Remover. |
## Regras importantes
- O texto entra exatamente como no arquivo (sem acentos, como todos os memos do sistema); a IA não reescreve nem classifica.
- Não há custo de IA de extração; só a geração dos vetores da busca semântica (alguns centavos para 200 trechos).
- Os memos importados aparecem nos Recentes do grupo e podem ser abertos e editados como qualquer memo de texto.
- Remover desativa os memos (exclusão lógica); eles deixam de ser usados nas respostas.
- A Importação em Lote (Seção 16) não serve para isso: pelo WebDAV ela não lê o conteúdo dos arquivos e não aplica IA.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Linha N não é JSON válido | O arquivo não está no formato JSON Lines. Gerar de novo com docs/manual-v2-fonte/gerar_trechos.py. |
| Trecho N sem "id" ou "texto" | Cada linha precisa ter os campos id e texto. |
| Categoria não disponível para este grupo | A categoria é de outro grupo. Usar uma categoria do grupo ou global. |
| Perguntas não usam os trechos importados | Conferir se a pergunta foi feita no mesmo grupo da importação e se a busca semântica está ativa (OPENAI_API_KEY configurada). |
# SEÇÃO 28 — Integrações externas (chave de API)
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
# SEÇÃO 29 — Erros Comuns e Soluções
## Erros de sessão / autenticação
| Mensagem / Sintoma | Causa e solução |
|---|---|
| HTTP 401 / Não autorizado | Sessão expirada. Usuário deve fazer login novamente. |
| HTTP 403 / Acesso negado | Usuário logado não tem permissão para o recurso (grupo, memo de outro usuário, rota admin). |
| Cookie mm_access ausente | Usuário não logou ou cookie foi apagado. Refazer login. |

## Erros de API / servidor
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Não foi possível conectar à API | Container da API parado. Executar: docker compose ps e docker compose up -d api. |
| HTTP 500 / Erro interno | Exceção não tratada na API. Ver logs: docker compose logs api --tail=50. |
| Database connection error | Banco de dados PostgreSQL inacessível. Verificar: docker compose ps db. |

## Erros de processamento de IA
| Mensagem / Sintoma | Causa e solução |
|---|---|
| OpenAI API error / Insufficient credits | Créditos OpenAI esgotados ou chave inválida. Verificar em /admin → aba IA. |
| Créditos do plano esgotados | Limite mensal do usuário atingido. Admin pode ajustar o plano em /admin/assinaturas. |
| Transcription failed | FFmpeg não instalado ou arquivo de áudio/vídeo corrompido. |

## Erros de armazenamento
| Mensagem / Sintoma | Causa e solução |
|---|---|
| S3 upload failed | Credenciais S3/MinIO inválidas ou bucket inexistente. Verificar variáveis S3_* no .env. |
| WebDAV put failed | Servidor WebDAV inacessível ou sem permissão de escrita na pasta de destino. |
| Arquivo não encontrado no disco | Caminho no Batch Import inexistente ou sem permissão de leitura para o processo da API. |

## Erros de e-mail (Resend)
| Mensagem / Sintoma | Causa e solução |
|---|---|
| emailSendFailed: true após cadastro | Resend não enviou o e-mail. Verificar: domínio verificado na Resend, chave RESEND_API_KEY válida, e-mail remetente configurado. |
| E-mail de confirmação não chega | Verificar spam / Promoções. Reenviar pelo botão na tela de Login. |

## Erros de perguntas e queries
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Query #N "nome": invalid input syntax for type numeric | Campo numérico com texto. Query padrão já é tolerante; em query editada, trocar ::numeric por mymemory_parse_number(...). |
| Query #N "nome": invalid input syntax for type date | Campo de data com texto. Usar mymemory_parse_date(...) no lugar de ::date. |
| Divide by zero (SQL Server) | Erro dentro da view do ERP. Abrir "ver etapas" para identificar a query e corrigir a view no banco. |
| Invalid column name 'X' (SQL Server) | Coluna inexistente na view/tabela do banco usado pela conexão. Conferir se a view é a mesma em todos os bancos (ex.: Demo × produção). |
| Resposta com filtro ignorado | Parâmetro com nome errado no SQL (nunca recebe valor). Conferir os nomes @param no trace. |

# SEÇÃO 30 — Referência Rápida Admin
## Variáveis de ambiente (.env) essenciais
| Campo / Elemento | Descrição |
|---|---|
| DATABASE_URL | Connection string do PostgreSQL. |
| OPENAI_API_KEY | Chave da API OpenAI. |
| RESEND_API_KEY | Chave da Resend para envio de e-mails. |
| EMAIL_FROM | E-mail remetente verificado na Resend. |
| JWT_SECRET | Segredo para assinar tokens de sessão. |
| STORAGE_MODE | local ou s3. |
| S3_* / AWS_* | Credenciais e bucket S3/MinIO (se STORAGE_MODE=s3). |
| STORAGE_ENCRYPTION_KEY | Chave AES-256 para criptografar senhas WebDAV. 64 hex chars. |
| Migrations | Aplicadas automaticamente quando a API sobe (inclui as funções mymemory_parse_date e mymemory_parse_number). |
| USE_DEV_FALLBACK | 1 para desativar auth em dev local (não usar em prod!). |

## Comandos úteis (servidor)
| Campo / Elemento | Descrição |
|---|---|
| docker compose ps | Ver status dos containers. |
| docker compose logs api --tail=50 | Ver últimos logs da API. |
| docker compose up -d | Iniciar/reiniciar todos os containers. |
| docker compose pull && docker compose up -d | Atualizar para a versão mais recente (após deploy). |
| npm run migration:run --workspace=@mymemory/api | Executar migrações pendentes do banco. |
| npm run migration:show --workspace=@mymemory/api | Ver status de todas as migrações. |

## Deploy padrão
| Campo / Elemento | Descrição |
|---|---|
| 1. Commit no master | git add . && git commit -m '...' |
| 2. Push master | git push origin master |
| 3. Merge para production | git checkout production && git merge master && git push origin production |
| 4. GitHub Actions dispara | Ver progresso na aba Actions do repositório no GitHub. |
| 5. Deploy automático | API e Web são reconstruídos e reiniciados no servidor via docker compose. |

## Rotas de todos os admins
| Campo / Elemento | Descrição |
|---|---|
| /admin | Painel principal (planos, custos, diagnósticos, etc.) |
| /admin/midia | Mídia por plano (limites e opções por tipo) |
| /admin/documento-ia | Roteamento de documentos para os extratores de texto |
| /admin/cad-pipeline | Processamento CAD/BIM (.ifc) |
| /admin/system-config | Configurações globais do sistema |
| /admin/llm-prompt | Último prompt enviado à IA (diagnóstico) |
| /admin/assinaturas | Assinaturas de usuários e grupos |
| /admin/storage | Storage WebDAV por grupo |
| /admin/conhecimento | Importar conhecimento em trechos para um grupo |
| /estrutura-memo | Categorias, queries e lembretes 🔔 (owner e admin) |
| /avisos | Avisos do usuário (monitoramento de perguntas) |

## Verificação rápida de saúde do sistema
- 1. /api/health ou /api/diagnostics → resposta HTTP 200 significa API online.
- 2. Tentar login com conta de teste → se falhar, verificar banco de dados.
- 3. Criar memo de texto com Sem IA → se falhar, verificar armazenamento (S3 ou local).
- 4. Criar memo com IA básico → se falhar, verificar OPENAI_API_KEY.
- 5. Enviar convite por e-mail → se falhar, verificar RESEND_API_KEY e domínio.
Fim do documento — MyMemory Manual Operacional · Versão 2 (outubro de 2026)

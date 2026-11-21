MyMemory
Manual Operacional de Suporte
Indexado por telas · Versão 2 — outubro de 2026
Este documento descreve todas as telas do sistema MyMemory, seus campos, comportamentos e procedimentos de suporte ao usuário. Destinado a atendentes, administradores e equipe técnica.
# ÍNDICE
- Novidades da versão 2
- Seção 1 — Entrar
- Seção 2 — Criar Conta / Escolher Plano
- Seção 3 — Confirmar E-mail / Esqueci a Senha
- Seção 4 — Tela Principal (Home)
- Seção 5 — Catalogar Memo (todos os tipos de mídia)
- Seção 6 — Revisar antes de salvar
- Seção 7 — Buscar Memos
- Seção 8 — Fale comigo (perguntas ao proMemory)
- Seção 9 — Perguntas salvas
- Seção 10 — Editar Memo
- Seção 11 — Minha Conta
- Seção 12 — Meus avisos e lembretes
- Seção 13 — Grupos: Criar / Entrar
- Seção 14 — Painel Owners
- Seção 15 — Aceitar Convite de Grupo
- Seção 16 — Importação em Lote
- Seção 17 — Categorias (Painel Owners)
- Seção 18 — Lembretes por e-mail
- Seção 19 — Painel Admin
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
Resumo do que mudou no sistema entre julho e novembro de 2026. Cada item remete à seção onde está descrito.
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
| Importação automática de pasta (aba Importações automáticas) e aba "Extrair dono do memo" | Seção 16 |
| Categoria Pessoal e campo dono configurados na própria categoria | Seção 17 |
| Campo dono aplicado também no Catalogar e na edição; pergunta que cita um membro ("agenda do Suporte") mostra os memos dele | Seção 17 |
| Renomear um campo atualiza os memos já gravados e as queries da categoria | Seção 17 |
| Extração mais fiel: endereços e nomes copiados como no texto, tempo sempre com unidade, "eu/me" = autor do memo | Seção 17 |
| Perguntas comparam texto dos memos por palavras ("sr. Wilson" acha "Sr. Wilson da FAPESP") | Seção 17 |
| Sem resultado nos seus memos Pessoal, a pergunta busca nos de todos (com aviso); resposta vazia com confiança baixa | Seção 17 |
| Categoria Atualizável: alterar, concluir ou cancelar memos (ex.: agenda) direto na resposta do Fale comigo, com ↶ Desfazer | Seções 8 e 17 |
| Períodos relativos ("semana que vem", "próxima sexta", "fim de semana"…) calculados pelo sistema no horário de Brasília | Seção 8 |
| ✎ no fim da resposta para alterar memo atualizável; com vários memos, abre a escolha "Qual memo alterar?" | Seção 8 |
| Campo dono vazio é preenchido com o nome de quem salvou; Situação vazia é gravada como Ativo (também nos memos antigos) | Seção 17 |
| Busca com várias palavras exige cada palavra no campo, em qualquer ordem | Seção 17 |
| Avisos e perguntas salvas conferem grupo, query e perfil de acesso a cada execução; aviso só para o próprio e-mail ou de membro do grupo | Seções 9 e 12 |
| Queries do ERP somente leitura (SELECT/WITH); conexões BD de owner só com endereço público; senhas das conexões guardadas cifradas | Seções 14 e 17 |
| Limite de tentativas no login, cadastro e recuperação de senha | Seção 1 |
| Arquivos guardados no S3 só abrem pelo MyMemory, com login (bucket privado) | Seções 6 e 26 |
| Relatório de chamadas de IA por etapa (admin) | Seção 24 |
| "📋 Colar print" e Ctrl+V no Catalogar para catalogar o print da tela | Seção 5 |
| Ícone de PDF na resposta: texto, gráfico e tabela com todos os registros | Seção 8 |
| Resposta estruturada em resumo (sem repetir a tabela no texto); tabela só com as colunas pedidas; totais e maiores/menores calculados sobre todas as linhas | Seção 8 |
| "Ordene por X" ordena no banco | Seção 8 |
| Comparação entre dois períodos (variação % de um mês sobre outro), com várias medidas e "só itens presentes nos dois períodos" | Seção 8 |
| Consultas que só servem de filtro não aparecem mais como tabela | Seção 8 |
| Trocar a categoria na revisão ou na edição mostra o aviso "Você alterou a categoria" com o botão ↻ Re-processar (refaz palavras-chave e campos com a nova categoria) | Seções 6 e 10 |
| Série mês a mês ganha a coluna "var. %" (cada período sobre o anterior), calculada pelo sistema | Seção 8 |
| Ícone de salvar pergunta: balão de conversa com + | Seção 8 |
| Categoria editável na pergunta salva | Seções 8 e 9 |
| Lixeira no cartão do memo aberto pela resposta pede confirmação e move o memo para a lixeira | Seção 8 |
| Cartão de alteração confere a data: data já passada há mais de 30 dias, a mais de 2 anos ou que não é data pede confirmação | Seção 8 |
| Perguntar sobre remarcações e cancelamentos ("o que foi remarcado esta semana?", "o que foi cancelado em outubro?") com a consulta automática "Alterações — categoria" | Seções 8 e 17 |
| Editar memo e Histórico abrem para o dono, quem catalogou e donos/editores do grupo; sem permissão, a mensagem diz de quem é o memo | Seção 10 |
| Autenticação por chave de API para integrações externas (ex.: Softing-erp) com contexto da tela | Seção 28 |
| Novo visual: cabeçalho com menu da conta, sino de avisos e lembretes, Fale comigo, Buscar, Catalogar e escolha do espaço | Seções 4, 7 e 8 |
| "Título curto" passa a se chamar Assunto, sugerido pela IA | Seções 4, 6 e 10 |
| Perguntas fixadas viram atalho embaixo da caixa do Fale comigo | Seções 4 e 9 |
| Painel Owners (/grupo/:id/admin) substitui o Painel do owner e a Estrutura do contexto | Seções 14 e 17 |
| Revisar antes de salvar só quando a categoria pede (Sempre revisar ou % mínimo de campos); nos outros casos salva direto | Seções 5, 6 e 17 |
| Revisão e Editar memo com o mesmo desenho: original à esquerda, memo à direita; campos em formulário; Excluir no Editar | Seções 6 e 10 |
| Meus avisos e lembretes: abas Avisos e Lembretes, histórico, editar, Verificar agora e "Mais" para os próximos 7 dias | Seção 12 |
| Tela Perguntas salvas própria: busca, categorias, fixar, Perguntar, Me avise | Seção 9 |
| Importar em lote em 3 passos; Disco local e Rede local pelo navegador (o original é descartado); aba Extrair dono do memo | Seção 16 |
| Telas de acesso novas: painel da marca, olho de mostrar a senha e "Manter conectado neste aparelho" (30 dias) | Seções 1 a 3 |
| Criar conta com o plano escolhido e a barra de senha; "Confira seu e-mail" depois de criar e de pedir nova senha | Seções 2 e 3 |
| Minha conta com menu lateral: Perfil e senha (trocar nome e senha), Preferências salvas sozinhas, Uso do plano com barras e créditos por área | Seção 11 |
| Entrar em grupo mostra o seu e-mail para copiar e os convites esperando você | Seções 13 e 15 |
| Painel Admin numa tela só, com menu lateral em 6 grupos e endereço próprio por seção; Início com verificação automática | Seção 19 |
| Admin: Chamadas de IA por etapa; assinantes por plano; totais no relatório de custos; último teste das conexões; Eliminar pede para digitar ELIMINAR | Seção 19 |
| Nomes novos: aba Fale comigo (antes Perguntar); no menu do avatar, Painel Admin, Painel Owners e Categorias Modelos; menu lateral do Painel Admin em 2 níveis, com largura ajustável e recolhível | Seções 4, 8, 14 e 19 |
| Correção: descrição das telas admin Mídia por plano, Documento — roteamento IA, CAD/BIM, Config. do Sistema e Último prompt LLM (estavam incorretas na v1) | Seções 20 a 24 |
# SEÇÃO 1 — Entrar
Rota: /login
## Objetivo
Entrar no proMemory com o e-mail e a senha da conta. No computador, à esquerda fica o painel verde "O assistente profissional para a sua memória", que explica o que o proMemory faz; no celular aparece só o cartão de entrar.
## Campos
| Campo / Elemento | Descrição |
|---|---|
| E-mail | E-mail da conta. Obrigatório. Aberto por um convite de grupo, já vem preenchido com o e-mail convidado. |
| Senha | Senha da conta. O olho ao lado mostra ou esconde o que foi digitado. |
| Esqueci a senha | Link ao lado do rótulo Senha. Abre /esqueci-senha (Seção 3). |
| Manter conectado neste aparelho | Marcado (padrão): a sessão dura 30 dias neste navegador. Desmarcado: a sessão termina ao fechar o navegador (use em computador de outra pessoa). |
| Botão Entrar | Envia o e-mail e a senha. Fica desabilitado enquanto entra. |
| Ainda não tem conta? Criar conta | Abre a escolha do plano (Seção 2). |

## Comportamentos
- Depois de entrar, volta para a página de onde veio (parâmetro ?next=) ou para o início.
- E-mail ainda não confirmado: aparece o erro com o botão "Reenviar e-mail de confirmação".
## Limite de tentativas
Para dificultar adivinhação de senha, o sistema limita as tentativas por endereço de rede e por e-mail:
- Login: até 60 tentativas a cada 15 minutos por rede e 10 por e-mail.
- Criar conta: até 10 por hora por rede.
- Esqueci a senha e reenvio da confirmação: até 20 por hora por rede e 5 por e-mail.
- Confirmação de e-mail e nova senha: até 30 a cada 15 minutos por rede.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| E-mail ou senha incorretos | Conferir o e-mail e a senha (o olho mostra o que foi digitado). Se esqueceu, usar "Esqueci a senha". |
| Muitas tentativas. Tente de novo em N minuto(s). | Limite de tentativas atingido. Aguardar o tempo indicado; se esqueceu a senha, usar "Esqueci a senha" depois da espera. |
| Confirme seu e-mail antes de entrar | A conta foi criada, mas o e-mail não foi confirmado. Usar o botão "Reenviar e-mail de confirmação" da própria tela. |
| Sai da conta toda vez que fecha o navegador | "Manter conectado neste aparelho" estava desmarcado ao entrar. Entrar de novo com a opção marcada. |
# SEÇÃO 2 — Criar Conta / Escolher Plano
Rotas: /select-plan → /cadastro
## Fluxo de cadastro
- 1. Em "Escolha seu plano" (/select-plan), cada plano mostra o preço (ou Grátis), os memos, o armazenamento e "Participar de grupos sem limite". O plano mais escolhido aparece em destaque. Clicar em "Escolher".
- 2. Em "Criar conta" (/cadastro), o quadro "Plano escolhido" mostra o plano; "Trocar" volta à escolha.
- 3. Preencher nome, e-mail e senha. Abaixo da senha, a barra mostra se já tem o mínimo de 8 caracteres.
- 4. "Criar conta" cria a conta e manda o e-mail de confirmação.
- 5. A tela vira "Confira seu e-mail": o link do e-mail entra direto, sem digitar a senha de novo.
## Campos do formulário de cadastro
| Campo / Elemento | Descrição |
|---|---|
| Nome | Obrigatório, mínimo 2 caracteres. |
| E-mail | Único no sistema. Obrigatório. Vindo de um convite de grupo, fica preso ao e-mail convidado. |
| Senha | Mínimo 8 caracteres. A barra abaixo mostra quantos faltam. |
| Botão Criar conta | Desabilitado enquanto processa. |
| Já tem conta? Entrar | Volta para /login. |

## Casos especiais
- E-mail já cadastrado: aparece o erro com os links Entrar e Esqueci a senha.
- Falha no envio do e-mail (Resend): a conta é criada e a tela mostra o aviso de diagnóstico.
- Vindo de um convite de grupo: depois de confirmar o e-mail, o usuário já entra no grupo.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| E-mail já cadastrado | Usar "Entrar" ou "Esqueci a senha". |
| E-mail de confirmação não chegou | Ver o spam e a aba Promoções. Se não chegou, usar "Reenviar e-mail de confirmação" na tela Entrar. |
| Senha muito curta | A senha precisa de pelo menos 8 caracteres; a barra abaixo do campo mostra quantos faltam. |
# SEÇÃO 3 — Confirmar E-mail / Esqueci a Senha
Rotas: /verificar-email · /esqueci-senha · /redefinir-senha
## Confirmar e-mail (/verificar-email)
Aberta pelo link do e-mail de confirmação. O link é conferido sozinho: válido, a conta é ativada, aparece "E-mail confirmado!" e o usuário já entra (ou vai para Entrar). Inválido ou vencido, aparece o erro.
## Esqueci a senha (/esqueci-senha)
- 1. Digitar o e-mail da conta e clicar "Enviar o link".
- 2. A tela vira "Confira seu e-mail". A mensagem é a mesma exista ou não a conta (segurança). O botão "Reenviar" manda de novo.
## Nova senha (/redefinir-senha)
- 1. Aberta pelo link do e-mail.
- 2. Digitar a senha nova (mínimo 8 caracteres) e repetir. Abaixo aparece "✓ As duas senhas são iguais" quando conferem.
- 3. "Salvar senha" grava e leva para Entrar.
NOTA: Logado, a senha também pode ser trocada em Minha conta → Perfil e senha (Seção 11), informando a senha atual.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Link de confirmação inválido ou vencido | Na tela Entrar, usar "Reenviar e-mail de confirmação". |
| Link de nova senha vencido | Pedir de novo em "Esqueci a senha". |
| E-mail não chegou | Ver o spam e a aba Promoções. Se persistir, conferir a configuração do Resend no servidor. |
# SEÇÃO 4 — Tela Principal (Home)
Rota: /
## Visão geral
A tela principal é o ponto central do sistema. Ela tem três abas: Fale comigo, Buscar e Catalogar. A aba ativa é salva no localStorage (mm_home_tab) e restaurada na próxima visita.
## Cabeçalho (Header)
| Campo / Elemento | Descrição |
|---|---|
| Logotipo / Nome do sistema | Clique retorna à home. |
| Indicador de espaço ativo | Mostra o grupo atual ou 'Pessoal'. Clique abre o Seletor de Espaço. |
| Menu da conta (avatar) | Conta (Minha conta, Meus avisos e lembretes, Importar em lote), Trocar espaço, Criar grupo, Administração (Painel Owners para o dono; Categorias Modelos e telas de admin para o administrador do sistema), tema claro/escuro e Sair. |
| 🔔 Sino (Avisos e lembretes) | Mostra quantos avisos novos e lembretes próximos existem. Abre um painel com duas abas: Avisos (respostas que mudaram) e Lembretes (compromissos dos próximos 7 dias em que você é destinatário). O link "Meus avisos e lembretes" abre a tela completa (Seção 12). |

## Seletor de Espaço (Workspace Picker)
Aparece quando o usuário clica no indicador de espaço ou acessa /?escolherEspaco=1.
- Exibe card 'Meus Memos Pessoais' e cards de cada grupo do qual faz parte.
- Card do grupo em que o usuário é dono exibe o link 'Painel Owners' (Seção 14).
- Botões: 'Criar novo grupo' → /grupo/novo · 'Entrar em outro Grupo' → /grupo/entrar · 'Cancelar'.
## Aba Fale comigo
Ver Seção 8 — Fale comigo (perguntas ao proMemory).
## Aba Buscar
Ver Seção 7 — Buscar Memos.
## Aba Catalogar
Ver Seção 5 — Catalogar Memo.
Abaixo do painel de catalogação, a lista de Memos Recentes exibe os últimos registros do espaço ativo.
## Perguntas fixadas (atalhos do Fale comigo)
Embaixo da caixa do Fale comigo aparecem como botões as perguntas salvas que você fixou. Um toque faz a pergunta na hora. Para fixar ou desafixar, use "Fixar no Fale comigo" na tela Perguntas salvas (Seção 9) ou o alfinete na lista de perguntas salvas do Fale comigo. As fixadas são por pessoa e por espaço.
## Assunto dos memos
Cada memo tem um Assunto: até 5 palavras que resumem o memo e aparecem no Buscar, nos Recentes e nas listas. A IA sugere o Assunto ao catalogar e ele pode ser trocado na revisão ou no Editar memo. Nas versões anteriores ele se chamava "título curto".
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
## Colar print da tela
No computador, o tile "📋 Colar print" cataloga a imagem que está na área de transferência, como o print tirado com PrintScreen ou Win+Shift+S. Também basta apertar Ctrl+V na tela do Catalogar, fora de um campo de texto. A imagem segue o mesmo caminho do seletor de arquivo, com o nome print-AAAAMMDD-HHMM.png.
- Na primeira vez, o navegador pede permissão para ler a área de transferência. Se negar, o Ctrl+V continua funcionando.
- No celular o tile não aparece: o print vai para a galeria e é escolhido pelo seletor de arquivo.
## Depois de catalogar: salvar direto ou revisar
Quem decide se a tela de revisão abre é a regra da categoria, configurada pelo dono do grupo (Seção 17, "Revisão antes de salvar"):
| Situação | O que acontece |
|---|---|
| A IA preencheu pelo menos o % mínimo dos campos da categoria | O memo é salvo direto e aparece uma mensagem rápida: "Memo salvo em Agenda (100%)". Para corrigir algo, abra o memo pelo Buscar. |
| Preencheu menos que o mínimo | O memo ainda NÃO foi gravado. Aparece "A IA preencheu X% dos campos", com o mínimo da categoria e três botões: Editar (abre a revisão), Gravar assim e Cancelar. |
| Categoria marcada "Sempre revisar antes de salvar" | A revisão sempre abre (ex.: Contratos). |
| Sem categoria, Sem IA, aviso do processamento ou texto vazio | A revisão sempre abre. |
NOTA: Não há preferência por usuário para isso: a regra é da categoria. O % mínimo sugerido é 80%.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Arquivo muito grande / tipo não suportado | Verificar limites do plano em Minha Conta → Sua utilização. |
| Transcrição falhou (áudio/vídeo) | FFmpeg pode não estar instalado ou áudio corrompido. |
| OCR retornou texto vazio | Imagem pode ser muito baixa resolução ou texto muito pequeno. |
| URL não acessível | Site bloqueou scraping. O memo será criado com texto mínimo. |
| Áudio da URL muito grande (acima de 20 MB) | Limite de transcrição automática via Whisper; catalogar o áudio separadamente pelo tipo Áudio. |

# SEÇÃO 6 — Revisar antes de salvar
Rotas: /revisao/memo-texto · /revisao/memo-imagem · /revisao/memo-audio · /revisao/memo-video · /revisao/memo-documento
## Quando aparece
Só quando a regra da categoria pede (Seção 5, "Depois de catalogar"): categoria crítica, poucos campos preenchidos, memo sem categoria, Sem IA, aviso do processamento ou texto vazio. Nos outros casos o memo é salvo direto.
## Como é a tela
Uma tela igual para os cinco tipos. No computador: o original à esquerda e o memo à direita. No celular: duas abas, Original e Memo.
| Campo / Elemento | Descrição |
|---|---|
| Original | A imagem, o áudio, o vídeo, o PDF ou a página, com o texto lido (OCR, transcrição ou texto extraído). "Abrir o arquivo" abre o original em outra aba. |
| Assunto | Até 5 palavras; aparece no Buscar e nas listas. A IA sugere; pode trocar. |
| Resumo | O texto do memo. Obrigatório. |
| Categoria | Lista das categorias do espaço. Ao trocar, os campos da nova categoria aparecem. |
| Palavras-chave | Em etiquetas; toque no × para tirar. |
| Campos da categoria | Formulário com o tipo de cada campo (texto, número, data). Campo vazio fica em branco com contorno amarelo; "✦ preenchido pela IA" marca o que a IA achou. |
| Salvar | Grava o memo e mostra "Memo salvo em …". |
| Descartar e voltar | Cancela sem salvar. |
## Trocar a categoria e Re-processar
Ao trocar a categoria (inclusive quando a IA não conseguiu classificar e o memo veio sem categoria), aparece o aviso "Você alterou a categoria para X" com o botão ↻ Re-processar (ou "Preencher com a IA"). Ele manda à IA o texto já extraído dizendo qual é a categoria. É uma chamada de texto, sem reler a mídia, e o custo é somado ao do memo.
- O ↻ Re-processar substitui as palavras-chave e os campos da tela, inclusive os editados à mão. Por isso não roda sozinho ao trocar a categoria. Se não quiser re-processar, basta seguir e salvar.
## Comportamentos específicos
- Com armazenamento S3, a miniatura, o áudio e o vídeo da revisão são servidos pelo próprio proMemory (o bucket é privado). Só quem enviou o arquivo consegue abri-lo nessa tela.
- Documento: o texto é extraído antes de a revisão abrir ("Processando o documento… Não feche a página").
NOTA: Se o usuário fechar o navegador antes de salvar, o memo não é gravado.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Nada para revisar. Volte e catalogue um memo. | A revisão foi aberta sem um memo em andamento (ex.: página recarregada). Catalogar de novo. |
| Não deu para ler o texto deste arquivo. | Arquivo sem texto legível. Escrever o resumo à mão ou descartar. |
| Escreva o resumo do memo. | Resumo vazio. É obrigatório para salvar. |
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

# SEÇÃO 8 — Fale comigo (perguntas ao proMemory)
Rota: / (aba Fale comigo) · Componente: PerguntaPage
## Propósito
Permite ao usuário fazer perguntas em linguagem natural sobre os memos do espaço ativo e sobre os dados estruturados (queries das categorias, inclusive bancos SQL Server de ERP). A IA classifica a pergunta, escolhe o caminho de resposta e mostra o resultado com as fontes usadas.
## Como usar
1. Digitar a pergunta no campo de texto ou falar clicando no microfone 🎤.
2. Clicar "Enviar" ou pressionar Enter.
3. A resposta aparece em um card, com os memos e dados usados.
4. Clicar em "Memo #id" abre o memo; a tabela de dados estruturados pode ser rolada e ordenada.
5. Para reutilizar, salvar a pergunta pelo ícone de salvar do card (ver "Salvar pergunta" abaixo).
## Tipos de resposta (pipe)
| Tipo | Quando é usado |
|---|---|
| Semântica | A resposta depende de interpretar textos dos memos (explicação, resumo, notícias). Usa busca por similaridade (pgvector). |
| Estruturada | Listagens, contagens, somas, médias, agrupamentos e filtros por critério. Usa as queries cadastradas nas categorias. |
| Híbrida | A pergunta pede números e interpretação textual ao mesmo tempo. Roda as duas partes e combina o resultado. |
NOTA: O tipo é escolhido pela IA.
- **↺ Refazer (um toque):** "não era isso". Sem IA, o sistema procura outra categoria com consultas que tenha pelo menos 2 palavras da pergunta (no nome, na descrição ou nas consultas) e refaz nela, como estruturada; se nenhuma passar desse limiar, refaz pela busca nos textos dos memos, em todo o grupo. A resposta mostra "↺ Refeito com: <categoria>" ou "textos dos memos". A categoria da resposta anterior não é repetida.
- **⋯ (ao lado):** as opções de sempre — forçar Semântico, Estruturado ou Híbrido, e "No manual".
- **Resposta com tabela:** o texto aparece em 2 linhas, com "Mais…" para abrir (a tabela abaixo traz os dados).
## Etapas da resposta estruturada
1. Classificação: identifica o tipo e as categorias envolvidas.
2. Planejamento: escolhe as queries da categoria e preenche os parâmetros (cliente, período, produto…).
3. Execução: roda as queries (PostgreSQL interno ou SQL Server do ERP).
4. Síntese: a IA redige a resposta usando somente as linhas retornadas.
## Texto da resposta e tabela
A resposta estruturada é dividida em duas partes: o texto resume, a tabela (e o PDF) traz os registros.
- Com até 5 registros, o texto pode citar cada um.
- Com mais de 5, o texto tem de 1 a 3 frases: quantos registros, o filtro e o período, e o total quando fizer sentido. Termina dizendo que a lista completa está na tabela. A lista não é repetida no texto.
- Totais (ex.: faturamento total) são somados pelo sistema sobre TODAS as linhas, não só as 20 que a IA recebe.
- Maiores e menores ("os 3 produtos mais faturados") também são calculados pelo sistema sobre todas as linhas. A IA só cita destaques quando a pergunta pede ranking, maiores ou menores.
- A tabela mostra só as colunas que a pergunta pede: o item (ex.: código e descrição do produto) e a medida (ex.: valor faturado). Para ver outras, peça na pergunta: "incluir o cliente", "com o número da nota".
DICA: Peça o ranking de forma explícita ("os 5 maiores clientes em faturamento") para que os destaques venham no texto.
## Colunas e linhas da tabela
- **Ordem das colunas pela categoria:** cada campo tem **Ordem na tabela** (edição do campo). 1, 2, 3… aparecem primeiro, nessa ordem; vazio vem depois, na ordem dos campos; colunas que não são campo (texto, data de registro) por último; **-1 não aparece**, a não ser que a pergunta cite o campo. Com alguma ordem definida na categoria, a tabela mostra todas as colunas da consulta (menos as técnicas), e não só as que a IA escolheu.
- **Lápis (✎) sempre na primeira coluna; #id e o ícone do arquivo original sempre na última.**
- **Arrastar colunas** (computador): arraste o título para outra posição. Aparece "Gravar esta ordem de colunas em <categoria>? Gravar (5)" por 5 segundos; sem tocar em Gravar, a nova ordem vale só nesta resposta. Gravar exige ser dono do grupo e a categoria ser do grupo (não global).
- **Duplo clique no título** ordena as linhas: crescente, decrescente e volta à original (números, datas e texto; vazios no fim).
- **Ver todas:** a tabela começa com as primeiras linhas; o botão no rodapé mostra todas (até 2.000, as mesmas do PDF).
## Gráfico das respostas: papel de cada campo
Na edição do campo, **Papel no gráfico**:
| Papel | No gráfico |
|---|---|
| **X** | Rótulos: eixo das categorias (embaixo na barra em pé, à esquerda na barra deitada) — ex.: Cliente, Mês, Produto |
| **Y** | Valor: tamanho da barra — ex.: Valor, Quantidade. **Com mais de um Y, cada um vira uma barra de cor diferente** (cor automática) |
| vazio | Não entra no gráfico, a não ser que a pergunta cite o campo (número vira Y; texto vira X, se ainda não houver X) |
- Linhas com o mesmo rótulo são somadas (ex.: várias notas do mesmo cliente viram uma barra).
- Com mais de 20 rótulos, ficam os 20 maiores pelo primeiro Y (ou as 20 primeiras datas).
- Categoria sem nenhum papel definido continua escolhendo sozinha, como antes; a barra em pé é usada para datas e meses, e a deitada para os demais rótulos.

## Ordenação
"Ordene por X", "em ordem alfabética", "de A a Z", "do maior para o menor" e "mais recentes primeiro" são aplicados no próprio banco de dados: a tabela e o PDF já chegam na ordem pedida.
- Exemplo: "Listar faturamento por produto de abril de 2026, incluir abrev do cliente e ordenar por abrev cliente de A a Z".
## Comparação entre dois períodos
Perguntas de variação entre dois períodos têm as contas feitas pelo sistema, não pela IA.
- Exemplo: "Faturamento e CMV total por produto, variação % de fevereiro sobre janeiro de 2026, somente produtos faturados nos dois meses".
- A tabela traz, para cada medida, o valor do período mais antigo, o do mais recente e a variação % (ex.: faturamento 01/2026, faturamento 02/2026, faturamento var. %, cmv 01/2026, cmv 02/2026, cmv var. %).
- As linhas vêm do maior impacto em valor (R$) para o menor.
- "Somente … nos dois meses" (ou "que tiveram movimento nos dois períodos") deixa de fora os itens que aparecem em um período só. Sem essa expressão, os itens novos e os que pararam também entram.
- O texto informa os totais de cada período com a variação, quantos itens subiram e quantos caíram, e os maiores aumentos e quedas EM VALOR, com R$ e % lado a lado (ex.: "LB-DI-773: −R$ 48.917,58 (−98,0%)").
- Até 4 medidas por comparação (ex.: faturamento, CMV, quantidade).
### Série mês a mês
Perguntas de evolução ao longo do tempo ("variação % mensal de faturamento em 2026", "crescimento mês a mês") vêm em uma tabela só, com uma linha por período e a coluna "<medida> var. %": a variação de cada período sobre o anterior, calculada pelo sistema. O primeiro período fica sem variação.
- Exemplo: "Mostrar variação % mensal de faturamento em 2026 do mês posterior sobre o mês anterior".
- A coluna de % aparece com o sinal % e não entra no gráfico (que mostra os valores).
NOTA: Os destaques do texto seguem o impacto em R$. Um item com queda percentual maior, mas de valor pequeno, pode não ser citado; ordene a tabela pela coluna "var. %" para ver o ranking em percentual.
DICA: O CMV total depende de a query da categoria ter a coluna de custo total (custo unitário × quantidade). Se só houver o custo unitário, a soma não representa o CMV. Ver Seção 17.
## Consultas auxiliares
Algumas perguntas fazem uma consulta só para obter uma lista que filtra outra (ex.: "dos clientes insatisfeitos, mostrar o faturamento"). Essas consultas auxiliares não aparecem como tabela na tela nem no PDF; só a consulta final aparece.
- Quando duas listas filtram o mesmo campo (ex.: produtos de janeiro E produtos de fevereiro), valem só os itens presentes nas duas.
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
Clicar no ícone de salvar do card (balão de conversa com +) guarda a pergunta em "Perguntas salvas".
- Se a resposta não tem parâmetros trocáveis, salva direto, como texto.
- Se tem parâmetros (cliente, produto, período…), aparecem duas opções: "Salvar só o texto" (padrão, já com foco) e "⚡ Com parâmetros". Ver Seção 9.
## Carregar pergunta salva
O botão "Perguntas salvas" abre a lista do espaço ativo, com busca por texto e filtro por categoria.
- Na mesma sessão do navegador, a lista reabre com os mesmos filtros e rola até a última pergunta escolhida, que fica destacada.
- A memória é por grupo (e pelo espaço pessoal) e some ao fechar a aba.
- Perguntas com ⚡ têm parâmetros (Seção 9). As demais são carregadas como texto na caixa de pergunta.
- Ao editar uma pergunta salva (na lista ou na página Perguntas salvas), dá para trocar também a categoria, usada no filtro da lista.
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
## PDF da resposta
O ícone de PDF no cabeçalho da resposta (ao lado do alto-falante) baixa a resposta como documento PDF:
- cabeçalho com data e hora, a pergunta e o texto da resposta, com o tipo (semântico, estruturado ou híbrido) e a confiança;
- o gráfico de barras, desenhado no próprio PDF (letras pequenas; rótulos inclinados só quando não cabem; nomes longos encurtados com "…"), seguido da tabela;
- a tabela com TODOS os registros (até 2.000), não só os 20 mostrados na tela; o cabeçalho da tabela se repete em cada página;
- nas respostas semânticas, a tabela dos memos usados;
- as observações (limitações) da resposta e o número da página no rodapé.
Tabelas com mais de 6 colunas saem em paisagem. O arquivo se chama resposta-<início da pergunta>-AAAAMMDD-HHMM.pdf.
NOTA: Respostas dadas antes desta versão trazem só as 20 linhas que já tinham; refaça a pergunta para o PDF levar todas.
## Alterar, concluir ou cancelar pela resposta
Em categorias marcadas como Atualizável (ex.: Agenda), a resposta mostra um ✎ discreto, sem contorno, alinhado à direita na última linha do texto. Nas tabelas da resposta, o memo também aparece com ✎ ao lado do número e a linha fica clicável. O ✎ só aparece para quem pode alterar: o dono do memo, quem o catalogou e owners/editores do grupo.
1. Toque (celular) ou clique (computador) no ✎ do fim da resposta. Com um só memo atualizável, abre direto o cartão do memo com os campos preenchidos. Com vários, abre antes a lista "Qual memo alterar?" para escolher. Nas tabelas, a linha ou o ✎ dela abre o cartão daquele memo.
2. Mude os campos digitando ou pelo 🎤 de cada campo (encerra sozinho após 1,5 s de silêncio; no computador o texto aparece enquanto você fala). Hora falada ("15 horas", "15h30") vira 15:00/15:30; data vira dd/mm/aaaa.
3. Toque em "Salvar alterações". Não há confirmação extra: aparece "Alterado: … ↶ Desfazer" por 10 segundos.
- "✓ Marcar como concluído" e "✕ Marcar como cancelado" mudam a situação com um toque (também com ↶ Desfazer). Memo concluído ou cancelado mostra "↺ Reativar".
- O × do cartão (ou Esc) fecha sem alterar nada.
- A linha alterada mostra os valores novos na própria resposta; cancelada ou concluída aparece riscada.
- Depois de salvar, a IA reescreve o resumo do memo com os valores novos e o vetor do memo é refeito (busca semântica). O texto original do memo nunca é alterado.
- Cada alteração fica registrada (quem, quando, antes e depois); o ↶ Desfazer usa esse registro. O registro aparece na caixa Histórico da tela Editar memo (Seção 10).
- A data é conferida antes de salvar. Se ela já passou há mais de 30 dias, fica a mais de 2 anos ou não parece uma data, aparece um aviso (ex.: "⚠ Data: 16/11/2016 já passou (há 10 anos).") e o botão vira "Salvar mesmo assim". Confira o ano: um ano errado tira o memo das perguntas da semana.
## Lista aberta única (ex.: uma Lista de compras por Tipo)
Na edição da categoria atualizável com campo do tipo lista, a opção **Lista aberta** define o que acontece ao registrar itens pelo Fale comigo:
| Opção | Ao registrar "comprar leite e pão" |
|---|---|
| cada registro cria uma lista nova | Cria outra lista (como era) |
| uma lista aberta só | Se houver uma lista aberta (nem concluída nem cancelada), os itens entram nela |
| uma lista aberta por <campo> (ex.: Tipo) | Entram na lista aberta do mesmo Tipo (Mercado, Farmácia…); sem lista aberta daquele Tipo, cria uma nova |
- A data não entra na chave: a lista continua a mesma até ser concluída ou cancelada; depois disso, o próximo registro abre outra.
- Os itens entram direto, sem perguntar ("Acrescentei na lista aberta de Mercado…"), com ↶ Desfazer. Item que já está na lista não é repetido (a resposta avisa); item já comprado volta a pendente.
- Tipo não dito ("comprar leite") = o **primeiro valor padronizado** do campo (ex.: Mercado). Sem lista aberta desse Tipo, a lista nova já sai com ele.
- Vale para o que é dito ou digitado no Fale comigo; o Catalogar continua criando um memo novo.

## Repetir uma lista
Cria uma lista nova a partir de uma anterior (ex.: a lista de compras da semana passada). A lista anterior fica como está, com as marcas ✓/✗ e a data dela.
- Pelo botão **⧉ Repetir lista** no cartão da lista (ao lado de ✎ Alterar e ☑ Concluir lista), ou dizendo: "repete a última lista de compras", "repetir a lista #8446", "nova lista igual à anterior", "copiar a lista do mercado".
- Sem número, vale a última lista **concluída** da categoria (se nenhuma foi concluída, a mais recente). Com mais de uma categoria de lista, cite o nome (ex.: "lista de compras").
- A lista nova é a **cópia** da anterior com a **data de hoje** (nos campos de data): mesmos campos, mesmos itens sem as marcas ✓ (ainda a fazer na lista nova), **sem os itens cancelados** (✗) e com a situação Pendente. Para escolher os itens, diga quais: "com os itens concluídos" (ou "comprados", "o que comprei") → só os ✓; "com os itens concluídos e cancelados" → ✓ e ✗; "com os itens pendentes" → só os sem marca; "com todos os itens" → todos. Ex.: "Gerar nova lista de compras com os itens concluídos e cancelados da última lista".

## Perguntar sobre remarcações e cancelamentos
Nas categorias atualizáveis, o Fale comigo também responde sobre o que MUDOU, usando o registro de alterações (consulta "Alterações — Agenda", criada sozinha; Seção 17).
| Pergunta | O que o sistema procura |
|---|---|
| "O que foi remarcado NESTA semana?" | Alterações feitas nesta semana (pela data em que você mudou). |
| "O que foi remarcado PARA esta semana?" | Memos cuja nova data cai nesta semana. |
| "O que foi cancelado em outubro?" | Memos cuja situação mudou para Cancelado em outubro. |
| "Quando a reunião com o Carlos foi mudada?" | Todas as alterações desse memo, com antes, depois e quando. |
A resposta mostra de onde para onde mudou e quando (ex.: Data: 14/11/2026 → 16/11/2026, alterado em 14/11).
NOTA: Só existem no registro as alterações feitas pelo ✎ da resposta ou pela tela Editar memo depois de 26/10/2026. Mudanças antigas não aparecem.
## Cartão do memo
Clicar no número de um memo (#id) na resposta abre o cartão dele. Ali:
- o ícone de documento abre o arquivo ou a página do memo;
- a lixeira pede confirmação ("Mover o memo #id para a lixeira?") e, ao confirmar, move o memo para a lixeira e fecha o cartão. A linha continua na tabela da resposta já exibida; ela some ao refazer a pergunta. Só o autor do memo pode excluir.
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
| Não encontrei dados estruturados para essa pergunta | Nenhuma categoria identificada. Conferir nome e descrição das categorias em Painel Owners → Categorias. |
| Erro ao processar a pergunta: Query #N "nome": … | Falha no SQL da query N. Abrir "ver etapas" para ver o SQL e os parâmetros; corrigir a query ou os parâmetros em Painel Owners → Categorias. |
| invalid input syntax for type numeric / date | Campo de memo com texto onde se esperava número ou data. Desde a v2 a Query padrão converte com tolerância; em queries editadas à mão, usar mymemory_parse_number / mymemory_parse_date (Seção 17). |
| A query "X" foi clonada e ainda não tem conexão definida | Query clonada com conexão pendente. Escolher a "Conexão BD externa" dela em Painel Owners → Categorias. |
| Resposta traz registros de outros clientes | Filtro do template não está sendo aplicado (ex.: nome de parâmetro digitado errado no SQL, como @Abrev_Abrev_Empresa). Conferir o SQL em "ver etapas". |
| Resposta cita dados fora do contexto | O planejador associou o termo ao campo errado. Preencher a descrição do campo (Seção 17) e refazer em Nova sessão. |
| Variação entre períodos: "não é possível cruzar os dois meses" | A comparação não foi montada (ex.: períodos com filtros diferentes, ou mais de dois períodos). Refazer em Nova sessão, citando os dois períodos e as medidas: "faturamento por produto, variação % de fevereiro sobre janeiro de 2026". Se repetir, enviar o trace ao suporte. |
| CMV total muito baixo perto do faturamento | A soma usou o custo unitário. Incluir na query a coluna de custo total (custo unitário × quantidade) e descrevê-la como CMV total (Seção 17). |
| "O que foi remarcado" traz memos que não foram remarcados | A pergunta foi respondida pela Query padrão (data atual), não pelo registro de alterações. Refazer em Nova sessão usando "remarcado", "alterado" ou "cancelado"; conferir se a categoria é Atualizável e tem a consulta "Alterações — categoria" (Seção 17). |
| ⚠ Data: … já passou (há N anos) | A data digitada ou falada no cartão de alteração parece errada (ex.: 2016 em vez de 2026). Corrigir; se estiver certa, clicar em "Salvar mesmo assim". |
| Os servidores de IA estão temporariamente sobrecarregados | Provedor de IA indisponível. Tentar novamente em alguns segundos ou minutos. |
| Créditos de IA esgotados | Limite do plano atingido. Aguardar renovação ou fazer upgrade. |
# SEÇÃO 9 — Perguntas salvas
Rota: / (aba Fale comigo) · Componentes: PerguntaPage, PerguntaChips
## Propósito
Uma pergunta salva com parâmetros guarda, além do texto, o plano da consulta (classificação, queries e parâmetros). Ao reutilizá-la, os parâmetros viram chips clicáveis na frase. O usuário troca só o que precisa (outro cliente, outro período) e a pergunta é reexecutada direto, sem as etapas de classificação e planejamento — mais rápida e com resultado consistente.
## Tela Perguntas salvas
Rota: /perguntas-salvas. "Perguntas que você usa sempre. As fixadas aparecem como atalho embaixo da caixa do Fale comigo."
| Campo / Elemento | Descrição |
|---|---|
| Busca | Procura nas perguntas e nas anotações. |
| Filtros por categoria | Etiquetas com as categorias das perguntas; "Sem categoria" para as demais. |
| Ordenar | Mais recentes, Mais antigas, Mais estrelas, De A a Z. |
| Grupos | As perguntas aparecem agrupadas por categoria. |
| 📌 Fixar no Fale comigo | Vira atalho embaixo da caixa do Fale comigo (só para você). Tocar de novo desafixa. |
| Perguntar | Faz a pergunta na hora, já na aba Fale comigo. |
| Me avise ligado | Etiqueta que aparece quando a pergunta tem um aviso ativo; tocar abre Meus avisos e lembretes. |
| Editar (tocar no texto) | Pergunta, categoria, anotações, classificação (estrelas), Fixar e "Me avise quando a resposta mudar". Botões Salvar, Cancelar e Excluir. |
## Como salvar
1. Fazer a pergunta normalmente e conferir se a resposta está correta.
2. Clicar no ícone de salvar do card.
3. Escolher "⚡ Com parâmetros". A opção "Salvar só o texto" mantém o comportamento antigo.
NOTA: Só respostas estruturadas com parâmetros trocáveis oferecem a opção. Perguntas semânticas e híbridas sempre são salvas como texto.
## Como usar
1. Abrir "Perguntas salvas" e escolher uma pergunta marcada com ⚡.
2. A frase aparece com os chips no lugar dos valores. Ex.: "faturamento do cliente [Cliente: Diguinho] [Período: nos últimos 6 meses]".
3. Clicar em um chip para trocar o valor.
4. Clicar "Enviar". O card da resposta mostra ⚡ indicando que o plano salvo foi reaproveitado.
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
- Editar o texto de uma pergunta salva em "Perguntas salvas" remove o plano: ela volta a ser uma pergunta salva comum. Trocar só a categoria (ou as anotações e estrelas) não mexe no plano.
- Perguntas salvas antes da v2 não têm plano. Para ter chips, refazer a pergunta e salvar com parâmetros.
- O autocomplete só funciona quando o parâmetro corresponde a uma coluna do SELECT da query (ex.: parâmetro abrev_empresa ↔ coluna Abrev_Empresa). Sem isso, é possível digitar o valor livremente.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Opção "⚡ Com parâmetros" não aparece | A resposta não era estruturada ou não tinha parâmetros trocáveis. Salvar só o texto. |
| Chip sem sugestões | Parâmetro não ligado a uma coluna do SELECT, ou termo com menos de 2 letras. Digitar o valor completo. |
| Microfone não funciona no chip | Permissão de microfone negada ou navegador sem reconhecimento de voz (no desktop usar Chrome ou Edge). |
| A pergunta foi replanejada em vez de reexecutada | A query mudou desde o salvamento. Comportamento esperado; salvar de novo para atualizar o plano. |
| Fora do seu perfil de acesso: categoria | A pergunta salva usa uma query de categoria que não está no seu perfil. A conferência é feita a cada execução, não só ao salvar. Pedir ao owner do grupo para incluir a categoria no perfil. |
| Query #N não pertence a este grupo | A pergunta salva foi feita em outro grupo. Trocar para o grupo dela ou refazer a pergunta no grupo atual. |
# SEÇÃO 10 — Editar Memo
Rota: /memo/:id/editar
## Acesso
Toque no memo no Buscar, nos Recentes ou no cartão do memo aberto pela resposta do Fale comigo.
## Como é a tela
O mesmo desenho da revisão (Seção 6): o original à esquerda e o memo à direita (no celular, abas Original e Memo).
| Campo / Elemento | Descrição |
|---|---|
| Original | Imagem, áudio, vídeo, PDF ou página do memo. "Abrir o arquivo ↗" abre o arquivo; "Abrir a página ↗" abre o site de um memo de URL. |
| Assunto, Resumo, Categoria, Palavras-chave, Campos | Iguais à revisão (Seção 6). Campo de uma categoria antiga aparece marcado "campo antigo". |
| Detalhes do arquivo | Armazenamento, local do arquivo, metadados e (se ligado) o custo de IA. |
| Histórico | As alterações gravadas no memo, mais recentes primeiro: campo, valor anterior → novo, quem alterou e quando. "Resumo reescrito" quando só o resumo mudou. |
| Salvar | Grava as alterações e volta à tela de origem. |
| Excluir (botão vermelho no topo) | Pede confirmação: "O memo sai das buscas e das respostas." |
## Memo sem o original
Memos do Importar em lote por Disco local ou Rede local não guardam o arquivo (Seção 16). No quadro Original aparece "Original descartado na importação" e não há "Abrir o arquivo". O resumo, os campos e o histórico funcionam normalmente.
## Quem pode editar
Abrem a tela de edição (e veem o Histórico) e salvam: o dono do memo, quem o catalogou, os donos e editores do grupo e o administrador. É a mesma regra do ✎ das categorias atualizáveis (Seção 8). Excluir o memo continua só com o autor.
## Trocar a categoria e Re-processar
Ao trocar a categoria aparece o aviso "Você alterou a categoria para X" com o botão ↻ Re-processar: a IA refaz as palavras-chave e os campos da nova categoria a partir do texto do memo. O texto não muda. O custo de IA do re-processamento é somado ao custo e aos créditos do memo ao salvar.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Você não tem permissão para editar este memo de Fulano | O memo é de outra pessoa e você não o catalogou nem é dono ou editor do grupo. Pedir ao dono do memo ou ao dono do grupo. |
| Memo não encontrado | ID inexistente ou memo excluído. |
| Escreva o resumo do memo | Resumo vazio — obrigatório para salvar. |
# SEÇÃO 11 — Minha Conta
Rota: /conta/preferencias (seções por ?tab=perfil · padrão = Preferências · ?tab=uso)
## Menu lateral
| Campo / Elemento | Descrição |
|---|---|
| Nome e e-mail | No alto do menu, com as iniciais do usuário. |
| Perfil e senha | Trocar o nome e a senha. |
| Preferências | Como o proMemory se comporta ao catalogar e responder. Salva sozinha. |
| Uso do plano | O plano, o consumo do mês e onde a IA foi usada. |
| Perguntas salvas ↗ | Abre a tela própria /perguntas-salvas (Seção 9). |
| Avisos e lembretes ↗ | Abre /avisos (Seção 12). |

No celular, o menu vira uma faixa de botões no topo.
## Perfil e senha
- Nome: trocar e clicar "Salvar". O e-mail é o login e não muda aqui.
- Trocar a senha: informar a senha atual e a nova (mínimo 8 caracteres) e clicar "Trocar a senha". Esqueceu a atual? O link leva a "Esqueci a senha" (Seção 3).
## Preferências
Cada mudança é salva sozinha em menos de um segundo; o canto da tela mostra "Salvando…" e depois "✓ Salvo automaticamente". Não há botão de salvar.
| Campo / Elemento | Descrição |
|---|---|
| Conferir antes de mandar para a IA | Se ligado, pede confirmação (com o nível de IA) antes de mandar o arquivo à IA. A revisão depois do processamento segue a regra da categoria (Seção 6). |
| Guardar campos que não são da categoria | Se ligado, dados que a IA achar e a categoria não prevê ficam no memo mesmo assim. |
| Fotos pouco nítidas: ler com IA de imagem | Valor de 1 a 100. Abaixo dessa nitidez, a IA olha a própria imagem (custo extra só nesses casos). Vazio = desligado. |
| Quanto de IA usar em cada tipo | Para Texto, Imagem, Áudio, Vídeo, Documento e Página da web, três botões: Sem IA (só guarda), Básico (palavras-chave e categoria) e Completo (também os campos da categoria). Vale para os memos novos. |
| Voz ligada | Lê as respostas em voz alta e deixa usar o microfone. |
| Velocidade da voz | De 0,5× (lenta) a 2,0× (rápida). Aparece só com a voz ligada. |
| Abrir o PDF numa aba nova | O PDF da resposta abre numa aba em vez de ser baixado. |

## Uso do plano
- Cartão do plano: o nome do plano. Os créditos de IA voltam a zero todo mês.
- Quatro barras: Memos, Armazenamento, Créditos de IA (este mês) e Downloads (este mês), cada uma com o usado e o limite.
- A partir de 80% do limite, a barra fica laranja com "Perto do limite". Passando do limite, o uso continua liberado por enquanto.
- "Onde a IA foi usada este mês": créditos gastos em Catalogar, Fale comigo, Importar em lote e Avisos.
NOTA: Créditos e downloads contam no mês do calendário. Os limites vêm do plano individual ou do plano de grupo (quando o usuário é dono de um grupo assinante).
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Não foi possível salvar (Preferências) | Falha de rede ou da API. A mensagem aparece no topo; mudar a opção de novo tenta salvar outra vez. |
| A senha atual não confere | A senha atual digitada está errada. Conferir, ou usar "Esqueci a senha". |
| Seção Preferências apagada (cinza) | O banco ainda não tem as colunas de preferências. O administrador deve rodar as migrations da API. |
# SEÇÃO 12 — Meus avisos e lembretes
Rota: /avisos (menu da conta → Meus avisos e lembretes, ou o link do 🔔 sino)
## Propósito
Avisos: o proMemory refaz uma pergunta sua e avisa quando a resposta muda (ex.: "me avise quando surgir nova nota fiscal do cliente X"). Lembretes: compromissos que chegam até você por e-mail antes da data.
## Como criar um aviso
1. No card de uma resposta do Fale comigo, tocar em "🔔 Me avise". Também dá para ligar em Perguntas salvas ("Me avise quando a resposta mudar").
2. Revisar a descrição do aviso e confirmar.
3. O sistema reexecuta a pergunta periodicamente com o mesmo caminho (semântico, estruturado ou híbrido) e compara o resultado.
- A cada execução o sistema confere de novo se quem criou o aviso ainda é membro do grupo e se as queries e o perfil de acesso permitem. Se não permitem mais, o aviso é pausado e nada é enviado.
## Aba Avisos
Cada aviso aparece num cartão.
| Campo / Elemento | Descrição |
|---|---|
| Descrição e pergunta | O que está sendo vigiado. |
| Última mudança | O texto do último aviso enviado (o que mudou). "Ainda não mudou desde que você ligou o aviso" quando nunca mudou. |
| Frequência e e-mail | Quando a pergunta é refeita e para quem vai o e-mail. |
| Chave liga/desliga | Pausar aviso / Ligar aviso. |
| Histórico | Abre o painel "Histórico e ajustes": a linha do tempo de todas as mudanças enviadas. |
| Editar | No mesmo painel: frequência (diária, semanal com o dia, mensal…) e "Enviar e-mail para" (o seu ou o de alguém do grupo). |
| Verificar agora | Refaz a pergunta na hora. "Verificado agora: a resposta não mudou" ou "A resposta mudou: o aviso foi enviado e entrou no histórico". |
| Excluir | Remove o aviso, com confirmação. |
## Aba Lembretes
Os compromissos dos próximos 7 dias em que você é destinatário do lembrete (o mesmo que o sino mostra), com data, hora (ou "dia todo"), categoria e a situação do envio. O botão "Mais: ver os próximos 7 dias" no fim da lista carrega mais uma semana a cada toque. "Abrir o memo" abre o compromisso.
NOTA: A lista é só de leitura. Quem decide quais categorias mandam lembrete, e com quanta antecedência, é o dono do grupo (Seção 18).
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Você ainda não tem avisos | Situação normal — nenhum aviso foi criado. Faça a pergunta no Fale comigo e toque em Me avise. |
| Aviso nunca dispara | A resposta não mudou, ou a query usada mudou de formato. Use Verificar agora; se continuar, recrie o aviso a partir de uma nova pergunta. |
| O aviso só pode ser enviado para o seu e-mail ou de um membro do grupo | E-mail de destino fora do grupo. Usar o próprio e-mail ou o de um membro. |
| Aviso ficou Pausado sozinho | Na execução agendada, o sistema conferiu de novo grupo, queries e perfil e o usuário não tem mais acesso (saiu do grupo, perfil mudou ou query foi movida). Ajustar o acesso e ligar de novo, ou excluir o aviso. |
| Fora do seu perfil de acesso (ao criar) | A pergunta usa query de categoria fora do seu perfil. O aviso não é criado. |
| Lembretes vazio | Nenhuma agenda sua com lembrete nos próximos dias. Quando uma agenda sua for catalogada, ela aparece aqui. |
# SEÇÃO 13 — Grupos: Criar / Entrar
Rotas: /grupo/novo · /grupo/entrar
## Criar novo grupo (/grupo/novo)
- 1. "Novo grupo": escolher o plano do grupo e clicar "Escolher".
- 2. No cartão "Novo grupo", o quadro "Plano do grupo" mostra o plano ("Trocar" volta à escolha).
- 3. Preencher o nome do grupo e, se quiser, "Para que serve".
- 4. "Criar grupo": quem cria vira o dono do grupo.
Após criar, o sistema leva ao Seletor de Espaço ou a Painel Owners (Seção 14).
## Entrar em grupo (/grupo/entrar)
Só se entra num grupo por convite.
- A tela mostra o seu e-mail com o botão "Copiar", para passar ao dono do grupo.
- "Convites esperando você" lista os convites pendentes para esse e-mail; "Ver convite" abre o aceite (Seção 15).
- Sem convites: "Nenhum convite pendente para este e-mail".
DICA: O dono envia convites em Painel Owners → Pessoas → Convidar pessoa.
# SEÇÃO 14 — Painel Owners
Rota: /grupo/:groupId/admin (as rotas antigas /grupo/:id/painel e /estrutura-memo levam para cá)
## Acesso
Menu da conta → Administração → Painel Owners. Só o dono (owner) do grupo e o administrador do sistema. O seletor de grupo no topo é uma busca e mostra só os grupos em que você é dono (o administrador vê todos e também "Categorias Modelos", que valem para todos os grupos).
## Seções do painel
| Seção | O que tem |
|---|---|
| Pessoas | Quem participa, o papel (owner, editor: cataloga, pergunta e busca; viewer: pergunta e busca), o perfil de acesso e o usuário no ERP de cada pessoa. Botão Convidar pessoa. |
| Categorias | As categorias do grupo e as globais (só leitura), com campos, consultas, lembretes, revisão e a marca Pessoal (Seção 17). |
| Consulta de memos | Localizar memos por categoria e período; o número abre o memo. |
| Perfis de acesso | Quais categorias cada perfil pode perguntar e quem tem cada perfil. |
| Ligação com o ERP | As conexões SQL Server do grupo. |
| Configurações | Chaves do grupo; cada uma salva sozinha ao mudar. |
## Pessoas e convites
O convite vale por 14 dias; a pessoa recebe um e-mail para aceitar. Convite vencido aparece marcado "venceu" e pode ser reenviado. Em "Usuário no ERP" informar o NOME do usuário do ERP (no Softing-erp, AGUSUAR.NOME), não o código interno.
## Consulta de memos
Escolha a categoria (ou Todas / Sem categoria) e o período. A tabela mostra os memos com os campos da categoria; clique no número do memo para abri-lo.
## Perfis de acesso
Cada perfil diz quais categorias a pessoa pode perguntar ("Todas as categorias (inclusive as criadas depois)" ou uma lista) e se responde com memos sem categoria. O perfil marcado "padrão" vale para quem não tem perfil. A marca Pessoal aparece só para leitura; ela é configurada na categoria.
## Configurações
| Chave | Descrição |
|---|---|
| Assunto dos memos | Gera o Assunto dos memos antigos em lotes de 50 (usa créditos de IA). "Todos os memos já têm assunto" quando não falta nenhum. |
| Extrair campos mesmo sem categoria | A IA pode guardar dados de um memo que não combinou com nenhuma categoria. |
| Usar os perfis de acesso nas perguntas | Desligado: todo mundo pergunta sobre tudo do grupo. |
| Só pergunta ao ERP quem tem usuário do ERP ligado | Ligue depois de ligar as pessoas em Pessoas, senão elas ficam sem resposta do ERP. |
## Ligação com o ERP (conexões)
Gerenciamento das conexões SQL Server usadas pelas queries do grupo. Servidor, banco e senha ficam aqui; as queries escolhem a conexão (Seção 17).
| Campo / Elemento | Descrição |
|---|---|
| Nome * | Identificador amigável da conexão. |
| Descrição | Texto opcional. |
| Host * | Endereço público do servidor SQL Server (domínio ou IP público; aceita SERVIDOR\INSTANCIA). Para owners, endereços internos (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x, nomes sem ponto) são recusados; só o administrador cadastra conexão com endereço interno. |
| Porta | Padrão: 1433. |
| Banco de dados * | Nome do banco. |
| Usuário * | Login SQL. |
| Senha * | Senha SQL. Guardada cifrada; não exibida após salvar. |
| Criptografar | Ativa TLS/SSL na conexão. |
| Confiar no certificado | Bypass de verificação de certificado (útil em dev/testes). |
| Conexão principal | Marcada como principal para resolução de Nome/Abreviatura. |
| Botão Testar | Testa a conexão e exibe latência. |
| Botão Desativar | Desativa a conexão (soft delete). |

- A senha da conexão é guardada cifrada no banco do MyMemory e nunca volta para a tela.
- As queries que usam a conexão são somente leitura (Seção 17).

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Não foi possível abrir este grupo | Sessão expirada ou o usuário não é owner deste grupo. |
| Convite: e-mail não enviado | Falha no Resend. Convite registrado no banco — usuário pode acessar pelo link direto se disponível. |
| Teste de conexão BD falhou | Verificar host, porta, credenciais e se o SQL Server está acessível da rede do servidor. |
| Endereço interno não é permitido | Host da conexão aponta para a rede interna. Usar o endereço público do servidor do ERP, ou pedir ao administrador. |
| Use o endereço completo do servidor | Host sem ponto (ex.: SRV01). Informar o domínio completo ou o IP público. |
| Não foi possível localizar o servidor | Nome do host não existe no DNS. Conferir a digitação. |

# SEÇÃO 15 — Aceitar Convite de Grupo
Rota: /convite/grupo
## Fluxo
- 1. O convidado recebe o e-mail com o link do convite (ou vê o convite em Entrar em grupo, Seção 13).
- 2. O link abre /convite/grupo?token=… com "Fulano convidou você" e o nome do grupo.
- 3. Já tem conta: "Entrar e aceitar o convite" (a tela Entrar já vem com o e-mail convidado).
- 4. Não tem conta: "Criar minha conta e aceitar o convite"; depois de confirmar o e-mail, já entra no grupo.
- 5. Logado com o e-mail certo, o convite é aceito sozinho e o grupo passa a ser o espaço ativo.
## Casos especiais
- Convite vencido: a tela avisa; o dono deve reenviar.
- Convite já aceito: a tela avisa e oferece Entrar.
- Logado com outro e-mail: a tela pede para sair e entrar com a conta do e-mail convidado.
# SEÇÃO 16 — Importação em Lote
Rota: /importar-lote
## Propósito
Registra vários arquivos de uma vez como memos. A tela tem três abas: Importar agora, Importações automáticas (em grupo) e Extrair dono do memo (em grupo).
## Indicador de destino
No topo direito: "Destino: [espaço ativo]". Os memos são criados no espaço ativo (pessoal ou grupo).
## Importar agora: 3 passos
1. Escolher a pasta: a origem e o nível de IA.
2. Conferir os arquivos: a lista com a situação de cada um, a estimativa de créditos e a marcação do que vai ser importado.
3. Importar: o progresso arquivo por arquivo e o resultado (memos criados, com erro, sem dono).
## Origens disponíveis
| Origem | Como funciona |
|---|---|
| Disco local | Botões "Escolher pasta" (com subpastas) ou "Escolher arquivos" no seu computador. O navegador envia os arquivos um por vez; o proMemory lê o texto, cria o memo e descarta o original (o arquivo não fica guardado). |
| Rede local | Igual ao Disco local: na janela de escolha, abra a pasta da rede (ex.: \\servidor\pasta). O original também é descartado. |
| WebDAV | URL do servidor WebDAV da empresa. Se o grupo tiver servidores WebDAV cadastrados (/admin/storage), aparece a lista para escolher. O memo guarda o link do arquivo no WebDAV. |
| OneDrive, Google Drive, Link (URL) | Em breve: aparecem desabilitados. |
## Doc original é descartado (Disco local e Rede local)
O servidor do proMemory fica na nuvem e não enxerga o computador nem a rede da empresa. Por isso, em Disco local e Rede local, é o navegador que envia os arquivos. O memo fica só com o texto, o resumo, os campos e o nome do arquivo: o arquivo e o caminho dele não ficam guardados.
- No memo aparece "Original descartado na importação"; não há "Abrir o arquivo" (Seção 10).
- Até 50 arquivos por vez e até 100 MB por arquivo.
- Enquanto aparece "Enviando X de Y", não feche a tela. Depois que tudo foi enviado, pode fechar: a importação continua no servidor e o resultado aparece quando voltar.
- Se a tela for fechada no meio do envio, o que já chegou é importado e o que faltou aparece com erro "Não chegou".
- Para guardar o original, use o WebDAV ou o Catalogar.
## Níveis de IA
| Nível | Descrição |
|---|---|
| Sem IA | Guarda o texto. Você completa depois (tag [Edição Pendente] no memo). |
| Básico | Categoria e palavras-chave. |
| Completo | Também os campos da categoria. Recomendado. |
## Conferir os arquivos — situações
| Situação | Descrição |
|---|---|
| Pronto | Pode importar. |
| Parece repetido | Nome parecido com um memo já cadastrado, ou já existe em outro grupo. Ainda pode ser importado. |
| Já cadastrado | Já existe no espaço de destino. Fica de fora; "mostrar/esconder" no resumo exibe esses arquivos. |
| Não dá para importar | Tipo de arquivo não aceito, arquivo grande demais ou sem acesso. A coluna "Por quê" explica. |
Marque e desmarque os arquivos na lista; o botão "Importar N arquivos" importa só os marcados. "Trocar a pasta" volta ao passo 1. Em grupo, com WebDAV, "Automatizar esta pasta" leva para Importações automáticas.
NOTA: A Importação em Lote também é aberta pelo tile "📂 Guarda própria" do Catalogar (Seção 5).
## WebDAV com configs de grupo
Quando o espaço ativo é um grupo e esse grupo tem configs de WebDAV cadastradas (/admin/storage), ao selecionar WebDAV como origem, aparece um dropdown com os servidores configurados. Selecionar um preenche o campo de caminho automaticamente com a URL + prefixo de pasta da config.
## Importações automáticas
A aba "Importações automáticas" (em espaço de grupo) faz o servidor verificar uma pasta WebDAV periodicamente e importar sozinho os arquivos novos com situação Pronto. Parece repetido e Já cadastrado ficam de fora. Owner e editor do grupo podem criar. Disco local e Rede local não podem ser automatizados: o servidor não enxerga o computador nem a rede da empresa.
1. Na aba, toque em Nova importação automática (ou, no passo Conferir de uma pasta WebDAV, em "Automatizar esta pasta") e informe a pasta e o nível de IA.
2. A janela verifica a pasta na hora. Se não der, mostra o motivo em vermelho (ex.: pasta não encontrada, fora da whitelist, WebDAV fora do ar) e o botão "Verificar de novo". Só salva com a pasta acessível.
3. Escolha o intervalo, o nível de IA, o máximo de arquivos por execução e as opções, e clique em Salvar.
| Campo / Elemento | Descrição |
|---|---|
| Verificar a cada | 15 minutos, 30 minutos, 1 hora, 6 horas ou 1 dia. |
| Nível de IA | Sem IA, Básico ou Completo. Só o Completo gera os vetores da busca semântica do Fale comigo. |
| Máximo por execução | Limite de arquivos importados por vez (1 a 500). O que passar fica para a próxima. |
| Copiar o arquivo para o armazenamento | Marcado: copia o arquivo como o Catalogar (S3/local ou WebDAV padrão do grupo). Desmarcado: só referencia o arquivo na pasta (Guarda própria). |
| Enviar resumo por e-mail | Resumo para quem criou a automação quando importar algo ou der erro. |
| Ativa | Desmarcada = pausada. |
## Lista de importações automáticas
Na aba aparecem as automações do espaço com pasta, intervalo, nível de IA, situação (Ativa, Pausada ou Executando), última execução com o resultado e a próxima execução. Ações: Executar agora, Pausar/Reativar, Editar, Histórico (últimas execuções com os erros por arquivo) e Excluir (os memos já importados continuam).
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
## Aba Extrair dono do memo
Sobras da importação: arquivos que caíram numa categoria Pessoal (Seção 17), mas o proMemory não achou no documento de quem é o memo. A aba fica sempre visível em grupo; com cor fraca quando não há nada pendente e com o número de pendentes quando há.
Em categoria Pessoal, a importação (manual ou automática) grava o memo para o membro do grupo cujo e-mail (exato) ou nome (único no grupo) está no campo dono da categoria. Não identificado, o memo fica com quem importou e entra nesta aba, com o valor encontrado e o motivo (ex.: "Mais de uma pessoa com esse nome", "O campo dono veio vazio"). Escolha a pessoa e toque em Atribuir.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Pasta não encontrada / acesso negado (WebDAV) | Caminho incorreto ou sem permissão no servidor WebDAV. |
| Nenhum arquivo encontrado na pasta | Pasta vazia ou extensões não suportadas. |
| Erro ao processar arquivo X: ... | Falha específica do arquivo. Ver lista de erros no resultado. Outros arquivos não são afetados. |
| WebDAV: falha de conexão | URL do WebDAV incorreta, credenciais inválidas ou servidor offline. |
| Acesso a arquivos locais desativado. Configure BATCH_ALLOWED_LOCAL_PATHS | Mensagem da tela antiga (antes de nov/2026). Disco local e Rede local agora usam "Escolher pasta" no navegador. |
| O envio parou: … O que já chegou continua sendo importado. | A conexão caiu no meio do envio pelo navegador. Conferir a pasta de novo: o que entrou aparece como Já cadastrado. |
| Não chegou: a tela foi fechada antes de enviar este arquivo. | A tela foi fechada durante o envio. Importar de novo só os que faltaram. |
| Arquivo grande demais (máx. 100 MB) | Limite do envio pelo navegador. Dividir o arquivo ou catalogar pelo WebDAV. |

# SEÇÃO 17 — Categorias (Painel Owners)
Rota: /grupo/:groupId/admin → Categorias (a antiga /estrutura-memo leva para cá)
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
Consultas parametrizadas vinculadas a uma categoria, usadas pelo Fale comigo para respostas estruturadas. Podem rodar no PostgreSQL interno (sobre os memos) ou em um SQL Server externo (ERP), conforme a conexão escolhida.
| Campo / Elemento | Descrição |
|---|---|
| Nome da query | Identificador amigável. |
| SQL | Consulta SELECT com parâmetros :param (interno) ou @param (SQL Server). Somente leitura. |
| Parâmetros | Cada parâmetro lista o campo do memo de onde vem o valor. |
| Conexão BD externa | Vazia = PostgreSQL interno. Preenchida = SQL Server da conexão escolhida. |

## Executar uma consulta (▶ Executar)
Na aba **Consultas** da categoria, cada consulta tem o botão **▶ Executar** (só para o dono do grupo ou admin; não aparece em consulta de ERP sem conexão escolhida).
- Abre uma janela grande, redimensionável pelo canto e com ⛶ para maximizar.
- No topo, um campo para cada **parâmetro** da consulta (os mesmos que a IA preenche pela pergunta). Vazio = filtro de fora. Enter ou ▶ Executar roda.
- O resultado vem em tabela com rolagem e cabeçalho fixo; abaixo de cada coluna há um **filtro rápido** que só filtra o que já veio.
- Rodapé: linhas, tempo e **Copiar** (cola no Excel). Roda sem IA, com o mesmo isolamento do Fale comigo (dados só deste grupo; consulta de ERP pela conexão do grupo).

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
Ao trocar o nome de um campo (✎), o sistema leva o novo nome a tudo o que já existe na categoria: os memos já gravados, o campo dono e o campo de situação da categoria, os parâmetros das queries, o nome entre aspas simples (ex.: 'Proprietario') no SQL das queries de memos escritas à mão e a regra de lembrete (campos escolhidos e variáveis {campo} do texto da mensagem). Ao final, uma janela do navegador informa quantos memos e queries foram atualizados; ela só aparece quando o nome muda (trocar só a descrição não gera a mensagem).
- Não são atualizados: queries do ERP (os nomes ali são colunas do banco do ERP), descrições de outros campos que citem o nome antigo e textos de prompt personalizados da categoria. Revise-os à mão.
- Perguntas salvas com parâmetros que usavam o campo são replanejadas automaticamente na próxima execução.
- Prefira nomes que não se confundam com outras categorias (ex.: "Dono Agenda" em vez de "Proprietario", que também aparece em imóveis e veículos).
- Queries de ERP (SQL Server) não são alteradas: os nomes ali são colunas do banco do ERP.
## Parâmetros das queries
| Convenção | Uso |
|---|---|
| :param (PostgreSQL) / @param (SQL Server) | Placeholder no SQL. O nome do parâmetro é o nome do campo sem acento, em minúsculas, com "_" (ex.: Abrev_Empresa → abrev_empresa). |
| Operador LIKE | Queries de memos: comparação por palavras (ver Tipos de campo); com várias palavras, cada uma precisa estar no campo, em qualquer ordem ("Wilson FAPESP" acha "Sr. Wilson da FAPESP"). Queries de ERP: comparação exata; "contém" só quando a pergunta pede busca parcial ("contendo", "começa com"). |
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
Queries internas (PostgreSQL) rodam em modo somente leitura e com papel restrito: cada grupo só enxerga os próprios memos, mesmo que o SQL da query tente ler outros grupos. O SQL não pode usar set_config, current_setting nem funções pg_*; a query é recusada ao salvar e ao executar.
## Queries do ERP somente leitura
Queries de SQL Server são conferidas ao salvar, ao verificar a sintaxe e a cada execução.
- Devem começar com SELECT ou WITH e ter um único comando (sem ; no meio).
- São recusadas se contiverem comandos que gravam ou alteram (INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, CREATE, TRUNCATE…), EXEC, procedures xp_/sp_ ou OPENROWSET/OPENQUERY.
- SELECT … INTO só é aceito para tabela temporária (#tabela).
- Mesmo assim, o usuário SQL da conexão deve ter só permissão de leitura no banco do ERP.
## Agregações no SQL Server
Médias (AVG) são calculadas com casas decimais; antes, colunas inteiras eram truncadas (0,8 dia virava 0).
## Ícones de ação
Em cada linha (categoria, campo, query, parâmetro) há ✎ para editar e 🗑 para excluir. Só aparecem quando a tela está em modo de edição (admin, ou owner do grupo selecionado); em "Só visualização" ficam ocultos.
## Categoria Pessoal e campo dono
Em Painel Owners → Categorias → Editar categoria há a chave "Pessoal: cada memo é de uma pessoa" e o campo "Quem é o dono do memo". A marca diz de quem é cada memo; ela não esconde os memos dos outros membros. Nas perguntas, "minha agenda" ou "meus registros" mostram só os memos da própria pessoa; para ver todos, pergunte "de todos".
- Marcada a opção, escolha o "Campo dono do memo": o campo com o e-mail ou o nome da pessoa (crie um campo como "Dono Agenda" se não existir).
- Na importação em lote, manual ou automática, o memo passa a ser do membro do grupo indicado nesse campo. Não identificado, vai para a aba "Extrair dono do memo" da Importação em Lote.
- No Catalogar e ao editar um memo, vale a mesma regra: se o campo dono indicar outro membro do grupo, o memo passa a ser dele ao salvar. Vazio, o próprio autor ou nome não reconhecido: o memo continua de quem salvou (sem ir para a lista de pendentes).
- Campo dono vazio é preenchido com o nome de quem salvou (ex.: "Dono Agenda" = Ting). Os memos antigos com o campo vazio foram preenchidos da mesma forma.
- Quem pode editar o memo: o dono, quem o catalogou e os donos e editores do grupo (Seção 10). Excluir continua só com o autor.
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
- Ao marcar, o sistema usa o campo "Situação" da categoria (ou cria um), com os padrões Ativo, Concluído e Cancelado — as mesmas três situações em todas as categorias atualizáveis. Memo salvo sem situação é gravado como Ativo; os memos antigos com Situação vazia também foram marcados como Ativo.
- Nas respostas do Fale comigo, os memos da categoria podem ser alterados, concluídos ou cancelados (ver seção 8).
- Perguntas: a Query padrão esconde Concluído e Cancelado, a menos que a pergunta peça pela situação ("o que foi cancelado este mês?"). Queries editadas à mão não ganham esse filtro automaticamente.
- Lembretes: memos concluídos ou cancelados não geram aviso. Remarcar (mudar data ou hora) já reprograma o lembrete.
- Consulta de alterações: a categoria ganha sozinha a consulta "Alterações — Nome da categoria", marcada "Automática · histórico" em Painel Owners → Categorias. Ela lê o registro de alterações e responde "o que foi remarcado/cancelado" (Seção 8). Como a Query padrão, é atualizada quando os campos mudam; editada à mão, deixa de ser tocada; desmarcando Atualizável, ela é desativada.
| Situação | Significa | Agenda | Tarefa | Pedido |
|---|---|---|---|---|
| Ativo | vale, em andamento | marcado | aberta | em aberto |
| Concluído | terminou | aconteceu | feita | entregue |
| Cancelado | não vai acontecer | desmarcado | desistida | cancelado |
NOTA: Remarcar não é uma situação: o memo continua Ativo e a mudança de data ou hora fica no registro de alterações.
- A aba Perfis do painel mostra a marca Pessoal só para leitura; a configuração fica na categoria.
## Revisão antes de salvar
Em Editar categoria, a parte "Revisão antes de salvar" decide quando a tela de revisão abre ao catalogar (Seção 5):
| Campo / Elemento | Descrição |
|---|---|
| Sempre revisar antes de salvar | Para categorias críticas, como Contratos. A tela de revisão sempre abre. |
| % mínimo dos campos | Se a IA preencher pelo menos este % dos campos, o memo é salvo direto. Abaixo dele, o usuário escolhe Editar, Gravar assim ou Cancelar. Sugerido: 80%. |
## Permissões de edição
- Painel Admin: pode criar/editar/excluir qualquer categoria (global ou de grupo).
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
Rota: /grupo/:groupId/admin → Categorias → Editar categoria (parte Lembretes)
## Propósito
Envia e-mail antes da data/hora de cada memo de uma categoria (Agenda, vencimentos, renovações). O memo pode sobrepor o padrão da categoria (ex.: "me lembre 30 min antes", "avisar o João", "não precisa lembrar").
## Acesso
Em Painel Owners → Categorias, abrir a categoria e ir à parte Lembretes (a categoria precisa de um campo de data). Só o dono do grupo e o admin configuram. Lembretes só existem em categorias do grupo, não nas globais.
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
| Próximos lembretes (até 60 dias) | Aparece ao clicar em "Ver próximos envios". Lista os envios: memo, compromisso, antecedência, envio, para e situação. |
| Salvar / Excluir / Fechar | Grava, remove a configuração ou fecha sem salvar. |
## Destinatário por memo (campo "Avisar também")
Um campo do memo ligado ao seletor "Destinatário" avisa outras pessoas além de quem registrou.
| Texto no campo | Quem recebe |
|---|---|
| Nome de membro ("Suporte", "Dr. João") | O membro e quem registrou |
| Vários nomes e e-mails ("Suporte e João", "Maria; ana@empresa.com") | Todos eles e quem registrou (separe por vírgula, ";", "/" ou "e") |
| "grupo", "todos", "equipe" | Todos do grupo |
| Nome que não é de membro, ou que serve a vários | Os demais encontrados e quem registrou; a prévia mostra o nome não encontrado |
| Vazio | O destinatário padrão da categoria |
NOTA: Renomear um campo em Painel Owners → Categorias atualiza também a regra de lembrete (campos escolhidos e variáveis {campo} do texto da mensagem).
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
# SEÇÃO 19 — Painel Admin
Rota: /admin (cada seção com endereço próprio: /admin/planos, /admin/custos…)
## Acesso
Só para administradores do sistema: menu do avatar → Administração → "Painel Admin". Sem login, vai para Entrar; sem perfil de admin, aparece "Acesso negado".
## Menu lateral
Todas as telas de admin têm o mesmo menu à esquerda (no celular, ele fica no topo). Os itens estão em 6 grupos; o grupo da tela aberta fica aberto e os outros podem ser abertos com um toque.
| Grupo | Itens (endereço) |
|---|---|
| Clientes e planos | Planos de assinatura (/admin/planos) · Assinaturas e grupos (/admin/assinaturas) · Convites de usuários (/admin/convites) · Storage por grupo (/admin/storage) · Mídia por plano (/admin/midia) |
| Inteligência artificial | Provedores de IA (/admin/ia) · Prompts (/admin/prompts) · Último prompt (/admin/llm-prompt) · Roteamento de documentos (/admin/documento-ia) · CAD/BIM (/admin/cad-pipeline) |
| Conteúdo | Categorias Modelos · Importar conhecimento (/admin/conhecimento) · Consulta de memos (/admin/consulta) · Eliminação definitiva (/admin/eliminacao) |
| Integrações | Conexões de banco (/admin/conexoes) · Perfis de acesso (/admin/perfis) |
| Custos e saúde | Relatório de custos (/admin/custos) · Chamadas de IA (/admin/chamadas-ia) · Verificação do sistema (/admin/verificacao) |
| Sistema | Configurações (/admin/system-config) |

## Início (/admin)
- Faixa "Verificação do sistema": roda sozinha ao abrir e mostra uma bolinha por item (verde = ok, vermelha = falha) com o tempo de resposta. "Ver detalhes" abre a Verificação do sistema.
- Um cartão por grupo, com os itens dele; tocar no cartão abre o primeiro item.
## Planos de assinatura (/admin/planos)
Criar, editar e excluir planos (individuais e de grupo).
| Campo / Elemento | Descrição |
|---|---|
| Nome | Nome do plano (ex.: Gratuito, Pro). |
| Preço | Valor em R$. 0 = gratuito. |
| Máx. memos · Armaz. (GB) · Máx. membros | Limites do plano. |
| Cred. / mês · Download / mês (GB) | Limites mensais de créditos de IA e de download. |
| Duração (dias) | Vazio = sem prazo. |
| Assinantes | Assinaturas ativas no plano. Passando o mouse: o total, contando as encerradas. |
| Ativo | Planos inativos não aparecem para novos cadastros. |

NOTA: Plano com assinaturas (ativas ou encerradas) não pode ser excluído; o botão de excluir explica o motivo.
## Provedores de IA (/admin/ia) e Prompts (/admin/prompts)
- Provedores de IA: para cada tipo de trabalho (texto, imagem, transcrição de áudio), o provedor, o modelo, a temperatura, o máximo de tokens e se está ativo. A chave de cada provedor fica no servidor e não aparece na tela.
- Prompts: o texto de instrução de cada etapa (classificação, planejamento, síntese, extração por tipo de mídia), com ajuste por categoria. O que a IA recebeu de fato aparece em "Último prompt" (Seção 24).
## Consulta de memos (/admin/consulta)
Igual à Consulta de memos de Painel Owners, mas com acesso a todos os grupos. Filtros por grupo de categorias, categoria, grupo de memos e data.
## Eliminação definitiva (/admin/eliminacao)
Memos que foram para a lixeira, por mês. "Eliminar" apaga de vez os memos do mês e os arquivos deles (os registros de custo ficam).
- Para confirmar, é preciso digitar ELIMINAR na janela que aparece.
- O mês atual não pode ser eliminado: dá tempo de o usuário se arrepender.
NOTA: A eliminação não pode ser desfeita. Combine com o responsável técnico antes.
## Conexões de banco (/admin/conexoes) e Perfis de acesso (/admin/perfis)
- Conexões de banco: todas as conexões SQL Server dos grupos. Cada conexão mostra o resultado do último teste ("✓ Conectou · N ms" ou "✗ Não conectou" com o motivo) e a data; "Ainda não testada" quando nunca foi testada. "Testar" atualiza.
- Perfis de acesso: escolher o grupo e editar os perfis dele (o mesmo painel de Painel Owners → Perfis de acesso).
## Relatório de custos (/admin/custos)
Custos de IA e de download por plano, grupo e pessoa, no período e tipo de mídia escolhidos. No topo, três totais: IA no período (US$), Créditos cobrados e Download (US$). Abaixo, a tabela por plano, que abre por grupo e por pessoa, e o detalhe das últimas chamadas.
## Chamadas de IA (/admin/chamadas-ia)
Para o último dia, 7, 30 ou 90 dias: por etapa (classificação, planejamento, síntese, extração…), quantas chamadas, quantas falharam, o tempo médio, o tempo em que 9 de cada 10 terminam, o custo em US$ e os modelos usados. Serve para achar o que está caro ou lento.
## Verificação do sistema (/admin/verificacao)
"Executar diagnóstico" testa as dependências do Fale comigo (banco, embeddings, provedor de IA) e mostra o status, o tempo e o detalhe de cada uma.
## Convites de usuários (/admin/convites)
Convidar uma pessoa por e-mail e acompanhar os convites (enviado, aceito, expirado).
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Acesso negado | O usuário não é administrador do sistema. Conferir no banco (tabela users). |
| Seção não encontrada | O endereço /admin/<seção> não existe. Usar o menu lateral. |
| Botão Eliminar desabilitado | O mês é o atual, ou não há memos nele. |
| Falha ao carregar custos | Nenhum registro no período: resultado vazio é normal. |
| Não é possível excluir o plano | Existem assinaturas ligadas a ele. Passar os usuários para outro plano antes. |
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
| Pesquisa semântica — limiares (Fale comigo) | Limiar inicial e mínimo de similaridade. Quando a busca retorna vazio, o sistema reduz o limiar em 10% a cada tentativa até o mínimo. Valores de 0,01 a 1,00. |
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
## Relatório de chamadas de IA
Toda chamada de IA fica registrada (etapa, modelo, tamanho do prompt e da resposta em caracteres, tempo, falha e custo). O admin consulta o resumo por etapa em /api/admin/llm-chamadas?dias=7 (JSON; dias de 1 a 90). Serve para ver quais prompts pesam mais e onde enxugar.
NOTA: A edição dos prompts (com override por categoria) fica em Painel Admin → Inteligência artificial → Prompts (Seção 19). Para ver todas as etapas de uma pergunta específica, use "ver etapas" no card da resposta (Seção 8).
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
## Bucket S3 privado
O bucket do S3 fica fechado ao público. O link direto do arquivo (https://…s3…amazonaws.com/memos/…) responde Access Denied. Os arquivos abrem só pelo MyMemory, com login:
- memo salvo: pelo card (linha do nome do arquivo ou miniatura), via /api/memos/:id/file, conforme o acesso ao memo;
- tela de revisão do Catalogar: via /api/media-revisao, só para quem enviou o arquivo (áudio e vídeo podem avançar e voltar).
NOTA: A janela "Armazenamento do arquivo" da edição do memo mostra a localização no S3 só como informação; esse endereço não abre no navegador.
## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Teste de conexão falhou | URL incorreta, servidor offline, credenciais inválidas ou firewall bloqueando. |
| Arquivo não chegou ao WebDAV | Verificar se a config está marcada como 'Padrão' e 'Ativa'. Ver logs da API. |
| Senha mostrada em texto puro após salvar | STORAGE_ENCRYPTION_KEY não configurada no servidor. Configurar e regerar as senhas. |
| Não aparece dropdown de WebDAV no Batch Import | Verificar se há config ativa e padrão para o grupo no /admin/storage. |

# SEÇÃO 27 — Admin: Importar conhecimento
Rota: /admin/conhecimento (Painel Admin → Conteúdo → Importar conhecimento)
## Propósito
Importa conhecimento já dividido em trechos — por exemplo o próprio Manual MyMemory (docs/manual-chunks/chunks-mymemory-operacional.jsonl) ou um FAQ interno — para dentro de um grupo. Cada trecho vira um memo de texto com categoria, campos e vetores da busca semântica, sem passar pela IA de extração. Depois disso, as perguntas feitas no grupo passam a ser respondidas também com esses trechos.
Cada importação leva um Nome do manual (origem). Vários manuais podem dividir a mesma categoria: Substituir e Remover só afetam os trechos do manual com o mesmo nome.
## Antes de importar
1. Em Painel Owners → Categorias, criar a categoria de destino (ex.: "Manual MyMemory") no grupo ou como global.
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
| /grupo/:groupId/admin | Painel Owners: pessoas, categorias, queries, lembretes, perfis, ERP (owner e admin) |
| /avisos | Meus avisos e lembretes |
| /perguntas-salvas | Perguntas salvas |
| /importar-lote | Importar em lote |

## Verificação rápida de saúde do sistema
- 1. /api/health ou /api/diagnostics → resposta HTTP 200 significa API online.
- 2. Tentar login com conta de teste → se falhar, verificar banco de dados.
- 3. Criar memo de texto com Sem IA → se falhar, verificar armazenamento (S3 ou local).
- 4. Criar memo com IA básico → se falhar, verificar OPENAI_API_KEY.
- 5. Enviar convite por e-mail → se falhar, verificar RESEND_API_KEY e domínio.
Fim do documento — MyMemory Manual Operacional · Versão 2 (novembro de 2026)

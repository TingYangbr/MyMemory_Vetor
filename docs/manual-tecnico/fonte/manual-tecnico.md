# SEÇÃO 1 — Perfis de acesso: conceitos
Rota: Painel administrativo → aba Perfis (admin do sistema) · Painel do dono do grupo → aba Perfis

## Propósito
O perfil de acesso controla o que cada pessoa pode perguntar no Perguntar (dentro do myMemory ou no gadget embutido de um ERP). Um perfil é uma lista de categorias com um nome, definida por grupo, por exemplo Financeiro, Fiscal ou Geral. A pessoa só obtém respostas sobre as categorias do perfil dela. Pergunta sobre uma categoria que não está no perfil recebe "Resposta não aberta para o seu perfil".

O perfil controla só o Perguntar. O Localizar e a navegação pelo site continuam abertos ao grupo todo, como sempre foram.

## Conceitos
- **Grupo**: o cliente. Todos os perfis, categorias e ligações com o ERP pertencem a um grupo.
- **Categoria**: o tipo do memo (Faturamento, Agenda, Manual do usuário etc.). É o que o perfil libera ou não.
- **Perfil**: uma lista de categorias com nome. Não existe exceção por pessoa: quem precisa de um acesso diferente recebe um perfil novo.
- **Perfil padrão**: cada grupo tem um e só um. Quem não recebeu um perfil explícito usa o padrão.
- **De-para**: a ligação entre uma pessoa do myMemory e o usuário dela no ERP (no Softing-erp, o nome de login do usuário, AGUSUAR.NOME).
- **Chaves do grupo**: duas chaves ligam o modelo, "Aplicar os perfis nas perguntas deste grupo" e "Exigir cadastro no de-para". Nascem desligadas.

## Quem pode configurar
O administrador do sistema (escolhendo o grupo) e o dono do grupo (só o grupo dele). Membros comuns não veem a aba Perfis.

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Não vejo a aba Perfis | A aba só aparece para o administrador do sistema e para o dono do grupo. Peça a um deles ou entre com a conta do dono do grupo. |
| Configurei o perfil, mas a pessoa continua vendo tudo | A chave "Aplicar os perfis nas perguntas deste grupo" está desligada. Ligue-a (Seção 8). Enquanto estiver desligada, todos perguntam com o acesso de antes. |

# SEÇÃO 2 — Aba Perfis: matriz de categorias por perfil
Rota: Painel administrativo → Perfis · Painel do dono do grupo → Perfis

## Propósito
A aba Perfis mostra, numa tabela só, o que cada perfil acessa. As linhas são as categorias do grupo e as colunas são os perfis. Uma marca na célula significa que o perfil inclui a categoria. É a tela central para configurar e conferir os acessos.

## Campos e elementos
| Campo / Elemento | Descrição |
|---|---|
| Grupo | Só no painel administrativo: escolhe qual grupo configurar. No painel do dono, o grupo é sempre o dele. |
| Aplicação dos perfis | Duas caixas de seleção do grupo: "Aplicar os perfis nas perguntas deste grupo" e "Exigir cadastro no de-para para perguntar pelo ERP" (Seção 8). |
| Avisos | Alertas de configuração: categoria que nenhum perfil inclui, perfil sem ninguém e categoria marcada "Só os meus" com queries escritas à mão. |
| Coluna de perfil | Uma por perfil, com o nome, o selo "padrão" no perfil padrão e o número de pessoas que o usam. Abaixo ficam três ícones, cada um com uma dica ao passar o mouse: duplicar (copia o perfil), ✓ tornar padrão e lixeira (excluir). O perfil padrão só tem o ícone de duplicar. |
| Linha "Todas as categorias" | Marca o perfil como sem restrição: vale para todas as categorias, inclusive as criadas depois. As outras marcas da coluna ficam desabilitadas. |
| Linha de cada categoria | Mostra o nome e etiquetas do que a categoria oferece: "global" (categoria sem grupo), "Texto" (busca no texto dos memos), "SQL ERP" (consultas ao banco do ERP) e "SQL memos" (consultas sobre os memos). |
| Linha "(Sem categoria)" | Memos sem categoria, ou cuja categoria foi apagada ou renomeada. Só entram no Perguntar para quem tem esta marca ou "Todas as categorias". |
| Coluna "Só os meus" | Fica logo depois do nome da categoria. Marca de escopo da categoria (Seção 5). |
| Salvar alterações / Descartar | As marcas da matriz só são gravadas ao clicar em Salvar alterações. Descartar volta ao que está salvo. |
| O que cada perfil alcança | Resumo em texto de cada perfil, por exemplo "Faturamento: texto e SQL do ERP". |
| Pessoas | Lista de membros com o perfil de cada um e a ligação com o ERP (Seção 7). |

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| As marcas de uma coluna estão cinzas e não deixam alterar | O perfil está com "Todas as categorias" marcada. Desmarque essa linha para escolher categorias uma a uma. |
| A categoria que criei hoje não aparece na matriz | A matriz mostra as categorias do próprio grupo e, se o grupo não tiver nenhuma, as globais. Confira se a categoria está ativa e pertence ao grupo escolhido. |

# SEÇÃO 3 — Criar, editar e excluir perfis
Rota: Painel administrativo → Perfis · Painel do dono do grupo → Perfis

## Propósito
Cada perfil é criado uma vez por grupo e reutilizado por quantas pessoas precisarem. Quando alguém precisa de um acesso diferente, cria-se um perfil novo em vez de abrir uma exceção para a pessoa.

## Passo a passo
1. Abra a aba Perfis e, no painel administrativo, escolha o grupo.
2. Clique em "+ Novo perfil", informe um nome (por exemplo Financeiro) e confirme. O perfil nasce sem nenhuma categoria.
3. Na coluna do novo perfil, marque as categorias que ele pode acessar. Marque "(Sem categoria)" se ele deve alcançar memos sem categoria.
4. Clique em "Salvar alterações". A tela pede confirmação quando a mudança atinge o perfil padrão com pessoas usando.
5. Para dar um perfil a uma pessoa, use a seção Pessoas (Seção 7).

## Duplicar um perfil
O ícone de duplicar, no alto da coluna, cria um perfil novo com a lista que está marcada na coluna, mesmo antes de salvar, e deixa a coluna original como estava. Serve para montar uma variação e guardá-la com outro nome, ou só para copiar um perfil: a tela sugere o nome "(cópia)" e você escolhe o definitivo.

## Excluir um perfil
O ícone da lixeira, no alto da coluna, remove o perfil. As pessoas que o usavam voltam a usar o perfil padrão do grupo. O perfil padrão não pode ser excluído: eleja outro como padrão antes.

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Já existe um perfil com esse nome neste grupo. | Os nomes de perfil são únicos por grupo, sem diferenciar maiúsculas. Escolha outro nome. |
| O perfil padrão não pode ser excluído. Eleja outro como padrão antes. | Todo grupo precisa de um perfil padrão. Clique no ícone ✓ (tornar padrão) em outro perfil e depois exclua este. |
| Salvei e voltou ao que estava antes | Se a tela mostrou erro vermelho, a gravação falhou: leia a mensagem. Sem mensagem, clique em Salvar alterações de novo e confira se a contagem ao lado do botão zerou. |

# SEÇÃO 4 — Perfil padrão do grupo
Rota: Painel administrativo → Perfis · Painel do dono do grupo → Perfis

## Propósito
Cada grupo tem um e só um perfil padrão. Todo membro, novo ou antigo, que não recebeu um perfil explícito usa o padrão. Mudar o padrão muda de uma vez o acesso de todos que o usam.

## Como funciona
- Nos grupos que já existiam quando os perfis foram criados, o perfil padrão nasceu com todas as categorias e com "(Sem categoria)", para ninguém perder o acesso que tinha. O dono do grupo restringe depois, se quiser.
- Para mudar o padrão, clique no ícone ✓ (tornar padrão) na coluna de outro perfil e confirme. Quem usava o padrão anterior (sem perfil explícito) passa a usar o novo.
- Antes de salvar uma mudança no perfil padrão, a tela mostra quantas pessoas serão afetadas e pede confirmação. Um padrão restritivo demais tranca muita gente: confira antes de confirmar.
- O padrão pode ser renomeado.

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Mudei o padrão e muita gente perdeu o acesso | O padrão novo tem menos categorias que o anterior. Volte a marcar as categorias no padrão ou eleja o perfil anterior como padrão de novo. |
| Um membro novo não consegue perguntar sobre nada | Ele usa o perfil padrão, e o padrão do grupo está sem categorias. Marque as categorias necessárias no padrão. |

# SEÇÃO 5 — Marca "Só os meus"
Rota: Painel administrativo → Perfis → coluna "Só os meus" · Painel do dono do grupo → Perfis

## Propósito
Algumas categorias guardam coisas de cada pessoa, como a Agenda. A pergunta "quais são minhas reuniões em março?" não deve trazer as de todo o grupo. A marca "Só os meus" faz a categoria responder, por padrão, só com os memos da própria pessoa que perguntou.

## Como funciona
- É um padrão de escopo, não uma barreira de acesso. Quem tem a categoria no perfil pode pedir "de todos" ou "do grupo" na pergunta e ver os memos de todos. O acesso continua sendo decidido só pela lista do perfil.
- A pessoa precisa ter a categoria no perfil dela, mesmo para ver os próprios memos.
- A resposta informa o escopo usado: "Mostrando só os seus memos em X; para ver os de todos, peça 'de todos'".
- A marca vale só para memos. Consultas SQL ao ERP seguem apenas a lista do perfil.
- Em pergunta com várias categorias, o escopo vale só para as categorias marcadas.
- Sem identificar a pessoa de verdade (por exemplo, pergunta vinda do ERP de uma pessoa não ligada no de-para), a marca não é aplicada.
- Consultas SQL sobre memos escritas à mão só aplicam o escopo se usarem o parâmetro :autor, por exemplo (:autor IS NULL OR m.userid = :autor). A tela avisa quando há categoria marcada.

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| A caixa "Só os meus" está desabilitada | A categoria só tem SQL do ERP e não tem memos para filtrar por autor. A marca não teria efeito. |
| Categoria global não deixa marcar | Categoria global só pode ser alterada por um administrador do sistema. |
| A pessoa pediu as próprias agendas e veio vazio | A Agenda não está no perfil dela, ou ela não tem memos nessa categoria. Confira o perfil na seção Pessoas. |

# SEÇÃO 6 — Pessoas, perfis e limite de membros
Rota: Painel administrativo → Perfis → Pessoas · Painel do dono do grupo → Perfis → Pessoas

## Propósito
A seção Pessoas lista os membros do grupo, o perfil que cada um usa e a ligação dele com o ERP. Aqui se troca o perfil de alguém e se confere quantos membros o grupo tem em relação ao limite do plano.

## Campos e elementos
| Campo / Elemento | Descrição |
|---|---|
| Cabeçalho "N de M membro(s)" | N é o total de membros do grupo; M é o limite do plano de assinatura (maxMembers). Sem limite no plano, mostra só o total. |
| Perfil | Lista com "Perfil padrão (nome)" e os perfis do grupo. Escolher "Perfil padrão" faz a pessoa acompanhar o padrão, mesmo quando ele mudar. |
| Ligação com o ERP | Os ids do ERP ligados à pessoa e os campos para ligar um novo (Seção 7). |

## Limite de membros
O número máximo de membros vem do plano de assinatura do grupo e só o administrador do sistema o altera. O limite é conferido quando uma pessoa aceita um convite para entrar no grupo. Quem já é membro nunca é removido por causa do limite.

## Como o usuário do ERP entra no grupo
O usuário do ERP que vai usar o Perguntar é um usuário comum do myMemory. O dono do grupo o convida por e-mail e a pessoa aceita o convite, ou ela se cadastra pelo site. O convite exige e-mail e a pessoa precisa ter um plano individual ativo para aceitar. Depois de entrar, ela é ligada ao id dela no ERP (Seção 7).

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| O grupo atingiu o número máximo de membros do plano. Peça ao administrador do grupo para ampliar o plano. | O grupo já tem tantos membros quanto o plano permite. O administrador do sistema precisa ampliar o limite do plano, ou é preciso liberar espaço removendo um membro. |
| É necessário um plano individual ativo. | Quem aceita o convite precisa de um plano individual ativo. A pessoa deve escolher um plano antes de aceitar. |
| Entre com a conta do mesmo e-mail que recebeu o convite. | O convite só vale para o e-mail para o qual foi enviado. Entre com essa conta. |

# SEÇÃO 7 — Ligar usuários do ERP (de-para)
Rota: Painel administrativo → Perfis → Pessoas → Ligação com o ERP · Painel do dono do grupo → Perfis

## Propósito
O de-para liga uma pessoa do myMemory ao id dela no ERP. O ERP só informa "é o usuário 57"; o myMemory decide quem é essa pessoa e aplica o perfil dela. Sem a ligação, o myMemory não sabe quem está perguntando dentro do ERP.

## Campos e elementos
| Campo / Elemento | Descrição |
|---|---|
| sistema | O sistema de origem. Para o Softing-erp, use softing-erp (já vem preenchido). É gravado em minúsculas. |
| banco (opcional) | O banco do cliente, quando o mesmo grupo atende mais de um banco. Deixe vazio no uso comum: precisa coincidir com o banco da chave de integração do grupo, que por padrão é vazio. |
| usuário no ERP | O usuário com que a pessoa entra no ERP. No Softing-erp é o NOME da tabela AGUSUAR (o que se digita no login), não o código interno U1_IDUSUARIO. Maiúsculas e minúsculas não fazem diferença. |
| Ligar | Grava a ligação. Repetir a mesma ligação não duplica. |
| remover | Desfaz a ligação. A pessoa continua membro do grupo e perde só o reconhecimento pelo ERP. |

## Passo a passo
1. A pessoa precisa ser membro do grupo (Seção 6).
2. Na seção Pessoas, na linha dela, confira sistema e banco, digite o id dela no ERP e clique em Ligar.
3. Escolha o perfil dela na lista Perfil, ou deixe no perfil padrão.
4. No ERP, o botão Perguntar aparece para ela no próximo carregamento de tela. O ERP guarda a resposta de "pode perguntar?" por cerca de 1 minuto.

## Regras da ligação
- Um mesmo id do ERP só pode ligar a uma pessoa por sistema e banco.
- Uma pessoa só pode ter um id por sistema e banco. Para trocar, remova o atual antes.
- Se a pessoa sair do grupo, o acesso dela pelo ERP deixa de valer, sem precisar apagar a ligação.

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Esse id do ERP já está ligado a outra pessoa. | O id já pertence a outro membro do grupo neste sistema e banco. Remova a ligação da outra pessoa ou confira se digitou o id certo. |
| Essa pessoa já tem um id neste sistema/banco. Remova o atual antes de ligar outro. | Cada pessoa tem um id por sistema e banco. Clique em remover na ligação existente e ligue o novo. |
| Membro não encontrado | A pessoa não é membro deste grupo. Convide-a e espere ela aceitar antes de ligar. |
| Liguei, mas o botão não apareceu no ERP | Espere cerca de 1 minuto e recarregue a tela. Se continuar sem aparecer, confira se o id digitado é o do usuário que está logado no ERP, se o sistema e o banco são os da chave do grupo e se o módulo está habilitado na tela Integração myMemory do Softing-erp. |

# SEÇÃO 8 — Chaves do grupo: aplicar perfis e exigir cadastro
Rota: Painel administrativo → Perfis → Aplicação dos perfis · Painel do dono do grupo → Perfis

## Propósito
Duas chaves por grupo ligam o modelo de acesso. As duas nascem desligadas: o modelo entra por adesão, nunca por bloqueio. Com ambas desligadas, tudo funciona como antes de os perfis existirem.

## Campos e elementos
| Campo / Elemento | Descrição |
|---|---|
| Aplicar os perfis nas perguntas deste grupo | Desligada: todos perguntam com o acesso de antes (o grupo inteiro). Ligada: cada pergunta passa pelo corte do perfil da pessoa. Perfil com "Todas as categorias" continua sem restrição. |
| Exigir cadastro no de-para para perguntar pelo ERP | Desligada: quem não está ligado no de-para, ou o conector que não informa o usuário, continua perguntando como o usuário da chave de integração. Ligada: essas perguntas são recusadas, e o botão Perguntar some no ERP para quem não está ligado. |

## Ordem segura para ligar
1. Convide os usuários do ERP e espere aceitarem (Seção 6).
2. Ligue cada pessoa ao id dela no ERP (Seção 7) e confira o perfil de cada uma.
3. Confira a matriz e os avisos (Seção 2).
4. Ligue "Aplicar os perfis nas perguntas deste grupo" e teste com uma pessoa de perfil restrito.
5. Só por último ligue "Exigir cadastro". Ligar antes de ligar as pessoas deixa quem usa o gadget hoje bloqueado.

## Atenção com conectores antigos
Um ERP com versão antiga do conector não informa o usuário. Com "Exigir cadastro" ligada, as perguntas dele são recusadas com a mensagem "Este grupo exige identificar quem pergunta". Atualize o conector antes de ligar a chave.

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Seu usuário ainda não foi ligado ao myMemory. Peça ao administrador do grupo para cadastrá-lo. | "Exigir cadastro" está ligada e o id dessa pessoa não está no de-para. Ligue-a (Seção 7) ou desligue a chave. |
| Este grupo exige identificar quem pergunta. Atualize o sistema de origem para informar o usuário. | "Exigir cadastro" está ligada e o ERP não enviou o id do usuário. Atualize o conector do ERP ou desligue a chave. |
| Todos ficaram sem o botão Perguntar no ERP | "Exigir cadastro" foi ligada antes de ligar as pessoas. Desligue a chave, ligue as pessoas e ligue de novo. O botão volta em cerca de 1 minuto. |

# SEÇÃO 9 — Como a pergunta é decidida
Rota: Perguntar (myMemory e gadget do ERP)

## Propósito
Com a chave "Aplicar os perfis" ligada, cada pergunta passa por um corte feito no servidor, nunca na tela. A IA só diz sobre o que a pergunta é; quem libera ou recusa é a lista de categorias do perfil.

## Passo a passo da decisão
1. A pergunta é classificada pela IA, que recebe todas as categorias do grupo e devolve sobre quais categorias ela é.
2. O servidor compara as categorias classificadas com a lista do perfil da pessoa.
3. Se alguma categoria classificada estiver fora da lista, a recusa é total: nada mais é executado e a resposta é "Resposta não aberta para o seu perfil", citando o nome da categoria (nunca o conteúdo). A recusa fica registrada para análise.
4. Se a IA não identificar categoria, a pergunta segue pela busca nos textos, restrita às categorias do perfil.
5. Se tudo estiver liberado, a pergunta segue: consultas SQL das categorias classificadas, busca nos textos dos memos das categorias do perfil, ou as duas juntas.
6. Nas categorias com "Só os meus", a resposta traz só os memos da pessoa, a menos que ela peça "de todos".

## Pontos importantes
- O botão "Ampliar busca" passa pelo mesmo corte.
- Perfil com "Todas as categorias" não sofre corte nem filtro.
- Uma categoria libera os dois modos: texto e SQL. Não dá para liberar só o texto de uma categoria que tenha consultas SQL.
- Memos sem categoria, ou cuja categoria não existe mais, só entram para quem tem "(Sem categoria)" ou "Todas as categorias". Renomear uma categoria não atualiza os memos antigos: eles passam a valer como "sem categoria" até serem reclassificados.
- Ao cadastrar a primeira consulta SQL de uma categoria, a tela avisa quais perfis passam a ter também o modo estruturado.
- Uma classificação errada pode causar recusa indevida. A mensagem orienta a reformular a pergunta, e o administrador pode ver qual categoria falta em qual perfil.

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Resposta não aberta para o seu perfil | A pergunta é sobre uma categoria que não está no perfil da pessoa. Inclua a categoria no perfil dela (aba Perfis), dê a ela outro perfil, ou peça que reformule a pergunta se a IA entendeu o assunto errado. |
| A pergunta foi recusada, mas a pessoa acha que a categoria é permitida | A IA classificou a pergunta em outra categoria. Veja a categoria citada na mensagem, reformule a pergunta com termos mais específicos ou ajuste o perfil. |
| Memos antigos sumiram depois de renomear uma categoria | Os memos guardam o nome antigo, que agora não existe e vale como "sem categoria". Marque "(Sem categoria)" no perfil ou reclassifique os memos. |

# SEÇÃO 10 — Chave de integração do ERP
Rota: API administrativa /api/admin/group-api-keys (a tela "Chaves de API" ainda não está concluída)

## Propósito
A chave de integração (começa com mmk_) autentica o ERP no myMemory de servidor para servidor. Ela fica presa a um grupo, a um sistema de origem e a um banco do cliente. O grupo, o sistema e o banco vêm sempre do registro da chave, nunca do que o navegador envia: ninguém usa a chave de um cliente para alcançar dados de outro.

## Como funciona
- A chave é guardada só como hash. O valor completo aparece uma única vez, na criação, e não pode ser recuperado depois.
- O ERP guarda a chave cifrada no servidor dele e nunca a envia ao navegador.
- A cada pergunta o ERP informa também o id do usuário logado. O myMemory procura esse id no de-para do grupo (Seção 7) e responde como a pessoa ligada, com o perfil dela.
- Pergunta feita com a chave de um grupo sobre outro grupo é recusada.
- Hoje a chave é criada por um administrador do sistema, pela API administrativa, informando grupo, usuário de serviço, nome, sistema e banco. O sistema padrão é softing-erp e o banco padrão é vazio.

## Erros frequentes
| Mensagem / Sintoma | Causa e solução |
|---|---|
| Esta chave não pertence a este grupo. | A pergunta pediu um grupo diferente do grupo da chave. Confira o Group ID na tela Integração myMemory do Softing-erp: deve ser o grupo da chave. |
| unauthorized (401) ao perguntar pelo ERP | A chave é inválida, foi revogada ou expirou. Crie uma chave nova e regrave-a na tela Integração myMemory do Softing-erp. |
| Integração habilitada mas sem grupo do myMemory configurado | O Group ID está em branco na tela Integração myMemory do Softing-erp. Preencha com o grupo do cliente. |

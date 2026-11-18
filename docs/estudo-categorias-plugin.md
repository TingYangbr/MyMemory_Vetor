# Estudo — Categorias como plug-ins

*18/11/2026 · estudo para decisão, nada implementado.*

## 1. Resumo em 1 minuto

- **Ideia:** a categoria (Agenda, To-do, Lista de compras, Recebimentos…) vira um **pacote pronto**. O usuário lê o que ele faz, vê exemplos de frases e **habilita**. Não precisa saber o que é campo, tipo, query ou atributo.
- **Fora do escopo:** as categorias de ERP, que dependem de conexão e SQL do cliente, continuam como hoje.
- **Decisão central:** habilitar = **copiar o pacote para o grupo, guardando de onde veio** (recomendado), ou habilitar = **apontar para um modelo global único**. A recomendação e o motivo estão na seção 4.
- **Mudança de comportamento:** hoje toda categoria global aparece para todos automaticamente. No modelo de plug-in, o global vira **catálogo**: só aparece no grupo que habilitou.
- **Fase 1:** plug-ins só de configuração (categoria, campos, consultas, lembretes, prompts). **Fase 2:** plug-ins com rotina própria (Investimentos, com tabelas e importador).

## 2. O que existe hoje

| Peça | Onde está | Observação |
| --- | --- | --- |
| Categorias globais | `categories.groupid IS NULL` | Carregadas **sempre** para todos os grupos, junto com as do grupo (o grupo tem prioridade se o nome for igual). A IA vê todas na classificação |
| Cópia de globais para um grupo (admin) | `POST /api/admin/memo-context/clone-categories` | Copia atributos, campos (com tipo e verbos), subcategorias, consultas manuais; regera a Query padrão |
| Copiar categoria para outro grupo (owner) | `copiarCategoriaParaGrupo` | Mesma ideia, entre grupos |
| Atributos | `categories` | Atualizável, Pessoal e campo dono, Confirmar antes de alterar, Encerra pela data, Revisão |
| Campos | `categorycampos` | Tipos texto, data, número, lista, status; valores; verbos |
| Consultas | `queries_categoria` | Query padrão e Consulta de alterações automáticas; manuais |
| Prompts por categoria | `llm_prompt_category_overrides` (migration 107) | Ajustes da IA por categoria |
| Lembretes | `lembrete_regras` por categoria (migration 151) | Agenda, prazo, vencimento |
| Perfis de acesso | `perfil_acesso_categorias` (migration 154) | Quais categorias cada perfil vê |

**Conclusão:** quase tudo que um plug-in precisa já existe e já sabe ser copiado. Falta o **pacote** (o que descreve e agrupa essas peças), o **catálogo** e a tela de **entender e habilitar**.

**O problema das globais de hoje:** como aparecem para todos, um grupo que não usa Agenda continua tendo Agenda na classificação. A IA pode errar a categoria e o Perguntar oferece consultas que o usuário nunca pediu. Quanto mais modelos prontos existirem, pior fica.

## 3. O que é um plug-in

Um plug-in é a definição de uma ou mais categorias mais o que o usuário precisa para decidir:

| Parte | Exemplo (Lista de compras) |
| --- | --- |
| **Nome e para que serve** | "Listas de mercado, farmácia, obra. Uma lista por memo, um item por linha" |
| **Exemplos de uso** | "acrescentar 2 L de leite na lista do mercado", "comprei o café", "o que falta comprar?" |
| **O que vem pronto** | Campos (Nome da lista, Itens como lista, Situação), consultas, atributos (Atualizável, Confirmar antes de alterar) |
| **Perguntas na instalação** (opcionais) | "Quer confirmar antes de cada alteração?" — já vem marcado como recomendado |
| **Versão** | 1, 2, 3… para oferecer melhorias depois |
| **Dependências e ligações** | Recebimentos sugere Empreitadas; a relação "medição de" entre as duas |

**Guardado como um manifesto** (JSON), em tabela própria (`plugins`: id, nome, descrição, exemplos, versão, manifesto, ativo). O manifesto lista a categoria, os campos, as consultas manuais, os lembretes e os prompts. As consultas automáticas não entram: são geradas na instalação, como já acontece na cópia.

**Quem cria plug-ins:** o admin do sistema, a partir de uma categoria que já funciona ("publicar esta categoria como plug-in"). Assim o caminho para criar um plug-in é configurar e testar uma categoria normal, que é o que fazemos hoje.

## 4. Decisão central: copiar ou apontar

| | **A. Habilitar = copiar com origem** (recomendo) | **B. Habilitar = apontar para o global** |
| --- | --- | --- |
| O que acontece | Os itens do pacote são copiados para o grupo, com `plugin_id` e versão gravados na categoria | O grupo ganha uma linha "habilitado"; a categoria continua única, global |
| Personalizar | O owner muda o que quiser na cópia dele | Exige uma camada de "ajustes do grupo" por cima do global em todas as telas e consultas |
| Melhorias do plug-in | Oferecidas: "Há versão nova: + campo Data prevista. Aplicar?" | Chegam sozinhas para todos, inclusive quebrando o que alguém ajustou |
| Encaixe no código atual | Total: é a cópia que já existe (admin e owner), mais o registro da origem | Grande: hoje categoria, campos e consultas são lidos pelo `groupid` e pelo nome em muitos lugares |
| Memos | Ficam ligados à categoria do grupo, como hoje | Iguais |
| Risco | Versões divergem entre grupos | Uma mudança no global afeta todos de uma vez |

**Por que A:** o sistema já trabalha com cópias. Os memos apontam para a categoria pelo nome e pelo grupo, e o owner já edita as categorias do grupo. A opção B pediria uma camada de sobreposição em tudo que lê categoria (classificação, Query padrão, comandos, lembretes, perfis). A melhoria fica **oferecida, não imposta**, que é o comportamento esperado de um plug-in.

**Atualizar um plug-in já habilitado** (versão nova): compara o manifesto novo com o antigo e aplica só o que **o grupo não mexeu**. Campo novo entra. Campo que o owner renomeou não é tocado. Consulta manual nova entra. O usuário vê a lista do que muda antes de aceitar.

## 5. As globais de hoje

No modelo de plug-in, a categoria global deixa de ser carregada para todos e vira o **conteúdo do catálogo**.

**Transição sem perder nada:**
1. Cada global atual vira um plug-in (manifesto gerado a partir dela).
2. Para cada grupo que **já tem memos** numa categoria global, a migração **habilita** o plug-in, copiando a categoria para o grupo com o mesmo nome. Os memos continuam achando a categoria pelo nome.
3. Só então a carga de globais (`groupId IS NULL OR …`) sai da classificação e das consultas.
4. Grupo novo: começa sem categorias e escolhe os plug-ins (seção 6).

**Cuidado:** o passo 2 precisa rodar antes do 3, e numa mesma publicação. Senão, por um momento, os memos dessas categorias ficariam sem categoria visível.

**Alternativa mais leve, se a transição parecer arriscada:** manter as globais como estão e acrescentar só uma lista "categorias globais ocultas" por grupo. Resolve o ruído, mas não dá versão nem personalização. Serve como passo intermediário.

## 6. Experiência do usuário

**Catálogo** (no painel do grupo, ao lado de Categorias): cartões por tema.

| Tema | Plug-ins |
| --- | --- |
| Pessoal | Agenda, To-do, Lista de compras |
| Obras e serviços | Empreitadas, Recebimentos (cobranças por medição ou parcela) |
| Finanças (fase 2) | Investimentos, Cartão, Conta bancária |

**Tela de um plug-in:** para que serve; 3 a 5 frases de exemplo, que já podem ser testadas; o que vem pronto, em linguagem comum ("guarda: com quem, quando, onde"; "esconde compromissos que já passaram"); perguntas de instalação; o botão **Habilitar**.

**Depois de habilitar:** o Perguntar e o Catalogar passam a reconhecer a categoria na hora. A categoria aparece em Categorias, editável pelo owner, com a marca "do plug-in Agenda v1".

**Desabilitar:** desativa a categoria (`isactive = 0`). Os memos ficam e voltam se o plug-in for habilitado de novo. Nunca apaga.

**No cadastro do grupo:** "O que você quer controlar?", com os temas marcáveis. Isso substitui o onboarding difícil que discutimos no financeiro.

## 7. Plug-ins de configuração e plug-ins com rotina

| | Fase 1 — configuração | Fase 2 — com rotina |
| --- | --- | --- |
| O que contém | Categoria, campos, consultas, lembretes, prompts | Tudo da fase 1, mais a rotina após gravar, tabelas próprias (DB interno), importadores, views |
| Exemplos | Agenda, To-do, Lista de compras, Recebimentos, Empreitadas | Investimentos, Cartão, Conta bancária |
| Instalação | Só cópia de dados | O código já vem no sistema; habilitar liga a rotina para o grupo |

Na fase 2 o código de cada rotina continua no sistema (não é baixado). O plug-in só diz "esta categoria usa a rotina `investimentos`", que já é o contrato previsto na seção 5.6 do plano de atributos.

## 8. Por onde começar (fase 1)

1. Tabela `plugins` e o manifesto; "publicar categoria como plug-in" (admin).
2. Origem na categoria: `categories.plugin_id` e `plugin_versao`.
3. Catálogo e tela de um plug-in; Habilitar (reusa a cópia) e Desabilitar.
4. Quatro plug-ins iniciais: Agenda, To-do, Lista de compras e um quarto quando Recebimentos estiver decidido.
5. Transição das globais (seção 5), em publicação separada e com teste em cópia do banco.
6. Atualização de versão (diferença do manifesto).

Os passos 1 a 4 não mudam nada para quem já usa o sistema. A mudança visível está no passo 5.

## 9. Perguntas em aberto

1. **Copiar com origem (A) ou apontar (B)?** Recomendo A.
2. **Transição completa das globais ou passo intermediário** (só "ocultar globais por grupo")?
3. **Quem habilita:** só o owner do grupo, ou qualquer membro no próprio espaço pessoal?
4. **Plug-in com mais de uma categoria** (Empreitadas + Recebimentos) entra já na fase 1 ou fica para depois?
5. **Nome na tela:** "Plug-ins", "Modelos", "Módulos" ou "Pacotes"? Para usuário comum, "Modelos prontos" talvez seja mais claro que "plug-in".

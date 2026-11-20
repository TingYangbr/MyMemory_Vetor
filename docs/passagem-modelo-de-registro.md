# Passagem: modelo de registro (pergunta salva que cria memo) e antropometria

*Versão de 20/11/2026. Documento de passagem para quem continua o trabalho. Resume o que foi feito, como funciona, onde está no código, o que foi testado e o que ficou pendente. Os commits têm o detalhe de cada mudança (`f314ed6` a `145f698`).*

## 1. O que existe agora

**Modelo de registro** é uma pergunta salva que, em vez de consultar, **cria um memo** de uma categoria. A pessoa cria o registro uma vez pelo Fale comigo, salva a pergunta com **"⚡ Com parâmetros"**, fixa com 📌 e, nos dias seguintes, só preenche os valores num atalho. O primeiro uso foi uma categoria **Antropometria** (peso, IMC, % de gordura, gordura visceral, medições diárias).

| Recurso | Resumo |
| --- | --- |
| Salvar com chips | O card de criação oferece "⚡ Com parâmetros". O modelo guarda a categoria, o começo da frase e os campos de texto e número da categoria. |
| Chips vazios a cada uso | Nada do dia em que o modelo foi salvo é reaproveitado. **Campo não preenchido fica nulo**; pode enviar sem preencher tudo. |
| Sem IA ao enviar | O servidor monta o cartão "Revisar e salvar" direto dos valores dos chips. Sem classificação nem extração. Custo zero, e o valor digitado vai direto ao campo. |
| Data de hoje | Campo de data que valia "hoje" ao salvar o modelo recebe a data do dia (fuso de São Paulo). |
| Período automático | Campo de período do dia vazio recebe Manhã (antes das 12h) ou Noite (12h em diante). |
| Edição em linha | No celular, o editor do chip abre dentro da caixa de chips, com setas ‹ e ›, microfone no cabeçalho e sem botão OK. |
| Voz contínua | Um toque no 🎤 preenche os campos em sequência; "pular" deixa vazio, "parar" encerra. Tocar › durante a escuta encerra a gravação já. |
| Layout do celular | Caixa de chips com quase toda a largura da tela; sem o aviso "As respostas aparecerão aqui" quando há uma pergunta salva aberta. |

Não há migration: `pergunta_modelos.plano_json` já era JSONB (migration 152).

## 2. Como funciona, de ponta a ponta

**Salvar.** Pergunta digitada → classificada como `criar` → `prepararCriacao` (IA, 1 a 2 chamadas) → cartão "Revisar e salvar" → ícone de salvar do card → "⚡ Com parâmetros" → `POST /api/pergunta-modelos` com o plano:

```json
{
  "versao": 1, "tipo": "criacao", "categoria": "Antropometria",
  "prefixo": "Registrar minha medida antropométrica de hoje:",
  "campos": [{ "nome": "Peso Kg", "tipo": "numero" }, { "nome": "Periodo_Medicao", "tipo": "texto" }],
  "hoje": ["Data_Medicao"]
}
```

Os campos do plano são os de **texto e número** da categoria, **sem o campo dono**. Datas e status ficam de fora. `hoje` lista os campos de data cujo valor extraído era a data do dia ao salvar.

**Usar.** Atalho (📌) ou lista de Perguntas salvas → `chipsDeCriacao` (um chip por campo, `valor ""`, sem trecho na frase, então aparecem depois do começo da frase) → a pessoa preenche → Enviar → `POST /api/pergunta-modelos/:id/executar` com os valores → ramo `ehPlanoCriacao` → `montarCriacaoDeModelo` → resposta no mesmo formato das perguntas salvas, com `criacao` → abre o cartão → **Salvar registro** grava por `POST /api/memos/text/confirm` (nível "sem IA", custo 0).

**O que o servidor monta** (`montarCriacaoDeModelo`):
- dados: só os campos preenchidos, mais a data de hoje e o período automático;
- resumo em texto fixo: `Categoria de dd/mm/aaaa (Manhã) — Campo valor; Campo valor`;
- palavras-chave: a categoria e os campos preenchidos;
- `origemModelo: true`, para o aviso do cartão sair em cor neutra.

**Quando cai no caminho com IA** (devolve `replanejar` com o texto montado): categoria indisponível para quem usa (inclui o perfil de acesso do grupo) ou campo removido, inativo ou com tipo trocado. **Erros para a pessoa corrigir** (HTTP 400): nenhum valor preenchido, ou número que não parece número.

**Período automático** (`periodoDoDia`): vale para o campo de texto cujos **Padrões** têm "Manhã" e "Noite" (sem acento e maiúsculas), ou, sem padrões, o campo de nome `Periodo_Medicao`. Quem preenche o chip mantém o valor.

## 3. Onde está no código

| O quê | Arquivo |
| --- | --- |
| Tipo do plano, `planoDeCriacao`, `chipsDeCriacao`, `textoDeCriacao`, `ehPlanoCriacao` | `packages/shared/src/perguntaPlano.ts` |
| `numeroFalado` ("oitenta e um vírgula cinco" → `81,5`) e `comandoDeVoz` (pular/parar) | `packages/shared/src/numeroFalado.ts` |
| `ComandoCriacao.campoDono` e `origemModelo` | `packages/shared/src/index.ts` |
| `montarCriacaoDeModelo`, `periodoDoDia`, `camposDoCartao` | `apps/api/src/services/comandoCriacaoService.ts` |
| Ramo `criacao` do `/executar`, schema do plano, guardas em `/valores` | `apps/api/src/routes/perguntaModelos.ts` |
| Chips: editor em linha, setas, voz contínua, rascunho ao sair | `apps/web/src/components/PerguntaChips.tsx` e `.module.css` |
| Microfone: `abrirSessaoVoz` (celular grava com MediaRecorder e transcreve no Whisper; desktop usa Web Speech) | `apps/web/src/lib/vozCurta.ts` |
| Salvar e usar o modelo, ✎ ✕ na linha de ações, layout do celular | `apps/web/src/pages/PerguntaPage.tsx` e `.module.css` |
| Etiqueta "Registro rápido" no lugar de "Perguntar" | `apps/web/src/pages/acompanhar/PerguntasSalvasNovoPage.tsx` |

## 4. Decisões e por quê

- **Sem IA ao enviar.** A IA truncou valores no caminho por frase (IMC "24,1" virou 24, IGP "45" virou 4). Com chips o valor digitado vai direto ao campo, e o registro diário não gasta crédito do plano.
- **Um campo por medida, não lista.** O filtro de número (`mymemory_parse_number`) lê só o primeiro número do texto; uma lista quebraria média, faixa e evolução.
- **Chips começam vazios.** Se mantivessem o último valor, tocar em Enviar sem mexer gravaria o peso de ontem de novo.
- **Edição em linha, não balão nem painel novo.** O balão flutuante cobria o Enviar e os outros chips no celular; um painel separado confundia. A edição abre dentro da caixa, que cresce.
- **Voz contínua só no modelo de registro.** As perguntas com chips de consulta (autocomplete, períodos) continuam com o balão antigo, para não mexer no que já funcionava.
- **Ao tocar › ouvindo, a tela espera a transcrição** (1 a 2 s) antes de passar, em vez de passar na hora. Assim o valor não se perde se a pessoa tocar em Enviar logo depois.
- **Simplicidade para o usuário leigo.** Preferir padrões prontos e o mínimo de configuração. Por isso o motor de recorrência genérico (abaixo) foi adiado.

## 5. Como foi testado e o que não foi

- Tipos: `tsc --noEmit` limpo em `shared`, `api` e `web`.
- Lógica pura testada em Node: `numeroFalado` (24 formas), `comandoDeVoz`, `planoDeCriacao`, `montarCriacaoDeModelo` (dezenas de casos, incluindo categoria sumida, campo trocado, número inválido, período nas bordas das 12h).
- Encadeamento dos chips e layout testados no navegador em tamanho de celular, com **voz simulada**: sequência, pular, parar, ⏸, tocar em outro chip ou em Enviar, sem fala, número inválido, seta durante a escuta.
- **Não testado:** o microfone real e a transcrição no aparelho (principalmente iPhone, onde o áudio só abre dentro de um toque), nem o teclado numérico real empurrando a página. O usuário testou o fluxo de salvar e usar no celular e mandou fotos que corrigiram o layout.

## 6. Pendências e armadilhas

1. **A categoria foi excluída por engano e reativada direto no banco** (`UPDATE categories SET isactive = 1 WHERE id = 114`). A exclusão é um clique sem confirmação, e **não existe tela para ver ou reativar categorias inativas**. Depois de reativar por SQL, abrir a categoria no Painel Owners e **salvar uma vez** atualiza a "Query padrão". Vale propor uma confirmação ao excluir, ou uma lista de inativas com "Reativar".
2. **A IA trunca números no caminho por frase.** Causa não investigada (pode estar na normalização depois da extração). Afeta qualquer registro criado por frase.
3. **Memo gravado "sem IA" não gera embedding.** Só o nível `completo` gera. A consulta estruturada funciona (a sincronização dos campos roda sempre), mas a busca semântica por texto não acharia esse memo.
4. **Vários registros no mesmo dia não se sobrepõem:** cada envio é um memo novo. O campo `Periodo_Medicao` é o que os separa. Não há aviso de duplicata.
5. **Falta de medição** ainda só sai por uma query com `generate_series` cruzando calendário e memos. Não existe aviso "você ainda não mediu hoje": o lembrete atual dispara por memo existente.
6. **O botão "Perguntar" da tela Perguntas salvas não deve ser usado com modelo de registro**, porque reenviaria os valores do dia em que foi salvo. Por isso a tela mostra "⚡ Registro rápido" no lugar.
7. **Corte do período em 12h.** Uma medição às 15h sai como "Noite". Pode ser ajustado.
8. **Os manuais** (`docs/manual-*`) não descrevem essa funcionalidade.

## 7. Próximos passos discutidos

**Importador de medições.** A importação em lote cria **um memo por arquivo**, não um por linha. Uma imagem ou lista com 30 dias viraria 1 memo. Proposta: colar o texto (ou subir a imagem), mostrar uma **tabela de conferência** e, ao confirmar, criar **um memo por dia**. Começar pelo texto colado (determinístico, sem IA); a imagem seria a segunda etapa, lida por IA, com a conferência obrigatória. O formato da lista que o usuário tem é `dd/mm - peso - gordura [visceral]`, com linhas zeradas nos dias sem medição e datas do mês anterior sob o título do mês corrente. Decisões abertas, a combinar com o usuário:
- o número solto no fim da linha ("Fat 9") é a gordura visceral?
- linhas zeradas viram **falta**, sem criar memo (recomendado: zero distorceria a média)?
- datas de outubro sob o título de novembro valem como outubro do mesmo ano?
- de quem são as medições (o dono)? Como evitar duplicata se o dia já tem registro?

**Motor de recorrência genérico para lembretes** (adiado). A função `finOcorrencias`, em `packages/shared/src/financeiro.ts`, é pura e reaproveitável: recebe início, fim e periodicidade e devolve datas. A ideia era generalizá-la (diária, dias da semana, intervalo) e usá-la nos lembretes e na Agenda, e para "avisar se não registrou". Foi adiada porque o desenho ficou complexo para o usuário leigo. Antes de retomar, partir de padrões prontos e do mínimo de campos.

**Configuração da categoria Antropometria** (recomendada). Categoria Pessoal, com `Dono_Medicao` como campo dono, **não** Atualizável (medição não se conclui nem se cancela), revisão "sempre revisar" nas primeiras semanas. Campos: `Dono_Medicao`, `Periodo_Medicao` (padrões "Manhã, Noite") e `Muscle` em texto; `Data_Medicao` em data; `Peso Kg`, `IMC`, `IGP`, `IGV` e `Body Age` em número. `Muscle` está como texto; se o valor da balança for percentual, melhor Número. Conferir na categoria real.

## 8. Como testar

1. Categoria com campos de texto e número ativos e a categoria liberada para o seu perfil.
2. No Fale comigo, criar um registro por frase (por exemplo, `Registrar minha medida antropométrica de hoje: Peso Kg 78,5 IGP 22`). Fechar o cartão no × sem gravar.
3. No card, ícone de salvar → **"⚡ Com parâmetros"**. Fixar com 📌.
4. Abrir o atalho: os chips vêm vazios. Preencher alguns (com vírgula decimal), usar as setas ‹ ›, ou o 🎤 em sequência.
5. Enviar: o cartão traz só o que foi preenchido, a data de hoje e o período; o aviso diz "sem IA". Conferir e **Salvar registro**.
6. Excluir o memo de teste pelo 🗑 **do memo** (não o da categoria).

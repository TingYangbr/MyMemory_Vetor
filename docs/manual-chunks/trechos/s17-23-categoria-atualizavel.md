Manual MyMemory › Categorias › Categoria Atualizável
Seção: Seção 17 — Categorias (Painel Owners)
Rota: /grupo/:groupId/admin → Categorias (a antiga /estrutura-memo leva para cá)
Perfil: owner · Tipo: campos · Versão do manual: 2

Em "Editar categoria", a opção "Atualizável — os memos mudam de situação" serve para agenda, tarefas, pedidos: registros que depois são remarcados, concluídos ou cancelados.
- Ao marcar, o sistema usa o campo "Situação" da categoria (ou cria um), com os padrões Ativo, Concluído e Cancelado — as mesmas três situações em todas as categorias atualizáveis. Memo salvo sem situação é gravado como Ativo; os memos antigos com Situação vazia também foram marcados como Ativo.
- Nas respostas do Fale comigo, os memos da categoria podem ser alterados, concluídos ou cancelados (ver seção 8).
- Pedido de alteração sem dúvida ("Adiar reunião com Carlos para às 16 hrs") é gravado na hora: a resposta mostra a mudança (valor antigo riscado), "✓ Alterado" e **↶ Desfazer**.
- O Fale comigo pergunta antes de gravar (botões **✓ Confirmar**, **✎ Ajustar** e **Cancelar**) só quando há dúvida:
- Mais de um registro pode ser o certo (ex.: duas reuniões com Carlos): Um quadro por registro, para escolher qual alterar.
- O novo horário cruza com outro compromisso ativo da categoria: "⚠ Conflito de horário com: …" e os botões.
- A categoria tem "Confirmar antes de alterar" ligado: Os botões, sempre.
- O valor pedido já é o atual (ex.: pedido repetido, a reunião já é às 16:00): Nada é gravado: "Já está assim em Agenda: Horario já é 16:00."
Sem tocar em Confirmar, nada é gravado.
- Pedido de alterar sem registro correspondente ("adiar reunião com Carlos" sem reunião com Carlos) não cria registro novo: a resposta diz que não encontrou. Para marcar um novo, use "marcar" ou "criar" com a data. Exceção: incluir item numa lista sem lista aberta prepara a lista nova.
- Em categoria de compromisso (com data e hora, como Agenda), a data é obrigatória no Form do registro novo: vazia, aparece "· obrigatório" em vermelho e o Salvar avisa.
- Conflito de horário (registro novo e alteração): dois compromissos ativos da categoria no mesmo dia cujos horários se cruzam. Cada um vai da Hora até Hora + Duração ("2 horas", "1h30", "90 min", "meia hora"). Sem duração, conta 15 minutos para ligação (ligar, ligação, telefonar, WhatsApp, retornar) e 1 hora para o resto. Mesmo horário de início sempre conflita: 4 ligações às 8:00 dão conflito; ligações às 8:00, 8:15 e 8:30, não. Concluídos e cancelados não contam; na categoria Pessoal, só os do mesmo dono.
  - No Form do registro novo, o aviso "⚠ Conflito de horário com: Reunião com Carlos (16:00–17:00)" aparece no topo e muda conforme data, hora e duração são editadas. Salvar com conflito pede confirmação ("Salvar mesmo assim?").
- Maria 05/12 às 15:00, 2 horas (15:00–17:00): Sim
- Maria 05/12 às 16:30 (16:30–17:30): Sim
- Maria 05/12 às 15:00, sem duração (15:00–16:00): Não (termina quando a outra começa)
- Maria 05/12 às 17:00: Não
- Perguntas: a Query padrão esconde Concluído e Cancelado, a menos que a pergunta peça pela situação ("o que foi cancelado este mês?"). Queries editadas à mão não ganham esse filtro automaticamente.
- Lembretes: memos concluídos ou cancelados não geram aviso. Remarcar (mudar data ou hora) já reprograma o lembrete.
- Consulta de alterações: a categoria ganha sozinha a consulta "Alterações — Nome da categoria", marcada "Automática · histórico" em Painel Owners → Categorias. Ela lê o registro de alterações e responde "o que foi remarcado/cancelado" (Seção 8). Como a Query padrão, é atualizada quando os campos mudam; editada à mão, deixa de ser tocada; desmarcando Atualizável, ela é desativada.
- Situação: Ativo; Significa: vale, em andamento; Agenda: marcado; Tarefa: aberta; Pedido: em aberto
- Situação: Concluído; Significa: terminou; Agenda: aconteceu; Tarefa: feita; Pedido: entregue
- Situação: Cancelado; Significa: não vai acontecer; Agenda: desmarcado; Tarefa: desistida; Pedido: cancelado
NOTA: Remarcar não é uma situação: o memo continua Ativo e a mudança de data ou hora fica no registro de alterações.
- A aba Perfis do painel mostra a marca Pessoal só para leitura; a configuração fica na categoria.

Perguntas que este trecho responde:
- Quais são as opções de categoria atualizável em Categorias?
- O que significa cada item de categoria atualizável?

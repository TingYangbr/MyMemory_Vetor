Manual MyMemory › Telas de Revisão pós-upload › Comportamentos específicos
Seção: Seção 6 — Telas de Revisão pós-upload
Rotas: /revisao/memo-texto · /revisao/memo-imagem · /revisao/memo-audio · /revisao/memo-video · /revisao/memo-documento
Perfil: usuário · Tipo: conceito · Versão do manual: 2

- Memo Áudio: exibe player de áudio para o usuário ouvir a gravação antes de confirmar.
- Memo Imagem: exibe a imagem em miniatura e o texto extraído pelo OCR (se houver).
- Memo Vídeo: exibe miniatura do vídeo.
- Memo Documento: exibe o nome do arquivo e tamanho.
- Com armazenamento S3, a miniatura, o áudio e o vídeo da revisão são servidos pelo próprio MyMemory (o bucket é privado). Só quem enviou o arquivo consegue abri-lo nessa tela.
- Ao trocar a categoria (inclusive quando a IA não conseguiu classificar e o memo veio sem categoria), aparece o aviso "Você alterou a categoria para X. Re-processar refaz as palavras-chave e os campos com a nova categoria. O resumo não muda." com o botão ↻ Re-processar. Ele manda à IA o texto já extraído (OCR, transcrição ou texto original) dizendo qual é a categoria. É uma chamada de texto, sem reler a mídia, e o custo é somado ao do memo.
- O ↻ Re-processar substitui as palavras-chave e os campos da tela, inclusive os editados à mão. Por isso não roda sozinho ao trocar a categoria. Se não quiser re-processar, basta seguir: o aviso fica na tela e o memo pode ser salvo como está.
NOTA: Se o usuário fechar o navegador antes de confirmar, o arquivo não é salvo. Nenhuma ação de recuperação é possível.

Perguntas que este trecho responde:
- Como Telas de Revisão pós-upload se comporta?
- O que acontece depois de usar Telas de Revisão pós-upload?

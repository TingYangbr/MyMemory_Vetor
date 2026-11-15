Manual MyMemory › Importação em Lote › Enviar arquivos para a pasta automaticamente
Seção: Seção 16 — Importação em Lote
Rota: /importar-lote
Perfil: usuário · Tipo: campos · Versão do manual: 2

A automação importa o que chega na pasta; quem coloca os arquivos lá é um aplicativo ou equipamento, fora do MyMemory. Use como destino o servidor WebDAV (URL, usuário e senha) e a mesma pasta da automação.
- Celular Android: App FolderSync (ou o app do Nextcloud, opção "Envio automático"): crie uma conta WebDAV, escolha a pasta do celular (Câmera, Downloads, Documentos do WhatsApp…) e a pasta de destino no WebDAV, com sincronização "só enviar" e agendamento ou envio imediato.
- iPhone: App PhotoSync ou Documents (Readdle): adicione o servidor WebDAV e ative o envio automático de fotos/arquivos para a pasta. O app Atalhos também permite automações como "ao salvar um arquivo, enviar para o WebDAV".
- Scanner ou multifuncional: Configure o destino "digitalizar para pasta de rede/WebDAV" apontando para a pasta da automação.
- E-mail: Use um serviço de automação (Make, Zapier ou n8n) com a regra "e-mail recebido → salvar anexos (ou o texto como .txt) na pasta WebDAV". Um filtro no Gmail/Outlook encaminhando só o que interessa completa o fluxo.
DICA: Prefira formatos que a importação lê bem (PDF, imagens, documentos do Office, .txt). Áudio e vídeo ainda não são transcritos na importação em lote.
NOTA: A URL do WebDAV precisa estar liberada no servidor (BATCH_ALLOWED_WEBDAV_URLS); se a janela do Automatizar mostrar "fora da whitelist", peça ao administrador.

Perguntas que este trecho responde:
- Quais são as opções de enviar arquivos para a pasta automaticamente em Importação em Lote?
- O que significa cada item de enviar arquivos para a pasta automaticamente?

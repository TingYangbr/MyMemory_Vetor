Manual MyMemory › Admin: Storage por Grupo › Bucket S3 privado
Seção: Seção 26 — Admin: Storage por Grupo
Rota: /admin/storage
Perfil: admin · Tipo: conceito · Versão do manual: 2

O bucket do S3 fica fechado ao público. O link direto do arquivo (https://…s3…amazonaws.com/memos/…) responde Access Denied. Os arquivos abrem só pelo MyMemory, com login:
- memo salvo: pelo card (linha do nome do arquivo ou miniatura), via /api/memos/:id/file, conforme o acesso ao memo;
- tela de revisão do Catalogar: via /api/media-revisao, só para quem enviou o arquivo (áudio e vídeo podem avançar e voltar).
NOTA: A janela "Armazenamento do arquivo" da edição do memo mostra a localização no S3 só como informação; esse endereço não abre no navegador.

Perguntas que este trecho responde:
- O que é bucket s3 privado em Admin: Storage por Grupo?
- Como funciona bucket s3 privado no MyMemory?

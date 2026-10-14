Manual MyMemory › Admin: Storage por Grupo › Criptografia de senhas
Seção: Seção 26 — Admin: Storage por Grupo
Rota: /admin/storage
Perfil: admin · Tipo: conceito · Versão do manual: 2

As senhas WebDAV são criptografadas com AES-256-CBC usando a chave definida em STORAGE_ENCRYPTION_KEY no .env do servidor. Se esta variável não estiver definida, as senhas são salvas em texto puro (não recomendado para produção).
DICA: Para gerar uma chave segura: openssl rand -hex 32. Inserir no .env do servidor como STORAGE_ENCRYPTION_KEY=<valor>.

Perguntas que este trecho responde:
- O que é criptografia de senhas em Admin: Storage por Grupo?
- Como funciona criptografia de senhas no MyMemory?

Manual MyMemory › Referência Rápida Admin › Variáveis de ambiente (.env) essenciais (parte 1/2)
Seção: Seção 30 — Referência Rápida Admin
Perfil: admin · Tipo: campos · Versão do manual: 2

- DATABASE_URL: Connection string do PostgreSQL.
- OPENAI_API_KEY: Chave da API OpenAI.
- RESEND_API_KEY: Chave da Resend para envio de e-mails.
- EMAIL_FROM: E-mail remetente verificado na Resend.
- JWT_SECRET: Segredo para assinar tokens de sessão.
- STORAGE_MODE: local ou s3.
- S3_* / AWS_*: Credenciais e bucket S3/MinIO (se STORAGE_MODE=s3).
- STORAGE_ENCRYPTION_KEY: Chave AES-256 para criptografar senhas WebDAV. 64 hex chars.

Perguntas que este trecho responde:
- Quais são as opções de variáveis de ambiente (.env) essenciais (parte 1/2) em Referência Rápida Admin?
- O que significa cada item de variáveis de ambiente (.env) essenciais (parte 1/2)?

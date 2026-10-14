Manual MyMemory › Referência Rápida Admin › Verificação rápida de saúde do sistema
Seção: Seção 29 — Referência Rápida Admin
Perfil: admin · Tipo: passo a passo · Versão do manual: 2

1. /api/health ou /api/diagnostics → resposta HTTP 200 significa API online.
2. Tentar login com conta de teste → se falhar, verificar banco de dados.
3. Criar memo de texto com Sem IA → se falhar, verificar armazenamento (S3 ou local).
4. Criar memo com IA básico → se falhar, verificar OPENAI_API_KEY.
5. Enviar convite por e-mail → se falhar, verificar RESEND_API_KEY e domínio.

Perguntas que este trecho responde:
- Como verificação rápida de saúde do sistema em Referência Rápida Admin?
- Qual o passo a passo de verificação rápida de saúde do sistema?

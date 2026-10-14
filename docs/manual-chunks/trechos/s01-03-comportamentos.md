Manual MyMemory › Login › Comportamentos
Seção: Seção 1 — Login
Rota: /login
Perfil: usuário · Tipo: conceito · Versão do manual: 2

- Após login bem-sucedido, redireciona para a página de origem (parâmetro ?next=) ou para / (home).
- Se o e-mail não estiver verificado, exibe erro com código email_not_verified e botão 'Reenviar e-mail de confirmação'.
- O reenvio chama o endpoint /api/auth/resend-verification e exibe mensagem de sucesso ou falha inline.

Perguntas que este trecho responde:
- Como Login se comporta?
- O que acontece depois de usar Login?

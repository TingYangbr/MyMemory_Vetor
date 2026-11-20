Manual MyMemory › Painel Owners › Ligação com o ERP (conexões) (parte 1/2)
Seção: Seção 14 — Painel Owners
Rota: /grupo/:groupId/admin (as rotas antigas /grupo/:id/painel e /estrutura-memo levam para cá)
Perfil: owner · Tipo: campos · Versão do manual: 2

Gerenciamento das conexões SQL Server usadas pelas queries do grupo. Servidor, banco e senha ficam aqui; as queries escolhem a conexão (Seção 17).
- A senha da conexão é guardada cifrada no banco do MyMemory e nunca volta para a tela.
- As queries que usam a conexão são somente leitura (Seção 17).
- Nome *: Identificador amigável da conexão.
- Descrição: Texto opcional.
- Host *: Endereço público do servidor SQL Server (domínio ou IP público; aceita SERVIDOR\INSTANCIA). Para owners, endereços internos (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x, nomes sem ponto) são recusados; só o administrador cadastra conexão com endereço interno.
- Porta: Padrão: 1433.
- Banco de dados *: Nome do banco.
- Usuário *: Login SQL.
- Senha *: Senha SQL. Guardada cifrada; não exibida após salvar.
- Criptografar: Ativa TLS/SSL na conexão.

Perguntas que este trecho responde:
- Quais são as opções de ligação com o erp (conexões) (parte 1/2) em Painel Owners?
- O que significa cada item de ligação com o erp (conexões) (parte 1/2)?

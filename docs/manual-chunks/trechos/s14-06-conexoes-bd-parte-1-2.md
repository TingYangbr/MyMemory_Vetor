Manual MyMemory › Painel do Owner do Grupo › Conexões BD (parte 1/2)
Seção: Seção 14 — Painel do Owner do Grupo
Rota: /grupo/:groupId/painel
Perfil: owner · Tipo: campos · Versão do manual: 2

Gerenciamento de conexões SQL Server para query templates do grupo.
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
- Quais são as opções de conexões bd (parte 1/2) em Painel do Owner do Grupo?
- O que significa cada item de conexões bd (parte 1/2)?

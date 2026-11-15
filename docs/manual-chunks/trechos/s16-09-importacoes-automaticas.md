Manual MyMemory › Importação em Lote › Importações automáticas
Seção: Seção 16 — Importação em Lote
Rota: /importar-lote
Perfil: usuário · Tipo: passo a passo · Versão do manual: 2

A aba "Importações automáticas" (em espaço de grupo) faz o servidor verificar uma pasta WebDAV periodicamente e importar sozinho os arquivos novos com situação Pronto. Parece repetido e Já cadastrado ficam de fora. Owner e editor do grupo podem criar. Disco local e Rede local não podem ser automatizados: o servidor não enxerga o computador nem a rede da empresa.
1. Na aba, toque em Nova importação automática (ou, no passo Conferir de uma pasta WebDAV, em "Automatizar esta pasta") e informe a pasta e o nível de IA.
2. A janela verifica a pasta na hora. Se não der, mostra o motivo em vermelho (ex.: pasta não encontrada, fora da whitelist, WebDAV fora do ar) e o botão "Verificar de novo". Só salva com a pasta acessível.
3. Escolha o intervalo, o nível de IA, o máximo de arquivos por execução e as opções, e clique em Salvar.
- Verificar a cada: 15 minutos, 30 minutos, 1 hora, 6 horas ou 1 dia.
- Nível de IA: Sem IA, Básico ou Completo. Só o Completo gera os vetores da busca semântica do Perguntar.
- Máximo por execução: Limite de arquivos importados por vez (1 a 500). O que passar fica para a próxima.
- Copiar o arquivo para o armazenamento: Marcado: copia o arquivo como o Catalogar (S3/local ou WebDAV padrão do grupo). Desmarcado: só referencia o arquivo na pasta (Guarda própria).
- Enviar resumo por e-mail: Resumo para quem criou a automação quando importar algo ou der erro.
- Ativa: Desmarcada = pausada.

Perguntas que este trecho responde:
- Como importações automáticas em Importação em Lote?
- Qual o passo a passo de importações automáticas?

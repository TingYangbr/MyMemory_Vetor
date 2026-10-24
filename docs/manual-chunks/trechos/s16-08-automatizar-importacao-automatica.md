Manual MyMemory › Importação em Lote › Automatizar (importação automática)
Seção: Seção 16 — Importação em Lote
Rota: /importar-lote
Perfil: usuário · Tipo: passo a passo · Versão do manual: 2

O botão "⏱ Automatizar" (ao lado de Verificar e Processar, em espaço de grupo) faz o servidor verificar a pasta periodicamente e importar sozinho os arquivos novos com situação Pronto. Suspeitos e já cadastrados ficam de fora. Disponível para Disco Local, Rede Local e WebDAV; owner e editor do grupo podem criar.
1. Informe a pasta e o nível de IA na tela e clique em "⏱ Automatizar".
2. A janela verifica a pasta na hora. Se não der, mostra o motivo em vermelho (ex.: pasta não encontrada, fora da whitelist, WebDAV fora do ar) e o botão "Verificar de novo". Só salva com a pasta acessível.
3. Escolha o intervalo, o nível de IA, o máximo de arquivos por execução e as opções, e clique em Salvar.
- Verificar a cada: 15 minutos, 30 minutos, 1 hora, 6 horas ou 1 dia.
- Nível de IA: Sem IA, Básico ou Completo. Só o Completo gera os vetores da busca semântica do Perguntar.
- Máximo por execução: Limite de arquivos importados por vez (1 a 500). O que passar fica para a próxima.
- Copiar o arquivo para o armazenamento: Marcado: copia o arquivo como o Catalogar (S3/local ou WebDAV padrão do grupo). Desmarcado: só referencia o arquivo na pasta (Guarda própria).
- Enviar resumo por e-mail: Resumo para quem criou a automação quando importar algo ou der erro.
- Ativa: Desmarcada = pausada.

Perguntas que este trecho responde:
- Como automatizar (importação automática) em Importação em Lote?
- Qual o passo a passo de automatizar (importação automática)?

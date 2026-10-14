Manual MyMemory › Admin: Documento — roteamento IA › Propósito
Seção: Seção 21 — Admin: Documento — roteamento IA
Rota: /admin/documento-ia
Perfil: admin · Tipo: campos · Versão do manual: 2

Define o roteamento dos documentos para os extratores de texto (JSON em ai_config.documentRoutingJson). Não é uma base de conhecimento: decide qual pipeline lê cada tipo de arquivo.
- Regras preprocess: Lista de regras por tipo/extensão; a primeira que coincidir é usada (a ordem importa).
- Pipelines: extract_utf8_text (texto, .md, .csv), extract_pdf_text, extract_msg_text (Outlook .msg), extract_eml_text (e-mail .eml), extract_docx_text (Word), extract_xlsx_text (Excel) ou unsupported.
- Salvar JSON: Grava o roteamento. Sem JSON gravado, vale o padrão do sistema (exibido na tela).
NOTA: Um JSON inválido impede a extração de documentos. Copie o conteúdo atual antes de editar.

Perguntas que este trecho responde:
- Para que serve Admin: Documento — roteamento IA?
- O que dá para fazer em Admin: Documento — roteamento IA?

# Manual técnico — Integração e perfis de acesso

Manual para quem administra o myMemory (administrador do sistema e dono do grupo): como configurar perfis de acesso,
a marca "Pessoal", o limite de membros, a ligação dos usuários do ERP (de-para), as chaves do grupo e a chave
de integração, e a segurança do acesso aos dados. Cobre 11 seções e 72 trechos (versão 2).

Não é o manual do usuário. O manual do usuário do ERP (por exemplo `Softing-erp/Docs/manual-operacional`) vai para a
categoria **Manual do usuário**; este vai para a categoria **Manual técnico**, que só deve estar em perfis técnicos.

| Arquivo | O que é |
|---|---|
| `fonte/manual-tecnico.md` | Texto-fonte. É onde se edita. |
| `gerar_trechos.py` | Gera `chunks-mymemory-tecnico.jsonl` a partir do texto-fonte (valida a numeração das seções e os ids). |
| `chunks-mymemory-tecnico.jsonl` | Trechos para importar (mesmo formato do manual operacional do Softing-erp). |

## Importar (Admin → Importar conhecimento)

1. Em **Estrutura do contexto**, criar a categoria **Manual técnico** (no grupo que vai usá-la).
2. Criar nela os campos **Seção, Tela, Rota, Perfil, Tipo e Versão** (casam com ou sem acento).
3. Admin → Importar conhecimento → escolher o grupo, a categoria "Manual técnico" e o arquivo `chunks-mymemory-tecnico.jsonl`.
4. Manter marcado "Substituir os trechos importados antes nesta categoria" ao reimportar uma versão nova.
5. Na aba **Perfis**, incluir **Manual técnico** só nos perfis de quem administra (nunca no perfil padrão dos usuários).

## Regerar depois de editar

```bash
cd docs/manual-tecnico
python gerar_trechos.py
```

## Convenções do texto-fonte

- `# SEÇÃO N — Título` e, na linha seguinte, `Rota: ...`; subseções `## ...`.
- Tabelas Markdown de 2 colunas: `Campo / Elemento | Descrição` (trechos de campos, até 8 linhas cada) e
  `Mensagem / Sintoma | Causa e solução` (um trecho por linha). Nunca usar `|` dentro de uma célula.
- Subseção chamada "Passo a passo" vira trecho do tipo "passo a passo"; as demais, "conceito".
- Ao mudar a tela de Perfis ou as mensagens de erro da API, atualizar a seção correspondente e regerar.

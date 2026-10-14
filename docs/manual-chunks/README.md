# Manual MyMemory v2 — trechos para busca semântica

Gerados a partir de `docs/manual-v2-fonte/MyMemory_Manual_Operacional_v2.md` por `gerar_trechos.py`.

- `trechos/` — um arquivo `.md` por trecho (texto pronto para virar memo). Nome: `sNN-MM-assunto.md` (NN = seção).
- `chunks.jsonl` — os mesmos trechos com metadados: `id`, `titulo`, `texto`, `secao_num`, `secao`, `tela`, `subsecao`, `rota`, `perfil` (usuário/owner/admin/suporte), `tipo` (conceito/campos/passo a passo/erro), `versao`.

Regras de corte: um trecho por subseção; cada linha de "Erros frequentes" vira um trecho; tabelas com mais de 8 linhas são divididas em partes. Cada trecho traz o caminho completo no título, a seção/rota/perfil e "Perguntas que este trecho responde".

## Regerar

```bash
cd docs/manual-v2-fonte
python montar_v2.py                      # v1.md + novos.md → MyMemory_Manual_Operacional_v2.md
node gerar_docx.js MyMemory_Manual_Operacional_v2.md ../../MyMemory_Manual_Operacional_v2.docx   # requer npm i docx
python gerar_trechos.py MyMemory_Manual_Operacional_v2.md ../manual-chunks
```

O PDF é exportado do .docx pelo Word.

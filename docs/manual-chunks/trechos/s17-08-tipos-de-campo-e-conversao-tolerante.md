Manual MyMemory › Estrutura de Contexto / Categorias › Tipos de campo e conversão tolerante
Seção: Seção 17 — Estrutura de Contexto / Categorias
Rota: /estrutura-memo
Perfil: owner · Tipo: campos · Versão do manual: 2

- Texto: Comparação por palavras: cada palavra da pergunta precisa aparecer inteira no campo, em qualquer ordem, sem acento e sem diferenciar maiúsculas. Tratamentos e palavras de ligação (sr., sra., dr., o, a, de, da, do, com…) são ignorados. Ex.: "sr. Wilson", "Wilson da FAPESP" e "FAPESP" acham "Sr. Wilson da FAPESP"; "Wilson" não acha "Wilsons Ltda". Vale para as queries de memos; nas queries de ERP (SQL Server) a comparação continua exata, salvo quando a pergunta pede "contendo".
- Data: mymemory_parse_date: aceita dd/mm/aaaa, aaaa-mm-dd, AAAA/MM/DD, "10 de outubro de 2026" e texto após a data. Data inválida fica fora do filtro, sem erro.
- Número: mymemory_parse_number: aceita vírgula decimal e milhar ("R$ 1.500,25" = 1500,25) e o primeiro número do texto ("3 quartos" = 3). Durações viram horas: "4 horas" = 4, "1h30" = "1:30" = "uma hora e meia" = "90 minutos" = 1,5, "meia hora" = 0,5. Sem número, fica fora do filtro, sem erro.
NOTA: Em queries editadas à mão, use mymemory_parse_date(...) e mymemory_parse_number(...) em vez de ::date e ::numeric para não quebrar a pergunta quando um memo tiver texto livre.

Perguntas que este trecho responde:
- Quais são as opções de tipos de campo e conversão tolerante em Estrutura de Contexto / Categorias?
- O que significa cada item de tipos de campo e conversão tolerante?

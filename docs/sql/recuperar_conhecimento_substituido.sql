-- Recupera trechos de conhecimento importado que foram desativados por um "Substituir"
-- (isactive = 0). Nada é apagado fisicamente: basta reativar.
-- Caso de uso: o importador desativava TODOS os trechos importados da categoria, de qualquer manual.
-- Rodar no banco PostgreSQL do MyMemory (produção), em um cliente SQL. Ajuste os 3 valores abaixo.

-- ── 0. Parâmetros ────────────────────────────────────────────────────────────
--   :grupo     id do grupo onde foi feita a importação
--   :categoria nome da categoria (ex.: 'Manual tecnico')
--   :origem_ok origem (nome do arquivo) do manual que DEVE continuar ativo (o recém-importado)
-- (Substitua os valores nas consultas abaixo; o Postgres puro não tem variáveis.)

-- ── 1. Diagnóstico: o que existe na categoria, por origem e por lote de importação ─────────
SELECT isactive,
       substring(mediametadata from '"origem":"([^"]*)"')  AS origem,
       substring(mediametadata from '"versao":"([^"]*)"')  AS versao,
       date_trunc('minute', createdat)                     AS lote_criado_em,
       MAX(updatedat)                                      AS ultima_alteracao,
       COUNT(*)                                            AS trechos
FROM memos
WHERE groupid = 0                       -- << :grupo
  AND category = 'Manual tecnico'       -- << :categoria
  AND mediametadata LIKE '%"reviewFlow":"conhecimento_v1"%'
GROUP BY 1, 2, 3, 4
ORDER BY lote_criado_em DESC;
-- Leia o resultado: os lotes isactive = 0 cuja soma dá os 246 trechos de antes são os que
-- devem voltar. O lote isactive = 1 com 79 trechos é o do Portal e permanece.

-- ── 2. Prévia do que será reativado ──────────────────────────────────────────
-- Critério: desativados, da mesma categoria, de origem diferente da que deve ficar ativa.
-- Se houver versões antigas desativadas há mais tempo (substituições anteriores), restrinja
-- pelas datas de criação (lote_criado_em) vistas no passo 1.
SELECT COUNT(*) AS a_reativar
FROM memos
WHERE groupid = 0                       -- << :grupo
  AND category = 'Manual tecnico'       -- << :categoria
  AND isactive = 0
  AND mediametadata LIKE '%"reviewFlow":"conhecimento_v1"%'
  AND COALESCE(substring(mediametadata from '"origem":"([^"]*)"'), '') <> 'chunks-suporte.jsonl'  -- << :origem_ok
  -- AND createdat >= TIMESTAMP '2026-01-01 00:00'   -- << opcional: restringir aos lotes certos
  -- AND createdat <  TIMESTAMP '2026-12-31 00:00'
;
-- Confira se o número é 246. Se não for, ajuste o filtro de datas antes de continuar.

-- ── 3. Reativação (em transação: confira o resultado e só então COMMIT) ──────────
BEGIN;
UPDATE memos
SET isactive = 1
WHERE groupid = 0                       -- << :grupo
  AND category = 'Manual tecnico'       -- << :categoria
  AND isactive = 0
  AND mediametadata LIKE '%"reviewFlow":"conhecimento_v1"%'
  AND COALESCE(substring(mediametadata from '"origem":"([^"]*)"'), '') <> 'chunks-suporte.jsonl'  -- << :origem_ok
  -- AND createdat >= TIMESTAMP '2026-01-01 00:00'
  -- AND createdat <  TIMESTAMP '2026-12-31 00:00'
RETURNING id;
-- Esperado: 246 linhas. Se estiver certo:  COMMIT;   Senão:  ROLLBACK;

-- ── 4. Conferência ───────────────────────────────────────────────────────────
-- A tela Admin → Importar conhecimento deve listar, na categoria, os dois manuais
-- (a quantidade antiga + 79). Faça uma pergunta de teste ao MyMemory no grupo.

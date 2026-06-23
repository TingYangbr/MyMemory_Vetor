import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: '127.0.0.1', port: 5432,
  user: 'mymemory', password: 'mymemory_secret', database: 'mymemory'
});

const { rows } = await pool.query(`
  SELECT
    c.name        AS categoria,
    q.id          AS query_id,
    q.nome        AS query_nome,
    p.campo,
    p.tipo,
    p.operadorsql,
    q.sentencasql
  FROM queries_categoria q
  JOIN categories c ON c.id = q.categoryid
  JOIN queries_categoria_params p ON p.queryid = q.id
  WHERE q.isactive = 1
    AND p.isactive = 1
    AND c.name ILIKE '%reuni%'
  ORDER BY q.id, p.ordem
`);

if (rows.length === 0) {
  console.log('Nenhuma categoria com "reuni" encontrada.');
} else {
  for (const r of rows) {
    // verifica se o SQL usa ILIKE/LIKE para este parâmetro
    const sqlSnippet = r.sentencasql ?? '';
    const paramRe = new RegExp(`\\bI?LIKE\\s+:${r.campo}\\b`, 'i');
    const sqlUsaLike = paramRe.test(sqlSnippet);
    const defUsaLike = /LIKE/i.test(r.operadorsql);
    const inconsistente = sqlUsaLike && !defUsaLike;

    console.log(
      `[${inconsistente ? '⚠ INCONSISTENTE' : 'OK'}] ` +
      `cat="${r.categoria}" query_id=${r.query_id} "${r.query_nome}" | ` +
      `campo="${r.campo}" tipo=${r.tipo} operadorsql=${r.operadorsql} | ` +
      `SQL usa LIKE: ${sqlUsaLike}`
    );
  }
}

await pool.end();

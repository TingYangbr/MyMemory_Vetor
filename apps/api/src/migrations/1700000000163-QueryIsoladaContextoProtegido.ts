import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Corrige a falha da migration 148: o recorte por grupo das queries escritas pelo owner lia o grupo
 * de variáveis de sessão (current_setting('mymemory.group_id')), que o próprio SQL da query podia
 * trocar com set_config(...) — e então ler memos de outros grupos.
 *
 * Agora o grupo/usuário da execução fica numa tabela (mm_query_contexto, uma linha por conexão =
 * pg_backend_pid()) gravada pelo app ANTES de entrar no papel restrito. O papel mm_query_reader não
 * tem nenhum privilégio nela; só lê o contexto pelas funções mm_ctx_* (SECURITY DEFINER), que não
 * aceitam parâmetro — não há como a query trocar o grupo.
 */
export class QueryIsoladaContextoProtegido1700000000163 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mm_query_contexto (
        pid INTEGER PRIMARY KEY,
        group_id INTEGER NULL,
        user_id INTEGER NULL,
        atualizado TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`REVOKE ALL ON mm_query_contexto FROM PUBLIC`);
    await queryRunner.query(`REVOKE ALL ON mm_query_contexto FROM mm_query_reader`);

    const funcoes: [string, string, string][] = [
      ["mm_ctx_ativo", "boolean", "SELECT EXISTS (SELECT 1 FROM public.mm_query_contexto WHERE pid = pg_backend_pid())"],
      ["mm_ctx_group_id", "integer", "SELECT group_id FROM public.mm_query_contexto WHERE pid = pg_backend_pid()"],
      ["mm_ctx_user_id", "integer", "SELECT user_id FROM public.mm_query_contexto WHERE pid = pg_backend_pid()"],
    ];
    for (const [nome, tipo, corpo] of funcoes) {
      await queryRunner.query(`
        CREATE OR REPLACE FUNCTION public.${nome}() RETURNS ${tipo}
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
        AS $$ ${corpo} $$`);
      await queryRunner.query(`REVOKE ALL ON FUNCTION public.${nome}() FROM PUBLIC`);
      await queryRunner.query(`GRANT EXECUTE ON FUNCTION public.${nome}() TO mm_query_reader`);
    }

    // Segunda trava: ninguém além do app (superusuário) chama set_config — a query do owner não
    // troca configurações da sessão. Sem privilégio para isso, só registra aviso.
    await queryRunner.query(`
      DO $$
      BEGIN
        REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;
        EXECUTE format('GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO %I', current_user);
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'REVOKE set_config ignorado: %', SQLERRM;
      END $$;
    `);

    // (SELECT f()) vira InitPlan: avaliado uma vez por consulta, não por linha
    await queryRunner.query(`DROP POLICY IF EXISTS mm_query_reader_grupo ON memos`);
    await queryRunner.query(`
      CREATE POLICY mm_query_reader_grupo ON memos FOR SELECT TO mm_query_reader
      USING (
        (SELECT public.mm_ctx_ativo())
        AND CASE
          WHEN (SELECT public.mm_ctx_group_id()) IS NOT NULL
            THEN groupid = (SELECT public.mm_ctx_group_id())
          ELSE groupid IS NULL AND userid = (SELECT public.mm_ctx_user_id())
        END
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS mm_query_reader_grupo ON memos`);
    await queryRunner.query(`
      CREATE POLICY mm_query_reader_grupo ON memos FOR SELECT TO mm_query_reader
      USING (
        CASE
          WHEN COALESCE(current_setting('mymemory.group_id', true), '') <> ''
            THEN groupid = current_setting('mymemory.group_id', true)::int
          ELSE groupid IS NULL
           AND userid = NULLIF(current_setting('mymemory.user_id', true), '')::int
        END
      )
    `);
    for (const nome of ["mm_ctx_ativo", "mm_ctx_group_id", "mm_ctx_user_id"]) {
      await queryRunner.query(`DROP FUNCTION IF EXISTS public.${nome}()`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS mm_query_contexto`);
  }
}

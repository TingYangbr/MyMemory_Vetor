import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Isolamento das queries de categoria (SQL livre escrito por owner de grupo, executado no PostgreSQL interno).
 *
 * Antes, o filtro "m.groupid = :groupId" dependia só do texto da query: um owner que o omitisse lia memos de
 * todos os grupos, e podia ler users/db_connections ou alterar dados. Agora queryIsoladaPorGrupo() (db.ts) roda
 * cada query em transação READ ONLY com SET LOCAL ROLE mm_query_reader, e este papel:
 *   - só tem SELECT em memos, dadosespecificos e nas tabelas de estrutura (categories, subcategories, categorycampos);
 *   - enxerga em memos só as linhas do grupo ativo (ou do próprio usuário, para memos sem grupo) via RLS.
 *
 * O app conecta como superusuário/dono das tabelas: RLS não se aplica a ele, então nada muda fora dessas queries.
 * A policy mm_app_all garante o mesmo caso o app algum dia conecte com um usuário não-dono.
 */
export class QueryCategoriaIsolada1700000000148 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mm_query_reader') THEN
          CREATE ROLE mm_query_reader NOLOGIN;
        END IF;
      END $$;
    `);
    // Necessário para SET ROLE quando o usuário do app não for superusuário
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format('GRANT mm_query_reader TO %I', current_user);
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'GRANT mm_query_reader ignorado: %', SQLERRM;
      END $$;
    `);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO mm_query_reader`);
    await queryRunner.query(
      `GRANT SELECT ON memos, dadosespecificos, categories, subcategories, categorycampos TO mm_query_reader`
    );

    for (const tabela of ["memos", "dadosespecificos"]) {
      await queryRunner.query(`ALTER TABLE ${tabela} ENABLE ROW LEVEL SECURITY`);
      // Usuário do app (e qualquer papel que não seja o restrito) segue vendo tudo, como antes
      await queryRunner.query(`DROP POLICY IF EXISTS mm_app_all ON ${tabela}`);
      await queryRunner.query(`
        DO $$
        BEGIN
          EXECUTE format('CREATE POLICY mm_app_all ON ${tabela} FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
        END $$;
      `);
    }

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

    // dadosespecificos herda o recorte de memos (a subconsulta também passa pela RLS de memos)
    await queryRunner.query(`DROP POLICY IF EXISTS mm_query_reader_grupo ON dadosespecificos`);
    await queryRunner.query(`
      CREATE POLICY mm_query_reader_grupo ON dadosespecificos FOR SELECT TO mm_query_reader
      USING (EXISTS (SELECT 1 FROM memos mm WHERE mm.id = dadosespecificos.id_memo))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tabela of ["memos", "dadosespecificos"]) {
      await queryRunner.query(`DROP POLICY IF EXISTS mm_query_reader_grupo ON ${tabela}`);
      await queryRunner.query(`DROP POLICY IF EXISTS mm_app_all ON ${tabela}`);
      await queryRunner.query(`ALTER TABLE ${tabela} DISABLE ROW LEVEL SECURITY`);
    }
    await queryRunner.query(
      `REVOKE SELECT ON memos, dadosespecificos, categories, subcategories, categorycampos FROM mm_query_reader`
    );
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM mm_query_reader`);
    await queryRunner.query(`DROP ROLE IF EXISTS mm_query_reader`);
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Perfis de acesso por grupo + de-para de usuários de ERPs externos (fase 2 da integração com ERPs).
 *
 * MIGRAÇÃO SOMENTE ADITIVA: só cria tabelas/colunas novas (nulas ou com padrão) e nenhum
 * comportamento muda por causa dela — o filtro por perfil na pergunta fica atrás de
 * `groups.perfis_ativos` (padrão 0), e a recusa de usuário sem de-para atrás de
 * `groups.exigir_cadastro` (padrão 0). Os grupos que já existem ganham um perfil padrão com
 * TODAS as categorias, para ninguém perder o acesso de hoje.
 *
 *  - perfis_acesso                : um perfil = lista de categorias com nome, por grupo. Um (e só um)
 *                                   é o padrão do grupo (índice único parcial).
 *  - perfil_acesso_categorias     : categorias do perfil (por id, então renomear a categoria não quebra).
 *  - group_members.perfilid       : perfil do membro; NULL = usa o perfil padrão do grupo.
 *  - categories.meus_por_padrao   : marca "Meus por padrão" (padrão de escopo, não barreira).
 *  - identidades_externas         : de-para (sistema + banco do cliente + id externo) → usuário do myMemory.
 *  - perguntas_recusadas          : registro das recusas por perfil (qual categoria falta em qual perfil).
 */
export class PerfisAcessoDePara1700000000154 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS perfis_acesso (
        id                    SERIAL PRIMARY KEY,
        groupid               INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        nome                  VARCHAR(120) NOT NULL,
        todas                 INT NOT NULL DEFAULT 0,
        inclui_sem_categoria  INT NOT NULL DEFAULT 0,
        padrao                INT NOT NULL DEFAULT 0,
        createdat             TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat             TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_perfis_acesso_grupo_nome ON perfis_acesso (groupid, LOWER(nome))`
    );
    // Um perfil padrão por grupo, garantido pelo banco.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_perfis_acesso_padrao ON perfis_acesso (groupid) WHERE padrao = 1`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS perfil_acesso_categorias (
        perfilid    INT NOT NULL REFERENCES perfis_acesso(id) ON DELETE CASCADE,
        categoryid  INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (perfilid, categoryid)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_perfil_acesso_categorias_categoryid ON perfil_acesso_categorias (categoryid)`
    );

    // Membro apontando para um perfil; apagar o perfil devolve o membro ao padrão do grupo.
    await queryRunner.query(
      `ALTER TABLE group_members ADD COLUMN IF NOT EXISTS perfilid INT NULL REFERENCES perfis_acesso(id) ON DELETE SET NULL`
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_group_members_perfilid ON group_members (perfilid)`);

    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS meus_por_padrao INT NOT NULL DEFAULT 0`);

    // Chaves por grupo. Ambas nascem desligadas: o modelo entra por adesão, nunca por bloqueio.
    await queryRunner.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS perfis_ativos INT NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS exigir_cadastro INT NOT NULL DEFAULT 0`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS identidades_externas (
        id          SERIAL PRIMARY KEY,
        groupid     INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        sistema     VARCHAR(60)  NOT NULL,
        banco       VARCHAR(120) NOT NULL DEFAULT '',
        idexterno   VARCHAR(120) NOT NULL,
        userid      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ativo       INT NOT NULL DEFAULT 1,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // O mesmo id do ERP não pode ligar a dois membros, nem um membro a dois ids do mesmo sistema/banco.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_identidades_externas_id ON identidades_externas (groupid, sistema, banco, idexterno)`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_identidades_externas_user ON identidades_externas (groupid, sistema, banco, userid)`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS perguntas_recusadas (
        id          SERIAL PRIMARY KEY,
        groupid     INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        userid      INT NULL REFERENCES users(id) ON DELETE SET NULL,
        perfilid    INT NULL REFERENCES perfis_acesso(id) ON DELETE SET NULL,
        categorias  TEXT NOT NULL DEFAULT '',
        motivo      VARCHAR(40) NOT NULL,
        pergunta    TEXT NOT NULL,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_perguntas_recusadas_grupo ON perguntas_recusadas (groupid, createdat DESC)`
    );

    // Perfil padrão dos grupos que já existem: todas as categorias + memos sem categoria
    // (= o acesso de hoje). Idempotente: só cria onde o grupo ainda não tem perfil padrão.
    await queryRunner.query(`
      INSERT INTO perfis_acesso (groupid, nome, todas, inclui_sem_categoria, padrao)
      SELECT g.id, 'Padrão', 1, 1, 1
      FROM groups g
      WHERE NOT EXISTS (SELECT 1 FROM perfis_acesso p WHERE p.groupid = g.id AND p.padrao = 1)
        AND NOT EXISTS (SELECT 1 FROM perfis_acesso p WHERE p.groupid = g.id AND LOWER(p.nome) = 'padrão')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS perguntas_recusadas`);
    await queryRunner.query(`DROP TABLE IF EXISTS identidades_externas`);
    await queryRunner.query(`ALTER TABLE groups DROP COLUMN IF EXISTS exigir_cadastro`);
    await queryRunner.query(`ALTER TABLE groups DROP COLUMN IF EXISTS perfis_ativos`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS meus_por_padrao`);
    await queryRunner.query(`ALTER TABLE group_members DROP COLUMN IF EXISTS perfilid`);
    await queryRunner.query(`DROP TABLE IF EXISTS perfil_acesso_categorias`);
    await queryRunner.query(`DROP TABLE IF EXISTS perfis_acesso`);
  }
}

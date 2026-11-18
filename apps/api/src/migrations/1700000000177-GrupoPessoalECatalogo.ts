import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Etapas 1 e 2 do plano do grupo pessoal (docs/plano-grupo-pessoal.md). Nada muda para quem já usa:
 *  - groups.tipo: 'normal' (como hoje), 'pessoal' (o espaço de uma pessoa) ou 'catalogo' (modelos prontos).
 *    Grupos pessoal e catálogo ficam fora das listas de grupos.
 *  - groups.pessoal_userid: dono do grupo pessoal (um por usuário).
 *  - groups.subscriptionid passa a aceitar vazio (o catálogo não tem assinatura).
 *  - Cria o grupo "Catálogo de modelos" e um grupo pessoal (vazio, sem membros ainda) para cada usuário,
 *    ligado à assinatura individual dele. Nenhum memo é movido.
 *  - categories: origem (modelo de onde veio a cópia) e os dados do modelo para o usuário (resumo,
 *    frases de exemplo, versão).
 */
export class GrupoPessoalECatalogo1700000000177 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) NOT NULL DEFAULT 'normal'`);
    await queryRunner.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS pessoal_userid INT NULL REFERENCES users(id) ON DELETE CASCADE`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS groups_pessoal_userid_unique ON groups (pessoal_userid) WHERE pessoal_userid IS NOT NULL`
    );
    await queryRunner.query(`ALTER TABLE groups ALTER COLUMN subscriptionid DROP NOT NULL`);

    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS origem_categoria_id INT NULL`);
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS origem_versao INT NULL`);
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS modelo_resumo TEXT NULL`);
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS modelo_exemplos TEXT NULL`);
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS modelo_versao INT NOT NULL DEFAULT 1`);

    // Catálogo de modelos: um só, sem assinatura e sem membros
    await queryRunner.query(`
      INSERT INTO groups (name, description, subscriptionid, tipo)
      SELECT 'Catálogo de modelos', 'Modelos prontos de categorias, copiados para um grupo ao habilitar.', NULL, 'catalogo'
      WHERE NOT EXISTS (SELECT 1 FROM groups WHERE tipo = 'catalogo')
    `);

    // Grupo pessoal de cada usuário, ligado à assinatura individual mais recente (ativa primeiro)
    await queryRunner.query(`
      INSERT INTO groups (name, description, subscriptionid, tipo, pessoal_userid)
      SELECT 'Meu espaço', NULL,
             (SELECT s.id FROM subscriptions s
              WHERE s.type = 'individual' AND s.userid = u.id AND s.ownerid = u.id
              ORDER BY (s.status = 'active') DESC, s.id DESC LIMIT 1),
             'pessoal', u.id
      FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.pessoal_userid = u.id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM groups WHERE tipo IN ('pessoal', 'catalogo')`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS modelo_versao`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS modelo_exemplos`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS modelo_resumo`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS origem_versao`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS origem_categoria_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS groups_pessoal_userid_unique`);
    await queryRunner.query(`ALTER TABLE groups DROP COLUMN IF EXISTS pessoal_userid`);
    await queryRunner.query(`ALTER TABLE groups DROP COLUMN IF EXISTS tipo`);
  }
}

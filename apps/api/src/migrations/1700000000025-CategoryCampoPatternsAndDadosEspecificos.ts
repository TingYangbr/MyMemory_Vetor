import type { MigrationInterface, QueryRunner } from "typeorm";

export class CategoryCampoPatternsAndDadosEspecificos1700000000025
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const colRows = (await queryRunner.query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'categoryCampos'
        AND COLUMN_NAME = 'normalizedTerms'
    `)) as Array<{ cnt: number }>;
    if (Number(colRows[0]?.cnt ?? 0) === 0) {
      await queryRunner.query(`
        ALTER TABLE \`categoryCampos\`
          ADD COLUMN \`normalizedTerms\` TEXT NULL
            COMMENT 'Lista opcional de termos padronizados separados por vírgula'
            AFTER \`description\`
      `);
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`dadosEspecificos\` (
        \`id\`               INT AUTO_INCREMENT PRIMARY KEY,
        \`id_Categoria\`     INT NULL,
        \`id_memo\`          INT NOT NULL,
        \`label\`            VARCHAR(255) NOT NULL,
        \`dadoOriginal\`     TEXT NULL,
        \`dadoPadronizado\`  TEXT NULL,
        \`isActive\`         INT NOT NULL DEFAULT 1,
        \`createdAt\`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY \`ix_dadosEspecificos_memo\` (\`id_memo\`),
        KEY \`ix_dadosEspecificos_categoria\` (\`id_Categoria\`),
        CONSTRAINT \`fk_dadosEspecificos_memo\`
          FOREIGN KEY (\`id_memo\`) REFERENCES \`memos\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_dadosEspecificos_categoria\`
          FOREIGN KEY (\`id_Categoria\`) REFERENCES \`categories\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`dadosEspecificos\``);
    await queryRunner.query(`
      ALTER TABLE \`categoryCampos\`
        DROP COLUMN \`normalizedTerms\`
    `);
  }
}

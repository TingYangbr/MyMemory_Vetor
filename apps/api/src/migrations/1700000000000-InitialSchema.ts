import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("SET NAMES utf8mb4");

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\`                          INT AUTO_INCREMENT PRIMARY KEY,
        \`openId\`                      VARCHAR(64) NOT NULL,
        \`name\`                        TEXT,
        \`email\`                       VARCHAR(320) NULL,
        \`loginMethod\`                 VARCHAR(64) NULL,
        \`role\`                        ENUM('user','admin') NOT NULL DEFAULT 'user',
        \`soundEnabled\`                TINYINT NOT NULL DEFAULT 1,
        \`confirmEnabled\`              TINYINT NOT NULL DEFAULT 1,
        \`allowFreeSpecificFieldsWithoutCategoryMatch\` TINYINT NOT NULL DEFAULT 0 COMMENT '1=permitir campos livres em dadosEspecificosJson sem match de categoria/campos',
        \`iaUseTexto\`                  ENUM('semIA','basico','completo') NOT NULL DEFAULT 'basico',
        \`iaUseImagem\`                 ENUM('semIA','basico','completo') NOT NULL DEFAULT 'basico',
        \`iaUseVideo\`                  ENUM('semIA','basico','completo') NOT NULL DEFAULT 'basico',
        \`iaUseAudio\`                  ENUM('semIA','basico','completo') NOT NULL DEFAULT 'basico',
        \`iaUseDocumento\`              ENUM('semIA','basico','completo') NOT NULL DEFAULT 'basico',
        \`iaUseUrl\`                    ENUM('semIA','basico','completo') NOT NULL DEFAULT 'basico',
        \`imageOcrVisionMinConfidence\` TINYINT UNSIGNED NULL DEFAULT NULL COMMENT 'NULL=off; 1-100: se confiança Tesseract < valor, LLM visão corrige texto (imagem)',
        \`createdAt\`                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`lastSignedIn\`                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`lastLoginAt\`                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`passwordHash\`                VARCHAR(255) NULL,
        \`emailVerified\`               TINYINT NOT NULL DEFAULT 0,
        \`lastWorkspaceGroupId\`        INT NULL COMMENT 'NULL = pessoal; FK para groups',
        UNIQUE KEY \`uq_users_openId\` (\`openId\`),
        UNIQUE KEY \`uq_users_email\`   (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`subscription_plans\` (
        \`id\`                     INT AUTO_INCREMENT PRIMARY KEY,
        \`name\`                   VARCHAR(100) NOT NULL,
        \`planType\`               ENUM('individual','group') NOT NULL DEFAULT 'individual',
        \`price\`                  DECIMAL(10,2) NOT NULL,
        \`maxMemos\`               INT NOT NULL,
        \`maxStorageGB\`           DECIMAL(10,2) NOT NULL,
        \`maxMembers\`             INT NULL,
        \`durationDays\`           INT NULL,
        \`isActive\`               INT NOT NULL DEFAULT 1,
        \`monthlyApiCredits\`      DECIMAL(14,2) NULL,
        \`monthlyDownloadLimitGB\` DECIMAL(10,2) NULL,
        \`supportLargeAudio\`      INT NOT NULL DEFAULT 0,
        \`supportLargeVideo\`      INT NOT NULL DEFAULT 0,
        \`createdAt\`              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`subscriptions\` (
        \`id\`        INT AUTO_INCREMENT PRIMARY KEY,
        \`type\`      ENUM('individual','group') NOT NULL,
        \`userId\`    INT NULL,
        \`ownerId\`   INT NOT NULL,
        \`planId\`    INT NOT NULL,
        \`status\`    ENUM('active','expired','canceled') NOT NULL DEFAULT 'active',
        \`startDate\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`endDate\`   TIMESTAMP NULL,
        \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sub_owner\` FOREIGN KEY (\`ownerId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_sub_user\`  FOREIGN KEY (\`userId\`)  REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_sub_plan\`  FOREIGN KEY (\`planId\`)  REFERENCES \`subscription_plans\`(\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`groups\` (
        \`id\`                   INT AUTO_INCREMENT NOT NULL,
        \`name\`                 VARCHAR(255) NOT NULL,
        \`description\`         TEXT,
        \`subscriptionId\`      INT NOT NULL,
        \`accessCode\`          VARCHAR(10) NULL,
        \`isPublic\`            INT NOT NULL DEFAULT 0,
        \`maxSummaryLength\`    INT NOT NULL DEFAULT 1000,
        \`allowPersonalContext\` INT NOT NULL DEFAULT 1,
        \`allowFreeSpecificFieldsWithoutCategoryMatch\` INT NOT NULL DEFAULT 0,
        \`createdAt\`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`groups_accessCode_unique\` (\`accessCode\`),
        CONSTRAINT \`fk_groups_subscription\` FOREIGN KEY (\`subscriptionId\`) REFERENCES \`subscriptions\`(\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    {
      const rows = await queryRunner.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'
          AND CONSTRAINT_NAME = 'fk_users_last_workspace_group'
      `);
      if (Number(rows[0].cnt) === 0) {
        await queryRunner.query(`
          ALTER TABLE \`users\`
            ADD CONSTRAINT \`fk_users_last_workspace_group\`
            FOREIGN KEY (\`lastWorkspaceGroupId\`) REFERENCES \`groups\`(\`id\`) ON DELETE SET NULL
        `);
      }
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`group_members\` (
        \`id\`       INT AUTO_INCREMENT NOT NULL,
        \`groupId\`  INT NOT NULL,
        \`userId\`   INT NOT NULL,
        \`role\`     ENUM('owner','editor','viewer') NOT NULL DEFAULT 'viewer',
        \`joinedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`group_members_groupId_userId_unique\` (\`groupId\`, \`userId\`),
        CONSTRAINT \`fk_gm_group\` FOREIGN KEY (\`groupId\`) REFERENCES \`groups\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_gm_user\`  FOREIGN KEY (\`userId\`)  REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`memos\` (
        \`id\`               INT AUTO_INCREMENT PRIMARY KEY,
        \`groupId\`          INT NULL,
        \`userId\`           INT NOT NULL,
        \`mediaType\`        ENUM('text','audio','image','video','document','url') NOT NULL,
        \`mediaAudioUrl\`    TEXT NULL,
        \`mediaImageUrl\`    TEXT NULL,
        \`mediaVideoUrl\`    TEXT NULL,
        \`mediaDocumentUrl\` TEXT NULL,
        \`mediaWebUrl\`      TEXT NULL,
        \`mediaText\`        TEXT NOT NULL,
        \`keywords\`         TEXT NULL,
        \`mediaMetadata\`    TEXT NULL,
        \`valor\`            TEXT NULL,
        \`apiCost\`          DECIMAL(12,8) DEFAULT 0,
        \`tamMediaUrl\`      BIGINT NULL,
        \`usedApiCred\`      DECIMAL(14,8) DEFAULT 0,
        \`isActive\`         INT NOT NULL DEFAULT 1,
        \`createdAt\`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_memos_user\`  FOREIGN KEY (\`userId\`)  REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_memos_group\` FOREIGN KEY (\`groupId\`) REFERENCES \`groups\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`email_invites\` (
        \`id\`              INT AUTO_INCREMENT NOT NULL,
        \`groupId\`         INT NOT NULL,
        \`email\`           VARCHAR(320) NOT NULL,
        \`invitedByUserId\` INT NOT NULL,
        \`role\`            ENUM('owner','editor','viewer') NOT NULL DEFAULT 'editor',
        \`adminRole\`       ENUM('user','admin') NOT NULL DEFAULT 'user',
        \`token\`           VARCHAR(256) NOT NULL,
        \`status\`          ENUM('pending','accepted','rejected','expired') NOT NULL DEFAULT 'pending',
        \`expiresAt\`       TIMESTAMP NOT NULL,
        \`createdAt\`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`acceptedAt\`      TIMESTAMP NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`email_invites_token_unique\` (\`token\`),
        CONSTRAINT \`fk_inv_group\` FOREIGN KEY (\`groupId\`)         REFERENCES \`groups\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_inv_user\`  FOREIGN KEY (\`invitedByUserId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`media_settings\` (
        \`id\`                  INT NOT NULL AUTO_INCREMENT,
        \`planId\`              INT NULL,
        \`mediaType\`           ENUM('audio','image','video','document','default','text','html') NOT NULL,
        \`maxFileSizeKB\`       INT NOT NULL DEFAULT 20000,
        \`video_chunk_minutes\` INT NULL DEFAULT NULL COMMENT 'Minutos por segmento - processamento grande vídeo (linha video)',
        \`audio_chunk_minutes\` INT NULL DEFAULT NULL COMMENT 'Minutos por segmento - processamento grande áudio (linha audio)',
        \`maxLargeVideoKb\`     INT NULL DEFAULT NULL COMMENT 'Máx. KB processamento grande vídeo - linha video',
        \`maxLargeAudioKb\`     INT NULL DEFAULT NULL COMMENT 'Máx. KB processamento grande áudio - linha audio',
        \`maxSummaryChars\`     INT NOT NULL DEFAULT 1000,
        \`textImagemMin\`       INT NOT NULL DEFAULT 100 COMMENT 'Mín. caracteres OCR para fluxo de texto na imagem',
        \`compressBeforeAI\`    TINYINT NOT NULL DEFAULT 0,
        \`createdAt\`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_media_settings_plan_media\` (\`planId\`, \`mediaType\`),
        CONSTRAINT \`fk_media_settings_plan\` FOREIGN KEY (\`planId\`) REFERENCES \`subscription_plans\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`ai_config\` (
        \`id\`                  INT AUTO_INCREMENT NOT NULL,
        \`operation\`           VARCHAR(100) NOT NULL,
        \`displayName\`         VARCHAR(255) NOT NULL,
        \`provider\`            ENUM('manus_proxy','openai','google_gemini','anthropic','microsoft_azure') NOT NULL DEFAULT 'openai',
        \`model\`               VARCHAR(100) NOT NULL,
        \`isEnabled\`           TINYINT NOT NULL DEFAULT 1,
        \`maxTokens\`           INT NULL,
        \`temperature\`         DECIMAL(3,2) NULL,
        \`extraParams\`         TEXT NULL,
        \`documentRoutingJson\` LONGTEXT NULL COMMENT 'JSON: preprocess + direct por provedor (memo_document_ia)',
        \`notes\`               TEXT NULL,
        \`updatedAt\`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`createdAt\`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`ai_config_operation_unique\` (\`operation\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`api_usage_logs\` (
        \`id\`                   INT NOT NULL AUTO_INCREMENT,
        \`memoId\`               INT NULL COMMENT 'null = operação sem memo associado',
        \`userId\`               INT NOT NULL,
        \`operation\`            VARCHAR(100) NOT NULL,
        \`model\`                VARCHAR(100) NOT NULL,
        \`inputTokens\`          INT DEFAULT 0,
        \`outputTokens\`         INT DEFAULT 0,
        \`totalTokens\`          INT DEFAULT 0,
        \`audioDurationSeconds\` DECIMAL(10,2) DEFAULT 0,
        \`costUsd\`              DECIMAL(12,8) NOT NULL DEFAULT 0,
        \`createdAt\`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_api_usage_logs_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_api_usage_logs_memo\` FOREIGN KEY (\`memoId\`) REFERENCES \`memos\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`download_logs\` (
        \`id\`              INT AUTO_INCREMENT NOT NULL,
        \`userId\`          INT NOT NULL,
        \`groupId\`         INT NULL,
        \`memoId\`          INT NULL,
        \`s3key\`           VARCHAR(1000) NULL,
        \`fileSizeMb\`      DECIMAL(12,4) NOT NULL,
        \`bytesDownloaded\` BIGINT UNSIGNED NULL COMMENT 'Bytes lidos do corpo (medida direta)',
        \`costUsd\`         DECIMAL(12,8) NULL COMMENT 'Custo estimado USD (egress S3), se S3_EGRESS_USD_PER_GB configurado',
        \`usedCred\`        DECIMAL(14,8) NULL COMMENT 'costUsd × fatorCredCost (system_config); NULL se sem costUsd',
        \`downloadedAt\`   BIGINT NOT NULL COMMENT 'Instante do registo: epoch ms (Unix), usado nos totais mensais',
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_dl_user\`  FOREIGN KEY (\`userId\`)  REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_dl_group\` FOREIGN KEY (\`groupId\`) REFERENCES \`groups\`(\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`fk_dl_memo\`  FOREIGN KEY (\`memoId\`)  REFERENCES \`memos\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`semantic_logs\` (
        \`id\`             INT NOT NULL AUTO_INCREMENT,
        \`userId\`         INT NOT NULL,
        \`groupId\`        INT NULL,
        \`searchTerms\`    TEXT NOT NULL,
        \`memosEvaluated\` INT NOT NULL DEFAULT 0,
        \`memosReturned\`  INT NOT NULL DEFAULT 0,
        \`cutoffPercent\`  DECIMAL(5,2) NOT NULL DEFAULT 67.00,
        \`costUsd\`        DECIMAL(12,8) NOT NULL DEFAULT 0,
        \`createdAt\`      BIGINT NOT NULL,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_sem_user\`  FOREIGN KEY (\`userId\`)  REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_sem_group\` FOREIGN KEY (\`groupId\`) REFERENCES \`groups\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`system_config\` (
        \`id\`              INT NOT NULL AUTO_INCREMENT,
        \`configKey\`       VARCHAR(100) NOT NULL,
        \`configValue\`     TEXT NOT NULL,
        \`description\`     TEXT NULL,
        \`updatedByUserId\` INT NULL,
        \`createdAt\`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_system_config_key\` (\`configKey\`),
        CONSTRAINT \`fk_sys_cfg_user\` FOREIGN KEY (\`updatedByUserId\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`support_chats\` (
        \`id\`        INT NOT NULL AUTO_INCREMENT,
        \`userId\`    INT NOT NULL,
        \`role\`      ENUM('user','assistant') NOT NULL,
        \`content\`   TEXT NOT NULL,
        \`apiCost\`   DECIMAL(12,8) DEFAULT 0,
        \`isActive\`  INT NOT NULL DEFAULT 1,
        \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_support_chats_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`usage_alerts\` (
        \`id\`             INT NOT NULL AUTO_INCREMENT,
        \`subscriptionId\` INT NOT NULL,
        \`resource\`       ENUM('memos','storage','apiCredits') NOT NULL,
        \`threshold\`      ENUM('80','100') NOT NULL,
        \`sentAt\`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`monthYear\`      VARCHAR(7) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_usage_alerts\` (\`subscriptionId\`, \`resource\`, \`threshold\`, \`monthYear\`),
        CONSTRAINT \`fk_usage_alerts_sub\` FOREIGN KEY (\`subscriptionId\`) REFERENCES \`subscriptions\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`user_auth_tokens\` (
        \`id\`        INT NOT NULL AUTO_INCREMENT,
        \`userId\`    INT NOT NULL,
        \`tokenHash\` CHAR(64) NOT NULL,
        \`purpose\`   ENUM('verify_email','reset_password') NOT NULL,
        \`expiresAt\` DATETIME NOT NULL,
        \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_user_auth_tokens_hash\` (\`tokenHash\`),
        KEY \`idx_user_auth_tokens_user_purpose\` (\`userId\`, \`purpose\`),
        KEY \`idx_user_auth_tokens_expires\` (\`expiresAt\`),
        CONSTRAINT \`fk_user_auth_tokens_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`categories\` (
        \`id\`          INT NOT NULL AUTO_INCREMENT,
        \`groupId\`     INT NULL COMMENT 'NULL = categorias globais (admin); senão FK para groups.id',
        \`mediaType\`   ENUM('text','audio','image','video','document','url') DEFAULT NULL COMMENT 'Opcional: restringe por tipo de mídia do memo',
        \`name\`        VARCHAR(255) NOT NULL,
        \`description\` TEXT DEFAULT NULL,
        \`isActive\`    INT NOT NULL DEFAULT 1,
        \`createdAt\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`ix_categories_groupId\` (\`groupId\`),
        CONSTRAINT \`fk_categories_group\` FOREIGN KEY (\`groupId\`) REFERENCES \`groups\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`subCategories\` (
        \`id\`          INT NOT NULL AUTO_INCREMENT,
        \`categoryId\`  INT NOT NULL,
        \`name\`        VARCHAR(255) NOT NULL,
        \`description\` TEXT DEFAULT NULL,
        \`isActive\`    INT NOT NULL DEFAULT 1,
        \`createdAt\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`ix_subCategories_categoryId\` (\`categoryId\`),
        CONSTRAINT \`fk_subCategories_categoryId\` FOREIGN KEY (\`categoryId\`) REFERENCES \`categories\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`categoryCampos\` (
        \`id\`          INT NOT NULL AUTO_INCREMENT,
        \`categoryId\`  INT NOT NULL,
        \`name\`        VARCHAR(255) NOT NULL,
        \`description\` TEXT DEFAULT NULL,
        \`normalizedTerms\` TEXT DEFAULT NULL COMMENT 'Lista opcional de termos padronizados separada por vírgula',
        \`isActive\`    INT NOT NULL DEFAULT 1,
        \`createdAt\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`ix_categoryCampos_categoryId\` (\`categoryId\`),
        CONSTRAINT \`fk_categoryCampos_categoryId\` FOREIGN KEY (\`categoryId\`) REFERENCES \`categories\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

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
        CONSTRAINT \`fk_dadosEspecificos_memo\` FOREIGN KEY (\`id_memo\`) REFERENCES \`memos\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_dadosEspecificos_categoria\` FOREIGN KEY (\`id_Categoria\`) REFERENCES \`categories\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      INSERT IGNORE INTO \`system_config\` (\`configKey\`, \`configValue\`, \`description\`) VALUES
        ('fatorCredCost', '100.00', 'Fator multiplicador do custo de API (USD) para calcular créditos consumidos (usedApiCred).'),
        ('showApiCost',   '1',      'Se 1, exibe custo API (USD) e créditos consumidos na criação/visualização de memos; se 0, oculta.')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("SET FOREIGN_KEY_CHECKS = 0");

    const tables = [
      "dadosEspecificos",
      "categoryCampos",
      "subCategories",
      "categories",
      "user_auth_tokens",
      "usage_alerts",
      "support_chats",
      "system_config",
      "semantic_logs",
      "download_logs",
      "api_usage_logs",
      "media_settings",
      "ai_config",
      "email_invites",
      "memos",
      "group_members",
      "groups",
      "subscriptions",
      "subscription_plans",
      "users",
    ];

    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
    }

    await queryRunner.query("SET FOREIGN_KEY_CHECKS = 1");
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Schema inicial em PostgreSQL.
 * Todos os identificadores sem aspas → PostgreSQL armazena em lowercase.
 * O wrapper db.ts mapeia os nomes lowercase de volta para camelCase no TypeScript.
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                          SERIAL PRIMARY KEY,
        openid                      VARCHAR(64) NOT NULL,
        name                        TEXT,
        email                       VARCHAR(320) NULL,
        loginmethod                 VARCHAR(64) NULL,
        role                        VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
        soundenabled                SMALLINT NOT NULL DEFAULT 1,
        confirmenabled              SMALLINT NOT NULL DEFAULT 1,
        allowfreespecificfieldswithoutcategorymatch SMALLINT NOT NULL DEFAULT 0,
        iausetexto                  VARCHAR(10) NOT NULL DEFAULT 'basico' CHECK (iausetexto IN ('semIA','basico','completo')),
        iauseimagem                 VARCHAR(10) NOT NULL DEFAULT 'basico' CHECK (iauseimagem IN ('semIA','basico','completo')),
        iausevideo                  VARCHAR(10) NOT NULL DEFAULT 'basico' CHECK (iausevideo IN ('semIA','basico','completo')),
        iauseaudio                  VARCHAR(10) NOT NULL DEFAULT 'basico' CHECK (iauseaudio IN ('semIA','basico','completo')),
        iausedocumento              VARCHAR(10) NOT NULL DEFAULT 'basico' CHECK (iausedocumento IN ('semIA','basico','completo')),
        iauseurl                    VARCHAR(10) NOT NULL DEFAULT 'basico' CHECK (iauseurl IN ('semIA','basico','completo')),
        imageocrvisionminconfidence SMALLINT NULL DEFAULT NULL,
        createdat                   TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat                   TIMESTAMP NOT NULL DEFAULT NOW(),
        lastsignedin                TIMESTAMP NOT NULL DEFAULT NOW(),
        lastloginat                 TIMESTAMP NOT NULL DEFAULT NOW(),
        passwordhash                VARCHAR(255) NULL,
        emailverified               SMALLINT NOT NULL DEFAULT 0,
        lastworkspacegroupid        INT NULL,
        CONSTRAINT uq_users_openid UNIQUE (openid),
        CONSTRAINT uq_users_email  UNIQUE (email)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id                     SERIAL PRIMARY KEY,
        name                   VARCHAR(100) NOT NULL,
        plantype               VARCHAR(12) NOT NULL DEFAULT 'individual' CHECK (plantype IN ('individual','group')),
        price                  DECIMAL(10,2) NOT NULL,
        maxmemos               INT NOT NULL,
        maxstoragegb           DECIMAL(10,2) NOT NULL,
        maxmembers             INT NULL,
        durationdays           INT NULL,
        isactive               INT NOT NULL DEFAULT 1,
        monthlyapicredits      DECIMAL(14,2) NULL,
        monthlydownloadlimitgb DECIMAL(10,2) NULL,
        supportlargeaudio      INT NOT NULL DEFAULT 0,
        supportlargevideo      INT NOT NULL DEFAULT 0,
        createdat              TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat              TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id         SERIAL PRIMARY KEY,
        type       VARCHAR(12) NOT NULL CHECK (type IN ('individual','group')),
        userid     INT NULL,
        ownerid    INT NOT NULL,
        planid     INT NOT NULL,
        status     VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','canceled')),
        startdate  TIMESTAMP NOT NULL DEFAULT NOW(),
        enddate    TIMESTAMP NULL,
        createdat  TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_sub_owner FOREIGN KEY (ownerid) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_sub_user  FOREIGN KEY (userid)  REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_sub_plan  FOREIGN KEY (planid)  REFERENCES subscription_plans(id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id                   SERIAL PRIMARY KEY,
        name                 VARCHAR(255) NOT NULL,
        description          TEXT,
        subscriptionid       INT NOT NULL,
        accesscode           VARCHAR(10) NULL,
        ispublic             INT NOT NULL DEFAULT 0,
        maxsummarylength     INT NOT NULL DEFAULT 1000,
        allowpersonalcontext INT NOT NULL DEFAULT 1,
        allowfreespecificfieldswithoutcategorymatch INT NOT NULL DEFAULT 0,
        createdat            TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat            TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT groups_accesscode_unique UNIQUE (accesscode),
        CONSTRAINT fk_groups_subscription FOREIGN KEY (subscriptionid) REFERENCES subscriptions(id)
      )
    `);

    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT fk_users_last_workspace_group
        FOREIGN KEY (lastworkspacegroupid) REFERENCES groups(id) ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        id        SERIAL PRIMARY KEY,
        groupid   INT NOT NULL,
        userid    INT NOT NULL,
        role      VARCHAR(10) NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','editor','viewer')),
        joinedat  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT group_members_groupid_userid_unique UNIQUE (groupid, userid),
        CONSTRAINT fk_gm_group FOREIGN KEY (groupid) REFERENCES groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_gm_user  FOREIGN KEY (userid)  REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memos (
        id                 SERIAL PRIMARY KEY,
        groupid            INT NULL,
        userid             INT NOT NULL,
        mediatype          VARCHAR(10) NOT NULL CHECK (mediatype IN ('text','audio','image','video','document','url')),
        mediaaudiourl      TEXT NULL,
        mediaimageurl      TEXT NULL,
        mediavideourl      TEXT NULL,
        mediadocumenturl   TEXT NULL,
        mediaweburl        TEXT NULL,
        mediatext          TEXT NOT NULL,
        keywords           TEXT NULL,
        mediametadata      TEXT NULL,
        valor              TEXT NULL,
        apicost            DECIMAL(12,8) DEFAULT 0,
        tammediaurl        BIGINT NULL,
        usedapicred        DECIMAL(14,8) DEFAULT 0,
        isactive           INT NOT NULL DEFAULT 1,
        createdat          TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat          TIMESTAMP NOT NULL DEFAULT NOW(),
        dadosespecificosjson TEXT NULL,
        CONSTRAINT fk_memos_user  FOREIGN KEY (userid)  REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_memos_group FOREIGN KEY (groupid) REFERENCES groups(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS email_invites (
        id               SERIAL PRIMARY KEY,
        groupid          INT NOT NULL,
        email            VARCHAR(320) NOT NULL,
        invitedbyuserid  INT NOT NULL,
        role             VARCHAR(10) NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')),
        adminrole        VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (adminrole IN ('user','admin')),
        token            VARCHAR(256) NOT NULL,
        status           VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired')),
        expiresat        TIMESTAMP NOT NULL,
        createdat        TIMESTAMP NOT NULL DEFAULT NOW(),
        acceptedat       TIMESTAMP NULL,
        CONSTRAINT email_invites_token_unique UNIQUE (token),
        CONSTRAINT fk_inv_group FOREIGN KEY (groupid)        REFERENCES groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_inv_user  FOREIGN KEY (invitedbyuserid) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS media_settings (
        id                  SERIAL PRIMARY KEY,
        planid              INT NULL,
        mediatype           VARCHAR(10) NOT NULL CHECK (mediatype IN ('audio','image','video','document','default','text','html')),
        maxfilesizekb       INT NOT NULL DEFAULT 20000,
        video_chunk_minutes INT NULL DEFAULT NULL,
        audio_chunk_minutes INT NULL DEFAULT NULL,
        maxlargevideokb     INT NULL DEFAULT NULL,
        maxlargeaudiokb     INT NULL DEFAULT NULL,
        maxsummarychars     INT NOT NULL DEFAULT 1000,
        textimagemmin       INT NOT NULL DEFAULT 100,
        compressbeforeai    SMALLINT NOT NULL DEFAULT 0,
        createdat           TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat           TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_media_settings_plan_media UNIQUE (planid, mediatype),
        CONSTRAINT fk_media_settings_plan FOREIGN KEY (planid) REFERENCES subscription_plans(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_config (
        id                  SERIAL PRIMARY KEY,
        operation           VARCHAR(100) NOT NULL,
        displayname         VARCHAR(255) NOT NULL,
        provider            VARCHAR(20) NOT NULL DEFAULT 'openai' CHECK (provider IN ('manus_proxy','openai','google_gemini','anthropic','microsoft_azure')),
        model               VARCHAR(100) NOT NULL,
        isenabled           SMALLINT NOT NULL DEFAULT 1,
        maxtokens           INT NULL,
        temperature         DECIMAL(3,2) NULL,
        extraparams         TEXT NULL,
        documentroutingjson TEXT NULL,
        notes               TEXT NULL,
        updatedat           TIMESTAMP NOT NULL DEFAULT NOW(),
        createdat           TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT ai_config_operation_unique UNIQUE (operation)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS api_usage_logs (
        id                    SERIAL PRIMARY KEY,
        memoid                INT NULL,
        userid                INT NOT NULL,
        operation             VARCHAR(100) NOT NULL,
        model                 VARCHAR(100) NOT NULL,
        inputtokens           INT DEFAULT 0,
        outputtokens          INT DEFAULT 0,
        totaltokens           INT DEFAULT 0,
        audiodurationseconds  DECIMAL(10,2) DEFAULT 0,
        costusd               DECIMAL(12,8) NOT NULL DEFAULT 0,
        createdat             TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_api_usage_logs_user FOREIGN KEY (userid) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_api_usage_logs_memo FOREIGN KEY (memoid) REFERENCES memos(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS download_logs (
        id               SERIAL PRIMARY KEY,
        userid           INT NOT NULL,
        groupid          INT NULL,
        memoid           INT NULL,
        s3key            VARCHAR(1000) NULL,
        filesizemb       DECIMAL(12,4) NOT NULL,
        bytesdownloaded  BIGINT NULL,
        costusd          DECIMAL(12,8) NULL,
        usedcred         DECIMAL(14,8) NULL,
        downloadedat     BIGINT NOT NULL,
        CONSTRAINT fk_dl_user  FOREIGN KEY (userid)  REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_dl_group FOREIGN KEY (groupid) REFERENCES groups(id) ON DELETE SET NULL,
        CONSTRAINT fk_dl_memo  FOREIGN KEY (memoid)  REFERENCES memos(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS semantic_logs (
        id              SERIAL PRIMARY KEY,
        userid          INT NOT NULL,
        groupid         INT NULL,
        searchterms     TEXT NOT NULL,
        memosevaluated  INT NOT NULL DEFAULT 0,
        memosreturned   INT NOT NULL DEFAULT 0,
        cutoffpercent   DECIMAL(5,2) NOT NULL DEFAULT 67.00,
        costusd         DECIMAL(12,8) NOT NULL DEFAULT 0,
        createdat       BIGINT NOT NULL,
        CONSTRAINT fk_sem_user  FOREIGN KEY (userid)  REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_sem_group FOREIGN KEY (groupid) REFERENCES groups(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        id               SERIAL PRIMARY KEY,
        configkey        VARCHAR(100) NOT NULL,
        configvalue      TEXT NOT NULL,
        description      TEXT NULL,
        updatedbyuserid  INT NULL,
        createdat        TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat        TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_system_config_key UNIQUE (configkey),
        CONSTRAINT fk_sys_cfg_user FOREIGN KEY (updatedbyuserid) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS support_chats (
        id        SERIAL PRIMARY KEY,
        userid    INT NOT NULL,
        role      VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant')),
        content   TEXT NOT NULL,
        apicost   DECIMAL(12,8) DEFAULT 0,
        isactive  INT NOT NULL DEFAULT 1,
        createdat TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_support_chats_user FOREIGN KEY (userid) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS usage_alerts (
        id               SERIAL PRIMARY KEY,
        subscriptionid   INT NOT NULL,
        resource         VARCHAR(15) NOT NULL CHECK (resource IN ('memos','storage','apiCredits')),
        threshold        VARCHAR(3) NOT NULL CHECK (threshold IN ('80','100')),
        sentat           TIMESTAMP NOT NULL DEFAULT NOW(),
        monthyear        VARCHAR(7) NOT NULL,
        CONSTRAINT uq_usage_alerts UNIQUE (subscriptionid, resource, threshold, monthyear),
        CONSTRAINT fk_usage_alerts_sub FOREIGN KEY (subscriptionid) REFERENCES subscriptions(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_auth_tokens (
        id          SERIAL PRIMARY KEY,
        userid      INT NOT NULL,
        tokenhash   CHAR(64) NOT NULL,
        purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
        expiresat   TIMESTAMP NOT NULL,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_auth_tokens_hash UNIQUE (tokenhash),
        CONSTRAINT fk_user_auth_tokens_user FOREIGN KEY (userid) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_user_auth_tokens_user_purpose ON user_auth_tokens (userid, purpose)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_user_auth_tokens_expires ON user_auth_tokens (expiresat)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id          SERIAL PRIMARY KEY,
        groupid     INT NULL,
        mediatype   VARCHAR(10) DEFAULT NULL CHECK (mediatype IN ('text','audio','image','video','document','url')),
        name        VARCHAR(255) NOT NULL,
        description TEXT DEFAULT NULL,
        isactive    INT NOT NULL DEFAULT 1,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat   TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_categories_group FOREIGN KEY (groupid) REFERENCES groups(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_categories_groupid ON categories (groupid)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subcategories (
        id          SERIAL PRIMARY KEY,
        categoryid  INT NOT NULL,
        name        VARCHAR(255) NOT NULL,
        description TEXT DEFAULT NULL,
        isactive    INT NOT NULL DEFAULT 1,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat   TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_subcategories_categoryid FOREIGN KEY (categoryid) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_subcategories_categoryid ON subcategories (categoryid)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS categorycampos (
        id               SERIAL PRIMARY KEY,
        categoryid       INT NOT NULL,
        name             VARCHAR(255) NOT NULL,
        description      TEXT DEFAULT NULL,
        normalizedterms  TEXT DEFAULT NULL,
        isactive         INT NOT NULL DEFAULT 1,
        createdat        TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat        TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_categorycampos_categoryid FOREIGN KEY (categoryid) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_categorycampos_categoryid ON categorycampos (categoryid)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dadosespecificos (
        id               SERIAL PRIMARY KEY,
        id_categoria     INT NULL,
        id_memo          INT NOT NULL,
        label            VARCHAR(255) NOT NULL,
        dadooriginal     TEXT NULL,
        dadopadronizado  TEXT NULL,
        isactive         INT NOT NULL DEFAULT 1,
        createdat        TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat        TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_dadosespecificos_memo      FOREIGN KEY (id_memo)      REFERENCES memos(id) ON DELETE CASCADE,
        CONSTRAINT fk_dadosespecificos_categoria FOREIGN KEY (id_categoria) REFERENCES categories(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_dadosespecificos_memo       ON dadosespecificos (id_memo)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_dadosespecificos_categoria  ON dadosespecificos (id_categoria)`);

    await queryRunner.query(`
      INSERT INTO system_config (configkey, configvalue, description)
      VALUES
        ('fatorCredCost', '100.00', 'Fator multiplicador do custo de API (USD) para calcular créditos consumidos.'),
        ('showApiCost',   '1',      'Se 1, exibe custo API (USD) e créditos consumidos; se 0, oculta.')
      ON CONFLICT (configkey) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET session_replication_role = replica`);
    const tables = [
      "dadosespecificos", "categorycampos", "subcategories", "categories",
      "user_auth_tokens", "usage_alerts", "support_chats", "system_config",
      "semantic_logs", "download_logs", "api_usage_logs", "media_settings",
      "ai_config", "email_invites", "memos", "group_members", "groups",
      "subscriptions", "subscription_plans", "users",
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await queryRunner.query(`SET session_replication_role = DEFAULT`);
  }
}

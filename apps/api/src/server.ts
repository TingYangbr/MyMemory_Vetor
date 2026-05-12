import path from "node:path";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { assertMediaStorageEnv, config } from "./config.js";
import { uploadsAbsolutePath } from "./paths.js";
import { AppDataSource } from "./data-source.js";
import { InitialSchema1700000000000 } from "./migrations/1700000000000-InitialSchema.js";
import { SeedDev1700000000001 } from "./migrations/1700000000001-SeedDev.js";
import { CategoryCampoPatternsAndDadosEspecificos1700000000025 } from "./migrations/1700000000025-CategoryCampoPatternsAndDadosEspecificos.js";
import { PgvectorMemoChunks1700000000100 } from "./migrations/1700000000100-PgvectorMemoChunks.js";
import { Unaccent1700000000101 } from "./migrations/1700000000101-Unaccent.js";
import { BackfillIndividualSubscriptions1700000000102 } from "./migrations/1700000000102-BackfillIndividualSubscriptions.js";
import { ResyncSequences1700000000103 } from "./migrations/1700000000103-ResyncSequences.js";
import { MemoCategoryColumn1700000000104 } from "./migrations/1700000000104-MemoCategoryColumn.js";
import { QueriesCategoria1700000000027 } from "./migrations/1700000000027-QueriesCategoria.js";
import { LlmPromptConfigs1700000000105 } from "./migrations/1700000000105-LlmPromptConfigs.js";
import { SemanticBuscaMinSimilarity1700000000106 } from "./migrations/1700000000106-SemanticBuscaMinSimilarity.js";
import { LlmPromptCategoryOverrides1700000000107 } from "./migrations/1700000000107-LlmPromptCategoryOverrides.js";
import { PerguntaModelos1700000000108 } from "./migrations/1700000000108-PerguntaModelos.js";
import { AiConfigSeed1700000000109 } from "./migrations/1700000000109-AiConfigSeed.js";
import { DbConnections1700000000110 } from "./migrations/1700000000110-DbConnections.js";
import { UpdatePipe2PlanejamentoPrompt1700000000111 } from "./migrations/1700000000111-UpdatePipe2PlanejamentoPrompt.js";
import { UpdatePipe2PercentualPrompts1700000000112 } from "./migrations/1700000000112-UpdatePipe2PercentualPrompts.js";
import { UpdatePipe2PlanejamentoOmitNullParams1700000000113 } from "./migrations/1700000000113-UpdatePipe2PlanejamentoOmitNullParams.js";
import { UpdatePipe2WildcardControl1700000000114 } from "./migrations/1700000000114-UpdatePipe2WildcardControl.js";
import { UpdatePipe2TruncGroupBy1700000000115 } from "./migrations/1700000000115-UpdatePipe2TruncGroupBy.js";
import { UpdatePipe2TruncGroupByV21700000000116 } from "./migrations/1700000000116-UpdatePipe2TruncGroupByV2.js";
import { UpdatePipe2SubsidiaryLimit1700000000117 } from "./migrations/1700000000117-UpdatePipe2SubsidiaryLimit.js";
import { UpdatePipe2CrossQueryFilter1700000000118 } from "./migrations/1700000000118-UpdatePipe2CrossQueryFilter.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import adminDocumentAiRoutes from "./routes/adminDocumentAi.js";
import adminMediaSettingsRoutes from "./routes/adminMediaSettings.js";
import adminCostReportRoutes from "./routes/adminCostReport.js";
import adminSoftDeletedMemosRoutes from "./routes/adminSoftDeletedMemos.js";
import adminSubscriptionPlansRoutes from "./routes/adminSubscriptionPlans.js";
import adminLlmPromptRoutes from "./routes/adminLlmPrompt.js";
import adminCadPipelineRoutes from "./routes/adminCadPipeline.js";
import adminSystemConfigRoutes from "./routes/adminSystemConfig.js";
import adminPromptConfigsRoutes from "./routes/adminPromptConfigs.js";
import adminAiConfigRoutes from "./routes/adminAiConfig.js";
import adminDbConnectionsRoutes from "./routes/adminDbConnections.js";
import groupsRoutes from "./routes/groups.js";
import groupInvitesRoutes from "./routes/groupInvites.js";
import memoContextRoutes from "./routes/memoContext.js";
import perguntasRoutes from "./routes/perguntas.js";
import perguntaModelosRoutes from "./routes/perguntaModelos.js";
import memoRoutes from "./routes/memos.js";
import mediaLocalProtectedRoutes from "./routes/mediaLocal.js";

assertMediaStorageEnv();

// Aplica migrations pendentes antes de abrir conexões da aplicação.
// É seguro rodar toda vez: o TypeORM verifica `typeorm_migrations` e pula as já aplicadas.
{
  AppDataSource.setOptions({
    migrations: [
      InitialSchema1700000000000,
      SeedDev1700000000001,
      CategoryCampoPatternsAndDadosEspecificos1700000000025,
      PgvectorMemoChunks1700000000100,
      Unaccent1700000000101,
      BackfillIndividualSubscriptions1700000000102,
      ResyncSequences1700000000103,
      MemoCategoryColumn1700000000104,
      QueriesCategoria1700000000027,
      LlmPromptConfigs1700000000105,
      SemanticBuscaMinSimilarity1700000000106,
      LlmPromptCategoryOverrides1700000000107,
      PerguntaModelos1700000000108,
      AiConfigSeed1700000000109,
      DbConnections1700000000110,
      UpdatePipe2PlanejamentoPrompt1700000000111,
      UpdatePipe2PercentualPrompts1700000000112,
      UpdatePipe2PlanejamentoOmitNullParams1700000000113,
      UpdatePipe2WildcardControl1700000000114,
      UpdatePipe2TruncGroupBy1700000000115,
      UpdatePipe2TruncGroupByV21700000000116,
      UpdatePipe2SubsidiaryLimit1700000000117,
      UpdatePipe2CrossQueryFilter1700000000118,
    ],
  });
  const ds = await AppDataSource.initialize();
  await ds.runMigrations({ transaction: "each" });
  await ds.destroy();
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
});

await app.register(cookie);
await app.register(jwt, {
  secret: config.jwtSecret,
  sign: { expiresIn: "7d" },
  cookie: {
    cookieName: "mm_access",
    signed: false,
  },
});

await app.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1,
  },
});

if (config.mediaLocalPublic) {
  await app.register(fastifyStatic, {
    root: uploadsAbsolutePath(),
    prefix: "/media/",
    decorateReply: false,
  });
} else {
  await app.register(mediaLocalProtectedRoutes);
}

await app.register(authRoutes);
await app.register(groupsRoutes);
await app.register(groupInvitesRoutes);
await app.register(meRoutes);
await app.register(memoRoutes);
await app.register(memoContextRoutes);
await app.register(perguntasRoutes);
await app.register(perguntaModelosRoutes);
await app.register(adminSubscriptionPlansRoutes);
await app.register(adminMediaSettingsRoutes);
await app.register(adminDocumentAiRoutes);
await app.register(adminSoftDeletedMemosRoutes);
await app.register(adminCostReportRoutes);
await app.register(adminLlmPromptRoutes);
await app.register(adminCadPipelineRoutes);
await app.register(adminSystemConfigRoutes);
await app.register(adminPromptConfigsRoutes);
await app.register(adminAiConfigRoutes);
await app.register(adminDbConnectionsRoutes);

app.get("/api/health", async () => ({ ok: true }));

if (process.env.NODE_ENV !== "production") {
  app.get("/api/debug/mail", async () => ({
    resendApiKeyConfigured: Boolean(config.resendApiKey?.length),
    emailFrom: config.emailFrom,
    publicWebUrl: config.publicWebUrl,
    hint:
      "Se resendApiKeyConfigured for false, a API não chama o Resend. Confira .env na raiz do repo ou em apps/api/.",
  }));
}

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    {
      port: config.port,
      uploads: path.resolve(uploadsAbsolutePath()),
      mediaStorage: config.mediaStorage,
      s3Bucket: config.mediaStorage === "s3" ? config.s3.bucket : undefined,
      s3Region: config.mediaStorage === "s3" ? config.s3.region : undefined,
      mediaLocalPublic: config.mediaLocalPublic,
      mail: {
        resendConfigured: Boolean(config.resendApiKey?.length),
        emailFrom: config.emailFrom,
        publicWebUrl: config.publicWebUrl,
      },
    },
    "API MyMemory"
  );
  if (config.mediaLocalPublic) {
    app.log.warn(
      "MEDIA_LOCAL_PUBLIC: /media sem verificação de login — não use em produção SaaS."
    );
  }
  if (!config.resendApiKey) {
    app.log.warn(
      "RESEND_API_KEY vazia — e-mails de confirmação não serão enviados. Defina em apps/api/.env ou .env na raiz."
    );
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

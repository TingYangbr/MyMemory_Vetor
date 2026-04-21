import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

/**
 * Mapa de nomes de coluna lowercase (PostgreSQL) → camelCase (TypeScript).
 * Necessário porque PostgreSQL armazena identificadores sem aspas em lowercase.
 */
const COL: Record<string, string> = {
  // users
  openid: "openId", loginmethod: "loginMethod", soundenabled: "soundEnabled",
  confirmenabled: "confirmEnabled",
  allowfreespecificfieldswithoutcategorymatch: "allowFreeSpecificFieldsWithoutCategoryMatch",
  iausetexto: "iaUseTexto", iauseimagem: "iaUseImagem", iausevideo: "iaUseVideo",
  iauseaudio: "iaUseAudio", iausedocumento: "iaUseDocumento", iauseurl: "iaUseUrl",
  imageocrvisionminconfidence: "imageOcrVisionMinConfidence",
  createdat: "createdAt", updatedat: "updatedAt",
  lastsignedin: "lastSignedIn", lastloginat: "lastLoginAt",
  passwordhash: "passwordHash", emailverified: "emailVerified",
  lastworkspacegroupid: "lastWorkspaceGroupId",
  // subscription_plans
  plantype: "planType", maxmemos: "maxMemos", maxstoragegb: "maxStorageGB",
  maxmembers: "maxMembers", durationdays: "durationDays", isactive: "isActive",
  monthlyapicredits: "monthlyApiCredits", monthlydownloadlimitgb: "monthlyDownloadLimitGB",
  supportlargeaudio: "supportLargeAudio", supportlargevideo: "supportLargeVideo",
  // subscriptions
  userid: "userId", ownerid: "ownerId", planid: "planId",
  startdate: "startDate", enddate: "endDate",
  // groups
  subscriptionid: "subscriptionId", accesscode: "accessCode",
  ispublic: "isPublic", maxsummarylength: "maxSummaryLength",
  allowpersonalcontext: "allowPersonalContext",
  // group_members
  groupid: "groupId", joinedat: "joinedAt",
  // memos
  mediatype: "mediaType", mediaaudiourl: "mediaAudioUrl", mediaimageurl: "mediaImageUrl",
  mediavideourl: "mediaVideoUrl", mediadocumenturl: "mediaDocumentUrl",
  mediaweburl: "mediaWebUrl", mediatext: "mediaText", mediametadata: "mediaMetadata",
  apicost: "apiCost", tammediaurl: "tamMediaUrl", usedapicred: "usedApiCred",
  dadosespecificosjson: "dadosEspecificosJson",
  // email_invites
  invitedbyuserid: "invitedByUserId", adminrole: "adminRole",
  expiresat: "expiresAt", acceptedat: "acceptedAt",
  // media_settings
  maxfilesizekb: "maxFileSizeKB", maxlargevideokb: "maxLargeVideoKb",
  maxlargeaudiokb: "maxLargeAudioKb", maxsummarychars: "maxSummaryChars",
  textimagemmin: "textImagemMin", compressbeforeai: "compressBeforeAI",
  // ai_config
  displayname: "displayName", isenabled: "isEnabled",
  maxtokens: "maxTokens", extraparams: "extraParams",
  documentroutingjson: "documentRoutingJson",
  // api_usage_logs / download_logs / semantic_logs
  memoid: "memoId", inputtokens: "inputTokens", outputtokens: "outputTokens",
  totaltokens: "totalTokens", audiodurationseconds: "audioDurationSeconds",
  costusd: "costUsd", filesizemb: "fileSizeMb", bytesdownloaded: "bytesDownloaded",
  usedcred: "usedCred", downloadedat: "downloadedAt",
  searchterms: "searchTerms", memosevaluated: "memosEvaluated",
  memosreturned: "memosReturned", cutoffpercent: "cutoffPercent",
  // system_config
  configkey: "configKey", configvalue: "configValue", updatedbyuserid: "updatedByUserId",
  // user_auth_tokens
  tokenhash: "tokenHash",
  // categories / sub_categories
  categoryid: "categoryId", normalizedterms: "normalizedTerms",
  // dados_especificos
  id_categoria: "id_Categoria", dadooriginal: "dadoOriginal",
  dadopadronizado: "dadoPadronizado",
  // memo_chunks
  memo_id: "memo_id", chunk_idx: "chunk_idx", chunk_text: "chunk_text",
  haschunks: "hasChunks",
  // misc aliases used in queries
  planname: "planName", groupname: "groupName", isonwer: "isOwner",
  isowner: "isOwner", subscriptionowneremail: "subscriptionOwnerEmail",
  memocontextaccess: "memoContextAccess",
  pricesum: "priceSum", activecnt: "activeCnt", totalcnt: "totalCnt",
  ym: "ym", cnt: "cnt", ok: "ok", ws: "ws",
  apicostusd: "apiCostUsd", dlcostusd: "dlCostUsd", dlcred: "dlCred",
  memoscount: "memosCount", chatscount: "chatsCount", totalcount: "totalCount",
  // camponame alias
  camponame: "campoName",
};

function camelizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[COL[k] ?? k] = v;
  }
  return out;
}

/** Converte placeholders ? do mysql2 para $1, $2, ... do PostgreSQL. */
function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const pgPool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  user: config.postgres.user,
  password: config.postgres.password,
  database: config.postgres.database,
  max: 10,
});

type QueryResult<T> = Promise<[T, pg.FieldDef[]]>;

function wrapClient(client: pg.PoolClient | pg.Pool) {
  const runQuery = async <T>(sql: string, params?: unknown[]): QueryResult<T> => {
    const result = await client.query(toPositional(sql), params);
    // UPDATE/DELETE sem RETURNING: retornar ResultSetHeader com affectedRows
    if (result.rows.length === 0 && (result.command === "UPDATE" || result.command === "DELETE")) {
      const header = { insertId: 0, affectedRows: result.rowCount ?? 0, changedRows: result.rowCount ?? 0 };
      return [header as unknown as T, []];
    }
    return [result.rows.map(camelizeRow) as unknown as T, result.fields ?? []];
  };
  return { query: runQuery, execute: runQuery };
}

export const pool = {
  ...wrapClient(pgPool),

  getConnection: async () => {
    const client = await pgPool.connect();
    return {
      ...wrapClient(client),
      beginTransaction: () => client.query("BEGIN"),
      commit: () => client.query("COMMIT"),
      rollback: () => client.query("ROLLBACK"),
      release: () => client.release(),
    };
  },
};

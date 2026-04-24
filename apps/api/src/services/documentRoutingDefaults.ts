/**
 * Defaults de roteamento de documentos (quando `ai_config.documentRoutingJson` é NULL).
 * Admin pode sobrescrever via JSON — ver `documentRoutingService.ts`.
 */
export type DocumentPreprocessRule = {
  match: {
    ext?: string[];
    mime?: string[];
    mimePrefix?: string[];
  };
  /** Pipelines: extract_utf8_text | extract_pdf_text | extract_msg_text | extract_eml_text | extract_docx_text | unsupported */
  pipeline: string;
};

export type ProviderDirectHints = {
  /** Extensões que o provedor costuma aceitar como input_file (referência; pipeline ainda extrai localmente). */
  directExtensions: string[];
  maxDirectBytes: number;
};

export type DocumentRoutingConfig = {
  version: number;
  preprocess: DocumentPreprocessRule[];
  providers: Record<string, ProviderDirectHints>;
};

export const DEFAULT_DOCUMENT_ROUTING: DocumentRoutingConfig = {
  version: 1,
  preprocess: [
    {
      match: { ext: [".ifc"], mimePrefix: ["application/x-step", "application/ifc"] },
      pipeline: "cad_not_enabled",
    },
    {
      match: { ext: [".dwg"] },
      pipeline: "dwg_not_supported",
    },
    {
      match: { ext: [".msg"] },
      pipeline: "extract_msg_text",
    },
    {
      match: {
        ext: [".eml"],
        mime: ["message/rfc822", "application/eml", "message/global"],
      },
      pipeline: "extract_eml_text",
    },
    {
      match: {
        ext: [".docx"],
        mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      },
      pipeline: "extract_docx_text",
    },
    {
      match: {
        ext: [".doc", ".xls", ".xlsx", ".ppt", ".pptx", ".rtf", ".odt", ".ods"],
      },
      pipeline: "unsupported",
    },
    {
      match: {
        ext: [".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml", ".css", ".js", ".ts"],
        mimePrefix: ["text/"],
      },
      pipeline: "extract_utf8_text",
    },
    {
      match: { ext: [".pdf"], mime: ["application/pdf"] },
      pipeline: "extract_pdf_text",
    },
  ],
  providers: {
    openai: {
      directExtensions: [".pdf", ".txt", ".md", ".csv", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"],
      maxDirectBytes: 52_428_800,
    },
    google_gemini: {
      directExtensions: [".pdf", ".txt", ".md"],
      maxDirectBytes: 20_971_520,
    },
  },
};

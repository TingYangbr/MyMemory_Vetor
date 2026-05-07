import type { MigrationInterface, QueryRunner } from "typeorm";

export class AiConfigSeed1700000000109 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = [
      { operation: "chat_ia",                displayName: "Chat IA — texto, resumo, perguntas",   provider: "openai", model: "gpt-4o-mini" },
      { operation: "vision_ia",              displayName: "Visão IA — imagem e frames de vídeo",   provider: "openai", model: "gpt-4o-mini" },
      { operation: "audio_transcription_ia", displayName: "Transcrição de áudio (Whisper — sempre OpenAI)", provider: "openai", model: "whisper-1" },
    ];
    for (const r of rows) {
      await queryRunner.query(
        `INSERT INTO ai_config (operation, displayname, provider, model, isenabled)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (operation) DO NOTHING`,
        [r.operation, r.displayName, r.provider, r.model]
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM ai_config WHERE operation IN ('chat_ia','vision_ia','audio_transcription_ia')`
    );
  }
}

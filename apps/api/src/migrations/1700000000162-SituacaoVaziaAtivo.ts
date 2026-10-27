import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Categorias atualizáveis: memos gravados antes da marca (ou sem a situação extraída) têm o campo
 * situação vazio — e o filtro "situacao = Ativo" das perguntas não os acha. Vazio vira "Ativo", o
 * mesmo que o salvamento passou a fazer. Só preenche o que está vazio; JSON inválido não é tocado.
 */
export class SituacaoVaziaAtivo1700000000162 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const norm = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();
    const cats: { name: string; groupid: number | null; campo_situacao: string }[] = await queryRunner.query(
      `SELECT name, groupid, campo_situacao FROM categories
       WHERE atualizavel = 1 AND isactive = 1 AND COALESCE(TRIM(campo_situacao), '') <> ''`
    );
    let total = 0;
    for (const c of cats) {
      const memos: { id: number; dadosespecificosjson: string | null }[] = await queryRunner.query(
        `SELECT id, dadosespecificosjson FROM memos
         WHERE isactive = 1 AND category = $1 AND ($2::int IS NULL OR groupid = $2::int)`,
        [c.name, c.groupid]
      );
      const alvo = norm(c.campo_situacao);
      for (const m of memos) {
        let dados: Record<string, unknown> = {};
        if (m.dadosespecificosjson && m.dadosespecificosjson.trim()) {
          try {
            const v = JSON.parse(m.dadosespecificosjson);
            if (!v || typeof v !== "object" || Array.isArray(v)) continue;
            dados = v as Record<string, unknown>;
          } catch {
            continue;
          }
        }
        const chave = Object.keys(dados).find((k) => norm(k) === alvo) ?? c.campo_situacao;
        if (String(dados[chave] ?? "").trim()) continue;
        dados[chave] = "Ativo";
        await queryRunner.query(`UPDATE memos SET dadosespecificosjson = $1 WHERE id = $2`, [JSON.stringify(dados), m.id]);
        await queryRunner.query(
          `UPDATE dadosespecificos SET dadooriginal = COALESCE(NULLIF(dadooriginal, ''), 'Ativo'), dadopadronizado = 'Ativo'
           WHERE id_memo = $1 AND label = $2 AND COALESCE(dadopadronizado, '') = ''`,
          [m.id, chave]
        );
        total++;
      }
    }
    console.log(`[migração 162] situação "Ativo" preenchida em ${total} memo(s) de categorias atualizáveis.`);
  }

  public async down(): Promise<void> {
    // Preenchimento de dados: sem volta.
  }
}

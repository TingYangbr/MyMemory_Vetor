import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Categorias "Pessoal" com campo dono: memos já gravados com o campo dono vazio recebem o nome do
 * dono atual do memo (users.name, sem acento; sem nome, o e-mail) — o mesmo que o Catalogar passou
 * a fazer ao salvar. Memos com dono pendente (lista "Memos sem dono identificado") ficam de fora.
 * Só preenche o que está vazio; rodar de novo não muda nada.
 */
export class PreencherCampoDonoVazio1700000000161 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const norm = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();
    const cats: { id: number; name: string; groupid: number | null; campo_dono: string }[] = await queryRunner.query(
      `SELECT id, name, groupid, campo_dono FROM categories
       WHERE meus_por_padrao = 1 AND isactive = 1 AND COALESCE(TRIM(campo_dono), '') <> ''`
    );
    let total = 0;
    for (const c of cats) {
      const memos: { id: number; dadosespecificosjson: string | null; dono: string | null }[] = await queryRunner.query(
        `SELECT m.id, m.dadosespecificosjson,
                COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS dono
         FROM memos m JOIN users u ON u.id = m.userid
         WHERE m.isactive = 1 AND m.category = $1
           AND ($2::int IS NULL OR m.groupid = $2::int)
           AND COALESCE(m.mediametadata, '') NOT LIKE '%"donoPendente"%'`,
        [c.name, c.groupid]
      );
      const alvo = norm(c.campo_dono);
      for (const m of memos) {
        if (!m.dono) continue;
        let dados: Record<string, unknown> = {};
        if (m.dadosespecificosjson && m.dadosespecificosjson.trim()) {
          try {
            const v = JSON.parse(m.dadosespecificosjson);
            if (!v || typeof v !== "object" || Array.isArray(v)) continue;
            dados = v as Record<string, unknown>;
          } catch {
            continue; // JSON inválido: não mexe
          }
        }
        const chave = Object.keys(dados).find((k) => norm(k) === alvo) ?? c.campo_dono;
        if (String(dados[chave] ?? "").trim()) continue;
        const valor = m.dono.normalize("NFD").replace(/\p{Mn}/gu, "");
        dados[chave] = valor;
        await queryRunner.query(`UPDATE memos SET dadosespecificosjson = $1 WHERE id = $2`, [JSON.stringify(dados), m.id]);
        await queryRunner.query(
          `UPDATE dadosespecificos SET dadooriginal = COALESCE(NULLIF(dadooriginal, ''), $1), dadopadronizado = $1
           WHERE id_memo = $2 AND label = $3 AND COALESCE(dadopadronizado, '') = ''`,
          [valor, m.id, chave]
        );
        total++;
      }
    }
    console.log(`[migração 161] campo dono preenchido em ${total} memo(s) de categorias Pessoal.`);
  }

  public async down(): Promise<void> {
    // Preenchimento de dados: não há como distinguir depois o que foi preenchido aqui.
  }
}

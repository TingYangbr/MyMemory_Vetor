import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { ensurePerfilPadrao, listCategoriasDoGrupo } from "./perfisAcessoService.js";

/**
 * Aplicação do perfil de acesso à pergunta (fase 2B). Tudo aqui só vale quando o grupo ligou
 * `groups.perfis_ativos`; desligado, a pergunta se comporta exatamente como antes.
 *
 * Duas camadas (ver plano): ALCANCE é segurança e é decidido aqui, no servidor, comparando as
 * categorias classificadas com a lista do perfil — a IA só diz sobre o que é a pergunta, nunca
 * libera nem recusa. COMPORTAMENTO (estilo da resposta) não é barreira e não passa por aqui.
 */

export interface PerfilEfetivo {
  perfilId: number;
  nome: string;
  /** "Todas as categorias" — sem corte e sem filtro, idêntico ao comportamento de antes. */
  todas: boolean;
  incluiSemCategoria: boolean;
  /** Nomes das categorias liberadas (vazio quando `todas`). */
  categoriasPermitidas: string[];
}

/** Perfil que vale para o usuário no grupo, ou null se o grupo não ligou os perfis. */
export async function carregarPerfilEfetivo(userId: number, groupId: number): Promise<PerfilEfetivo | null> {
  const [g] = await pool.query<RowDataPacket[]>(`SELECT perfis_ativos AS "ativos" FROM groups WHERE id = ?`, [groupId]);
  if (!g[0] || !(g[0].ativos === 1 || g[0].ativos === true)) return null;

  const padraoId = await ensurePerfilPadrao(groupId);
  const [m] = await pool.query<RowDataPacket[]>(
    `SELECT perfilid AS "perfilId" FROM group_members WHERE groupid = ? AND userid = ?`,
    [groupId, userId]
  );
  // Quem não é membro (ex.: admin do sistema entrando em qualquer grupo) usa o padrão do grupo.
  const perfilId = m[0]?.perfilId != null ? Number(m[0].perfilId) : padraoId;

  const [p] = await pool.query<RowDataPacket[]>(
    `SELECT id, nome, todas, inclui_sem_categoria AS "incluiSemCategoria"
     FROM perfis_acesso WHERE id = ? AND groupid = ?`,
    [perfilId, groupId]
  );
  // Perfil sumiu (não deveria: a FK devolve o membro ao padrão). Cai no padrão em vez de abrir ou trancar tudo.
  const row = p[0] ?? (await pool.query<RowDataPacket[]>(
    `SELECT id, nome, todas, inclui_sem_categoria AS "incluiSemCategoria" FROM perfis_acesso WHERE id = ?`,
    [padraoId]
  ))[0][0];

  const todas = row.todas === 1 || row.todas === true;
  let categoriasPermitidas: string[] = [];
  if (!todas) {
    const [cats] = await pool.query<RowDataPacket[]>(
      `SELECT c.name AS nome FROM perfil_acesso_categorias pc
       JOIN categories c ON c.id = pc.categoryid AND c.isactive = 1
       WHERE pc.perfilid = ?`,
      [Number(row.id)]
    );
    categoriasPermitidas = cats.map((c) => String(c.nome));
  }
  return {
    perfilId: Number(row.id),
    nome: String(row.nome),
    todas,
    incluiSemCategoria: row.incluiSemCategoria === 1 || row.incluiSemCategoria === true,
    categoriasPermitidas,
  };
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Corte pelo perfil. `catalogo` = nomes de todas as categorias do grupo: só categorias que existem
 * contam (nome inventado pelo classificador não é "fora do perfil", apenas não existe).
 * Recusa total: basta UMA categoria classificada fora da lista.
 */
export function aplicarCorte(
  perfil: PerfilEfetivo,
  classificadas: string[],
  catalogo: string[]
): { liberada: boolean; foraDoPerfil: string[] } {
  if (perfil.todas) return { liberada: true, foraDoPerfil: [] };
  const existentes = new Map(catalogo.map((n) => [norm(n), n]));
  const permitidas = new Set(perfil.categoriasPermitidas.map(norm));
  const fora: string[] = [];
  for (const nome of classificadas) {
    const real = existentes.get(norm(nome));
    if (real && !permitidas.has(norm(real)) && !fora.includes(real)) fora.push(real);
  }
  return { liberada: fora.length === 0, foraDoPerfil: fora };
}

/**
 * Membro do grupo citado na pergunta ("agenda do Suporte"), por e-mail, nome completo ou primeiro
 * nome (só quando único no grupo). Palavra inteira, sem acento/maiúscula. Mais de um membro citado
 * (ou nome que serve a vários) → "ambiguo".
 */
export function pessoaDaPergunta(
  pergunta: string,
  membros: { id: number; name: string | null; email: string | null }[]
): { tipo: "membro"; id: number; nome: string } | { tipo: "ambiguo"; termo: string } | null {
  const t = ` ${norm(pergunta).replace(/[^\p{L}\p{N}@._-]+/gu, " ")} `;
  const tem = (termo: string) => termo.length >= 3 && t.includes(` ${termo} `);
  const limpa = (s: string) => norm(s).replace(/[^\p{L}\p{N}@._-]+/gu, " ").replace(/\s+/g, " ").trim();
  const primeiro = (m: { name: string | null }) => (m.name ? limpa(m.name).split(" ")[0] : "");
  const contaPrimeiro = new Map<string, number>();
  for (const m of membros) {
    const p = primeiro(m);
    if (p) contaPrimeiro.set(p, (contaPrimeiro.get(p) ?? 0) + 1);
  }
  const achados = new Map<number, string>();
  let ambiguo: string | null = null;
  for (const m of membros) {
    const nome = m.name ? limpa(m.name) : "";
    const email = m.email ? m.email.trim().toLowerCase() : "";
    const p = primeiro(m);
    if ((email && tem(email)) || (nome && tem(nome))) {
      achados.set(m.id, m.name ?? m.email ?? `#${m.id}`);
    } else if (p && tem(p)) {
      if ((contaPrimeiro.get(p) ?? 0) === 1) achados.set(m.id, m.name ?? `#${m.id}`);
      else ambiguo = p;
    }
  }
  if (achados.size === 1 && !ambiguo) {
    const [[id, nome]] = [...achados];
    return { tipo: "membro", id, nome };
  }
  if (achados.size > 1) return { tipo: "ambiguo", termo: [...achados.values()].join(", ") };
  if (ambiguo) return { tipo: "ambiguo", termo: ambiguo };
  return null;
}

/**
 * "De quem" da pergunta: "eu" (padrão) ou "todos" quando a pessoa pede explicitamente. Em dúvida,
 * vale "eu". Primeira versão por regra de texto (sem depender de mudar o prompt do classificador);
 * nomes de pessoas ("agenda da Ana") ficam para depois.
 */
export function deQuem(pergunta: string): "eu" | "todos" {
  const t = norm(pergunta);
  if (
    /\b(de|dos|das)\s+todos\b/.test(t) ||
    /\b(de|do|da|dos|das)\s+(todo\s+o\s+)?(grupo|equipe|time|empresa)\b/.test(t) ||
    /\btodo\s+mundo\b/.test(t) ||
    /\bde\s+todas\b/.test(t)
  ) {
    return "todos";
  }
  return "eu";
}

export async function registrarRecusa(input: {
  groupId: number;
  userId: number | null;
  perfilId: number | null;
  categorias: string[];
  motivo: string;
  pergunta: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO perguntas_recusadas (groupid, userid, perfilid, categorias, motivo, pergunta)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.groupId, input.userId, input.perfilId, input.categorias.join(", "), input.motivo, input.pergunta.slice(0, 4000)]
    );
  } catch {
    /* registro é só para análise; nunca derruba a resposta */
  }
}

/**
 * Mensagem de recusa: curta, com só o NOME da(s) categoria(s) envolvida(s) no fim — nunca conteúdo nem
 * o nome do perfil. A categoria também fica no registro `perguntas_recusadas`.
 */
export function mensagemRecusa(categorias: string[]): string {
  return `Resposta bloqueada com dados restritos: ${categorias.join(", ")}`;
}

/** Tudo que `perguntarMemory` precisa saber sobre o perfil, já resolvido pela rota. */
export interface PerfilNaPergunta {
  efetivo: PerfilEfetivo;
  groupId: number;
  /** Quem perguntou (para o registro das recusas). */
  userId: number;
  /** Nomes das categorias marcadas "Pessoal". */
  categoriasMeus: string[];
  /**
   * Autor do escopo "Pessoal". Nulo quando a requisição não identifica uma pessoa de verdade
   * (chave de integração sem o id do usuário do ERP, até a fase 3): "eu" seria o usuário de serviço
   * e a pergunta voltaria vazia.
   */
  autorEscopoId: number | null;
}

export async function montarPerfilNaPergunta(input: {
  userId: number;
  groupId: number;
  porChave: boolean;
}): Promise<PerfilNaPergunta | null> {
  const efetivo = await carregarPerfilEfetivo(input.userId, input.groupId);
  if (!efetivo) return null;
  const categorias = await listCategoriasDoGrupo(input.groupId);
  return {
    efetivo,
    groupId: input.groupId,
    userId: input.userId,
    categoriasMeus: categorias.filter((c) => c.meusPorPadrao).map((c) => c.nome),
    autorEscopoId: input.porChave ? null : input.userId,
  };
}

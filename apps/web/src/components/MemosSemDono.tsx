import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPostJson } from "../api";

type Membro = { id: number; name: string | null; email: string | null };
type Item = {
  id: number;
  category: string | null;
  resumo: string;
  campo: string | null;
  valor: string | null;
  motivo: string;
  donoAtualId: number;
  createdAt: string;
};

const rotuloMembro = (m: Membro) => (m.name ? `${m.name}${m.email ? ` (${m.email})` : ""}` : m.email ?? `#${m.id}`);

/**
 * Memos importados em categoria "Pessoal" cujo dono não foi identificado pelo campo dono:
 * ficam com quem importou até alguém escolher a pessoa em "Atribuir a".
 */
export function MemosSemDono({ groupId, atualizar }: { groupId: number; atualizar?: number }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [escolha, setEscolha] = useState<Record<number, number>>({});
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await apiGet<{ itens: Item[]; membros: Membro[] }>(`/api/memos/sem-dono?groupId=${groupId}`);
      setItens(r.itens);
      setMembros(r.membros);
      setErro(null);
    } catch {
      // Viewer (sem permissão) ou API indisponível: a seção simplesmente não aparece
      setItens([]);
    }
  }, [groupId]);

  useEffect(() => { void carregar(); }, [carregar, atualizar]);

  async function atribuir(memoId: number) {
    const dono = escolha[memoId];
    if (!dono) return;
    setOcupado(memoId);
    setErro(null);
    try {
      await apiPostJson(`/api/memos/${memoId}/atribuir-dono`, { groupId, userId: dono });
      await carregar();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      try { setErro((JSON.parse(raw) as { message?: string }).message ?? raw); } catch { setErro(raw); }
    } finally {
      setOcupado(null);
    }
  }

  if (!itens.length) return null;
  const nomeDe = (id: number) => {
    const m = membros.find((x) => x.id === id);
    return m ? rotuloMembro(m) : `#${id}`;
  };

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.3rem" }}>Memos sem dono identificado ({itens.length})</h2>
      <p className="mm-muted" style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>
        Importados em categoria Pessoal sem uma pessoa reconhecida no campo dono. Ficam com quem importou até você
        escolher o dono.
      </p>
      {erro ? <p className="mm-error">{erro}</p> : null}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ padding: "0.3rem" }}>Memo</th>
              <th style={{ padding: "0.3rem" }}>Categoria</th>
              <th style={{ padding: "0.3rem" }}>Campo dono</th>
              <th style={{ padding: "0.3rem" }}>Motivo</th>
              <th style={{ padding: "0.3rem" }}>Atribuir a</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} style={{ borderTop: "1px solid var(--mm-border)" }}>
                <td style={{ padding: "0.3rem", maxWidth: 320 }} title={i.resumo}>
                  <strong>#{i.id}</strong> {i.resumo}
                  <div className="mm-muted" style={{ fontSize: "0.75rem" }}>
                    com {nomeDe(i.donoAtualId)} · {new Date(i.createdAt).toLocaleDateString("pt-BR")}
                  </div>
                </td>
                <td style={{ padding: "0.3rem" }}>{i.category ?? "—"}</td>
                <td style={{ padding: "0.3rem" }}>{i.campo ? `${i.campo}: ${i.valor ?? "(vazio)"}` : "—"}</td>
                <td style={{ padding: "0.3rem" }}>{i.motivo}</td>
                <td style={{ padding: "0.3rem", whiteSpace: "nowrap" }}>
                  <select
                    className="mm-field"
                    value={escolha[i.id] ?? ""}
                    onChange={(e) => setEscolha((p) => ({ ...p, [i.id]: Number(e.target.value) }))}
                    style={{ maxWidth: 220 }}
                  >
                    <option value="">— membro —</option>
                    {membros.map((m) => <option key={m.id} value={m.id}>{rotuloMembro(m)}</option>)}
                  </select>{" "}
                  <button
                    type="button"
                    className="mm-btn mm-btn--primary"
                    disabled={!escolha[i.id] || ocupado != null}
                    onClick={() => void atribuir(i.id)}
                  >
                    {ocupado === i.id ? "…" : "Atribuir"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

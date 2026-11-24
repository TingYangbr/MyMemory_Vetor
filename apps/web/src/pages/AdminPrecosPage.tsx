import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPostJson } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";

type Situacao = {
  papeis: number;
  linhas: number;
  primeiraData: string | null;
  ultimaData: string | null;
  importacoes: { arquivo: string; situacao: string; linhas: number; mensagem: string | null; em: string }[];
  carga: { anos: number[]; atual: number | null; iniciadoEm: string } | null;
};

const dataBr = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const ROTULO: Record<string, string> = { ok: "importado", sem_arquivo: "sem arquivo", sem_papeis: "sem papéis", erro: "erro" };

/** Nome do arquivo da B3 para a tela: "A2025" → "ano 2025"; "D21112025" → "dia 21/11/2025". */
function arquivoLegivel(a: string): string {
  if (/^A\d{4}$/.test(a)) return `ano ${a.slice(1)}`;
  const m = /^D(\d{2})(\d{2})(\d{4})$/.exec(a);
  return m ? `dia ${m[1]}/${m[2]}/${m[3]}` : a;
}

/**
 * Admin → Sistema → Histórico de preços (B3): carga dos anos pelo arquivo oficial gratuito da B3 (Séries Históricas)
 * e situação das importações. O fechamento de cada dia entra sozinho (robô, a partir das 20h).
 */
export default function AdminPrecosPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [carregandoMe, setCarregandoMe] = useState(true);
  const [sit, setSit] = useState<Situacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const anoAtual = new Date().getFullYear();
  const [anos, setAnos] = useState<number[]>([anoAtual - 4, anoAtual - 3, anoAtual - 2, anoAtual - 1, anoAtual]);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me").then((r) => setMe(r.ok ? r.data : null)).finally(() => setCarregandoMe(false));
  }, []);

  const atualizar = useCallback(() => {
    apiGet<Situacao>("/api/admin/precos").then(setSit).catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    if (me?.role !== "admin") return;
    atualizar();
  }, [me, atualizar]);
  // Enquanto a carga roda, atualiza a cada 10 s
  useEffect(() => {
    if (!sit?.carga) return;
    const t = setInterval(atualizar, 10_000);
    return () => clearInterval(t);
  }, [sit?.carga, atualizar]);

  async function carregar() {
    setErro(null);
    try {
      await apiPostJson("/api/admin/precos/carregar", { anos });
      atualizar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  if (carregandoMe) return <div className={adminStyles.shell}><Header /><main className={adminStyles.main}><p className="mm-muted">Carregando…</p></main></div>;
  if (!me) {
    return <div className={adminStyles.shell}><Header /><main className={adminStyles.main}><h1 className={adminStyles.title}>Autenticação necessária</h1><Link to="/login">Ir ao login</Link></main></div>;
  }
  if (me.role !== "admin") return <div className={adminStyles.shell}><Header /><main className={adminStyles.main}><h1 className={adminStyles.title}>Acesso negado</h1></main></div>;

  const opcoes = Array.from({ length: 10 }, (_, i) => anoAtual - 9 + i);
  const cel: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid var(--mm-border-muted)", textAlign: "left", fontSize: 13 };
  return (
    <div className={adminStyles.shell}>
      <Header />
      <main className={adminStyles.main}>
        <h1 className={adminStyles.title}>Histórico de preços (B3)</h1>
        <p className="mm-muted">
          Fechamento de cada pregão pelo arquivo oficial e gratuito da B3 (Séries Históricas), só dos papéis que alguém da base
          tem ou já teve. O fechamento de cada dia entra sozinho a partir das 20h; aqui você carrega os anos anteriores
          (repita depois de cadastrar papéis novos — o que já existe não duplica).
        </p>
        {sit ? (
          <p>
            <b>{sit.papeis}</b> papéis · <b>{sit.linhas.toLocaleString("pt-BR")}</b> fechamentos · de {dataBr(sit.primeiraData)} a {dataBr(sit.ultimaData)}
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
          <span>Anos:</span>
          {opcoes.map((a) => (
            <label key={a} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={anos.includes(a)} onChange={(e) => setAnos((l) => (e.target.checked ? [...l, a] : l.filter((x) => x !== a)))} />
              {a}
            </label>
          ))}
          <button type="button" className="mm-btn mm-btn--primary" disabled={!!sit?.carga || !anos.length} onClick={() => void carregar()}>
            Carregar
          </button>
          <button type="button" className="mm-btn" onClick={atualizar}>Atualizar</button>
        </div>
        {sit?.carga ? (
          <p className="mm-muted">
            Carregando {sit.carga.atual ?? "…"} ({sit.carga.anos.join(", ")}). Cada ano tem ~90 MB na B3 e leva alguns minutos.
          </p>
        ) : null}
        {erro ? <p className="mm-error">{erro}</p> : null}
        {sit?.importacoes.length ? (
          <table style={{ borderCollapse: "collapse", marginTop: 8 }}>
            <thead><tr><th style={cel}>Arquivo</th><th style={cel}>Situação</th><th style={cel}>Fechamentos</th><th style={cel}>Quando</th><th style={cel}>Observação</th></tr></thead>
            <tbody>
              {sit.importacoes.map((i) => (
                <tr key={i.arquivo}>
                  <td style={cel}>{arquivoLegivel(i.arquivo)}</td>
                  <td style={{ ...cel, color: i.situacao === "erro" ? "var(--mm-danger)" : undefined }}>{ROTULO[i.situacao] ?? i.situacao}</td>
                  <td style={cel}>{i.linhas.toLocaleString("pt-BR")}</td>
                  <td style={cel}>{i.em}</td>
                  <td style={cel}>{i.mensagem ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mm-muted">Nenhuma importação ainda.</p>}
      </main>
    </div>
  );
}

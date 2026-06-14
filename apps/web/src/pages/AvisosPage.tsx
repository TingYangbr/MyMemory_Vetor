import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MeResponse } from "@mymemory/shared";
import { apiGetOptional, avisos as avisosApi } from "../api";
import Header from "../components/Header";
import styles from "./AvisosPage.module.css";

interface AvisoRow {
  id: number;
  descricao: string;
  pipe: "semantica" | "estruturada" | "hibrida";
  frequenciatipo: "horas" | "diaria" | "semanal" | "mensal";
  frequenciahoras: number | null;
  canaldestino: string;
  ultimaexecucao: string | null;
  proximaexecucao: string | null;
  status: "ativo" | "pausado";
  createdat: string;
  ultimoaviso: string | null;
}

function formatFreq(tipo: string, horas: number | null): string {
  if (tipo === "horas") return `A cada ${horas ?? "?"} hora${horas !== 1 ? "s" : ""}`;
  if (tipo === "diaria") return "Diário";
  if (tipo === "semanal") return "Semanal";
  if (tipo === "mensal") return "Mensal";
  return tipo;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function PipeLabel({ pipe }: { pipe: string }) {
  const label =
    pipe === "semantica" ? "Semântico" :
    pipe === "estruturada" ? "Estruturado" :
    pipe === "hibrida" ? "Híbrido" : pipe;
  return (
    <span className={`${styles.pipeBadge} ${styles[`pipe_${pipe}` as keyof typeof styles] ?? ""}`}>
      {label}
    </span>
  );
}

export default function AvisosPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [avisos, setAvisos] = useState<AvisoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) { navigate("/login"); return; }
      setMe(r.data);
    });
  }, [navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await avisosApi.listar();
      setAvisos(data.avisos as unknown as AvisoRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar avisos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (me) void load(); }, [me, load]);

  async function toggleStatus(aviso: AvisoRow) {
    setActingId(aviso.id);
    try {
      await avisosApi.atualizar(aviso.id, {
        status: aviso.status === "ativo" ? "pausado" : "ativo",
      });
      setAvisos((prev) =>
        prev.map((a) =>
          a.id === aviso.id
            ? { ...a, status: a.status === "ativo" ? "pausado" : "ativo" }
            : a
        )
      );
    } catch { /* silencia */ } finally {
      setActingId(null);
    }
  }

  async function excluir(id: number) {
    setActingId(id);
    try {
      await avisosApi.excluir(id);
      setAvisos((prev) => prev.filter((a) => a.id !== id));
    } catch { /* silencia */ } finally {
      setActingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className={styles.shell}>
      <Header meRefreshKey={0} />
      <main className={styles.main}>
        <div className={styles.topBar}>
          <h1 className={styles.title}>Meus Avisos</h1>
        </div>

        {loading ? (
          <p className={styles.muted}>Carregando…</p>
        ) : error ? (
          <p className="mm-error">{error}</p>
        ) : avisos.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Você ainda não tem avisos.</p>
            <p className={styles.emptyHint}>
              Faça uma pergunta ao MyMemory e ative um aviso a partir da resposta.
            </p>
            <button
              type="button"
              className="mm-btn mm-btn--primary"
              onClick={() => navigate("/?tab=perguntar")}
            >
              Fazer uma pergunta
            </button>
          </div>
        ) : (
          <ul className={styles.list}>
            {avisos.map((a) => (
              <li
                key={a.id}
                className={`${styles.item} ${a.status === "pausado" ? styles.itemPausado : ""}`}
              >
                <div className={styles.itemHeader}>
                  <PipeLabel pipe={a.pipe} />
                  <span
                    className={`${styles.statusBadge} ${a.status === "ativo" ? styles.statusAtivo : styles.statusPausado}`}
                  >
                    {a.status === "ativo" ? "Ativo" : "Pausado"}
                  </span>
                  <span className={styles.itemFreq}>
                    {formatFreq(a.frequenciatipo, a.frequenciahoras)}
                  </span>
                </div>

                <p className={styles.itemDescricao}>{a.descricao}</p>

                <div className={styles.itemMeta}>
                  <span title="E-mail de destino">📧 {a.canaldestino}</span>
                  <span>Última exec.: {formatDate(a.ultimaexecucao)}</span>
                  <span>Próxima: {formatDate(a.proximaexecucao)}</span>
                  {a.ultimoaviso ? (
                    <span>Último aviso enviado: {formatDate(a.ultimoaviso)}</span>
                  ) : null}
                </div>

                <div className={styles.itemActions}>
                  <button
                    type="button"
                    className={`mm-btn${a.status === "pausado" ? " mm-btn--primary" : ""}`}
                    disabled={actingId === a.id}
                    onClick={() => void toggleStatus(a)}
                  >
                    {actingId === a.id
                      ? "…"
                      : a.status === "ativo"
                      ? "Pausar"
                      : "Reativar"}
                  </button>

                  {confirmDeleteId === a.id ? (
                    <>
                      <button
                        type="button"
                        className={styles.deleteConfirmBtn}
                        disabled={actingId === a.id}
                        onClick={() => void excluir(a.id)}
                      >
                        {actingId === a.id ? "…" : "Confirmar exclusão"}
                      </button>
                      <button
                        type="button"
                        className="mm-btn"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => setConfirmDeleteId(a.id)}
                    >
                      Excluir
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

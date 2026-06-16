import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MeResponse } from "@mymemory/shared";
import { apiGetOptional, avisos as avisosApi } from "../api";
import Header from "../components/Header";
import styles from "./AvisosPage.module.css";

interface AvisoRow {
  id: number;
  descricao: string;
  perguntaOriginal: string;
  pipe: "semantica" | "estruturada" | "hibrida";
  frequenciaTipo: "horas" | "diaria" | "semanal" | "mensal";
  frequenciaHoras: number | null;
  canalDestino: string;
  ultimaExecucao: string | null;
  proximaExecucao: string | null;
  status: "ativo" | "pausado";
  createdAt: string;
  ultimoaviso: string | null;
}

function formatFreq(tipo: string | undefined, horas: number | null): string {
  if (tipo === "horas") return `A cada ${horas ?? "?"} hora${horas !== 1 ? "s" : ""}`;
  if (tipo === "diaria") return "Diário";
  if (tipo === "semanal") return "Semanal";
  if (tipo === "mensal") return "Mensal";
  return tipo ?? "—";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function IconRepeat() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function IconEmail() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
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
  const [modalAviso, setModalAviso] = useState<AvisoRow | null>(null);

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
      const newStatus = aviso.status === "ativo" ? "pausado" : "ativo";
      setAvisos((prev) =>
        prev.map((a) => a.id === aviso.id ? { ...a, status: newStatus } : a)
      );
      if (modalAviso?.id === aviso.id) {
        setModalAviso((prev) => prev ? { ...prev, status: newStatus } : null);
      }
    } catch { /* silencia */ } finally {
      setActingId(null);
    }
  }

  async function excluir(id: number) {
    setActingId(id);
    try {
      await avisosApi.excluir(id);
      setAvisos((prev) => prev.filter((a) => a.id !== id));
      if (modalAviso?.id === id) setModalAviso(null);
    } catch { /* silencia */ } finally {
      setActingId(null);
      setConfirmDeleteId(null);
    }
  }

  function openModal(a: AvisoRow) {
    setConfirmDeleteId(null);
    setModalAviso(a);
  }

  function closeModal() {
    setModalAviso(null);
    setConfirmDeleteId(null);
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
                  <span className={`${styles.statusBadge} ${a.status === "ativo" ? styles.statusAtivo : styles.statusPausado}`}>
                    {a.status === "ativo" ? "Ativo" : "Pausado"}
                  </span>
                </div>

                <p className={styles.itemPergunta}>{a.perguntaOriginal}</p>

                <p className={styles.itemDescricao}>{a.descricao}</p>

                <div className={styles.itemInfoRow}>
                  <span className={styles.itemInfoChip}>
                    <IconRepeat /> {formatFreq(a.frequenciaTipo, a.frequenciaHoras)}
                  </span>
                  <span className={styles.itemInfoChip}>
                    <IconEmail /> {a.canalDestino}
                  </span>
                </div>

                <button
                  type="button"
                  className={styles.itemMetaBtn}
                  onClick={() => openModal(a)}
                >
                  <IconClock />
                  <span>Ult. Verificação: {formatDate(a.ultimaExecucao)}</span>
                  {a.proximaExecucao && (
                    <>
                      <span className={styles.itemMetaSep}>·</span>
                      <span>Próxima: {formatDate(a.proximaExecucao)}</span>
                    </>
                  )}
                </button>

                <div className={styles.itemActions}>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    disabled={actingId === a.id}
                    onClick={() => void toggleStatus(a)}
                  >
                    {actingId === a.id ? "…" : a.status === "ativo" ? "Pausar" : "Reativar"}
                  </button>

                  {confirmDeleteId === a.id ? (
                    <>
                      <button
                        type="button"
                        className={styles.actionBtnDanger}
                        disabled={actingId === a.id}
                        onClick={() => void excluir(a.id)}
                      >
                        {actingId === a.id ? "…" : "Confirmar exclusão"}
                      </button>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.actionBtnDelete}
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

      {modalAviso && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalPerguntaWrap}>
              <span className={styles.modalPerguntaLabel}>Pergunta:</span>
              <p className={styles.modalPergunta}>{modalAviso.perguntaOriginal}</p>
            </div>

            <p className={styles.modalDescricao}>{modalAviso.descricao}</p>

            <div className={styles.modalInfoRow}>
              <span className={styles.modalInfoChip}>
                <IconRepeat /> {formatFreq(modalAviso.frequenciaTipo, modalAviso.frequenciaHoras)}
              </span>
              <span className={styles.modalInfoPara}>para</span>
              <span className={styles.modalInfoChip}>
                <IconEmail /> {modalAviso.canalDestino}
              </span>
            </div>

            <div className={styles.modalMeta}>
              <span className={styles.modalMetaItem}>
                <IconClock /> Ult. Verificação: {formatDate(modalAviso.ultimaExecucao)}
              </span>
              <span className={styles.modalMetaSep}>·</span>
              <span>Próxima: {formatDate(modalAviso.proximaExecucao)}</span>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalActionBtn}
                disabled={actingId === modalAviso.id}
                onClick={() => void toggleStatus(modalAviso)}
              >
                {actingId === modalAviso.id ? "…" : modalAviso.status === "ativo" ? "Pausar" : "Reativar"}
              </button>

              {confirmDeleteId === modalAviso.id ? (
                <>
                  <button
                    type="button"
                    className={styles.modalActionBtnDanger}
                    disabled={actingId === modalAviso.id}
                    onClick={() => void excluir(modalAviso.id)}
                  >
                    {actingId === modalAviso.id ? "…" : "Confirmar exclusão"}
                  </button>
                  <button
                    type="button"
                    className={styles.modalActionBtn}
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.modalActionBtnDelete}
                  onClick={() => setConfirmDeleteId(modalAviso.id)}
                >
                  Excluir
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, type FormEvent } from "react";
import type { CreateGroupInviteResponse, GroupOwnerPanelResponse } from "@mymemory/shared";
import { apiDeleteJson, apiPostJson, apiPutJson } from "../../api";
import { IconMail, IconPlus, IconX } from "../../components/icons";
import type { Matriz, MembroDoGrupo } from "./perfisApi";
import { msgPerfil } from "./perfisApi";
import { corDe, fmtData, iniciais, msgErro } from "./util";
import s from "./painel.module.css";

const PAPEL_TAG: Record<string, string> = { owner: s.tagBrand, editor: s.tagInd, viewer: s.tag };

export const LEGENDA_PAPEIS = (
  <div className={s.legend}>
    <span>
      <span className={s.tag}>viewer</span> pergunta e busca
    </span>
    <span>
      <span className={`${s.tag} ${s.tagInd}`}>editor</span> cataloga, pergunta e busca
    </span>
    <span>
      <span className={`${s.tag} ${s.tagBrand}`}>owner</span> tudo do editor + administra o grupo
    </span>
  </div>
);

interface Props {
  groupId: number;
  painel: GroupOwnerPanelResponse;
  matriz: Matriz | null;
  erroMatriz: string | null;
  recarregarPainel: () => Promise<void>;
  recarregarMatriz: () => Promise<void>;
}

export default function SecaoPessoas({ groupId, painel, matriz, erroMatriz, recarregarPainel, recarregarMatriz }: Props) {
  const [convidando, setConvidando] = useState(false);
  const [ligando, setLigando] = useState<MembroDoGrupo | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [reenviando, setReenviando] = useState<number | null>(null);

  const base = `/api/groups/${groupId}/perfis`;
  const convitesAbertos = painel.invites.filter((c) => c.status !== "accepted" && c.status !== "rejected");
  const padrao = matriz?.perfis.find((p) => p.padrao);

  async function executar(acao: () => Promise<unknown>, sucesso?: string) {
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      await acao();
      if (sucesso) setOk(sucesso);
      await recarregarMatriz();
    } catch (e) {
      setErro(msgPerfil(e));
    } finally {
      setOcupado(false);
    }
  }

  async function reenviar(id: number, email: string) {
    setReenviando(id);
    setErro(null);
    setOk(null);
    try {
      await apiPostJson<CreateGroupInviteResponse>(`/api/groups/${groupId}/invites/${id}/resend`, {});
      setOk(`Convite reenviado para ${email} (vale por mais 14 dias).`);
      await recarregarPainel();
    } catch (e) {
      setErro(msgErro(e, "Não foi possível reenviar o convite."));
    } finally {
      setReenviando(null);
    }
  }

  return (
    <>
      <div className={s.mh}>
        <h1>Pessoas</h1>
        <span className={s.sp} />
        <button type="button" className="mm-btn mm-btn--primary" onClick={() => setConvidando(true)}>
          <IconPlus /> Convidar pessoa
        </button>
      </div>
      <p className={s.sub}>Quem participa do grupo, o papel de cada um, o perfil de acesso e o usuário de cada pessoa no ERP.</p>

      {ok ? <p className={s.msgOk}>{ok}</p> : null}
      {erro ? <p className={s.msgErr}>{erro}</p> : null}
      {erroMatriz ? <p className={s.msgErr}>{erroMatriz}</p> : null}

      <div className={s.card}>
        <div className={s.tblWrap}>
          <table className={s.tbl}>
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Papel</th>
                <th>Perfil de acesso</th>
                <th>Usuário no ERP</th>
              </tr>
            </thead>
            <tbody>
              {!matriz && !erroMatriz ? (
                <tr>
                  <td colSpan={4} className="mm-muted">
                    Carregando…
                  </td>
                </tr>
              ) : null}
              {matriz?.membros.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <div className={s.who}>
                      <span className={s.whoAv} style={{ background: corDe(m.userId) }}>
                        {iniciais(m.nome, m.email)}
                      </span>
                      <div>
                        <span className={s.whoName}>{m.nome ?? m.email ?? `#${m.userId}`}</span>
                        <span className={s.whoSub}>{m.email ?? ""}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`${s.tag} ${PAPEL_TAG[m.role] ?? ""}`}>{m.role}</span>
                  </td>
                  <td>
                    <select
                      className={`mm-field ${s.selectSm}`}
                      value={m.perfilId ?? ""}
                      disabled={ocupado}
                      aria-label={`Perfil de acesso de ${m.nome ?? m.email}`}
                      onChange={(e) =>
                        void executar(
                          () => apiPutJson(`${base}/membros/${m.userId}`, { perfilId: e.target.value === "" ? null : Number(e.target.value) }),
                          "Perfil alterado."
                        )
                      }
                    >
                      <option value="">{padrao && padrao.nome !== "Padrão" ? `Padrão (${padrao.nome})` : "Padrão"}</option>
                      {matriz.perfis.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className={s.row}>
                      {m.identidades.map((i) => (
                        <span key={i.id} className={s.chip} title={`${i.sistema}${i.banco ? ` / ${i.banco}` : ""}`} style={{ paddingLeft: 8 }}>
                          <span className={s.code}>{i.idExterno}</span>
                          <button
                            type="button"
                            className={`${s.iconBtn} ${s.iconBtnDanger}`}
                            title="Desligar do ERP"
                            disabled={ocupado}
                            onClick={() => {
                              if (window.confirm(`Desligar ${m.nome ?? m.email} do usuário "${i.idExterno}" no ERP?`)) {
                                void executar(() => apiDeleteJson(`${base}/identidades/${i.id}`), "Ligação removida.");
                              }
                            }}
                          >
                            <IconX size={12} />
                          </button>
                        </span>
                      ))}
                      {m.identidades.length === 0 ? (
                        <button type="button" className={`mm-btn ${s.btnSm}`} onClick={() => setLigando(m)}>
                          Ligar ao ERP
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {convitesAbertos.map((c) => {
                const venceu = c.status === "expired" || new Date(c.expiresAt).getTime() < Date.now();
                return (
                  <tr key={`c${c.id}`}>
                    <td>
                      <div className={s.who}>
                        <span className={s.whoAv} style={{ background: "#94a3b8" }}>
                          <IconMail size={14} />
                        </span>
                        <div>
                          <span className={s.whoName}>{c.email}</span>
                          <span className={s.whoSub}>
                            Convite enviado em {fmtData(c.createdAt)}
                            {venceu ? <span style={{ color: "var(--mm-warning)" }}> · venceu</span> : null}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`${s.tag} ${s.tagWarn}`}>convite {c.role}</span>
                    </td>
                    <td className="mm-muted">Padrão</td>
                    <td>
                      <button
                        type="button"
                        className={`mm-btn ${s.btnSm}`}
                        disabled={reenviando === c.id}
                        onClick={() => void reenviar(c.id, c.email)}
                      >
                        {reenviando === c.id ? "Reenviando…" : "Reenviar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {LEGENDA_PAPEIS}
      </div>
      {matriz?.config.maxMembers != null ? (
        <p className={s.help} style={{ marginTop: 8 }}>
          {matriz.config.totalMembros} de {matriz.config.maxMembers} pessoas do plano.
        </p>
      ) : null}

      {convidando ? (
        <ConviteModal
          groupId={groupId}
          onFechar={() => setConvidando(false)}
          onEnviado={async (msg) => {
            setConvidando(false);
            setOk(msg);
            setErro(null);
            await recarregarPainel();
          }}
        />
      ) : null}

      {ligando ? (
        <LigarErpModal
          membro={ligando}
          onFechar={() => setLigando(null)}
          onLigar={async (form) => {
            await apiPutJson(`${base}/identidades`, { ...form, userId: ligando.userId });
            setLigando(null);
            setOk("Ligação com o ERP gravada.");
            await recarregarMatriz();
          }}
        />
      ) : null}
    </>
  );
}

function ConviteModal({ groupId, onFechar, onEnviado }: { groupId: number; onFechar: () => void; onEnviado: (msg: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    try {
      const res = await apiPostJson<CreateGroupInviteResponse>(`/api/groups/${groupId}/invites`, { email: email.trim(), role });
      const destino = email.trim();
      const msg = res.emailSendFailed
        ? res.message ?? "Convite registrado; confira o envio do e-mail."
        : res.temConta
          ? `Convite enviado. ${destino} já tem conta e vai receber o convite para entrar e aceitar.`
          : `Convite enviado. ${destino} ainda não tem conta e vai receber as instruções para criar a conta e aceitar.`;
      await onEnviado(msg);
    } catch (err) {
      setErro(msgErro(err, "Não foi possível enviar o convite."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <form className={`mm-modal ${s.modal}`} role="dialog" aria-modal="true" aria-labelledby="conv-tit" onSubmit={enviar}>
        <div className={s.modalHead}>
          <h2 id="conv-tit">Convidar pessoa</h2>
          <span className={s.sp} />
          <button type="button" className={s.iconBtn} onClick={onFechar} aria-label="Fechar">
            <IconX />
          </button>
        </div>
        <label className={s.fieldLabel} htmlFor="conv-email">
          E-mail
        </label>
        <input id="conv-email" type="email" required className="mm-field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com.br" />
        <label className={s.fieldLabel} htmlFor="conv-role">
          Papel no grupo
        </label>
        <select id="conv-role" className="mm-field" value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
          <option value="viewer">viewer: pergunta e busca</option>
          <option value="editor">editor: cataloga, pergunta e busca</option>
        </select>
        <p className={s.help}>O convite vale por 14 dias. A pessoa recebe um e-mail para aceitar.</p>
        {erro ? <p className={s.msgErr}>{erro}</p> : null}
        <div className={s.actions}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar}>
            Cancelar
          </button>
          <button type="submit" className="mm-btn mm-btn--primary" disabled={busy || !email.trim()}>
            {busy ? "Enviando…" : "Enviar convite"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LigarErpModal({
  membro,
  onFechar,
  onLigar,
}: {
  membro: MembroDoGrupo;
  onFechar: () => void;
  onLigar: (form: { sistema: string; banco: string; idExterno: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ sistema: "softing-erp", banco: "", idExterno: "" });
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    try {
      await onLigar({ sistema: form.sistema.trim(), banco: form.banco.trim(), idExterno: form.idExterno.trim() });
    } catch (err) {
      setErro(msgPerfil(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <form className={`mm-modal ${s.modal}`} role="dialog" aria-modal="true" aria-labelledby="erp-tit" onSubmit={salvar}>
        <div className={s.modalHead}>
          <h2 id="erp-tit">Ligar {membro.nome ?? membro.email} ao ERP</h2>
          <span className={s.sp} />
          <button type="button" className={s.iconBtn} onClick={onFechar} aria-label="Fechar">
            <IconX />
          </button>
        </div>
        <label className={s.fieldLabel} htmlFor="erp-id">
          Usuário no ERP
        </label>
        <input
          id="erp-id"
          className="mm-field"
          required
          value={form.idExterno}
          onChange={(e) => setForm({ ...form, idExterno: e.target.value })}
          placeholder="usuário com que a pessoa entra no ERP"
        />
        <p className={s.help}>No Softing-erp: o NOME do usuário (AGUSUAR.NOME), não o código interno.</p>
        <details style={{ marginTop: 10 }}>
          <summary className={s.help} style={{ cursor: "pointer" }}>
            Opções avançadas
          </summary>
          <div className={s.grid2}>
            <div>
              <label className={s.fieldLabel} htmlFor="erp-sis">
                Sistema
              </label>
              <input id="erp-sis" className="mm-field" value={form.sistema} onChange={(e) => setForm({ ...form, sistema: e.target.value })} />
            </div>
            <div>
              <label className={s.fieldLabel} htmlFor="erp-banco">
                Banco (opcional)
              </label>
              <input id="erp-banco" className="mm-field" value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} />
            </div>
          </div>
        </details>
        {erro ? <p className={s.msgErr}>{erro}</p> : null}
        <div className={s.actions}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onFechar}>
            Cancelar
          </button>
          <button type="submit" className="mm-btn mm-btn--primary" disabled={busy || !form.idExterno.trim() || !form.sistema.trim()}>
            {busy ? "Gravando…" : "Ligar"}
          </button>
        </div>
      </form>
    </div>
  );
}

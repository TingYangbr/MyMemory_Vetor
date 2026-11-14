import { useCallback, useEffect, useState } from "react";
import type { DbConnection, DbConnectionTestResult } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPostJson, apiPutJson } from "../../api";
import { IconEdit, IconPlug, IconPlus, IconX } from "../../components/icons";
import { msgErro } from "./util";
import s from "./painel.module.css";

type Form = Partial<DbConnection> & { password: string };

const vazio = (): Form => ({
  nome: "",
  descricao: null,
  host: "",
  port: 1433,
  database: "",
  username: "",
  password: "",
  encrypt: 0,
  trustServerCertificate: 1,
  isPrincipal: 0,
});

/** Ligação com o ERP: as conexões de banco do grupo. Os dados de conexão ficam só aqui. */
export default function SecaoErp({ groupId }: { groupId: number }) {
  const [conns, setConns] = useState<DbConnection[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | "nova" | null>(null);
  const [form, setForm] = useState<Form>(vazio());
  const [salvando, setSalvando] = useState(false);
  const [testes, setTestes] = useState<Record<number, DbConnectionTestResult | "testando">>({});

  const base = `/api/groups/${groupId}/db-connections`;

  const carregar = useCallback(async () => {
    try {
      const r = await apiGet<{ connections: DbConnection[] }>(base);
      setConns(r.connections);
    } catch (e) {
      setErro(msgErro(e, "Falha ao carregar as conexões."));
    }
  }, [base]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function testar(id: number) {
    setTestes((t) => ({ ...t, [id]: "testando" }));
    try {
      const r = await apiPostJson<DbConnectionTestResult>(`${base}/${id}/test`, {});
      setTestes((t) => ({ ...t, [id]: r }));
    } catch (e) {
      setTestes((t) => ({ ...t, [id]: { ok: false, message: msgErro(e) } }));
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setOk(null);
    try {
      const corpo = {
        nome: form.nome ?? "",
        descricao: form.descricao ?? null,
        host: form.host ?? "",
        port: form.port ?? 1433,
        database: form.database ?? "",
        username: form.username ?? "",
        encrypt: form.encrypt ?? 0,
        trustServerCertificate: form.trustServerCertificate ?? 1,
        isPrincipal: form.isPrincipal ?? 0,
      };
      if (editando === "nova") {
        await apiPostJson(base, { ...corpo, password: form.password });
      } else if (typeof editando === "number") {
        await apiPutJson(`${base}/${editando}`, { ...corpo, ...(form.password ? { password: form.password } : {}) });
      }
      setOk("Conexão salva.");
      setEditando(null);
      setForm(vazio());
      await carregar();
    } catch (e) {
      setErro(msgErro(e, "Erro ao salvar."));
    } finally {
      setSalvando(false);
    }
  }

  async function desativar(c: DbConnection) {
    if (!window.confirm(`Desativar a conexão "${c.nome}"? As queries que usam esta conexão param de responder.`)) return;
    try {
      await apiDeleteJson(`${base}/${c.id}`);
      setEditando(null);
      setOk(`Conexão "${c.nome}" desativada.`);
      await carregar();
    } catch (e) {
      setErro(msgErro(e, "Erro ao desativar."));
    }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valido =
    !!form.nome?.trim() && !!form.host?.trim() && !!form.database?.trim() && !!form.username?.trim() && (editando !== "nova" || !!form.password);

  const formulario = (
    <div className={s.card} style={{ padding: "14px 16px", marginTop: 14, maxWidth: 680 }}>
      <div className={s.modalHead} style={{ marginBottom: 0 }}>
        <h2>{editando === "nova" ? "Nova conexão" : `Editar ${form.nome ?? "conexão"}`}</h2>
        <span className={s.sp} />
        <button type="button" className={s.iconBtn} aria-label="Fechar" onClick={() => setEditando(null)}>
          <IconX />
        </button>
      </div>
      <div className={s.grid2}>
        <div>
          <label className={s.fieldLabel} htmlFor="cx-nome">
            Nome
          </label>
          <input id="cx-nome" className="mm-field" value={form.nome ?? ""} placeholder="ex.: ERP principal" onChange={(e) => set("nome", e.target.value)} />
        </div>
        <div>
          <label className={s.fieldLabel} htmlFor="cx-host">
            Servidor
          </label>
          <input id="cx-host" className="mm-field" value={form.host ?? ""} placeholder="servidor.empresa.com.br" onChange={(e) => set("host", e.target.value)} />
        </div>
        <div>
          <label className={s.fieldLabel} htmlFor="cx-db">
            Banco de dados
          </label>
          <input id="cx-db" className="mm-field" value={form.database ?? ""} placeholder="NomeDoBanco" onChange={(e) => set("database", e.target.value)} />
        </div>
        <div>
          <label className={s.fieldLabel} htmlFor="cx-user">
            Usuário
          </label>
          <input id="cx-user" className="mm-field" value={form.username ?? ""} onChange={(e) => set("username", e.target.value)} />
        </div>
        <div>
          <label className={s.fieldLabel} htmlFor="cx-pass">
            {editando === "nova" ? "Senha" : "Senha (vazio = manter a atual)"}
          </label>
          <input id="cx-pass" className="mm-field" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
        </div>
        <div>
          <label className={s.fieldLabel} htmlFor="cx-desc">
            Descrição (opcional)
          </label>
          <input id="cx-desc" className="mm-field" value={form.descricao ?? ""} onChange={(e) => set("descricao", e.target.value || null)} />
        </div>
      </div>
      <label className={s.row} style={{ marginTop: 12, fontSize: 13.5 }}>
        <input type="checkbox" checked={form.isPrincipal === 1} onChange={(e) => set("isPrincipal", e.target.checked ? 1 : 0)} />
        Conexão principal do grupo (usada para achar nomes de clientes e produtos)
      </label>
      <details style={{ marginTop: 10 }}>
        <summary className={s.help} style={{ cursor: "pointer" }}>
          Opções avançadas (porta, criptografia, certificado)
        </summary>
        <div className={s.row} style={{ marginTop: 8, gap: 16 }}>
          <label className={s.row}>
            Porta
            <input className={`mm-field ${s.selectSm}`} style={{ minWidth: 0, width: 90 }} type="number" value={form.port ?? 1433} onChange={(e) => set("port", Number(e.target.value))} />
          </label>
          <label className={s.row}>
            <input type="checkbox" checked={form.encrypt === 1} onChange={(e) => set("encrypt", e.target.checked ? 1 : 0)} />
            Criptografar
          </label>
          <label className={s.row}>
            <input type="checkbox" checked={form.trustServerCertificate === 1} onChange={(e) => set("trustServerCertificate", e.target.checked ? 1 : 0)} />
            Confiar no certificado
          </label>
        </div>
      </details>
      <div className={s.actions} style={{ justifyContent: "space-between" }}>
        {typeof editando === "number" ? (
          <button type="button" className="mm-btn mm-btn--ghost" style={{ color: "var(--mm-danger)" }} onClick={() => conns && void desativar(conns.find((c) => c.id === editando)!)}>
            Desativar conexão
          </button>
        ) : (
          <span />
        )}
        <div className={s.row}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setEditando(null)}>
            Cancelar
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={salvando || !valido} onClick={() => void salvar()}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className={s.mh}>
        <h1>Ligação com o ERP</h1>
        <span className={s.sp} />
        <button
          type="button"
          className="mm-btn mm-btn--primary"
          onClick={() => {
            setForm(vazio());
            setEditando("nova");
            setOk(null);
          }}
        >
          <IconPlus /> Nova conexão
        </button>
      </div>
      <p className={s.sub}>
        Bancos de dados do ERP que o proMemory consulta para responder perguntas. A senha fica guardada cifrada e não aparece de novo. As queries de
        cada categoria só escolhem a conexão pelo nome.
      </p>
      {ok ? <p className={s.msgOk}>{ok}</p> : null}
      {erro ? <p className={s.msgErr}>{erro}</p> : null}

      <div className={s.card}>
        {conns == null ? <p className="mm-muted" style={{ padding: 16 }}>Carregando…</p> : null}
        {conns?.length === 0 ? <p className="mm-muted" style={{ padding: 16 }}>Nenhuma conexão neste grupo ainda.</p> : null}
        {conns?.map((c) => {
          const t = testes[c.id];
          const estado = t === "testando" ? "testando…" : t ? (t.ok ? `funcionando${t.latencyMs != null ? ` (${t.latencyMs} ms)` : ""}` : `com erro: ${t.message}`) : "clique em Testar para conferir";
          return (
            <div key={c.id} className={s.conn}>
              <span className={`${s.dot} ${t && t !== "testando" ? (t.ok ? s.dotOk : s.dotErr) : ""}`} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>
                  {c.nome} {c.isPrincipal === 1 ? <span className={`${s.tag} ${s.tagBrand}`}>principal</span> : null}
                </b>
                <div className="mm-muted" style={{ fontSize: 12.5 }}>
                  banco {c.database} · {estado}
                </div>
              </div>
              <div className={s.row}>
                <button type="button" className={`mm-btn ${s.btnSm}`} disabled={t === "testando"} onClick={() => void testar(c.id)}>
                  <IconPlug size={13} /> Testar
                </button>
                <button
                  type="button"
                  className={`mm-btn ${s.btnSm}`}
                  onClick={() => {
                    setForm({ ...c, password: "" });
                    setEditando(c.id);
                    setOk(null);
                  }}
                >
                  <IconEdit size={13} /> Editar
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {editando != null ? formulario : null}
    </>
  );
}

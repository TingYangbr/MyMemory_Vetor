import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { GroupOwnerPanelResponse, MeResponse } from "@mymemory/shared";
import { apiGet } from "../../api";
import Header from "../../components/Header";
import { IconDatabase, IconSearch, IconSettings, IconShield, IconTag, IconUsers } from "../../components/icons";
import GrupoSeletor, { guardarRecente } from "./GrupoSeletor";
import { usePerfisMatriz } from "./perfisApi";
import SecaoCategorias from "./SecaoCategorias";
import SecaoConfig from "./SecaoConfig";
import SecaoConsulta from "./SecaoConsulta";
import SecaoErp from "./SecaoErp";
import SecaoPerfis from "./SecaoPerfis";
import SecaoPessoas from "./SecaoPessoas";
import { msgErro, SECOES, type Secao } from "./util";
import s from "./painel.module.css";

const ICONES: Record<Secao, ReactNode> = {
  pessoas: <IconUsers />,
  categorias: <IconTag />,
  consulta: <IconSearch />,
  perfis: <IconShield />,
  erp: <IconDatabase />,
  config: <IconSettings />,
};

/**
 * Novo painel do grupo: um menu lateral com Pessoas, Categorias, Consulta de memos, Perfis de acesso,
 * Ligação com o ERP e Configurações. Substitui o painel antigo
 * (/grupo/:id/painel) e a página Estrutura contextual (/estrutura-memo), que agora redirecionam para cá.
 * `/grupo/globais/admin` = categorias globais (só administrador do sistema).
 */
export default function PainelGrupoPage() {
  const { groupId: param } = useParams<{ groupId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const global = param === "globais";
  const groupId = useMemo(() => {
    if (global) return null;
    const n = Number(param);
    return Number.isInteger(n) && n > 0 ? n : NaN;
  }, [param, global]);

  const secaoParam = searchParams.get("secao") as Secao | null;
  const secao: Secao = global ? "categorias" : SECOES.some((x) => x.id === secaoParam) ? (secaoParam as Secao) : "pessoas";
  const irPara = (id: Secao) => {
    const p = new URLSearchParams(searchParams);
    p.set("secao", id);
    p.delete("categoria");
    setSearchParams(p, { replace: true });
  };

  const [me, setMe] = useState<MeResponse | null>(null);
  const [painel, setPainel] = useState<GroupOwnerPanelResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [totalCategorias, setTotalCategorias] = useState<number | null>(null);
  const isAdmin = me?.role === "admin";

  const { matriz, erro: erroMatriz, recarregar: recarregarMatriz } = usePerfisMatriz(
    typeof groupId === "number" && !Number.isNaN(groupId) ? groupId : null
  );

  useEffect(() => {
    apiGet<MeResponse>("/api/me").then(setMe).catch(() => setMe(null));
  }, []);

  const carregarPainel = useCallback(async () => {
    if (groupId == null || Number.isNaN(groupId)) return;
    try {
      const p = await apiGet<GroupOwnerPanelResponse>(`/api/groups/${groupId}/owner-panel`);
      setPainel(p);
      setErro(null);
      guardarRecente({ id: p.group.id, name: p.group.name });
    } catch (e) {
      setPainel(null);
      setErro(msgErro(e, "Não foi possível abrir este grupo."));
    }
  }, [groupId]);

  useEffect(() => {
    setPainel(null);
    setTotalCategorias(null);
    void carregarPainel();
  }, [carregarPainel]);

  const trocarGrupo = (id: number | null) => {
    const destino = id == null ? "globais" : String(id);
    navigate(`/grupo/${destino}/admin?secao=${id == null ? "categorias" : secao}`);
  };

  const invalido = !global && Number.isNaN(groupId);
  const nomeGrupo = global ? "Categorias globais" : painel?.group.name ?? (erro ? `Grupo #${param}` : "Carregando…");
  const pessoas = matriz?.membros.length ?? null;
  const sub = global
    ? "valem para todos os grupos"
    : matriz
      ? `${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}`
      : isAdmin
        ? "administrador"
        : "você é dono";

  const contagem: Partial<Record<Secao, number | null>> = {
    pessoas,
    categorias: totalCategorias,
    perfis: matriz?.perfis.length ?? null,
  };

  let conteudo: ReactNode;
  if (invalido) {
    conteudo = <p className={s.msgErr}>Grupo inválido.</p>;
  } else if (global) {
    conteudo = isAdmin ? (
      <SecaoCategorias groupId={null} isAdmin onTotal={setTotalCategorias} />
    ) : (
      <p className="mm-muted">{me ? "Só o administrador do sistema edita as categorias globais." : "Carregando…"}</p>
    );
  } else if (erro) {
    conteudo = <p className={s.msgErr}>{erro}</p>;
  } else if (!painel) {
    conteudo = <p className="mm-muted">Carregando…</p>;
  } else {
    const gid = painel.group.id;
    conteudo = (
      <>
        {secao === "pessoas" ? (
          <SecaoPessoas groupId={gid} painel={painel} matriz={matriz} erroMatriz={erroMatriz} recarregarPainel={carregarPainel} recarregarMatriz={recarregarMatriz} />
        ) : null}
        {secao === "categorias" ? <SecaoCategorias groupId={gid} isAdmin={isAdmin} onTotal={setTotalCategorias} /> : null}
        {secao === "consulta" ? <SecaoConsulta groupId={gid} /> : null}
        {secao === "perfis" ? <SecaoPerfis groupId={gid} matriz={matriz} erroMatriz={erroMatriz} recarregar={recarregarMatriz} /> : null}
        {secao === "erp" ? <SecaoErp groupId={gid} /> : null}
        {secao === "config" ? (
          <SecaoConfig groupId={gid} painel={painel} setPainel={setPainel} matriz={matriz} recarregarMatriz={recarregarMatriz} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <Header />
      <div className={s.layout}>
        <aside className={s.side}>
          <GrupoSeletor grupoId={global ? null : painel?.group.id ?? (Number.isNaN(groupId) ? -1 : (groupId as number))} grupoNome={nomeGrupo} sub={sub} onEscolher={trocarGrupo} />
          {global ? null : (
            <nav className={s.nav} aria-label="Seções do painel">
              {SECOES.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={`${s.navItem} ${secao === x.id ? s.navItemOn : ""}`}
                  aria-current={secao === x.id ? "page" : undefined}
                  onClick={() => irPara(x.id)}
                >
                  {ICONES[x.id]}
                  {x.nome}
                  {contagem[x.id] != null ? <span className={s.navCount}>{contagem[x.id]}</span> : null}
                </button>
              ))}
            </nav>
          )}
        </aside>
        <main className={s.main}>{conteudo}</main>
      </div>
    </>
  );
}

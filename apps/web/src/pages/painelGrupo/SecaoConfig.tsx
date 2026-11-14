import { useEffect, useState } from "react";
import type { GroupOwnerPanelResponse, PatchGroupOwnerSettingsResponse } from "@mymemory/shared";
import { apiGet, apiPatchJson, apiPostJson } from "../../api";
import type { Matriz } from "./perfisApi";
import { msgPerfil } from "./perfisApi";
import { msgErro } from "./util";
import s from "./painel.module.css";

interface Props {
  groupId: number;
  painel: GroupOwnerPanelResponse;
  setPainel: (p: GroupOwnerPanelResponse) => void;
  matriz: Matriz | null;
  recarregarMatriz: () => Promise<void>;
}

/** Todas as chaves do grupo num lugar só. Cada chave salva sozinha ao mudar. */
export default function SecaoConfig({ groupId, painel, setPainel, matriz, recarregarMatriz }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semAssunto, setSemAssunto] = useState<number | null>(null);
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    apiGet<{ semTitulo: number }>(`/api/groups/${groupId}/titulos-curtos`)
      .then((r) => setSemAssunto(r.semTitulo))
      .catch(() => setSemAssunto(null));
  }, [groupId]);

  async function rodar(acao: () => Promise<void>, sucesso: string) {
    setOcupado(true);
    setOk(null);
    setErro(null);
    try {
      await acao();
      setOk(sucesso);
    } catch (e) {
      setErro(msgPerfil(e));
    } finally {
      setOcupado(false);
    }
  }

  function mudarPerfis(campo: "perfisAtivos" | "exigirCadastro", valor: boolean) {
    if (valor && campo === "perfisAtivos" && !window.confirm("Passar a aplicar os perfis nas perguntas deste grupo? Perfis com todas as categorias continuam sem restrição.")) return;
    if (valor && campo === "exigirCadastro" && !window.confirm("Recusar perguntas ao ERP de quem não tem usuário do ERP ligado? Ligue as pessoas antes, em Pessoas, ou elas ficam sem resposta do ERP.")) return;
    void rodar(async () => {
      await apiPatchJson(`/api/groups/${groupId}/perfis/config`, { [campo]: valor });
      await recarregarMatriz();
    }, "Salvo.");
  }

  function mudarLivres(valor: boolean) {
    void rodar(async () => {
      const r = await apiPatchJson<PatchGroupOwnerSettingsResponse>(`/api/groups/${groupId}/owner-settings`, {
        allowFreeSpecificFieldsWithoutCategoryMatch: valor,
      });
      setPainel({ ...painel, group: r.group });
    }, "Salvo.");
  }

  async function gerarAssuntos() {
    setGerando(true);
    setOk(null);
    setErro(null);
    try {
      const r = await apiPostJson<{ gerados: number; vazios: number; erros: number; restantes: number }>(`/api/groups/${groupId}/titulos-curtos/gerar`, {
        limite: 50,
      });
      setSemAssunto(r.restantes);
      const partes = [`Pronto: ${r.gerados} memo(s) ganharam assunto.`];
      if (r.vazios) partes.push(`${r.vazios} não têm texto para resumir.`);
      if (r.erros) partes.push(`${r.erros} deram erro e serão tentados no próximo clique.`);
      partes.push(r.restantes ? `Ainda faltam ${r.restantes}.` : "Todos os memos já têm assunto.");
      setOk(partes.join(" "));
    } catch (e) {
      setErro(msgErro(e, "Falha ao gerar assuntos."));
    } finally {
      setGerando(false);
    }
  }

  const chave = (id: string, checked: boolean | undefined, onChange: (v: boolean) => void) => (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className={`${s.switch} ${s.switchRight}`}
      checked={!!checked}
      disabled={ocupado || checked === undefined}
      onChange={(e) => onChange(e.target.checked)}
    />
  );

  return (
    <>
      <div className={s.mh}>
        <h1>Configurações</h1>
      </div>
      <p className={s.sub}>Cada chave salva sozinha ao mudar.</p>
      {ok ? <p className={s.msgOk}>{ok}</p> : null}
      {erro ? <p className={s.msgErr}>{erro}</p> : null}

      <div className={s.card}>
        <div className={s.switchRow}>
          <label htmlFor="cf-perfis" style={{ cursor: "pointer" }}>
            <b>Usar os perfis de acesso nas perguntas</b>
            <p>Desligado: todo mundo pergunta sobre tudo do grupo.</p>
          </label>
          {chave("cf-perfis", matriz?.config.perfisAtivos, (v) => mudarPerfis("perfisAtivos", v))}
        </div>
        <div className={s.switchRow}>
          <label htmlFor="cf-exigir" style={{ cursor: "pointer" }}>
            <b>Só pergunta ao ERP quem tem usuário do ERP ligado</b>
            <p>Ligue depois de ligar as pessoas em Pessoas, senão elas ficam sem resposta do ERP.</p>
          </label>
          {chave("cf-exigir", matriz?.config.exigirCadastro, (v) => mudarPerfis("exigirCadastro", v))}
        </div>
        <div className={s.switchRow}>
          <label htmlFor="cf-livres" style={{ cursor: "pointer" }}>
            <b>Extrair campos mesmo sem categoria</b>
            <p>A IA pode guardar dados de um memo que não combinou com nenhuma categoria.</p>
          </label>
          {chave("cf-livres", painel.group.allowFreeSpecificFieldsWithoutCategoryMatch, mudarLivres)}
        </div>
        <div className={s.switchRow}>
          <div>
            <b>Assunto dos memos</b>
            <p>
              {semAssunto == null
                ? "Gera o assunto dos memos antigos em lotes de 50 (usa créditos de IA)."
                : semAssunto === 0
                  ? "Todos os memos já têm assunto."
                  : `${semAssunto} memo(s) ainda sem assunto. Gera em lotes de 50 (usa créditos de IA).`}
            </p>
          </div>
          <button type="button" className={`mm-btn ${s.switchRight}`} disabled={gerando || semAssunto === 0} onClick={() => void gerarAssuntos()}>
            {gerando ? "Gerando…" : "Gerar assuntos"}
          </button>
        </div>
      </div>
    </>
  );
}

import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "./Header";
import { EmbutidoNoAdmin } from "./adminContexto";
import styles from "./AdminLayout.module.css";

/**
 * Moldura do Admin do sistema (lote 5 do redesenho): cabeçalho do app + menu lateral com 6 grupos.
 * As telas de admin seguem chamando <Header />; dentro da moldura ele não se repete (EmbutidoNoAdmin).
 */

type Item = { rotulo: string; to: string };
type Grupo = { nome: string; itens: Item[] };

export const GRUPOS_ADMIN: Grupo[] = [
  {
    nome: "Clientes e planos",
    itens: [
      { rotulo: "Planos de assinatura", to: "/admin/planos" },
      { rotulo: "Assinaturas e grupos", to: "/admin/assinaturas" },
      { rotulo: "Convites de usuários", to: "/admin/convites" },
      { rotulo: "Storage por grupo", to: "/admin/storage" },
      { rotulo: "Mídia por plano", to: "/admin/midia" },
    ],
  },
  {
    nome: "Inteligência artificial",
    itens: [
      { rotulo: "Provedores de IA", to: "/admin/ia" },
      { rotulo: "Prompts", to: "/admin/prompts" },
      { rotulo: "Último prompt", to: "/admin/llm-prompt" },
      { rotulo: "Roteamento de documentos", to: "/admin/documento-ia" },
      { rotulo: "CAD/BIM", to: "/admin/cad-pipeline" },
    ],
  },
  {
    nome: "Conteúdo",
    itens: [
      { rotulo: "Categorias globais", to: "/grupo/globais/admin?secao=categorias" },
      { rotulo: "Importar conhecimento", to: "/admin/conhecimento" },
      { rotulo: "Consulta de memos", to: "/admin/consulta" },
      { rotulo: "Eliminação definitiva", to: "/admin/eliminacao" },
    ],
  },
  {
    nome: "Integrações",
    itens: [
      { rotulo: "Conexões de banco", to: "/admin/conexoes" },
      { rotulo: "Perfis de acesso", to: "/admin/perfis" },
    ],
  },
  {
    nome: "Custos e saúde",
    itens: [
      { rotulo: "Relatório de custos", to: "/admin/custos" },
      { rotulo: "Chamadas de IA", to: "/admin/chamadas-ia" },
      { rotulo: "Verificação do sistema", to: "/admin/verificacao" },
    ],
  },
  {
    nome: "Sistema",
    itens: [{ rotulo: "Configurações", to: "/admin/system-config" }],
  },
];

/** Grupo e rótulo do item de um caminho (para o título da tela). */
export function itemDoCaminho(pathname: string): { grupo: string; rotulo: string } | null {
  for (const g of GRUPOS_ADMIN) {
    const it = g.itens.find((i) => i.to === pathname);
    if (it) return { grupo: g.nome, rotulo: it.rotulo };
  }
  return null;
}

/** Largura do menu (arrastar a borda) e menu recolhido: guardados neste navegador. */
const CHAVE_LARGURA = "mm.admin.larguraMenu";
const CHAVE_RECOLHIDO = "mm.admin.menuRecolhido";
const LARGURA_PADRAO = 250;
const LARGURA_MIN = 190;
const LARGURA_MAX = 440;

function lerNumero(chave: string): number | null {
  try {
    const v = Number(localStorage.getItem(chave));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string | null) {
  try {
    if (valor == null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    /* sem localStorage: vale só nesta tela */
  }
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [largura, setLargura] = useState<number>(() => lerNumero(CHAVE_LARGURA) ?? LARGURA_PADRAO);
  const [recolhido, setRecolhido] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAVE_RECOLHIDO) === "1";
    } catch {
      return false;
    }
  });

  function alternarMenu() {
    setRecolhido((r) => {
      gravar(CHAVE_RECOLHIDO, r ? null : "1");
      return !r;
    });
  }

  function arrastar(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = largura;
    const limitar = (x: number) => Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, w0 + (x - x0)));
    const mover = (ev: PointerEvent) => setLargura(limitar(ev.clientX));
    const soltar = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const w = limitar(ev.clientX);
      setLargura(w);
      gravar(CHAVE_LARGURA, String(Math.round(w)));
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  function larguraPadrao() {
    setLargura(LARGURA_PADRAO);
    gravar(CHAVE_LARGURA, null);
  }

  if (recolhido) {
    return (
      <div className={styles.shell}>
        <Header />
        <div className={styles.corpo}>
          <div className={styles.menuRecolhido}>
            <button type="button" className={styles.botaoMenu} onClick={alternarMenu} aria-label="Abrir o menu da administração" title="Abrir o menu">
              »
            </button>
          </div>
          <div className={styles.conteudo}>
            <EmbutidoNoAdmin.Provider value={true}>{children}</EmbutidoNoAdmin.Provider>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Header />
      <div className={styles.corpo}>
        <nav className={styles.menu} aria-label="Administração do sistema" style={{ flexBasis: `${Math.round(largura)}px` }}>
          <div
            className={styles.alca}
            role="separator"
            aria-orientation="vertical"
            aria-label="Largura do menu"
            title="Arraste para mudar a largura. Clique duas vezes para voltar ao padrão."
            onPointerDown={arrastar}
            onDoubleClick={larguraPadrao}
          />
          <div className={styles.menuTopo}>
            <div className={styles.selo}>Admin do sistema</div>
            <button type="button" className={styles.botaoMenu} onClick={alternarMenu} aria-label="Recolher o menu da administração" title="Recolher o menu">
              «
            </button>
          </div>
          <Link to="/admin" className={`${styles.item} ${pathname === "/admin" ? styles.ativo : ""}`} aria-current={pathname === "/admin" ? "page" : undefined}>
            Início
          </Link>
          {GRUPOS_ADMIN.map((g) => {
            const aberto = g.itens.some((i) => i.to === pathname);
            return (
              <details key={g.nome} className={styles.grupo} open={aberto || undefined}>
                <summary className={`${styles.grupoNome} ${aberto ? styles.grupoAberto : ""}`}>{g.nome}</summary>
                {g.itens.map((i) => (
                  <Link
                    key={i.to}
                    to={i.to}
                    className={`${styles.item} ${i.to === pathname ? styles.ativo : ""}`}
                    aria-current={i.to === pathname ? "page" : undefined}
                  >
                    {i.rotulo}
                  </Link>
                ))}
              </details>
            );
          })}
        </nav>
        <div className={styles.conteudo}>
          <EmbutidoNoAdmin.Provider value={true}>{children}</EmbutidoNoAdmin.Provider>
        </div>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
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

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className={styles.shell}>
      <Header />
      <div className={styles.corpo}>
        <nav className={styles.menu} aria-label="Administração do sistema">
          <div className={styles.selo}>Admin do sistema</div>
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

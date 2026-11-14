import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../api";
import { msgErro } from "./util";

/** Formato de GET /api/groups/:id/perfis (mesma API do painel antigo). */
export interface CategoriaDoGrupo {
  id: number;
  nome: string;
  descricao: string | null;
  global: boolean;
  meusPorPadrao: boolean;
  temSqlErp: boolean;
  temSqlMemos: boolean;
}

export interface PerfilAcesso {
  id: number;
  nome: string;
  todas: boolean;
  incluiSemCategoria: boolean;
  padrao: boolean;
  categoriaIds: number[];
  pessoas: number;
}

export interface IdentidadeExterna {
  id: number;
  sistema: string;
  banco: string;
  idExterno: string;
  ativo: boolean;
}

export interface MembroDoGrupo {
  userId: number;
  nome: string | null;
  email: string | null;
  role: string;
  perfilId: number | null;
  perfilEfetivoId: number;
  identidades: IdentidadeExterna[];
}

export interface Matriz {
  categorias: CategoriaDoGrupo[];
  perfis: PerfilAcesso[];
  membros: MembroDoGrupo[];
  config: { perfisAtivos: boolean; exigirCadastro: boolean; maxMembers: number | null; totalMembros: number };
  avisos: string[];
}

const MENSAGENS: Record<string, string> = {
  nome_duplicado: "Já existe um perfil com esse nome neste grupo.",
  nome_obrigatorio: "Informe um nome.",
  perfil_padrao_nao_exclui: "O perfil padrão não pode ser excluído. Escolha outro como padrão antes.",
  id_externo_ja_ligado: "Esse usuário do ERP já está ligado a outra pessoa.",
  membro_ja_tem_id: "Essa pessoa já tem um usuário neste ERP. Remova o atual antes de ligar outro.",
  categoria_global_so_admin: "Categoria global só pode ser alterada por um administrador do sistema.",
};

export function msgPerfil(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  for (const [codigo, msg] of Object.entries(MENSAGENS)) if (texto.includes(codigo)) return msg;
  return msgErro(e);
}

export function usePerfisMatriz(groupId: number | null) {
  const [matriz, setMatriz] = useState<Matriz | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    if (groupId == null) return;
    try {
      setMatriz(await apiGet<Matriz>(`/api/groups/${groupId}/perfis`));
      setErro(null);
    } catch (e) {
      setErro(msgPerfil(e));
    }
  }, [groupId]);

  useEffect(() => {
    setMatriz(null);
    void recarregar();
  }, [recarregar]);

  return { matriz, erro, recarregar };
}

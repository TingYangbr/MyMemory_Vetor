import { useEffect, useState } from "react";
import type { GroupInviteInfoResponse } from "@mymemory/shared";
import { apiGetOptional } from "../api";

/** Token do convite de grupo contido no `next` (ex.: "/convite/grupo?token=abc"). */
export function tokenDoConvite(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/convite/grupo")) return null;
  const q = next.indexOf("?");
  if (q < 0) return null;
  const t = new URLSearchParams(next.slice(q + 1)).get("token")?.trim();
  return t && t.length >= 16 ? t : null;
}

/** Dados do convite (grupo, e-mail convidado, se já tem conta). null enquanto carrega ou se inválido. */
export function useConviteGrupo(token: string | null): GroupInviteInfoResponse | null {
  const [info, setInfo] = useState<GroupInviteInfoResponse | null>(null);
  useEffect(() => {
    if (!token) { setInfo(null); return; }
    let cancelado = false;
    apiGetOptional<GroupInviteInfoResponse>(`/api/group-invites/info?token=${encodeURIComponent(token)}`)
      .then((r) => { if (!cancelado) setInfo(r.ok ? r.data : null); })
      .catch(() => { if (!cancelado) setInfo(null); });
    return () => { cancelado = true; };
  }, [token]);
  return info;
}

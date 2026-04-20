/** Base da API: vazio = mesmo host do front (proxy Vite em dev). `vite preview`/build estático: `VITE_API_BASE=http://127.0.0.1:4000`. */
const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

function withCreds(init?: RequestInit): RequestInit {
  return { ...init, credentials: "include" };
}

function wrapNetworkError(path: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "Failed to fetch" || msg.includes("NetworkError") || msg.includes("Load failed")) {
    return new Error(
      `Não foi possível contatar a API em ${base || "(mesmo host)"}${path}. ` +
        `Confira se a API está rodando (porta 4000), se o Vite tem proxy /api, ou defina VITE_API_BASE. (${msg})`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${base}${path}`, withCreds(init));
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw wrapNetworkError(path, e);
  }
}

export async function apiGet<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T> {
  const r = await apiFetch(path, {
    headers: { Accept: "application/json" },
    signal: opts?.signal,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

/** GET que não lança por HTTP 401/404/500 — só por falha de rede ou JSON inválido. */
export async function apiGetOptional<T>(
  path: string
): Promise<
  | { ok: true; data: T }
  | { ok: false; status: number; bodyText?: string }
> {
  const r = await apiFetch(path, { headers: { Accept: "application/json" } });
  if (r.status === 401) return { ok: false, status: 401 };
  if (!r.ok) {
    const bodyText = await r.text();
    return { ok: false, status: r.status, bodyText };
  }
  return { ok: true, data: (await r.json()) as T };
}

function parseJsonBody<T>(text: string, path: string): T {
  const t = text?.trim() ?? "";
  if (!t) {
    throw new Error(`Resposta vazia do servidor (${path}). A API está em execução?`);
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new Error(t.length > 280 ? `${t.slice(0, 280)}…` : t);
  }
}

export async function apiPostJson<T>(
  path: string,
  body: unknown,
  opts?: { signal?: AbortSignal }
): Promise<T> {
  const r = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `Erro HTTP ${r.status}`);
  return parseJsonBody<T>(text, path);
}

export async function apiPatchJson<T>(path: string, body: unknown): Promise<T> {
  const r = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `Erro HTTP ${r.status}`);
  return parseJsonBody<T>(text, path);
}

export async function apiPutJson<T>(path: string, body: unknown): Promise<T> {
  const r = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `Erro HTTP ${r.status}`);
  if (!text.trim()) return {} as T;
  return parseJsonBody<T>(text, path);
}

export async function apiDeleteJson<T>(path: string): Promise<T> {
  const r = await apiFetch(path, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `Erro HTTP ${r.status}`);
  if (!text.trim()) return {} as T;
  return parseJsonBody<T>(text, path);
}

export async function apiPostMultipart(
  path: string,
  form: FormData,
  opts?: { signal?: AbortSignal }
): Promise<unknown> {
  const r = await apiFetch(path, { method: "POST", body: form, signal: opts?.signal });
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 413) {
      let msg = "O arquivo excede o tamanho máximo permitido.";
      try {
        const j = JSON.parse(text) as { message?: string };
        if (typeof j.message === "string" && j.message.trim()) msg = j.message;
      } catch {
        /* texto não-JSON */
      }
      throw new Error(msg);
    }
    if (r.status === 422) {
      let msg = text || "Não foi possível processar o arquivo.";
      try {
        const j = JSON.parse(text) as { message?: string };
        if (typeof j.message === "string" && j.message.trim()) msg = j.message;
      } catch {
        /* texto não-JSON */
      }
      throw new Error(msg);
    }
    throw new Error(text || `Erro HTTP ${r.status}`);
  }
  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}

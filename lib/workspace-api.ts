/** All workspace screens share the same API contract in Sites and GitHub Pages. */
export type WorkspaceFetch = (path: string, init?: RequestInit) => Promise<Response>;
export type WorkspaceUser = { id: string; email?: string; name?: string };

export const sameOriginWorkspaceFetch: WorkspaceFetch = (path, init) => fetch(path, init);

export function createSupabaseWorkspaceFetch(options: {
  functionUrl: string;
  publishableKey: string;
  getAccessToken: () => Promise<string | null>;
}): WorkspaceFetch {
  const base = options.functionUrl.replace(/\/+$/, "");
  return async (path, init) => {
    if (!path.startsWith("/api/") || path.includes("..")) throw new Error("Endereço de integração inválido.");
    const accessToken = await options.getAccessToken();
    if (!accessToken) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("apikey", options.publishableKey);
    return fetch(`${base}/${path.slice(5)}`, { ...init, headers, credentials: "omit" });
  };
}

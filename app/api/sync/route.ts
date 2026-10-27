import { getChatGPTUser } from "../../chatgpt-auth";
import { DEFAULT_COMPANIES } from "../../../lib/workspace-types";
import { syncWorkspace } from "../../../lib/provider-sync";
import { getUserConnectionConfigs } from "../../../lib/integration-store";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "unauthorized", message: "Entre para sincronizar suas integrações." }, { status: 401, headers });
  let origin: string;
  try { origin = new URL(request.url).origin; } catch { return Response.json({ error: "invalid_origin", message: "Origem da solicitação inválida." }, { status: 403, headers }); }
  if (request.headers.get("origin") !== origin) return Response.json({ error: "invalid_origin", message: "Sincronize a partir deste painel." }, { status: 403, headers });
  try {
    const configs = await getUserConnectionConfigs(user.userId);
    if (!configs.length) return Response.json({ error: "not_configured", message: "Nenhuma conta conectada. Abra Integrações para configurar sua primeira conexão." }, { status: 409, headers });
    return Response.json({ configured: true, data: await syncWorkspace(configs, DEFAULT_COMPANIES) }, { headers });
  } catch {
    return Response.json({ error: "configuration_unavailable", message: "Não foi possível sincronizar suas integrações. Tente novamente ou confira as conexões no painel." }, { status: 503, headers });
  }
}

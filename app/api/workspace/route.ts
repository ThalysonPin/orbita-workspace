import { getChatGPTUser } from "../../chatgpt-auth";
import { DEFAULT_COMPANIES } from "../../../lib/workspace-types";
import { getWorkspaceStatus } from "../../../lib/provider-sync";
import { getUserConnectionConfigs } from "../../../lib/integration-store";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "unauthorized", message: "Entre para acessar suas integrações." }, { status: 401, headers });
  try {
    // Configuration metadata only; no external requests on page load.
    return Response.json(getWorkspaceStatus(await getUserConnectionConfigs(user.userId), DEFAULT_COMPANIES), { headers });
  } catch {
    return Response.json({ error: "configuration_unavailable", message: "Não foi possível carregar suas integrações. Tente novamente em instantes." }, { status: 503, headers });
  }
}

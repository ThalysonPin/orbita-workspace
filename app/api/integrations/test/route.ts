import { getChatGPTUser } from "../../../chatgpt-auth";
import { INTEGRATION_HEADERS, IntegrationError, integrationErrorResponse, normalizeIntegrationInput, readIntegrationBody, verifyIntegrationOrigin } from "../../../../lib/integration-config";
import { getIntegrationStore } from "../../../../lib/integration-store";
import { syncWorkspace } from "../../../../lib/provider-sync";
import { DEFAULT_COMPANIES } from "../../../../lib/workspace-types";

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser(); if (!user) throw new IntegrationError("unauthorized", "Entre para testar suas integrações.", 401);
    verifyIntegrationOrigin(request); const input = await readIntegrationBody(request), prior = await (await getIntegrationStore()).get(user.userId, input.provider, input.companyId);
    const config = normalizeIntegrationInput(input, prior?.config), result = await syncWorkspace([config], DEFAULT_COMPANIES);
    const verified = result.connections.find((connection) => connection.id === config.id)?.status === "connected";
    return Response.json({ verified, message: verified ? "Acesso validado. Os dados desta integração estão disponíveis para leitura." : "A leitura não foi validada por completo. Confira credenciais, permissões e limites do provedor." }, { headers: INTEGRATION_HEADERS });
  } catch (error) { return integrationErrorResponse(error); }
}

import { getChatGPTUser } from "../../chatgpt-auth";
import { INTEGRATION_HEADERS, IntegrationError, integrationErrorResponse, integrationSlot, publicIntegrationSettings, readIntegrationBody, verifyIntegrationOrigin } from "../../../lib/integration-config";
import { getIntegrationSettings, getIntegrationStore, saveIntegration } from "../../../lib/integration-store";
import { googleCallbackUrl } from "../../../lib/integration-oauth";

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser(); if (!user) throw new IntegrationError("unauthorized", "Entre para configurar suas integrações.", 401);
    const params = new URL(request.url).searchParams, slot = integrationSlot(params.get("provider"), params.get("companyId"));
    return Response.json({ settings: await getIntegrationSettings(user.userId, slot.provider, slot.companyId), callbackUrl: googleCallbackUrl(request.url) }, { headers: INTEGRATION_HEADERS });
  } catch (error) { return integrationErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser(); if (!user) throw new IntegrationError("unauthorized", "Entre para configurar suas integrações.", 401);
    verifyIntegrationOrigin(request); const input = await readIntegrationBody(request);
    return Response.json({ settings: await saveIntegration(user.userId, input), message: "Configuração salva com proteção. Teste ou sincronize para validar o acesso." }, { headers: INTEGRATION_HEADERS });
  } catch (error) { return integrationErrorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    const user = await getChatGPTUser(); if (!user) throw new IntegrationError("unauthorized", "Entre para configurar suas integrações.", 401);
    verifyIntegrationOrigin(request);
    const params = new URL(request.url).searchParams, input = params.has("provider") ? integrationSlot(params.get("provider"), params.get("companyId")) : await readIntegrationBody(request);
    await (await getIntegrationStore()).disconnect(user.userId, input.provider, input.companyId);
    return Response.json({ settings: publicIntegrationSettings(input.provider, input.companyId), message: "Integração desconectada deste painel." }, { headers: INTEGRATION_HEADERS });
  } catch (error) { return integrationErrorResponse(error); }
}

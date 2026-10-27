import { getChatGPTUser } from "../../../../chatgpt-auth";
import { INTEGRATION_HEADERS, IntegrationError, integrationErrorResponse, readIntegrationBody, verifyIntegrationOrigin } from "../../../../../lib/integration-config";
import { getIntegrationStore } from "../../../../../lib/integration-store";
import { startGoogleOAuth } from "../../../../../lib/integration-oauth";

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser(); if (!user) throw new IntegrationError("unauthorized", "Entre para autorizar o Google Calendar.", 401);
    verifyIntegrationOrigin(request); const input = await readIntegrationBody(request);
    const store = await getIntegrationStore(), prior = await store.get(user.userId, input.provider, input.companyId);
    return Response.json(await startGoogleOAuth(user.userId, input, request.url, store, prior?.config), { headers: INTEGRATION_HEADERS });
  } catch (error) { return integrationErrorResponse(error); }
}

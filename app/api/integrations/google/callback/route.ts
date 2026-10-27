import { getChatGPTUser } from "../../../../chatgpt-auth";
import { INTEGRATION_HEADERS, IntegrationError, integrationErrorResponse } from "../../../../../lib/integration-config";
import { getIntegrationStore } from "../../../../../lib/integration-store";
import { finishGoogleOAuth } from "../../../../../lib/integration-oauth";

export async function GET(request: Request) {
  const user = await getChatGPTUser(); if (!user) return integrationErrorResponse(new IntegrationError("unauthorized", "Entre para concluir a autorização do Google.", 401));
  const params = new URL(request.url).searchParams;
  const destination = new URL("/", request.url); destination.searchParams.set("provider", "google");
  try {
    const companyId = await finishGoogleOAuth(user.userId, params.get("state") || "", params.get("code"), params.get("error"), await getIntegrationStore());
    destination.searchParams.set("integration", "connected"); destination.searchParams.set("company", companyId);
  } catch (error) {
    destination.searchParams.set("integration", "error");
    destination.searchParams.set("reason", error instanceof IntegrationError && ["oauth_denied", "invalid_oauth_state", "calendar_scope_required", "offline_access_required"].includes(error.code) ? error.code : "oauth_failed");
  }
  return new Response(null, { status: 303, headers: { ...INTEGRATION_HEADERS, Location: destination.href } });
}

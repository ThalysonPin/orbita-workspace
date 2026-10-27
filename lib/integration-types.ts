import type { Provider } from "./workspace-types";

export type IntegrationFields = {
  authMode?: "oauth" | "access_token" | "refresh_token";
  label?: string;
  calendarId?: string;
  workspaceId?: string;
  assigneeId?: string;
  channelIds?: string;
  channelNames?: string;
  guildId?: string;
  clientId?: string;
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  clientSecret?: string;
};
export type IntegrationInput = { provider: Provider; companyId: string; fields: IntegrationFields };
export type IntegrationSettings = {
  provider: Provider;
  companyId: string;
  saved: boolean;
  fields: IntegrationFields;
  secrets: { token: boolean; accessToken: boolean; refreshToken: boolean; clientSecret: boolean };
  updatedAt?: string;
};
export type IntegrationResult = {
  settings?: IntegrationSettings;
  message?: string;
  error?: string;
  verified?: boolean;
  authorizationUrl?: string;
  callbackUrl?: string;
};

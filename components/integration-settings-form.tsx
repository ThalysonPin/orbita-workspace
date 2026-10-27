"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowUpRight, Check, CircleCheck, Copy, ExternalLink, KeyRound, LoaderCircle, LockKeyhole, Plug, RefreshCw, Trash2 } from "lucide-react";
import type { Provider } from "@/lib/workspace-types";
import { sameOriginWorkspaceFetch, type WorkspaceFetch } from "@/lib/workspace-api";
import type { IntegrationFields, IntegrationInput, IntegrationResult, IntegrationSettings } from "@/lib/integration-types";

type Props = { api?: WorkspaceFetch; provider: Provider; companyId: string; companyName: string; onSaved: () => Promise<void>; onClose: () => void };
type Feedback = { kind: "success" | "error" | "info"; message: string } | null;
type SecretField = "token" | "accessToken" | "refreshToken" | "clientSecret";
const providerNames: Record<Provider, string> = { google: "Google Calendar", clickup: "ClickUp", slack: "Slack", discord: "Discord" };
const guides: Record<Provider, { url: string; title: string; description: string }> = {
  google: { url: "https://console.cloud.google.com/apis/credentials", title: "Abrir Google Cloud", description: "Crie um cliente OAuth do tipo Aplicativo da Web, habilite a API Google Calendar e cadastre o endereço abaixo como URI de redirecionamento autorizado." },
  clickup: { url: "https://developer.clickup.com/docs/authentication", title: "Encontrar meu token do ClickUp", description: "Gere um token pessoal nas configurações do ClickUp. Informe o ID do workspace que você quer acompanhar; ele também é chamado de Team ID na API." },
  slack: { url: "https://docs.slack.dev/authentication/tokens/", title: "Configurar meu aplicativo do Slack", description: "Use o Bot User OAuth Token do seu aplicativo (começa com xoxb-). O bot precisa participar dos canais escolhidos e ter permissão para ler o histórico." },
  discord: { url: "https://discord.com/developers/docs/intro", title: "Abrir guia de aplicativos do Discord", description: "Use o token de um bot autorizado no servidor. Com o Modo desenvolvedor do Discord ativado, copie os IDs do servidor e dos canais. O bot precisa de acesso às mensagens desses canais." },
};
const defaultFields = (provider: Provider): IntegrationFields => provider === "google" ? { authMode: "oauth", calendarId: "primary" } : {};
function publicFields(settings: IntegrationSettings): IntegrationFields {
  const fields = settings.fields;
  return { authMode: fields.authMode, label: fields.label || "", calendarId: fields.calendarId || "primary", workspaceId: fields.workspaceId || "", assigneeId: fields.assigneeId || "", channelIds: fields.channelIds || "", channelNames: fields.channelNames || "", guildId: fields.guildId || "", clientId: fields.clientId || "" };
}
async function apiRequest(api: WorkspaceFetch, url: string, method: "POST" | "DELETE", input: IntegrationInput): Promise<IntegrationResult> {
  const response = await api(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const result = await response.json() as IntegrationResult;
  if (!response.ok) throw new Error(result.message || "Não foi possível concluir. Tente novamente.");
  return result;
}

export default function IntegrationSettingsForm({ api = sameOriginWorkspaceFetch, provider, companyId, companyName, onSaved, onClose }: Props) {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [fields, setFields] = useState<IntegrationFields>(() => defaultFields(provider));
  const [callbackUrl, setCallbackUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<"test" | "save" | "authorize" | "disconnect" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [verified, setVerified] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const callbackRef = useRef<HTMLInputElement>(null);
  const googleMode = fields.authMode || "oauth";
  const providerName = providerNames[provider];
  const secretExists = (key: SecretField) => Boolean(settings?.secrets[key]) && !(provider === "google" && key !== "clientSecret" && (settings?.fields.authMode || "oauth") !== googleMode);

  useEffect(() => {
    const controller = new AbortController();
    api(`/api/integrations?provider=${encodeURIComponent(provider)}&companyId=${encodeURIComponent(companyId)}`, { credentials: "same-origin", signal: controller.signal }).then(async (response) => {
      const result = await response.json() as IntegrationResult;
      if (!response.ok || !result.settings) throw new Error(result.message || "Não foi possível carregar esta integração.");
      setSettings(result.settings);
      setFields({ ...defaultFields(provider), ...publicFields(result.settings), authMode: result.settings.fields.authMode || "oauth" });
      setCallbackUrl(result.callbackUrl || "");
      setLoadError("");
    }).catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar esta integração."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, provider, companyId, retry]);

  const update = (key: keyof IntegrationFields, value: string) => {
    setFields((previous) => ({ ...previous, [key]: value }));
    setVerified(false);
    setFeedback(null);
  };
  const switchGoogleMode = (mode: IntegrationFields["authMode"]) => {
    setFields((previous) => ({ ...previous, authMode: mode, token: "", accessToken: "", refreshToken: "", clientSecret: "" }));
    setVerified(false); setFeedback(null); setConfirmDisconnect(false);
  };
  const draft = (): IntegrationInput => ({ provider, companyId, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])) as IntegrationFields });
  const valid = (action: "test" | "save" | "authorize") => {
    if (!formRef.current?.reportValidity()) return false;
    if (provider === "google") {
      const hasAccess = Boolean(fields.accessToken?.trim() || (settings?.fields.authMode === googleMode && secretExists("accessToken")));
      const hasRefresh = Boolean(fields.refreshToken?.trim() || (settings?.fields.authMode === googleMode && secretExists("refreshToken")));
      const hasClient = Boolean(fields.clientId?.trim() && (fields.clientSecret?.trim() || secretExists("clientSecret")));
      if (googleMode === "oauth" && action === "test" && !hasRefresh && !hasAccess) { setFeedback({ kind: "info", message: "Autorize sua conta com Google primeiro. Depois, você pode testar o acesso à agenda aqui." }); return false; }
      if ((action === "authorize" || googleMode === "refresh_token") && !hasClient) { setFeedback({ kind: "error", message: "Informe o ID do cliente e o segredo do cliente do aplicativo Google." }); return false; }
      if (googleMode === "access_token" && !hasAccess) { setFeedback({ kind: "error", message: "Informe um token de acesso para esta agenda." }); return false; }
      if (googleMode === "refresh_token" && !hasRefresh) { setFeedback({ kind: "error", message: "Informe o token de atualização da conta Google." }); return false; }
    }
    if (provider === "slack" || provider === "discord") {
      const channels = (fields.channelIds || "").split(",").map((value) => value.trim()).filter(Boolean);
      if (!channels.length || channels.length > 5) { setFeedback({ kind: "error", message: "Informe de 1 a 5 IDs de canais, separados por vírgula." }); return false; }
      const names = (fields.channelNames || "").split(",").map((value) => value.trim()).filter(Boolean);
      if (names.length && names.length !== channels.length) { setFeedback({ kind: "error", message: "Informe um nome para cada canal, na mesma ordem dos IDs, ou deixe os nomes em branco." }); return false; }
      if (provider === "discord" && fields.token?.trim().startsWith("Bot ")) { setFeedback({ kind: "error", message: "Cole apenas o token do bot, sem o prefixo “Bot”." }); return false; }
    }
    return true;
  };
  const test = async () => {
    if (!valid("test")) return;
    setBusy("test"); setFeedback(null);
    try { const result = await apiRequest(api, "/api/integrations/test", "POST", draft()); setVerified(result.verified === true); setFeedback({ kind: result.verified ? "success" : "error", message: result.message || (result.verified ? "Conexão verificada. Foi possível consultar esta conta." : "Não foi possível verificar o acesso. Revise as credenciais e permissões.") }); }
    catch (error) { setVerified(false); setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Não foi possível testar a conexão." }); }
    finally { setBusy(null); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (provider === "google" && googleMode === "oauth") { await authorize(); return; }
    if (!valid("save")) return;
    setBusy("save"); setFeedback(null);
    try {
      const result = await apiRequest(api, "/api/integrations", "POST", draft());
      if (result.settings) { setSettings(result.settings); setFields({ ...defaultFields(provider), ...publicFields(result.settings) }); }
      else setFields((previous) => ({ ...previous, token: "", accessToken: "", refreshToken: "", clientSecret: "" }));
      setFeedback({ kind: "success", message: verified ? "Integração salva. A conexão foi verificada nesta sessão." : "Configuração salva. A sincronização vai verificar o acesso à sua conta." });
      try { await onSaved(); } catch { setFeedback({ kind: "info", message: "Configuração salva. Não foi possível atualizar o painel agora; use Sincronizar para tentar novamente." }); }
    } catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Não foi possível salvar esta integração." }); }
    finally { setBusy(null); }
  };
  const authorize = async () => {
    if (!valid("authorize")) return;
    setBusy("authorize"); setFeedback(null);
    try {
      const result = await apiRequest(api, "/api/integrations/google/start", "POST", draft());
      if (!result.authorizationUrl) throw new Error(result.message || "Não foi possível iniciar a autorização com Google.");
      const url = new URL(result.authorizationUrl);
      if (url.origin !== "https://accounts.google.com") throw new Error("O endereço de autorização do Google é inválido.");
      window.location.assign(url.href);
    } catch (error) { setBusy(null); setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Não foi possível iniciar a autorização com Google." }); }
  };
  const disconnect = async () => {
    setBusy("disconnect"); setFeedback(null);
    try {
      await apiRequest(api, "/api/integrations", "DELETE", { provider, companyId, fields: {} });
      setSettings(null); setFields(defaultFields(provider)); setVerified(false); setConfirmDisconnect(false);
      setFeedback({ kind: "info", message: "Integração desconectada. A permissão no serviço de origem pode ser revogada nas configurações da sua conta." });
      try { await onSaved(); } catch { setFeedback({ kind: "info", message: "Integração desconectada. Atualize o painel para rever as fontes disponíveis." }); }
    } catch (error) { setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Não foi possível desconectar esta integração." }); }
    finally { setBusy(null); }
  };
  const copyCallback = async () => {
    try { await navigator.clipboard.writeText(callbackUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { callbackRef.current?.focus(); callbackRef.current?.select(); setFeedback({ kind: "info", message: "Selecione e copie o endereço de redirecionamento acima." }); }
  };
  const secretInput = (name: SecretField, label: string, hint: string, required = true) => <label className="integration-field">{label}<input type="password" name={`integration-${name}`} autoComplete="new-password" spellCheck={false} autoCapitalize="none" value={fields[name] || ""} onChange={(event) => update(name, event.target.value)} placeholder={secretExists(name) ? "Já salvo. Deixe vazio para manter." : hint} required={required && !secretExists(name)} maxLength={8192} /><small>{secretExists(name) ? "O valor salvo nunca é exibido. Preencha somente para substituir." : hint}</small></label>;
  const resourceInput = (name: keyof IntegrationFields, label: string, placeholder: string, hint?: string, required = false) => <label className="integration-field">{label}<input name={`integration-${name}`} autoComplete="off" autoCapitalize="none" spellCheck={false} value={fields[name] || ""} onChange={(event) => update(name, event.target.value)} placeholder={placeholder} required={required} maxLength={name === "channelNames" ? 500 : 250} />{hint && <small>{hint}</small>}</label>;
  const googleClientFields = <div className="integration-client-fields"><label className="integration-field">ID do cliente Google<input name="integration-clientId" type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="none" value={fields.clientId || ""} onChange={(event) => update("clientId", event.target.value)} placeholder="Seu ID de cliente OAuth" required /><small>O cliente OAuth do aplicativo criado no Google Cloud.</small></label>{secretInput("clientSecret", "Segredo do cliente Google", "Cole o segredo do cliente OAuth")}</div>;

  return <div className="integration-settings-form">
    <span className="integration-form-eyebrow"><Plug size={15} />SUAS FERRAMENTAS, EM ÓRBITA</span>
    <h2 id="modal-title">{settings?.saved ? "Configurar" : "Conectar"} {providerName}</h2>
    <p className="modal-description">{companyName} · acesso apenas às fontes que você escolher.</p>
    {loading ? <div className="integration-form-loading" role="status"><LoaderCircle size={21} className="spin" /><span>Carregando configuração…</span></div> : loadError ? <div className="integration-load-error"><AlertCircle size={22} /><p>{loadError}</p><button className="secondary-button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}><RefreshCw size={14} />Tentar novamente</button></div> : <>
      <div className="integration-saved-state"><span className={settings?.saved ? "saved" : "unsaved"}><i />{settings?.saved ? "Configuração salva no painel" : "Ainda não configurada"}</span>{settings?.saved && <span className="integration-secret-note"><LockKeyhole size={12} />Credenciais protegidas</span>}</div>
      <form ref={formRef} onSubmit={save} autoComplete="off">
        <fieldset disabled={busy !== null} className="integration-fieldset">
          {resourceInput("label", "Nome da conexão", `${providerName} · ${companyName}`, "Opcional. Ajuda a reconhecer esta conta no painel.")}
          {provider === "google" && <>
            <div className="integration-mode-label">Como você quer conectar?</div>
            <div className="integration-auth-modes" aria-label="Forma de conexão Google">{[{ id: "oauth" as const, title: "Com Google", subtitle: "Recomendado" }, { id: "access_token" as const, title: "Token de acesso", subtitle: "Temporário" }, { id: "refresh_token" as const, title: "Token de atualização", subtitle: "Avançado" }].map((mode) => <button type="button" key={mode.id} className={googleMode === mode.id ? "selected" : ""} aria-pressed={googleMode === mode.id} onClick={() => switchGoogleMode(mode.id)}><strong>{mode.title}</strong><span>{mode.subtitle}</span>{googleMode === mode.id && <Check size={12} />}</button>)}</div>
            {googleMode === "oauth" && <div className="integration-provider-guide"><KeyRound size={17} /><div><strong>Uma configuração inicial, depois é só autorizar.</strong><p>{guides.google.description} A autorização acontece na página oficial do Google.</p><a href={guides.google.url} target="_blank" rel="noreferrer">{guides.google.title}<ExternalLink size={12} /></a></div></div>}
            {googleMode !== "access_token" && googleClientFields}
            {googleMode === "oauth" && <label className="integration-field callback-field">URI de redirecionamento autorizado<div><input ref={callbackRef} value={callbackUrl} readOnly aria-label="URI de redirecionamento autorizado" onFocus={(event) => event.currentTarget.select()} /><button type="button" className="callback-copy" aria-label="Copiar URI de redirecionamento" onClick={copyCallback} disabled={!callbackUrl}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copiado" : "Copiar"}</button></div><small>Copie exatamente este endereço para a configuração do cliente no Google Cloud.</small></label>}
            {googleMode === "access_token" && <>{secretInput("accessToken", "Token de acesso Google", "Cole um access token válido") }<p className="integration-inline-note">O token de acesso é temporário. Quando expirar, você precisará atualizá-lo aqui.</p></>}
            {googleMode === "refresh_token" && secretInput("refreshToken", "Token de atualização Google", "Cole o refresh token da conta")}
            {resourceInput("calendarId", "ID da agenda", "primary", "Use primary para a agenda principal ou informe o ID de outra agenda autorizada.", true)}
          </>}
          {provider !== "google" && <>
            <div className="integration-provider-guide"><KeyRound size={17} /><div><p>{guides[provider].description}</p><a href={guides[provider].url} target="_blank" rel="noreferrer">{guides[provider].title}<ExternalLink size={12} /></a></div></div>
            {secretInput("token", provider === "clickup" ? "Token pessoal do ClickUp" : provider === "slack" ? "Token do bot Slack" : "Token do bot Discord", provider === "slack" ? "xoxb-…" : provider === "discord" ? "Cole o token sem o prefixo Bot" : "Cole seu token pessoal")}
            {provider === "clickup" && <div className="integration-two-columns">{resourceInput("workspaceId", "ID do workspace", "Ex.: 90123456", "Workspace / Team ID do ClickUp.", true)}{resourceInput("assigneeId", "Seu ID de usuário", "Opcional", "Preencha para consultar apenas tarefas atribuídas a você.")}</div>}
            {provider === "discord" && resourceInput("guildId", "ID do servidor Discord", "Ex.: 123456789012345678", "Copie o ID do servidor com o Modo desenvolvedor ativado.", true)}
            {(provider === "slack" || provider === "discord") && <>{resourceInput("channelIds", "IDs dos canais", provider === "slack" ? "C0123456789, C9876543210" : "123456789012345678, 987654321098765432", "De 1 a 5 canais. Separe os IDs por vírgula.", true)}{resourceInput("channelNames", "Nomes dos canais", "geral, projetos", "Opcional. Informe os nomes na mesma ordem dos IDs, separados por vírgula.")}</>}
          </>}
          <div className="integration-privacy-note"><LockKeyhole size={15} /><p>As credenciais são enviadas e armazenadas com proteção no servidor. Elas não entram no armazenamento local nem na exportação do seu painel.</p></div>
          {feedback && <div className={`integration-feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.kind === "error" ? <AlertCircle size={17} /> : feedback.kind === "success" ? <CircleCheck size={17} /> : <Plug size={17} />}<p>{feedback.message}</p></div>}
          <div className="integration-form-actions"><button type="button" className="secondary-button" onClick={test}>{busy === "test" ? <LoaderCircle size={15} className="spin" /> : <Plug size={15} />}{busy === "test" ? "Testando…" : "Testar conexão"}</button>{provider === "google" && googleMode === "oauth" ? <button type="submit" className="primary-button">{busy === "authorize" ? <LoaderCircle size={15} className="spin" /> : <ArrowUpRight size={15} />}{busy === "authorize" ? "Abrindo Google…" : settings?.saved ? "Autorizar novamente" : "Autorizar com Google"}</button> : <button type="submit" className="primary-button">{busy === "save" ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{busy === "save" ? "Salvando…" : "Salvar integração"}</button>}</div>
        </fieldset>
      </form>
      {settings?.saved && !confirmDisconnect && <div className="integration-form-footer"><button className="integration-disconnect-button" onClick={() => { setConfirmDisconnect(true); setFeedback(null); }} disabled={busy !== null}><Trash2 size={13} />Desconectar integração</button><button className="text-button" onClick={onClose} disabled={busy !== null}>Fechar</button></div>}
      {confirmDisconnect && <div className="integration-disconnect-confirm"><h3>Desconectar {providerName}?</h3><p>O painel deixará de acessar esta conexão de {companyName}. Para revogar a permissão também em {providerName}, use as configurações da sua conta no serviço.</p><div><button className="secondary-button" onClick={() => setConfirmDisconnect(false)} disabled={busy !== null}>Manter conexão</button><button className="secondary-button danger-button" onClick={disconnect} disabled={busy !== null}>{busy === "disconnect" ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{busy === "disconnect" ? "Desconectando…" : "Desconectar"}</button></div></div>}
    </>}
  </div>;
}

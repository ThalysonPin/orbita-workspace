import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import WorkspaceDashboard from "@/components/workspace-dashboard";
import { createDemoData } from "@/lib/demo-data";
import { createSupabaseWorkspaceFetch } from "@/lib/workspace-api";
import type { WorkspaceData } from "@/lib/workspace-types";
import AuthScreen from "./auth-screen";
import { configuration } from "./supabase-client";

const recoveryHint = () => new URLSearchParams(window.location.search).get("auth") === "recovery";
function clearRecoveryAddress() { const url = new URL(window.location.href); url.searchParams.delete("auth"); url.hash = ""; window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`); }
function emptyWorkspace(): WorkspaceData {
  const initial = createDemoData();
  return { ...initial, mode: "live", tasks: [], events: [], messages: [] };
}
export default function PagesApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!configuration.client);
  const [recovering, setRecovering] = useState(recoveryHint);
  const [recovered, setRecovered] = useState(false);
  const [notice, setNotice] = useState("");
  const initialData = useMemo(() => emptyWorkspace(), []);
  const api = useMemo(() => createSupabaseWorkspaceFetch({ functionUrl: `${configuration.url}/functions/v1/orbita-api`, publishableKey: configuration.publishableKey, getAccessToken: async () => { const result = await configuration.client?.auth.getSession(); return result?.data.session?.access_token || null; } }), []);
  useEffect(() => {
    const client = configuration.client;
    if (!client) return;
    let active = true;
    let authChanged = false;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      authChanged = true;
      setSession(nextSession);
      setReady(true);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") setRecovering(false);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (!authChanged) setSession(data.session);
      setReady(true);
      if (error) setNotice("Não foi possível restaurar sua sessão. Entre novamente para continuar.");
      if (recoveryHint() && !data.session) { setRecovering(false); clearRecoveryAddress(); setNotice("Este link de recuperação expirou ou já foi usado. Solicite um novo link em “Esqueci minha senha”."); }
    }).catch(() => { if (active) { setReady(true); setNotice("Não foi possível restaurar sua sessão. Entre novamente para continuar."); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  const recoveryComplete = () => {
    setSession(null); setRecovering(false); setRecovered(true); setNotice("");
    clearRecoveryAddress();
  };
  if (!ready) return <div className="pages-session-loading" role="status"><LoaderCircle size={25} className="spin" /><span>Preparando seu espaço…</span></div>;
  if (!session || recovering) return <AuthScreen key={recovering ? "recovery" : recovered ? "recovered" : "login"} client={configuration.client} configurationStatus={configuration.status} recovery={recovering && Boolean(session)} recovered={recovered} initialNotice={notice} onRecoveryComplete={recoveryComplete} />;
  return <WorkspaceDashboard key={session.user.id} initialData={initialData} api={api} user={{ id: session.user.id, email: session.user.email, name: typeof session.user.user_metadata?.name === "string" ? session.user.user_metadata.name : undefined }} onSignOut={async () => { const result = await configuration.client!.auth.signOut({ scope: "local" }); if (result.error) throw result.error; setSession(null); }} />;
}

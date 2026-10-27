import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Plug, ShieldCheck } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appReturnUrl } from "./supabase-client";

type Props = { client: SupabaseClient | null; configurationStatus: "ready" | "missing" | "invalid"; recovery: boolean; recovered: boolean; initialNotice?: string; onRecoveryComplete: () => void };
function friendlyAuthError(code?: string, status?: number): string {
  if (code === "invalid_credentials") return "E-mail ou senha incorretos. Confira seus dados e tente novamente.";
  if (code === "email_not_confirmed") return "Confirme seu e-mail antes de entrar. Se precisar, peça ajuda ao administrador.";
  if (status === 429 || code === "over_request_rate_limit") return "Muitas tentativas em pouco tempo. Aguarde um momento antes de tentar novamente.";
  return "Não foi possível concluir agora. Verifique sua conexão e tente novamente.";
}
export default function AuthScreen({ client, configurationStatus, recovery, recovered, initialNotice, onRecoveryComplete }: Props) {
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialNotice || "");
  const appBasePath = import.meta.env.BASE_URL;
  const pending = configurationStatus !== "ready" || !client;
  const changeMode = (next: "login" | "reset") => { setMode(next); setPassword(""); setConfirmation(""); setError(""); setNotice(""); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!client) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      if (recovery) {
        if (!passwordUpdated) {
          if (password.length < 8) { setError("Escolha uma senha com pelo menos 8 caracteres."); return; }
          if (password !== confirmation) { setError("As senhas precisam ser iguais."); return; }
          const result = await client.auth.updateUser({ password });
          if (result.error) { setError(friendlyAuthError(result.error.code, result.error.status)); return; }
          setPasswordUpdated(true); setPassword(""); setConfirmation("");
        }
        const signedOut = await client.auth.signOut({ scope: "local" });
        if (signedOut.error) { setError("Sua senha já foi atualizada. Tente encerrar a sessão novamente para entrar com a nova senha."); return; }
        onRecoveryComplete();
      } else if (mode === "reset") {
        const returnUrl = new URL(appReturnUrl()); returnUrl.searchParams.set("auth", "recovery");
        const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: returnUrl.href });
        if (result.error) { setError(friendlyAuthError(result.error.code, result.error.status)); return; }
        setNotice("Se este e-mail estiver cadastrado, você receberá um link para definir uma nova senha.");
      } else {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password });
        setPassword("");
        if (result.error) setError(friendlyAuthError(result.error.code, result.error.status));
      }
    } catch { setPassword(""); setConfirmation(""); setError("Não foi possível conectar agora. Verifique sua conexão e tente novamente."); }
    finally { setBusy(false); }
  };
  return <main className="auth-shell">
    <section className="auth-story" aria-label="Órbita, seu espaço de trabalho"><a className="brand auth-brand" href={appBasePath} aria-label="Órbita, início"><span className="orbit-mark" aria-hidden="true"><span /><i /></span><span>órbita<span className="brand-period">.</span></span></a><div className="auth-story-content"><span className="auth-eyebrow">UM ESPAÇO PARA O SEU UNIVERSO</span><h1>Mais clareza.<br />Um dia de<br /><em>cada vez.</em></h1><p>Agendas, tarefas e conversas.<br />O seu trabalho encontra o próprio ritmo.</p><div className="auth-orbit-art" aria-hidden="true"><span className="art-core">ó</span><span className="art-ring ring-one" /><span className="art-ring ring-two" /><span className="art-ring ring-three" /><i className="art-company one">01</i><i className="art-company two">02</i><i className="art-company three">03</i><i className="art-spark">✳</i></div></div><div className="auth-story-footer"><span />Três contextos. Uma boa órbita.</div></section>
    <section className="auth-access" aria-label="Acesso ao painel"><div className="auth-card">{pending ? <div className="auth-pending"><span className="auth-icon"><Plug size={25} strokeWidth={1.6} /></span><span className="auth-kicker">SEU ESPAÇO ESTÁ A CAMINHO</span><h2>Configuração pendente.</h2><p>{configurationStatus === "invalid" ? "O serviço de autenticação precisa de um ajuste antes de liberar o acesso ao painel." : "Este painel ainda precisa ser conectado ao serviço de autenticação. Assim que a configuração terminar, você poderá entrar com sua conta."}</p><div className="auth-pending-note"><ShieldCheck size={18} /><span>O login por e-mail e senha ficará disponível após essa configuração.</span></div></div> : <>
      <span className="auth-icon"><LockKeyhole size={24} strokeWidth={1.5} /></span><span className="auth-kicker">SEU ESPAÇO PESSOAL DE TRABALHO</span><h2>{recovery ? passwordUpdated ? "Sua senha está atualizada." : "Escolha uma nova senha." : mode === "reset" ? "Recupere seu acesso." : "Entre na sua órbita."}</h2><p className="auth-intro">{recovery ? passwordUpdated ? "Encerre esta sessão para entrar com a nova senha." : "Uma senha nova para continuar de onde você parou." : mode === "reset" ? "Enviaremos um link para você definir uma nova senha." : "Seu dia fica mais leve quando tudo tem um lugar."}</p>
      {recovered && !notice && <div className="auth-feedback success" role="status"><CheckCircle2 size={17} /><p>Senha atualizada. Entre com sua nova senha.</p></div>}
      {notice && <div className="auth-feedback success" role="status"><Mail size={17} /><p>{notice}</p></div>}
      {error && <div className="auth-feedback error" role="alert"><span>!</span><p>{error}</p></div>}
      <form className="auth-form" onSubmit={submit}>
        {!recovery && <label htmlFor="auth-email">E-mail<div className="auth-input-wrap"><Mail size={17} /><input id="auth-email" name="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" required disabled={busy} autoCapitalize="none" spellCheck={false} /></div></label>}
        {((recovery && !passwordUpdated) || (!recovery && mode === "login")) && <label htmlFor="auth-password">{recovery ? "Nova senha" : "Senha"}<div className="auth-input-wrap"><LockKeyhole size={17} /><input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={recovery ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={recovery ? "Pelo menos 8 caracteres" : "Sua senha"} required minLength={recovery ? 8 : undefined} disabled={busy} /><button className="auth-show-password" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} disabled={busy}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
        {recovery && !passwordUpdated && <label htmlFor="auth-password-confirmation">Repita a nova senha<div className="auth-input-wrap"><LockKeyhole size={17} /><input id="auth-password-confirmation" name="passwordConfirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Digite a mesma senha" required minLength={8} disabled={busy} /></div></label>}
        {!recovery && mode === "login" && <button type="button" className="auth-forgot" onClick={() => changeMode("reset")} disabled={busy}>Esqueci minha senha</button>}
        <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={17} className="spin" />{recovery ? passwordUpdated ? "Encerrando…" : "Atualizando…" : mode === "reset" ? "Enviando…" : "Entrando…"}</> : <>{recovery ? passwordUpdated ? "Encerrar sessão" : "Salvar nova senha" : mode === "reset" ? "Enviar link de recuperação" : "Entrar no painel"}<ArrowRight size={17} /></>}</button>
      </form>
      {!recovery && mode === "reset" ? <button className="auth-return" onClick={() => changeMode("login")} disabled={busy}><ArrowLeft size={15} />Voltar para o login</button> : !recovery && <div className="auth-invitation">Seu acesso é liberado pelo administrador do painel.</div>}
      <div className="auth-session-note"><ShieldCheck size={15} />Sua sessão fica nesta aba. Sua senha não é armazenada.</div>
    </>}</div><footer className="auth-access-footer"><span className="orbit-mark small" aria-hidden="true"><span /><i /></span>Seu trabalho, em boa órbita.</footer></section>
  </main>;
}

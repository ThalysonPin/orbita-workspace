"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowDownToLine, ArrowUpRight, Bell, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock3, ExternalLink, LayoutDashboard, List, LoaderCircle, Menu, MessageSquare, MoreHorizontal, Pause, Play, Plug, Plus, RefreshCw, RotateCcw, Search, Settings2, Sparkles, Sun, Target, Video, X, LogOut } from "lucide-react";
import { createDemoData } from "@/lib/demo-data";
import { mergeLiveWorkspace } from "@/lib/workspace-merge";
import IntegrationSettingsForm from "@/components/integration-settings-form";
import { sameOriginWorkspaceFetch, type WorkspaceFetch, type WorkspaceUser } from "@/lib/workspace-api";
import type { CalendarEvent, Company, Connection, Message, Provider, Task, WorkspaceData } from "@/lib/workspace-types";

type View = "overview" | "calendar" | "tasks" | "messages" | "integrations" | "settings";
type Modal = { type: "newTask"; title?: string; companyId?: string } | { type: "task"; id: string } | { type: "event"; id: string } | { type: "message"; id: string } | { type: "connection"; provider: Provider; companyId: string } | { type: "reset" } | null;
const STORAGE_KEY = "orbita-workspace-v1";
const TIME_ZONE = "America/Campo_Grande";
const dateKey = (date: Date | string = new Date()) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
const time = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? "Dia inteiro" : new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(date));
const dayOffset = (day: string, offset: number) => { const value = new Date(`${day}T12:00:00-04:00`); value.setUTCDate(value.getUTCDate() + offset); return dateKey(value); };
const longDate = (day: string) => !day ? "Sem prazo" : new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00-04:00`));
const eventOccursOn = (event: CalendarEvent, day: string) => { const start = new Date(event.start.length === 10 ? `${event.start}T00:00:00-04:00` : event.start); const end = new Date(event.end.length === 10 ? `${event.end}T00:00:00-04:00` : event.end); return start < new Date(`${dayOffset(day, 1)}T00:00:00-04:00`) && end > new Date(`${day}T00:00:00-04:00`); };
type ApiResult = { configured?: boolean; connections?: Connection[]; data?: WorkspaceData; message?: string; error?: string };
const navItems = [{ id: "overview" as const, label: "Visão geral", icon: LayoutDashboard }, { id: "calendar" as const, label: "Agenda", icon: CalendarDays }, { id: "tasks" as const, label: "Tarefas", icon: CircleCheck }, { id: "messages" as const, label: "Mensagens", icon: MessageSquare }];
const providerNames: Record<Provider, string> = { google: "Google Calendar", clickup: "ClickUp", slack: "Slack", discord: "Discord" };
const companyStyle = (company?: Company) => ({ "--company-color": company?.color || "#8c8c82" }) as CSSProperties;

function OrbitMark({ small = false }: { small?: boolean }) {
  return <span className={`orbit-mark ${small ? "small" : ""}`} aria-hidden="true"><span /><i /></span>;
}
function ProviderIcon({ provider }: { provider: Provider | "local" }) {
  if (provider === "google") return <span className="provider-icon google-icon" aria-label="Google Calendar"><CalendarDays size={14} /></span>;
  if (provider === "clickup") return <span className="provider-icon clickup-icon" aria-label="ClickUp"><Check size={14} strokeWidth={3} /></span>;
  if (provider === "slack") return <span className="provider-icon slack-icon" aria-label="Slack">#</span>;
  if (provider === "discord") return <span className="provider-icon discord-icon" aria-label="Discord"><MessageSquare size={13} fill="currentColor" /></span>;
  return <span className="provider-icon local-icon" aria-label="Órbita"><OrbitMark small /></span>;
}
function CompanyTag({ company, compact = false }: { company?: Company; compact?: boolean }) {
  return <span className={`company-tag ${compact ? "compact" : ""}`} style={companyStyle(company)}><i />{company?.name || "Empresa"}</span>;
}
function EmptyState({ title, description, icon: Icon = Search }: { title: string; description: string; icon?: typeof Search }) {
  return <div className="empty-state"><span><Icon size={24} strokeWidth={1.5} /></span><h3>{title}</h3><p>{description}</p></div>;
}

type DashboardProps = { initialData: WorkspaceData; api?: WorkspaceFetch; user?: WorkspaceUser; onSignOut?: () => Promise<void> };

export default function WorkspaceDashboard({ initialData, api = sameOriginWorkspaceFetch, user, onSignOut }: DashboardProps) {
  const storageKey = user?.id ? `${STORAGE_KEY}:${user.id}` : STORAGE_KEY;
  const profileName = user?.name || user?.email?.split("@")[0] || "Meu espaço pessoal";
  const profileInitial = user ? profileName.charAt(0).toLocaleUpperCase("pt-BR") : "T";
  const [signingOut, setSigningOut] = useState(false);
  const [data, setData] = useState<WorkspaceData>(initialData);
  const [view, setView] = useState<View>("overview");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [calendarMode, setCalendarMode] = useState("day");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkingConnections, setCheckingConnections] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [focusMinutes, setFocusMinutes] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const remainingRef = useRef(remainingSeconds);
  const modalRef = useRef<HTMLDivElement>(null);
  const localTasks = useRef<Task[]>([]);
  const companyNames = useRef<Record<string, string>>({});
  const readMessageIds = useRef<Set<string>>(new Set());
  const today = dateKey();
  const company = useCallback((id: string) => data.companies.find((item) => item.id === id), [data.companies]);
  const navigate = (next: View) => { setView(next); setMobileMenu(false); setQuery(""); if (next === "overview") setStatusFilter("open"); };
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && typeof saved === "object") {
        if (Array.isArray(saved.localTasks)) localTasks.current = saved.localTasks.filter((task: Task) => task.source === "local" && typeof task.title === "string");
        if (saved.companyNames && typeof saved.companyNames === "object") companyNames.current = saved.companyNames;
        if (saved.workspaceMode === "live") {
          setData((previous) => ({ ...previous, mode: "live", companies: previous.companies.map((item) => ({ ...item, name: companyNames.current[item.id] || item.name })), tasks: localTasks.current, events: [], messages: [] }));
        } else if (initialData.mode === "demo" && saved.demoData?.mode === "demo" && Array.isArray(saved.demoData.tasks) && Array.isArray(saved.demoData.companies) && Array.isArray(saved.demoData.events) && Array.isArray(saved.demoData.messages) && Array.isArray(saved.demoData.connections)) {
          const fresh = createDemoData();
          const savedDate = saved.day;
          setData(savedDate === dateKey() ? saved.demoData : { ...fresh, companies: fresh.companies.map((item) => ({ ...item, name: companyNames.current[item.id] || item.name })), tasks: [...localTasks.current, ...fresh.tasks] });
        } else if (localTasks.current.length) {
          setData((previous) => ({ ...previous, tasks: [...localTasks.current, ...previous.tasks.filter((task) => !localTasks.current.some((local) => local.id === task.id))] }));
        }
        if (typeof saved.focusMinutes === "number" && saved.day === dateKey()) setFocusMinutes(saved.focusMinutes);
        if (Array.isArray(saved.readMessageIds)) readMessageIds.current = new Set(saved.readMessageIds.filter((id: unknown) => typeof id === "string"));
      }
    } catch { /* A private browser or invalid saved state must not prevent startup. */ }
    setStorageReady(true);
    const callbackParams = new URLSearchParams(window.location.search);
    const callbackResult = callbackParams.get("integration");
    if (callbackResult) {
      setView("integrations");
      const callbackProvider = callbackParams.get("provider");
      const providerLabel = callbackProvider && callbackProvider in providerNames ? providerNames[callbackProvider as Provider] : "Google Calendar";
      notify(callbackResult === "connected" ? `${providerLabel} autorizado. Estamos atualizando seu painel.` : "Não foi possível concluir a autorização. Abra a integração para revisar a configuração e tentar novamente.");
      ["integration", "provider", "company", "reason"].forEach((key) => callbackParams.delete(key));
      const queryString = callbackParams.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`);
    }
    let active = true;
    api("/api/workspace", { credentials: "same-origin" }).then(async (response) => {
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.message || "Não foi possível verificar as integrações.");
      if (!active) return;
      setServerConfigured(Boolean(result.configured));
      if (Array.isArray(result.connections)) setData((previous) => ({ ...previous, connections: result.connections! }));
      if (result.configured) {
        setSyncing(true);
        const syncResponse = await api("/api/sync", { method: "POST", credentials: "same-origin" });
        const synced = await syncResponse.json() as ApiResult;
        if (!syncResponse.ok || !synced.data) throw new Error(synced.message || "Não foi possível carregar suas contas.");
        if (!active) return;
        const incoming = synced.data;
        setData((previous) => { const merged = mergeLiveWorkspace(previous, incoming); return { ...merged, messages: merged.messages.map((message) => readMessageIds.current.has(message.id) ? { ...message, unread: false } : message) }; });
        const failures = incoming.connections.filter((connection) => connection.status === "error").length;
        if (failures) notify(`${failures} ${failures === 1 ? "integração requer" : "integrações requerem"} atenção. Consulte Integrações para ver os detalhes.`);
      }
    }).catch((error: unknown) => { if (active) notify(error instanceof Error ? error.message : "Não foi possível verificar as integrações. O painel local continua disponível."); }).finally(() => { if (active) { setCheckingConnections(false); setSyncing(false); } });
    return () => { active = false; };
  }, [initialData.mode, notify, api, storageKey]);

  useEffect(() => {
    if (!storageReady) return;
    localTasks.current = data.tasks.filter((task) => task.source === "local");
    companyNames.current = Object.fromEntries(data.companies.map((item) => [item.id, item.name]));
    try { localStorage.setItem(storageKey, JSON.stringify({ day: today, workspaceMode: data.mode, demoData: data.mode === "demo" ? data : undefined, localTasks: localTasks.current, companyNames: companyNames.current, readMessageIds: [...readMessageIds.current], focusMinutes })); } catch { /* Saving can be disabled in private browsing. */ }
  }, [data, storageReady, today, focusMinutes, storageKey]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(""), 5500); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => { remainingRef.current = remainingSeconds; }, [remainingSeconds]);
  useEffect(() => {
    if (!timerRunning) return;
    const endsAt = Date.now() + remainingRef.current * 1000;
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) { window.clearInterval(interval); setTimerRunning(false); setFocusMinutes((minutes) => minutes + 25); notify("Sessão concluída. 25 minutos de atenção ao que importa ✨"); }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning, notify]);
  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape") { setModal(null); setMobileMenu(false); searchRef.current?.blur(); }
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const timeout = window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>("input, button, a, select")?.focus(), 40);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = modalRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, textarea");
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { window.clearTimeout(timeout); document.removeEventListener("keydown", trap); previous?.focus(); };
  }, [modal]);

  const matches = (id: string, text: string) => (companyFilter === "all" || companyFilter === id) && (!query || text.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const filteredTasks = data.tasks.filter((task) => matches(task.companyId, `${task.title} ${task.project} ${company(task.companyId)?.name}`));
  const openTasks = filteredTasks.filter((task) => task.status !== "done");
  const visibleTasks = filteredTasks.filter((task) => statusFilter === "all" || (statusFilter === "done" ? task.status === "done" : statusFilter === "in_progress" ? task.status === "in_progress" : task.status !== "done"));
  const filteredMessages = data.messages.filter((message) => matches(message.companyId, `${message.body} ${message.author} ${message.channel} ${company(message.companyId)?.name}`));
  const unreadMessages = filteredMessages.filter((message) => message.unread);
  const todayEvents = data.events.filter((event) => eventOccursOn(event, today) && matches(event.companyId, `${event.title} ${company(event.companyId)?.name}`)).sort((a, b) => a.start.localeCompare(b.start));
  const weekStart = useMemo(() => { const day = new Date(`${selectedDate}T12:00:00-04:00`).getUTCDay(); return dayOffset(selectedDate, -(day === 0 ? 6 : day - 1)); }, [selectedDate]);
  const agendaEvents = data.events.filter((event) => matches(event.companyId, `${event.title} ${company(event.companyId)?.name}`) && (calendarMode === "week" ? Array.from({ length: 7 }, (_, index) => dayOffset(weekStart, index)).some((day) => eventOccursOn(event, day)) : calendarMode === "list" ? dateKey(event.end) >= selectedDate : eventOccursOn(event, selectedDate))).sort((a, b) => a.start.localeCompare(b.start));
  const completeTask = (task: Task) => {
    if (data.mode === "live" && task.source === "clickup") { notify("Abra esta tarefa no ClickUp para atualizar o status. As integrações são de leitura."); return; }
    setData((previous) => ({ ...previous, tasks: previous.tasks.map((item) => item.id === task.id ? { ...item, status: item.status === "done" ? "todo" : "done" } : item) }));
    notify(task.status === "done" ? "Tarefa reaberta." : "Mais uma tarefa concluída. Bom trabalho!");
  };
  const markRead = (id?: string) => { data.messages.filter((message) => !id || message.id === id).forEach((message) => readMessageIds.current.add(message.id)); setData((previous) => ({ ...previous, messages: previous.messages.map((item) => !id || item.id === id ? { ...item, unread: false } : item) })); notify(id ? "Mensagem marcada como lida neste painel." : "Todas as mensagens marcadas como lidas neste painel."); };
  const createTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fields = new FormData(event.currentTarget); const title = String(fields.get("title") || "").trim(); if (!title) return;
    const task: Task = { id: `local-${crypto.randomUUID()}`, title, companyId: String(fields.get("company")), source: "local", status: "todo", priority: String(fields.get("priority")) as Task["priority"], dueDate: String(fields.get("dueDate")), project: String(fields.get("project") || "Pessoal").trim() || "Pessoal", estimatedMinutes: Number(fields.get("duration")) || undefined };
    setData((previous) => ({ ...previous, tasks: [task, ...previous.tasks] })); setModal(null); notify("Tarefa criada e salva neste navegador.");
  };
  const sync = async () => {
    if (!serverConfigured) { navigate("integrations"); notify("Configure as integrações para sincronizar suas contas."); return; }
    setSyncing(true);
    try { const response = await api("/api/sync", { method: "POST", credentials: "same-origin" }); const result = await response.json() as ApiResult; if (!response.ok || !result.data) throw new Error(result.message || "Não foi possível sincronizar agora."); const incoming = result.data; setData((previous) => { const merged = mergeLiveWorkspace(previous, incoming); return { ...merged, messages: merged.messages.map((message) => readMessageIds.current.has(message.id) ? { ...message, unread: false } : message) }; }); const failures = incoming.connections.filter((connection) => connection.status === "error").length; notify(failures ? `${failures} ${failures === 1 ? "integração requer" : "integrações requerem"} atenção. ${incoming.connections.some((connection) => connection.status === "connected") ? "Os dados disponíveis foram atualizados." : "Não foi possível atualizar as contas."} Veja os detalhes em Integrações.` : "Suas informações foram atualizadas."); } catch (error) { notify(error instanceof Error ? error.message : "Erro ao sincronizar. Tente novamente."); } finally { setSyncing(false); }
  };
  const refreshIntegrations = async () => {
    setCheckingConnections(true);
    setSyncing(true);
    try {
      const response = await api("/api/workspace", { credentials: "same-origin" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.message || "Não foi possível atualizar as integrações.");
      setServerConfigured(Boolean(result.configured));
      if (Array.isArray(result.connections)) setData((previous) => ({ ...previous, connections: result.connections! }));
      if (!result.configured) {
        setData((previous) => ({ ...previous, mode: "live", tasks: previous.tasks.filter((task) => task.source === "local"), events: [], messages: [], connections: result.connections || previous.connections, syncedAt: undefined }));
        notify("Integração desconectada. Suas tarefas locais continuam no painel.");
        return;
      }
      const syncResponse = await api("/api/sync", { method: "POST", credentials: "same-origin" });
      const synced = await syncResponse.json() as ApiResult;
      if (!syncResponse.ok || !synced.data) throw new Error(synced.message || "Configuração salva. Não foi possível sincronizar agora.");
      const incoming = synced.data;
      setData((previous) => { const merged = mergeLiveWorkspace(previous, incoming); return { ...merged, messages: merged.messages.map((message) => readMessageIds.current.has(message.id) ? { ...message, unread: false } : message) }; });
      const failures = incoming.connections.filter((connection) => connection.status === "error").length;
      notify(failures ? `Configuração atualizada. ${failures} ${failures === 1 ? "integração requer" : "integrações requerem"} atenção; consulte os detalhes abaixo.` : "Integrações atualizadas. Seus dados já estão no painel.");
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível atualizar o painel."); throw error; }
    finally { setCheckingConnections(false); setSyncing(false); }
  };
  const signOut = async () => {
    if (!onSignOut) return;
    setSigningOut(true);
    setModal(null);
    setTimerRunning(false);
    setData((previous) => ({ ...previous, tasks: previous.tasks.filter((task) => task.source === "local"), events: [], messages: [] }));
    try { await onSignOut(); } catch { notify("Não foi possível encerrar a sessão. Tente novamente."); setSigningOut(false); }
  };
  const exportData = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `orbita-${today}.json`; anchor.click(); URL.revokeObjectURL(url); notify("Arquivo do painel exportado."); };
  const resetDemo = () => { const fresh = createDemoData(); localTasks.current = []; companyNames.current = {}; readMessageIds.current.clear(); setData(fresh); setFocusMinutes(0); setTimerRunning(false); setRemainingSeconds(1500); setModal(null); setCompanyFilter("all"); notify("Demonstração restaurada. Os dados locais foram removidos."); };
  const selectedTask = modal?.type === "task" ? data.tasks.find((task) => task.id === modal.id) : undefined;
  const selectedEvent = modal?.type === "event" ? data.events.find((event) => event.id === modal.id) : undefined;
  const selectedMessage = modal?.type === "message" ? data.messages.find((message) => message.id === modal.id) : undefined;
  const title = view === "overview" ? "Seu dia, em perspectiva." : view === "calendar" ? "Espaço para cada compromisso." : view === "tasks" ? "Um passo de cada vez." : view === "messages" ? "Conversas que importam." : view === "integrations" ? "Tudo começa com uma conexão." : "Do seu jeito, no seu ritmo.";
  const subtitle = view === "overview" ? "Três empresas. Um lugar para organizar o que importa." : view === "calendar" ? "Suas agendas, lado a lado. Sem perder o próximo encontro." : view === "tasks" ? "Todas as suas entregas, com a clareza que você precisa." : view === "messages" ? "Slack e Discord, com contexto e espaço para agir." : view === "integrations" ? "Conecte suas ferramentas e traga o seu trabalho para a órbita." : "Ajuste seu espaço para acompanhar a sua rotina.";

  const renderTask = (task: Task) => <div className={`task-row ${task.status === "done" ? "is-complete" : ""}`} key={task.id}>
    <button className="task-checkbox" aria-label={`${task.status === "done" ? "Reabrir" : "Concluir"} tarefa: ${task.title}`} aria-pressed={task.status === "done"} onClick={() => completeTask(task)}>{task.status === "done" && <Check size={12} strokeWidth={3} />}</button>
    <button className="task-content" onClick={() => setModal({ type: "task", id: task.id })}><span className="task-name">{task.title}</span><span className="task-meta"><CompanyTag company={company(task.companyId)} compact /><span className="meta-dot">·</span><span>{task.project}</span>{task.source === "local" && <span className="local-label">Local</span>}</span></button>
    <div className="task-aside"><span className={`priority-dot ${task.priority}`} title={`Prioridade ${task.priority === "high" ? "alta" : task.priority === "medium" ? "média" : "baixa"}`} /><span className={task.dueDate && task.dueDate < today && task.status !== "done" ? "due overdue" : "due"}>{!task.dueDate ? "Sem prazo" : task.dueDate === today ? "Hoje" : task.dueDate === dayOffset(today, 1) ? "Amanhã" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TIME_ZONE }).format(new Date(`${task.dueDate}T12:00:00-04:00`))}</span></div>
  </div>;
  const renderEvent = (event: CalendarEvent, index: number) => <button className={`agenda-row event-${index}`} style={companyStyle(company(event.companyId))} key={event.id} onClick={() => setModal({ type: "event", id: event.id })}>
    <span className="agenda-time"><strong>{time(event.start)}</strong><span>{event.start.length === 10 ? "" : time(event.end)}</span></span><span className="timeline-axis"><i /><b /></span><span className="agenda-event"><span className="event-top"><CompanyTag company={company(event.companyId)} /><span className="event-duration">{event.start.length === 10 ? "Dia inteiro" : `${Math.round((+new Date(event.end) - +new Date(event.start)) / 60000)} min`}</span></span><strong>{event.title}{event.start.length > 10 && data.events.some((other) => other.id !== event.id && other.start.length > 10 && +new Date(other.start) < +new Date(event.end) && +new Date(other.end) > +new Date(event.start)) && <span className="overlap-label" title="Este horário coincide com outro compromisso">Conflito</span>}</strong><span className="event-bottom"><Video size={12} /> {event.source === "google" ? "Google Meet" : event.location || "Compromisso local"}{data.mode === "demo" && <span className="sample-word">· exemplo</span>}<ArrowUpRight size={14} /></span></span>
  </button>;
  const renderMessage = (message: Message, expanded = false) => <div className={`message-card ${message.unread ? "unread" : ""} ${expanded ? "expanded" : ""}`} key={message.id}>
    <div className="message-card-top"><CompanyTag company={company(message.companyId)} compact /><span className="message-provider"><ProviderIcon provider={message.source} /><span>#{message.channel}</span></span></div>
    <button className="message-body-button" onClick={() => setModal({ type: "message", id: message.id })}><span className="author-row"><span className="person-avatar" style={companyStyle(company(message.companyId))}>{message.author.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><strong>{message.author}</strong><time>{time(message.timestamp)}</time>{message.unread && <i className="unread-dot" />}</span><p>{message.body}</p></button>
    {expanded && <div className="message-actions"><button className="text-button" onClick={() => setModal({ type: "newTask", title: message.body, companyId: message.companyId })}><Plus size={14} />Criar tarefa</button>{message.unread && <button className="text-button" onClick={() => markRead(message.id)}><CheckCheck size={14} />Marcar como lida</button>}</div>}
  </div>;

  return <div className="workspace-shell">
    <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
    {mobileMenu && <button aria-label="Fechar navegação" className="sidebar-scrim" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? "is-open" : ""}`}>
      <button className="brand" onClick={() => navigate("overview")} aria-label="Órbita, início"><OrbitMark /><span>órbita<span className="brand-period">.</span></span></button>
      <div className="workspace-switcher"><span className="workspace-avatar">T</span><span><strong>Meu workspace</strong><small>Seu universo de trabalho</small></span><ChevronDown size={14} /></div>
      <span className="nav-label">WORKSPACE</span>
      <nav aria-label="Navegação principal">{navItems.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}><item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{item.id === "messages" && data.messages.some((message) => message.unread) && <span className="nav-count">{data.messages.filter((message) => message.unread).length}</span>}</button>)}</nav>
      <div className="company-section"><span className="nav-label">SUAS EMPRESAS <span>03</span></span>{data.companies.map((item) => <button className={`sidebar-company ${companyFilter === item.id ? "selected" : ""}`} key={item.id} style={companyStyle(item)} onClick={() => { setCompanyFilter(companyFilter === item.id ? "all" : item.id); if (view === "integrations" || view === "settings") navigate("overview"); }}><span className="company-initial">{item.initials}</span><span>{item.name}</span><i /></button>)}</div>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-orbit"><OrbitMark small /></span><strong>Mais clareza.<br />Menos abas abertas.</strong><p>Seu trabalho encontra<br />o próprio ritmo.</p><span className="note-sparkle">✳</span></div><button className={`nav-item ${view === "integrations" ? "active" : ""}`} onClick={() => navigate("integrations")}><Plug size={18} strokeWidth={1.7} />Integrações<span className="connection-indicator" /></button><button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}><Settings2 size={18} strokeWidth={1.7} />Configurações</button><div className="sidebar-profile"><span className="profile-avatar">{profileInitial}</span><span style={{ minWidth: 0 }}><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{profileName}</strong><small>{user ? "Sua conta pessoal" : "Um dia de cada vez"}</small></span><button className="icon-button" aria-label={onSignOut ? "Sair da conta" : "Configurações do perfil"} onClick={onSignOut ? signOut : () => navigate("settings")} disabled={signingOut}>{onSignOut ? <LogOut size={17} /> : <MoreHorizontal size={17} />}</button></div></div>
    </aside>

    <div className="workspace-main">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu-button" aria-label="Abrir navegação" onClick={() => setMobileMenu(true)}><Menu size={20} /></button><span>Meu workspace</span><ChevronRight size={13} /><strong>{view === "overview" ? "Visão geral" : view === "calendar" ? "Agenda" : view === "tasks" ? "Tarefas" : view === "messages" ? "Mensagens" : view === "integrations" ? "Integrações" : "Configurações"}</strong></div><div className="topbar-actions"><label className="search-field"><Search size={16} /><input ref={searchRef} aria-label="Buscar tarefas, eventos e mensagens" placeholder="Buscar no seu universo…" value={query} onChange={(event) => { setQuery(event.target.value); if (view === "integrations" || view === "settings") setView("overview"); }} /><kbd>⌘ K</kbd>{query && <button aria-label="Limpar busca" onClick={() => setQuery("")}><X size={13} /></button>}</label><button className="notification-button icon-button" aria-label={`${unreadMessages.length} mensagens não lidas. Abrir mensagens`} onClick={() => { setView("messages"); setUnreadOnly(true); }}>{unreadMessages.length > 0 && <i />}<Bell size={19} strokeWidth={1.7} /></button><span className="topbar-divider" /><button className="profile-avatar" aria-label="Abrir configurações" onClick={() => navigate("settings")}>{profileInitial}</button></div></header>
      <main id="main-content" className="main-content">
        <div className="heading-area"><div><div className="day-greeting"><Sun size={15} /><span>{new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span><span className={`mode-badge ${data.mode === "live" ? "live" : ""}`}><i />{data.mode === "demo" ? "Modo demonstração" : serverConfigured ? "Dados das suas contas" : "Workspace local"}</span></div><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div><button className="primary-button create-task-button" onClick={() => setModal({ type: "newTask" })}><Plus size={17} strokeWidth={2} />Nova tarefa</button></div>

        {view !== "integrations" && view !== "settings" && <div className="filter-bar"><div className="company-filters"><button className={companyFilter === "all" ? "company-filter all active" : "company-filter all"} onClick={() => setCompanyFilter("all")}><span className="all-company-icon"><span /><span /><span /></span>Todas as empresas</button><span className="filter-separator" />{data.companies.map((item) => <button className={`company-filter ${companyFilter === item.id ? "active" : ""}`} key={item.id} style={companyStyle(item)} onClick={() => setCompanyFilter(item.id)}><i />{item.name}</button>)}</div><button className="sync-button" onClick={sync} disabled={syncing || checkingConnections}><RefreshCw size={12} className={syncing || checkingConnections ? "spin" : ""} />{checkingConnections ? "Verificando integrações" : syncing ? "Atualizando…" : data.syncedAt ? `Atualizado às ${time(data.syncedAt)}` : "Sincronizar contas"}</button></div>}

        {query && <div className="search-summary"><Search size={14} /><span>Resultados para <strong>“{query}”</strong></span><button onClick={() => setQuery("")}>Limpar busca</button></div>}

        {view === "overview" && <>
          <section className="metrics-grid" aria-label="Resumo do seu dia">
            <button className="metric" onClick={() => { setView("tasks"); setStatusFilter("open"); }}><span className="metric-label">Tarefas em aberto<CircleCheck size={16} /></span><span className="metric-main"><strong>{openTasks.length.toString().padStart(2, "0")}</strong><span className="metric-pill orange">{openTasks.filter((task) => task.dueDate === today).length} para hoje</span></span><span className="metric-foot">Um passo mais perto de concluir</span></button>
            <button className="metric" onClick={() => { setView("calendar"); setSelectedDate(today); }}><span className="metric-label">Compromissos hoje<CalendarDays size={16} /></span><span className="metric-main"><strong>{todayEvents.length.toString().padStart(2, "0")}</strong><span className="mini-avatars">{data.companies.map((item) => <i key={item.id} style={companyStyle(item)}>{item.initials}</i>)}</span></span><span className="metric-foot">Suas agendas em sintonia</span></button>
            <button className="metric" onClick={() => { setView("messages"); setUnreadOnly(true); }}><span className="metric-label">Mensagens não lidas<MessageSquare size={16} /></span><span className="metric-main"><strong>{unreadMessages.length.toString().padStart(2, "0")}</strong><span className="metric-pill lavender">{new Set(unreadMessages.map((message) => message.source)).size} {new Set(unreadMessages.map((message) => message.source)).size === 1 ? "ferramenta" : "ferramentas"}</span></span><span className="metric-foot">O que precisa da sua atenção</span></button>
            <button className="metric progress-metric" onClick={() => { setView("tasks"); setStatusFilter("done"); }}><span className="metric-label">Seu progresso<Target size={16} /></span><span className="metric-main"><strong>{filteredTasks.filter((task) => task.status === "done").length}<small>/{filteredTasks.length}</small></strong><span className="progress-text">tarefas concluídas</span></span><span className="progress-track"><i style={{ width: `${filteredTasks.length ? filteredTasks.filter((task) => task.status === "done").length / filteredTasks.length * 100 : 0}%` }} /></span></button>
          </section>
          <div className="overview-grid"><section className="panel agenda-panel"><div className="panel-heading"><h2><CalendarDays size={17} />Sua agenda<span className="count-badge">{todayEvents.length}</span></h2><button className="panel-link" onClick={() => { setView("calendar"); setSelectedDate(today); }}>Ver agenda<ArrowUpRight size={14} /></button></div><div className="agenda-date-row"><span><strong>Hoje</strong><span> · {longDate(today)}</span></span><span className="timezone-label">GMT−4</span></div><div className="agenda-list">{todayEvents.length ? todayEvents.map(renderEvent) : <EmptyState title="Um pouco de espaço na agenda" description={query ? "Nenhum compromisso corresponde à sua busca." : "Nenhum compromisso para hoje nesta seleção."} icon={CalendarDays} />}</div><div className="panel-bottom"><span className="small-status-dot" />{data.mode === "demo" ? "Eventos de exemplo · conecte suas agendas" : "Google Calendar · todas as suas agendas"}</div></section>
          <section className="panel tasks-panel"><div className="panel-heading"><h2><CircleCheck size={17} />Suas prioridades<span className="count-badge">{openTasks.length}</span></h2><button className="panel-link" onClick={() => { setView("tasks"); setStatusFilter("open"); }}>Ver todas<ArrowUpRight size={14} /></button></div><div className="task-list-tabs"><button className={statusFilter === "open" ? "selected" : ""} onClick={() => setStatusFilter("open")}>Em aberto <span>{openTasks.length}</span></button><button className={statusFilter === "done" ? "selected" : ""} onClick={() => setStatusFilter("done")}>Concluídas <span>{filteredTasks.filter((task) => task.status === "done").length}</span></button><span className="priority-key"><i /> Prioridade</span></div><div className="task-list">{visibleTasks.length ? visibleTasks.slice(0, 5).map(renderTask) : <EmptyState title={statusFilter === "done" ? "Seu próximo check vem aí" : "Tudo em dia por aqui"} description={query ? "Nenhuma tarefa corresponde à sua busca." : statusFilter === "done" ? "As tarefas concluídas aparecem aqui." : "Crie uma tarefa e dê o próximo passo."} icon={CircleCheck} />}</div><button className="inline-add-task" onClick={() => setModal({ type: "newTask" })}><Plus size={15} />Adicionar uma tarefa<span>↵</span></button><div className="panel-bottom"><ProviderIcon provider="clickup" />{data.mode === "demo" ? "Tarefas de exemplo e tarefas locais" : "ClickUp e suas tarefas locais"}</div></section></div>
          <div className="lower-grid"><section className="panel messages-panel"><div className="panel-heading"><h2><MessageSquare size={17} />No seu radar<span className="unread-indicator" /></h2><button className="panel-link" onClick={() => { setView("messages"); setUnreadOnly(false); }}>Todas as mensagens<ArrowUpRight size={14} /></button></div><div className="message-grid">{filteredMessages.length ? filteredMessages.slice(0, 2).map((message) => renderMessage(message)) : <EmptyState title="O radar está tranquilo" description="As mensagens da seleção aparecem aqui." icon={MessageSquare} />}</div></section><section className={`focus-panel ${timerRunning ? "running" : ""}`}><div className="focus-top"><span><Sparkles size={15} /> UM TEMPO PARA FOCAR</span><span className="focus-decoration">✳</span></div><div className="focus-content"><div><h2>{timerRunning ? "Uma coisa de cada vez." : "Seu próximo bom trabalho."}</h2><p>{focusMinutes ? `${focusMinutes} minutos de foco hoje. Continue assim.` : "Dê espaço para o que precisa de você."}</p></div><div className="focus-controls"><span className="timer-value" aria-label={`${Math.floor(remainingSeconds / 60)} minutos e ${remainingSeconds % 60} segundos`}>{String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}<i>:</i>{String(remainingSeconds % 60).padStart(2, "0")}</span><div><button className="focus-start" onClick={() => { if (remainingSeconds === 0) setRemainingSeconds(1500); setTimerRunning(!timerRunning); }}>{timerRunning ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}{timerRunning ? "Pausar" : remainingSeconds < 1500 && remainingSeconds > 0 ? "Continuar" : "Iniciar foco"}</button><button className="focus-reset" aria-label="Reiniciar cronômetro de foco" onClick={() => { setTimerRunning(false); setRemainingSeconds(1500); }}><RotateCcw size={14} /></button></div></div></div></section></div>
        </>}

        {view === "calendar" && <section className="panel full-panel"><div className="calendar-toolbar"><div className="calendar-title"><button className="icon-button" aria-label="Período anterior" onClick={() => setSelectedDate(dayOffset(selectedDate, calendarMode === "week" ? -7 : -1))}><ChevronLeft size={18} /></button><h2>{calendarMode === "week" ? `${longDate(weekStart)} – ${longDate(dayOffset(weekStart, 6))}` : longDate(selectedDate)}</h2><button className="icon-button" aria-label="Próximo período" onClick={() => setSelectedDate(dayOffset(selectedDate, calendarMode === "week" ? 7 : 1))}><ChevronRight size={18} /></button><button className="secondary-button compact-button" onClick={() => setSelectedDate(today)}>Hoje</button></div><div className="segmented-control">{[{ id: "day", label: "Dia" }, { id: "week", label: "Semana" }, { id: "list", label: "Lista" }].map((item) => <button key={item.id} className={calendarMode === item.id ? "active" : ""} onClick={() => setCalendarMode(item.id)}>{item.id === "list" && <List size={13} />}{item.label}</button>)}</div></div><div className="week-strip">{Array.from({ length: 7 }, (_, index) => { const day = dayOffset(weekStart, index); return <button className={`${day === selectedDate ? "selected" : ""} ${day === today ? "today" : ""}`} key={day} onClick={() => { setSelectedDate(day); setCalendarMode("day"); }}><span>{new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: TIME_ZONE }).format(new Date(`${day}T12:00:00-04:00`)).replace(".", "")}</span><strong>{Number(day.slice(-2))}</strong><i style={{ visibility: data.events.some((event) => eventOccursOn(event, day)) ? "visible" : "hidden" }} /></button>; })}</div><div className="full-agenda-list">{agendaEvents.length ? agendaEvents.map((event, index) => <div key={event.id}>{calendarMode !== "day" && (index === 0 || dateKey(agendaEvents[index - 1].start) !== dateKey(event.start)) && <h3 className="list-date-label">{longDate(dateKey(event.start))}</h3>}{renderEvent(event, index)}</div>) : <EmptyState title="Este espaço é todo seu" description="Nenhum compromisso neste período. Use as setas para navegar pela agenda." icon={CalendarDays} />}</div><div className="panel-bottom">Horários em America/Campo_Grande (GMT−4){data.mode === "demo" && " · Eventos de demonstração"}</div></section>}

        {view === "tasks" && <section className="panel full-panel"><div className="task-page-toolbar"><div className="task-list-tabs">{[{ id: "open", label: "Em aberto" }, { id: "in_progress", label: "Em andamento" }, { id: "done", label: "Concluídas" }, { id: "all", label: "Todas" }].map((item) => <button className={statusFilter === item.id ? "selected" : ""} key={item.id} onClick={() => setStatusFilter(item.id)}>{item.label}</button>)}</div><span className="results-count">{visibleTasks.length} {visibleTasks.length === 1 ? "tarefa" : "tarefas"}</span></div><div className="task-table-heading"><span>TAREFA / PROJETO</span><span>PRIORIDADE · PRAZO</span></div><div className="task-list full-task-list">{visibleTasks.length ? visibleTasks.map(renderTask) : <EmptyState title="Tudo organizado por aqui" description={query ? "Tente buscar por outro título ou projeto." : "Nenhuma tarefa nesta seleção. Crie uma nova tarefa para começar."} icon={CircleCheck} />}</div><button className="inline-add-task" onClick={() => setModal({ type: "newTask" })}><Plus size={15} />Adicionar uma tarefa</button><div className="panel-bottom">Tarefas locais são salvas neste navegador. {data.mode === "demo" ? "Os itens do ClickUp são exemplos." : "Atualize tarefas do ClickUp na ferramenta de origem."}</div></section>}

        {view === "messages" && <section className="panel full-panel"><div className="messages-toolbar"><div className="segmented-control"><button className={!unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(false)}>Todas<span>{filteredMessages.length}</span></button><button className={unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(true)}>Não lidas<span>{unreadMessages.length}</span></button></div><button className="text-button" onClick={() => markRead()} disabled={!data.messages.some((message) => message.unread)}><CheckCheck size={15} />Marcar todas como lidas</button></div><div className="inbox-grid">{(unreadOnly ? unreadMessages : filteredMessages).length ? (unreadOnly ? unreadMessages : filteredMessages).map((message) => renderMessage(message, true)) : <EmptyState title="Você está em dia" description={query ? "Nenhuma mensagem corresponde à sua busca." : "Nenhuma mensagem para ler nesta seleção."} icon={MessageSquare} />}</div><div className="panel-bottom">A marcação de leitura acontece apenas neste painel.{data.mode === "demo" && " · Conversas fictícias para demonstração."}</div></section>}

        {view === "integrations" && <div className="integrations-content"><div className="connection-overview"><span className="connection-overview-icon"><Plug size={23} /></span><div><strong>{data.connections.filter((connection) => connection.status === "connected").length} de {data.connections.length} integrações configuradas</strong><p>{data.mode === "demo" ? "Você está explorando dados de exemplo. Conecte suas contas para ver sua rotina real." : "Suas credenciais ficam no servidor. Cada empresa mantém suas próprias conexões."}</p></div><button className="secondary-button" onClick={sync} disabled={syncing || !serverConfigured}>{syncing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}Sincronizar</button></div><div className="integration-company-grid">{data.companies.map((item) => <section className="panel integration-company" key={item.id} style={companyStyle(item)}><div className="integration-company-header"><span className="company-initial">{item.initials}</span><div><h2>{item.name}</h2><p>Seu espaço de trabalho</p></div><span className="integration-company-dot" /></div>{data.connections.filter((connection) => connection.companyId === item.id).map((connection) => <div className="integration-row" key={connection.id}><span className={`large-provider ${connection.provider}`}><ProviderIcon provider={connection.provider} /></span><div><strong>{connection.label}</strong><small className={`connection-status ${connection.status}`}><i />{connection.status === "connected" ? "Configurado" : connection.status === "error" ? "Requer atenção" : "Não conectado"}</small>{connection.detail && <p>{connection.detail}</p>}</div><button className="connection-button" onClick={() => setModal({ type: "connection", provider: connection.provider, companyId: item.id })}>{connection.status === "connected" ? "Detalhes" : "Configurar"}<ArrowUpRight size={12} /></button></div>)}</section>)}</div><div className="integration-info"><span><Sparkles size={18} /></span><div><h3>Um painel. Três contextos bem definidos.</h3><p>Use as cores e os filtros de empresa para manter suas agendas, tarefas e conversas organizadas. As integrações consultam apenas as contas e os canais autorizados.</p></div></div></div>}

        {view === "settings" && <div className="settings-content"><section className="panel settings-panel"><div className="panel-heading"><h2>Suas empresas</h2><span className="subtle-text">Personalize os nomes do seu espaço</span></div><form onSubmit={(event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); setData((previous) => ({ ...previous, companies: previous.companies.map((item) => ({ ...item, name: String(fields.get(item.id) || item.name).trim() || item.name })) })); notify("Nomes das empresas atualizados neste navegador."); }}><div className="company-name-fields">{data.companies.map((item) => <label key={item.id} style={companyStyle(item)}><span className="company-initial">{item.initials}</span><span>Nome da empresa<input key={`${item.id}-${item.name}`} name={item.id} defaultValue={item.name} maxLength={36} required /></span></label>)}</div><div className="settings-form-bottom"><span>As cores ajudam a reconhecer cada contexto.</span><button className="primary-button" type="submit"><Check size={15} />Salvar alterações</button></div></form></section><section className="panel settings-panel"><div className="panel-heading"><h2>Seu painel, seus dados</h2></div>{user && <div className="setting-row"><div><strong>Sua conta</strong><p>{user.email || profileName}</p></div>{onSignOut && <button className="secondary-button" onClick={signOut} disabled={signingOut}><LogOut size={15} />{signingOut ? "Saindo…" : "Sair da conta"}</button>}</div>}<div className="setting-row"><div><strong>Fuso horário</strong><p>Todos os compromissos aparecem no horário de Campo Grande.</p></div><span className="setting-value">America/Campo_Grande · GMT−4</span></div><div className="setting-row"><div><strong>Exportar espaço de trabalho</strong><p>Baixe suas tarefas, mensagens e eventos em formato JSON.</p></div><button className="secondary-button" onClick={exportData}><ArrowDownToLine size={15} />Exportar dados</button></div><div className="setting-row"><div><strong>Armazenamento local</strong><p>Tarefas locais e preferências ficam salvas apenas neste navegador.</p></div><span className="setting-value">Neste dispositivo</span></div>{data.mode === "demo" && <div className="setting-row reset-row"><div><strong>Recomeçar a demonstração</strong><p>Remove suas alterações e tarefas locais e restaura os exemplos.</p></div><button className="secondary-button danger-button" onClick={() => setModal({ type: "reset" })}><RotateCcw size={14} />Restaurar exemplo</button></div>}</section></div>}
        <footer className="workspace-footer"><span><OrbitMark small />Seu trabalho, em boa órbita.</span><span>{data.mode === "demo" ? "Dados de exemplo · tudo pronto para explorar" : "Seu espaço pessoal de trabalho"}<span className="footer-dot">·</span>GMT−4</span></footer>
      </main>
    </div>

    {toast && <div className="toast" role="status"><CircleCheck size={17} /><span>{toast}</span><button aria-label="Fechar aviso" onClick={() => setToast("")}><X size={14} /></button></div>}
    {modal && <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><div className={`modal ${modal.type === "connection" ? "integration-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={modalRef}><button className="modal-close icon-button" aria-label="Fechar janela" onClick={() => setModal(null)}><X size={20} /></button>
      {modal.type === "newTask" && <><span className="modal-eyebrow"><CircleCheck size={16} />UMA COISA A MENOS NA CABEÇA</span><h2 id="modal-title">Um novo próximo passo.</h2><p className="modal-description">Organize uma tarefa no seu espaço pessoal.</p><form className="new-task-form" onSubmit={createTask}><label>O que precisa ser feito?<input name="title" autoComplete="off" placeholder="Dê um nome para a sua tarefa" defaultValue={modal.title} required maxLength={250} /></label><div className="form-grid"><label>Empresa<select name="company" defaultValue={modal.companyId || (companyFilter !== "all" ? companyFilter : data.companies[0].id)}>{data.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Prioridade<select name="priority" defaultValue="medium"><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select></label><label>Prazo<input name="dueDate" type="date" defaultValue={today} required /></label><label>Tempo estimado (min)<input name="duration" type="number" min="5" max="1440" step="5" placeholder="Ex.: 30" /></label></div><label>Projeto<input name="project" placeholder="Ex.: Planejamento" maxLength={70} /></label><div className="form-note"><OrbitMark small />Salva neste navegador. A tarefa não será enviada ao ClickUp.</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="primary-button"><Plus size={15} />Criar tarefa</button></div></form></>}
      {modal.type === "task" && selectedTask && <><div className="detail-eyebrow"><CompanyTag company={company(selectedTask.companyId)} /><ProviderIcon provider={selectedTask.source} /><span>{selectedTask.source === "clickup" ? "ClickUp" : "Tarefa local"}{data.mode === "demo" && selectedTask.source === "clickup" ? " · exemplo" : ""}</span></div><h2 id="modal-title">{selectedTask.title}</h2><div className="detail-properties"><div><span>Projeto</span><strong>{selectedTask.project}</strong></div><div><span>Prazo</span><strong>{longDate(selectedTask.dueDate)}</strong></div><div><span>Prioridade</span><strong><i className={`priority-dot ${selectedTask.priority}`} />{selectedTask.priority === "high" ? "Alta" : selectedTask.priority === "medium" ? "Média" : "Baixa"}</strong></div><div><span>Status</span><strong>{selectedTask.status === "done" ? "Concluída" : selectedTask.status === "in_progress" ? "Em andamento" : "Em aberto"}</strong></div>{selectedTask.estimatedMinutes && <div><span>Tempo estimado</span><strong>{selectedTask.estimatedMinutes} minutos</strong></div>}</div><div className="modal-actions">{selectedTask.sourceUrl && <a className="secondary-button" href={selectedTask.sourceUrl} target="_blank" rel="noreferrer">Abrir no ClickUp<ExternalLink size={14} /></a>}{(data.mode === "demo" || selectedTask.source === "local") && <button className="primary-button" onClick={() => completeTask(selectedTask)}><Check size={15} />{selectedTask.status === "done" ? "Reabrir tarefa" : "Concluir tarefa"}</button>}</div></>}
      {modal.type === "event" && selectedEvent && <><div className="detail-eyebrow"><CompanyTag company={company(selectedEvent.companyId)} /><ProviderIcon provider={selectedEvent.source} /><span>{data.mode === "demo" ? "Compromisso de exemplo" : "Compromisso"}</span></div><h2 id="modal-title">{selectedEvent.title}</h2><div className="event-detail-time"><CalendarDays size={18} /><span>{longDate(dateKey(selectedEvent.start))}</span><Clock3 size={17} /><span>{selectedEvent.start.length === 10 ? "Dia inteiro" : `${time(selectedEvent.start)} – ${time(selectedEvent.end)}`}</span></div><div className="detail-properties">{selectedEvent.location && <div><span>Local</span><strong>{selectedEvent.location}</strong></div>}{selectedEvent.attendees?.length ? <div><span>Participantes</span><strong>{selectedEvent.attendees.join(", ")}</strong></div> : null}<div><span>Fuso horário</span><strong>America/Campo_Grande · GMT−4</strong></div></div>{data.mode === "demo" && <div className="form-note">Este evento é fictício. Conecte suas contas para acessar suas reuniões.</div>}<div className="modal-actions">{selectedEvent.sourceUrl && <a className="secondary-button" href={selectedEvent.sourceUrl} target="_blank" rel="noreferrer">Abrir evento<ExternalLink size={14} /></a>}{selectedEvent.meetingUrl && <a className="primary-button" href={selectedEvent.meetingUrl} target="_blank" rel="noreferrer"><Video size={15} />Entrar na reunião</a>}</div></>}
      {modal.type === "message" && selectedMessage && <><div className="detail-eyebrow"><CompanyTag company={company(selectedMessage.companyId)} /><ProviderIcon provider={selectedMessage.source} /><span>#{selectedMessage.channel}{data.mode === "demo" ? " · exemplo" : ""}</span></div><h2 id="modal-title">{selectedMessage.author}</h2><span className="subtle-text">{longDate(dateKey(selectedMessage.timestamp))}, às {time(selectedMessage.timestamp)}</span><p className="detail-message-body">{selectedMessage.body}</p><div className="modal-actions">{selectedMessage.sourceUrl && <a className="secondary-button" href={selectedMessage.sourceUrl} target="_blank" rel="noreferrer">Abrir conversa<ExternalLink size={14} /></a>}{selectedMessage.unread && <button className="secondary-button" onClick={() => markRead(selectedMessage.id)}><CheckCheck size={15} />Marcar como lida</button>}<button className="primary-button" onClick={() => setModal({ type: "newTask", title: selectedMessage.body, companyId: selectedMessage.companyId })}><Plus size={15} />Criar tarefa</button></div></>}
      {modal.type === "connection" && <IntegrationSettingsForm key={`${modal.provider}-${modal.companyId}`} api={api} provider={modal.provider} companyId={modal.companyId} companyName={company(modal.companyId)?.name || "Empresa"} onSaved={refreshIntegrations} onClose={() => setModal(null)} />}
      {modal.type === "reset" && <><span className="modal-eyebrow"><RotateCcw size={16} />UM NOVO COMEÇO</span><h2 id="modal-title">Restaurar a demonstração?</h2><p className="modal-description">Suas tarefas locais, alterações nos exemplos e nomes de empresas serão removidos deste navegador. Os dados de demonstração serão recriados.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>Manter meu painel</button><button className="primary-button" onClick={resetDemo}>Restaurar demonstração</button></div></>}
    </div></div>}
  </div>;
}

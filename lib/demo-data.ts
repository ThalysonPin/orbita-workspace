import { DEFAULT_COMPANIES, type WorkspaceData } from "./workspace-types";

export function createDemoData(): WorkspaceData {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Campo_Grande", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const stamp = (time: string) => `${date}T${time}:00-04:00`;
  const future = new Date(`${date}T12:00:00-04:00`);
  future.setUTCDate(future.getUTCDate() + 1);
  const tomorrow = future.toISOString().slice(0, 10);
  return {
    mode: "demo",
    companies: DEFAULT_COMPANIES.map((company) => ({ ...company })),
    tasks: [
      { id: "demo-task-1", title: "Finalizar proposta do novo projeto", companyId: "company-1", source: "clickup", status: "in_progress", priority: "high", dueDate: date, project: "Planejamento", estimatedMinutes: 45 },
      { id: "demo-task-2", title: "Revisar os layouts da próxima entrega", companyId: "company-2", source: "clickup", status: "todo", priority: "high", dueDate: date, project: "Website", estimatedMinutes: 60 },
      { id: "demo-task-3", title: "Organizar relatório de resultados", companyId: "company-3", source: "clickup", status: "todo", priority: "medium", dueDate: date, project: "Operações", estimatedMinutes: 30 },
      { id: "demo-task-4", title: "Preparar pauta do alinhamento", companyId: "company-1", source: "clickup", status: "todo", priority: "low", dueDate: tomorrow, project: "Planejamento", estimatedMinutes: 15 },
      { id: "demo-task-5", title: "Compartilhar referências com a equipe", companyId: "company-2", source: "clickup", status: "done", priority: "medium", dueDate: date, project: "Website", estimatedMinutes: 20 },
      { id: "demo-task-6", title: "Mapear melhorias do processo interno", companyId: "company-3", source: "clickup", status: "todo", priority: "medium", dueDate: tomorrow, project: "Operações", estimatedMinutes: 40 },
    ],
    events: [
      { id: "demo-event-1", title: "Alinhamento da equipe", companyId: "company-1", start: stamp("09:00"), end: stamp("09:30"), source: "google", location: "Google Meet · exemplo", attendees: ["Você", "Equipe de projetos"] },
      { id: "demo-event-2", title: "Revisão de design", companyId: "company-2", start: stamp("10:30"), end: stamp("11:30"), source: "google", location: "Google Meet · exemplo", attendees: ["Você", "Equipe de design"] },
      { id: "demo-event-3", title: "Planejamento da semana", companyId: "company-3", start: stamp("14:00"), end: stamp("14:45"), source: "google", location: "Google Meet · exemplo", attendees: ["Você", "Equipe de operações"] },
      { id: "demo-event-4", title: "Checkpoint do projeto", companyId: "company-1", start: stamp("16:00"), end: stamp("16:30"), source: "google", location: "Google Meet · exemplo", attendees: ["Você", "Equipe de projetos"] },
    ],
    messages: [
      { id: "demo-message-1", companyId: "company-1", source: "slack", channel: "projetos", author: "Marina Costa", body: "Deixei os comentários na proposta. Podemos revisar os últimos pontos no nosso alinhamento?", timestamp: stamp("08:42"), unread: true },
      { id: "demo-message-2", companyId: "company-2", source: "discord", channel: "design", author: "Lucas Almeida", body: "Os novos layouts já estão disponíveis para revisão. Incluí também a versão para mobile ✨", timestamp: stamp("09:15"), unread: true },
      { id: "demo-message-3", companyId: "company-3", source: "discord", channel: "geral", author: "Camila Santos", body: "Atualizei os indicadores da semana. O resumo está pronto para o planejamento de hoje.", timestamp: stamp("10:08"), unread: true },
    ],
    connections: DEFAULT_COMPANIES.flatMap((company, index) => [
      { id: `google-${company.id}`, provider: "google" as const, companyId: company.id, label: "Google Calendar", status: "unconfigured" as const },
      { id: `clickup-${company.id}`, provider: "clickup" as const, companyId: company.id, label: "ClickUp", status: "unconfigured" as const },
      { id: `${index === 0 ? "slack" : "discord"}-${company.id}`, provider: index === 0 ? "slack" as const : "discord" as const, companyId: company.id, label: index === 0 ? "Slack" : "Discord", status: "unconfigured" as const },
    ]),
  };
}

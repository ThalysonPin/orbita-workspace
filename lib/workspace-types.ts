export type Provider = "google" | "clickup" | "slack" | "discord";
export type Company = { id: string; name: string; initials: string; color: string };
export type Task = {
  id: string; title: string; companyId: string; source: "clickup" | "local";
  status: "todo" | "in_progress" | "done"; priority: "high" | "medium" | "low";
  dueDate: string; project: string; sourceUrl?: string; estimatedMinutes?: number;
};
export type CalendarEvent = {
  id: string; title: string; companyId: string; start: string; end: string;
  source: "google" | "local"; meetingUrl?: string; sourceUrl?: string;
  location?: string; attendees?: string[];
};
export type Message = {
  id: string; companyId: string; source: "slack" | "discord"; channel: string;
  author: string; body: string; timestamp: string; unread: boolean; sourceUrl?: string;
};
export type Connection = {
  id: string; provider: Provider; companyId: string; label: string;
  status: "connected" | "unconfigured" | "error"; detail?: string; lastSync?: string;
};
export type WorkspaceData = {
  companies: Company[]; tasks: Task[]; events: CalendarEvent[]; messages: Message[];
  connections: Connection[]; mode: "demo" | "live"; syncedAt?: string;
};
export const DEFAULT_COMPANIES: Company[] = [
  { id: "company-1", name: "Empresa 01", initials: "01", color: "#f07854" },
  { id: "company-2", name: "Empresa 02", initials: "02", color: "#9a8dc7" },
  { id: "company-3", name: "Empresa 03", initials: "03", color: "#72a494" },
];

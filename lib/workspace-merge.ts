import type { WorkspaceData } from "./workspace-types";

/** Keep known records for failed sources; a successful empty source removes old records. */
export function mergeLiveWorkspace(previous: WorkspaceData, incoming: WorkspaceData): WorkspaceData {
  const oldLive = previous.mode === "live";
  const failed = incoming.connections.filter((connection) => connection.status === "error");
  const staleRecord = (record: { id: string }) => oldLive && failed.some((connection) => record.id.startsWith(`${connection.id}:`));
  const merge = <T extends { id: string }>(oldRecords: T[], newRecords: T[]): T[] => [
    ...new Map([...oldRecords.filter(staleRecord), ...newRecords].map((record) => [record.id, record])).values(),
  ];
  const oldMessages = new Map(oldLive ? previous.messages.map((message) => [message.id, message]) : []);
  const importedTasks = merge(previous.tasks.filter((task) => task.source !== "local"), incoming.tasks.filter((task) => task.source !== "local"));
  const messages = merge(previous.messages, incoming.messages).map((message) => ({
    ...message,
    // Read status belongs to this panel, independently of Slack/Discord.
    unread: oldMessages.get(message.id)?.unread ?? true,
  })).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return {
    ...incoming,
    mode: "live",
    companies: incoming.companies.map((company) => ({ ...company, name: previous.companies.find((item) => item.id === company.id)?.name || company.name })),
    tasks: [...previous.tasks.filter((task) => task.source === "local"), ...importedTasks],
    events: merge(previous.events, incoming.events).sort((a, b) => a.start.localeCompare(b.start)),
    messages,
    connections: incoming.connections.map((connection) => {
      if (connection.status !== "error") return connection;
      const hasStale = [...previous.tasks, ...previous.events, ...previous.messages].some((record) => staleRecord(record) && record.id.startsWith(`${connection.id}:`));
      if (!hasStale) return connection;
      return {
        ...connection,
        lastSync: previous.connections.find((item) => item.id === connection.id)?.lastSync,
        detail: `${connection.detail || "Não foi possível atualizar esta fonte."} Exibindo o último resultado disponível; alguns dados podem estar desatualizados.`,
      };
    }),
  };
}

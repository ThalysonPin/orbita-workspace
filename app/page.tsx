import WorkspaceDashboard from "@/components/workspace-dashboard";
import { createDemoData } from "@/lib/demo-data";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireChatGPTUser("/");
  return <WorkspaceDashboard initialData={createDemoData()} />;
}

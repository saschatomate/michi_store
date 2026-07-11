import { requireAuth } from "@/lib/dal";
import { Sidebar } from "./Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();

  return (
    <div className="flex h-full min-h-screen bg-zinc-50">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}

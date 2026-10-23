import { requireAuth } from "@/lib/dal";
import { getFilterOptions } from "@/lib/filter-options";
import { getBudgetSummary } from "@/lib/cost-tracking";
import { shopifyActivityCounts } from "@/lib/shopify-activity";
import { Sidebar } from "./Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const [filterOptions, budget, shopifyActivity] = await Promise.all([
    getFilterOptions(),
    getBudgetSummary(),
    shopifyActivityCounts(),
  ]);

  return (
    <div className="h-screen p-3 sm:p-5">
      <div className="flex h-full overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-black/10">
        <Sidebar filterOptions={filterOptions} budget={budget} shopifyActivity={shopifyActivity} />
        <main className="min-w-0 flex-1 overflow-y-auto bg-zinc-50/70 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

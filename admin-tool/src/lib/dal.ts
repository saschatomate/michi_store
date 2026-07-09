import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";

export const requireAuth = cache(async () => {
  const isAuthenticated = await verifySession();
  if (!isAuthenticated) {
    redirect("/login");
  }
});

import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const isAuthenticated = await verifySession();
  if (isAuthenticated) {
    redirect("/");
  }

  return <LoginForm />;
}

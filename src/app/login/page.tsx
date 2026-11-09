import type { Metadata } from "next";
import { Zap } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { dashboardSession } from "../dashboard/session";
import { PanelSkeleton } from "../dashboard/panel";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Вхід" };

export default function LoginPage() {
  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center justify-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Zap aria-hidden="true" className="size-5" />
          </span>
          Power Dashboard
        </div>
        <Suspense fallback={<PanelSkeleton label="Перевірка сеансу" />}>
          <LoginCard />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginCard() {
  const session = await dashboardSession();
  if (session === "authenticated") redirect("/");

  return (
    <Card className="gap-5 py-6">
      <div className="grid gap-2 px-4 sm:px-5">
        <h1 className="text-2xl font-bold tracking-tight">Вхід до дашборда</h1>
        <p className="text-sm text-muted-foreground">Увійдіть, щоб переглянути показники станції та графіки відключень.</p>
      </div>
      <CardContent>
        {session === "unconfigured" ? (
          <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm text-danger">
            Вхід тимчасово недоступний. Зверніться до адміністратора.
          </p>
        ) : <LoginForm />}
      </CardContent>
    </Card>
  );
}

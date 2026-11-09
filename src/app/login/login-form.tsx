"use client";

import { ArrowRight } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "./actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-1.5">
        <label htmlFor="username" className="text-sm font-medium">Логін</label>
        <Input id="username" name="username" autoComplete="username" autoCapitalize="none" required />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">Пароль</label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error && <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Виконується вхід…" : "Увійти"} <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}

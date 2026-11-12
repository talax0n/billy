import { loginInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../components/ui/button.tsx";
import { Field, Input } from "../components/ui/field.tsx";
import { api, unwrap } from "../lib/api.ts";
import { meQuery } from "../lib/auth.ts";
import { useForm } from "../lib/form.ts";

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm(loginInput, { username: "", password: "" });

  const submit = form.onSubmit(async (input) => {
    const me = await unwrap(api.auth.login.$post({ json: input }));
    queryClient.setQueryData(meQuery.queryKey, me);
    await navigate({ to: me.role === "kasir" ? "/kasir" : "/" });
  });

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} noValidate className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-line bg-panel p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Masuk</h1>
          <p className="mt-0.5 text-muted">Pembukuan dan kasir toko</p>
        </div>
        <Field label="Nama pengguna" error={form.errors.username}>
          {(props) => (
            <Input
              {...props}
              autoComplete="username"
              autoFocus
              value={form.values.username}
              onChange={(e) => form.set("username", e.target.value)}
            />
          )}
        </Field>
        <Field label="Kata sandi" error={form.errors.password}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={form.values.password}
              onChange={(e) => form.set("password", e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={form.submitting}>
          {form.submitting ? "Memeriksa…" : "Masuk"}
        </Button>
      </form>
    </main>
  );
}

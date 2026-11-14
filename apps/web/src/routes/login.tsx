import { loginInput } from "@billy/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import Waves from "../components/backgrounds/waves.tsx";
import { ThemeToggle } from "../components/shell/theme-toggle.tsx";
import { Button } from "../components/ui/button.tsx";
import { Field, Input } from "../components/ui/field.tsx";
import { ApiError, api, unwrap } from "../lib/api.ts";
import { meQuery, rememberMe } from "../lib/auth.ts";
import { useForm } from "../lib/form.ts";
import { useTheme } from "../lib/theme.ts";

// ponytail: reads the OS preference on render, a live OS switch while on this page needs a matchMedia listener.
function useDark() {
  const theme = useTheme();
  return theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm(loginInput, { username: "", password: "" });
  const [failure, setFailure] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const dark = useDark();

  const submit = form.onSubmit(async (input) => {
    setFailure(null);
    try {
      const me = await unwrap(api.auth.login.$post({ json: input }));
      queryClient.setQueryData(meQuery.queryKey, rememberMe(me));
      await navigate({ to: me.role === "kasir" ? "/kasir" : "/" });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setFailure(err.message);
    }
  });

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <Waves
        className="-z-10"
        lineColor={dark ? "#3f3f46" : "#b4b4bc"}
        accentColor={dark ? "#a1a1aa" : "#71717a"}
        backgroundColor="var(--bg)"
        spacing={14}
        amplitude={40}
        speed={0.6}
        mouseStrength={0.8}
        fade={0.35}
      />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,var(--bg)_0%,transparent_65%)] opacity-80" />

      <header className="flex justify-end p-4 sm:px-6">
        <ThemeToggle />
      </header>

      <div className="grid flex-1 place-items-center px-4 pb-16">
        <div className="w-full max-w-[380px]">
          <form
            onSubmit={submit}
            noValidate
            className="flex flex-col gap-4 rounded-2xl border border-line bg-panel/90 p-7 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.18)] backdrop-blur-md"
          >
            <h1 className="mb-1 text-xl font-semibold tracking-tight">Toko Cat Sumber Karya</h1>

            {failure && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-down/30 bg-down/5 px-3 py-2 text-[13px] text-down">
                <CircleAlert className="mt-px size-4 shrink-0" />
                {failure}
              </div>
            )}

            <Field label="Nama pengguna" error={form.errors.username}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  value={form.values.username}
                  onChange={(e) => form.set("username", e.target.value)}
                />
              )}
            </Field>
            <Field label="Kata sandi" error={form.errors.password}>
              {(props) => (
                <div className="relative">
                  <Input
                    {...props}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="pr-10"
                    value={form.values.password}
                    onChange={(e) => form.set("password", e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Sembunyikan sandi" : "Tampilkan sandi"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-faint hover:text-ink-2 focus-visible:text-ink focus-visible:outline-none"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              )}
            </Field>

            <Button type="submit" variant="primary" disabled={form.submitting} className="mt-1 h-10 justify-center">
              {form.submitting && <Loader2 className="size-4 animate-spin" />}
              {form.submitting ? "Memeriksa…" : "Masuk"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

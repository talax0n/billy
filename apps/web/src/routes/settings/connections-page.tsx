import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { PageBody, PageHeader } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { SettingsSection } from "./section.tsx";

type Connections = InferResponseType<typeof api.integrations.$get, 200>;
type Secret = Connections["openaiKey"];

const connectionsQuery = { queryKey: ["integrations"], queryFn: () => unwrap(api.integrations.$get()) };
const sourceLabel = { web: "disimpan di sini", env: "dari variabel server" } as const;
const secretStatus = (s: Secret) => (s.hint && s.source ? `Terisi ${s.hint}, ${sourceLabel[s.source]}` : "Belum diisi");

/** Runs an action, showing an API refusal as a toast instead of throwing. */
async function attempt(action: () => Promise<void>) {
  try {
    await action();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    toast(err.message, "down");
  }
}

/** Admin only: the ChatGPT account the Telegram bot thinks with, its model, and the bot's Telegram connection. */
export function ConnectionsPage() {
  const connections = useQuery(connectionsQuery);
  const data = connections.data;
  return (
    <>
      <PageHeader title="Koneksi" />
      <PageBody className="max-w-2xl gap-8">
        {data && !data.canStoreSecrets && (
          <p className="rounded-lg bg-warn-bg/40 px-3 py-2 text-ink-2">
            Server belum punya BILLY_SECRET_KEY, jadi sesi, kunci dan token belum bisa disimpan di sini. Minta pengelola server menambahkannya.
          </p>
        )}
        <SettingsSection title="ChatGPT untuk bot Telegram" description="Bot membaca pesan dan foto staf dengan ChatGPT, memakai paket ChatGPT akun yang masuk di sini.">
          {data && <ChatgptForm data={data} />}
        </SettingsSection>
        <SettingsSection title="Model" description="Model ChatGPT yang menjawab bot. Muat daftar setelah masuk untuk melihat yang tersedia di akun Anda.">
          {data && <ModelForm key={data.aiModel} data={data} />}
        </SettingsSection>
        <SettingsSection title="Bot Telegram" description="Token dari @BotFather. Setelah disimpan, staf menghubungkan chat mereka di halaman Bot Telegram.">
          {data && <BotForm data={data} />}
        </SettingsSection>
        {data?.telegram.token.hint && (
          <SettingsSection
            title="Webhook"
            description="Alamat server ini yang dihubungi Telegram setiap ada pesan. Wajib https. Saat dicoba di komputer sendiri tanpa alamat publik, bot memakai polling dan webhook tidak perlu."
          >
            <WebhookForm suggested={data.suggestedWebhookUrl} />
          </SettingsSection>
        )}
      </PageBody>
    </>
  );
}

function ChatgptForm({ data }: { data: Connections }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState("");
  const [apiKey, setApiKey] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["integrations"] });

  // While a sign-in runs in another tab, ask the server every 2 s whether the callback arrived.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void unwrap(api.integrations.chatgpt.login.$get()).then(async (state) => {
        if (!state || state.status === "waiting") return;
        setWaiting(false);
        if (state.status === "done") {
          await refresh();
          toast(`Masuk dengan ChatGPT${state.message ? ` sebagai ${state.message}` : ""}`, "up");
        } else toast(state.message, "down");
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting]);

  const run = (action: () => Promise<void>) =>
    attempt(async () => {
      setBusy(true);
      try {
        await action();
      } finally {
        setBusy(false);
      }
    });

  const signIn = () =>
    run(async () => {
      const started = await unwrap(api.integrations.chatgpt.login.$post());
      window.open(started.url, "_blank", "noopener");
      setWaiting(true);
    });

  const status =
    data.aiAuth?.kind === "chatgpt"
      ? `Masuk sebagai ${data.aiAuth.email ?? "akun ChatGPT"}`
      : data.aiAuth?.kind === "api_key"
        ? `Belum masuk ChatGPT · memakai kunci API OpenAI ${data.openaiKey.hint ?? ""}`
        : "Belum masuk";

  return (
    <div className="flex flex-col gap-4">
      <p>
        Status: <span className="font-medium">{status}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || waiting} onClick={() => void signIn()}>
          {waiting ? "Menunggu masuk di tab baru…" : data.chatgpt ? "Masuk ulang" : "Masuk dengan ChatGPT"}
        </Button>
        {data.chatgpt && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await unwrap(api.integrations.chatgpt.session.$delete());
                await refresh();
                toast("Keluar dari ChatGPT", "up");
              })
            }
          >
            Keluar
          </Button>
        )}
      </div>
      <p className="text-ink-2">
        Tombol ini hanya berfungsi bila billy berjalan di komputer yang sama dengan browser ini, karena ChatGPT mengembalikan hasil masuk ke 127.0.0.1.
      </p>
      <details className="rounded-[10px] border border-line px-4 py-3">
        <summary className="cursor-pointer font-medium">billy berjalan di server internet?</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-ink-2">
            Jalankan <code className="rounded bg-line-2 px-1">pnpm --filter @billy/api chatgpt:login</code> di komputer Anda, masuk di browser yang terbuka, lalu tempel kode
            sesi yang muncul di sini. Kode itu rahasia.
          </p>
          <Field label="Kode sesi">{(p) => <Input {...p} type="password" autoComplete="off" placeholder="billy-chatgpt-v1...." value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <div className="flex justify-end">
            <Button
              disabled={busy || !code.trim()}
              onClick={() =>
                void run(async () => {
                  const saved = await unwrap(api.integrations.chatgpt.session.$post({ json: { code: code.trim() } }));
                  setCode("");
                  await refresh();
                  toast(`Sesi ChatGPT dipasang${saved.email ? ` (${saved.email})` : ""}`, "up");
                })
              }
            >
              Pasang sesi
            </Button>
          </div>
        </div>
      </details>
      <details className="rounded-[10px] border border-line px-4 py-3">
        <summary className="cursor-pointer font-medium">Pakai kunci API OpenAI sebagai cadangan</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-ink-2">Dipakai hanya bila tidak ada yang masuk dengan ChatGPT. Ditagih per pemakaian di platform.openai.com.</p>
          <Field label="Kunci API" hint={secretStatus(data.openaiKey)}>
            {(p) => <Input {...p} type="password" autoComplete="off" placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            {data.openaiKey.source === "web" && (
              <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await unwrap(api.integrations.$put({ json: { aiModel: data.aiModel, openaiApiKey: null } })); await refresh(); })}>
                Hapus kunci
              </Button>
            )}
            <Button
              disabled={busy || !apiKey.trim()}
              onClick={() =>
                void run(async () => {
                  await unwrap(api.integrations.$put({ json: { aiModel: data.aiModel, openaiApiKey: apiKey.trim() } }));
                  setApiKey("");
                  await refresh();
                  toast("Kunci OpenAI disimpan", "up");
                })
              }
            >
              Simpan kunci
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

function ModelForm({ data }: { data: Connections }) {
  const queryClient = useQueryClient();
  const [model, setModel] = useState(data.aiModel);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) =>
    attempt(async () => {
      setBusy(true);
      try {
        await action();
      } finally {
        setBusy(false);
      }
    });
  return (
    <div className="flex flex-col gap-4">
      <Field label="Model" hint={data.aiModel ? `Sekarang: ${data.aiModel}` : "Belum dipilih: bot belum bisa menjawab"}>
        {(p) => (
          <>
            <Input {...p} list="ai-models" placeholder="pilih dari daftar atau ketik nama model" value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      {models.length > 0 && <p className="text-ink-2">Tersedia: {models.join(", ")}</p>}
      <div className="flex justify-end gap-2">
        <Button
          disabled={busy || !data.aiAuth}
          onClick={() =>
            void run(async () => {
              const { models: found } = await unwrap(api.integrations.ai.models.$get());
              setModels(found);
              if (!model && found[0]) setModel(found[0]);
            })
          }
        >
          Muat daftar model
        </Button>
        <Button
          variant="primary"
          disabled={busy || model.trim() === data.aiModel}
          onClick={() =>
            void run(async () => {
              await unwrap(api.integrations.$put({ json: { aiModel: model.trim() } }));
              await queryClient.invalidateQueries({ queryKey: ["integrations"] });
              toast("Model disimpan", "up");
            })
          }
        >
          Simpan model
        </Button>
      </div>
    </div>
  );
}

function BotForm({ data }: { data: Connections }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const save = (telegramBotToken: string | null) =>
    attempt(async () => {
      setBusy(true);
      try {
        const saved = await unwrap(api.integrations.$put({ json: { aiModel: data.aiModel, telegramBotToken } }));
        setToken("");
        await queryClient.invalidateQueries({ queryKey: ["integrations"] });
        await queryClient.invalidateQueries({ queryKey: ["telegram"] });
        toast(saved.telegramBotUsername ? `Terhubung ke @${saved.telegramBotUsername}` : "Token bot dihapus", "up");
      } finally {
        setBusy(false);
      }
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) void save(token.trim());
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <p>
        Bot: <span className="font-medium">{data.telegram.username ? `@${data.telegram.username}` : "belum ada"}</span>
        <span className="text-ink-2"> · token {secretStatus(data.telegram.token).toLowerCase()}</span>
      </p>
      <Field label="Token bot" hint="Billy memeriksa token ke Telegram sebelum menyimpan.">
        {(p) => <Input {...p} type="password" autoComplete="off" placeholder="123456789:AA..." value={token} onChange={(e) => setToken(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        {data.telegram.token.source === "web" && (
          <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
            Hapus token
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
          Simpan token
        </Button>
      </div>
    </form>
  );
}

function WebhookForm({ suggested }: { suggested: string }) {
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ["integrations", "webhook"], queryFn: () => unwrap(api.integrations.telegram.webhook.$get()), retry: false });
  const [url, setUrl] = useState(suggested);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<unknown>, done: string) =>
    attempt(async () => {
      setBusy(true);
      try {
        await action();
        await queryClient.invalidateQueries({ queryKey: ["integrations", "webhook"] });
        toast(done, "up");
      } finally {
        setBusy(false);
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">
        {info.isError
          ? "Status webhook tidak bisa dibaca dari Telegram."
          : info.data?.url
            ? `Aktif ke ${info.data.url}${info.data.pending ? ` · ${info.data.pending} pesan menunggu` : ""}${info.data.lastError ? ` · galat terakhir: ${info.data.lastError}` : ""}`
            : "Belum dipasang."}
      </p>
      <Field label="Alamat webhook">{(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
      <div className="flex justify-end gap-2">
        {info.data?.url && (
          <Button variant="ghost" disabled={busy} onClick={() => void run(() => unwrap(api.integrations.telegram.webhook.$delete()), "Webhook dilepas")}>
            Lepas webhook
          </Button>
        )}
        <Button variant="primary" disabled={busy || !url.trim()} onClick={() => void run(() => unwrap(api.integrations.telegram.webhook.$put({ json: { url: url.trim() } })), "Webhook dipasang")}>
          Pasang webhook
        </Button>
      </div>
    </div>
  );
}

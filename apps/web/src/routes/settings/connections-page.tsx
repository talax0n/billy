import { type AiProvider, aiProviderLabels, aiProviders } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input, Select } from "../../components/ui/field.tsx";
import { PageBody, PageHeader } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { SettingsSection } from "./section.tsx";

type Connections = InferResponseType<typeof api.integrations.$get, 200>;
type Secret = Connections["keys"]["anthropic"];

const connectionsQuery = { queryKey: ["integrations"], queryFn: () => unwrap(api.integrations.$get()) };
const sourceLabel = { web: "disimpan di sini", env: "dari variabel server" } as const;
const secretStatus = (s: Secret) => (s.hint ? `Terisi ${s.hint}, ${sourceLabel[s.source!]}` : "Belum diisi");

/** Runs an action, showing an API refusal as a toast instead of throwing. */
async function attempt(action: () => Promise<void>) {
  try {
    await action();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    toast(err.message, "down");
  }
}

/** Admin only: which AI answers the Telegram bot, its keys, and the bot's Telegram connection. */
export function ConnectionsPage() {
  const connections = useQuery(connectionsQuery);
  const data = connections.data;
  return (
    <>
      <PageHeader title="Koneksi" />
      <PageBody className="max-w-2xl gap-8">
        {data && !data.canStoreSecrets && (
          <p className="rounded-lg bg-warn-bg/40 px-3 py-2 text-ink-2">
            Server belum punya BILLY_SECRET_KEY, jadi kunci dan token belum bisa disimpan di sini. Minta pengelola server menambahkannya.
          </p>
        )}
        <SettingsSection title="AI untuk bot Telegram" description="Pilih AI yang membaca pesan dan foto staf. Kunci API disimpan terenkripsi dan tidak pernah ditampilkan lagi.">
          {data && <AiForm key={`${data.aiProvider}-${data.aiModel}`} data={data} />}
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

function AiForm({ data }: { data: Connections }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<AiProvider>(data.aiProvider);
  const [model, setModel] = useState(data.aiModel);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const stored = data.keys[provider];

  const testKey = () =>
    attempt(async () => {
      setBusy(true);
      try {
        const { models: found } = await unwrap(api.integrations.ai.test.$post({ json: { provider, ...(key && { apiKey: key }) } }));
        setModels(found);
        toast(`Kunci berfungsi · ${found.length} model tersedia`, "up");
      } finally {
        setBusy(false);
      }
    });

  const save = (patch: { anthropicApiKey?: string | null; openaiApiKey?: string | null } = {}) =>
    attempt(async () => {
      setBusy(true);
      try {
        const keyField = provider === "anthropic" ? "anthropicApiKey" : "openaiApiKey";
        await unwrap(api.integrations.$put({ json: { aiProvider: provider, aiModel: model.trim(), ...(key && { [keyField]: key }), ...patch } }));
        setKey("");
        await queryClient.invalidateQueries({ queryKey: ["integrations"] });
        toast("Koneksi AI disimpan", "up");
      } finally {
        setBusy(false);
      }
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  const defaultModel = data.defaultModels[provider];
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Penyedia AI">
        {(p) => (
          <Select
            {...p}
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as AiProvider);
              setModels([]);
              setModel("");
              setKey("");
            }}
          >
            {aiProviders.map((id) => (
              <option key={id} value={id}>
                {aiProviderLabels[id]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Kunci API" hint={secretStatus(stored)}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="off"
            placeholder={stored.hint ? "Kosongkan untuk tetap memakai kunci yang ada" : provider === "anthropic" ? "sk-ant-..." : "sk-..."}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || (!key && !stored.hint)} onClick={() => void testKey()}>
          Tes kunci dan muat model
        </Button>
        {stored.source === "web" && (
          <Button variant="ghost" disabled={busy} onClick={() => void save({ [provider === "anthropic" ? "anthropicApiKey" : "openaiApiKey"]: null })}>
            Hapus kunci tersimpan
          </Button>
        )}
      </div>
      <Field label="Model" hint={defaultModel ? `Kosongkan untuk memakai ${defaultModel}` : "Pilih dari daftar setelah tes kunci, atau ketik nama model"}>
        {(p) => (
          <>
            <Input {...p} list="ai-models" placeholder={defaultModel || "nama model"} value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          Simpan
        </Button>
      </div>
    </form>
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
        const saved = await unwrap(api.integrations.$put({ json: { aiProvider: data.aiProvider, aiModel: data.aiModel, telegramBotToken } }));
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

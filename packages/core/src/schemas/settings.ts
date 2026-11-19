import { z } from "zod";
import { text } from "./common.ts";

export const settingsInput = z.object({
  shopName: z.string().trim().min(1, "Nama toko wajib diisi").max(120),
  address: text(500),
  phone: text(40),
  whatsapp: text(40),
  invoiceBankText: text(500),
  invoiceSigner: text(100),
  receiptFooter: text(500),
  posDeviceCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,4}$/, "1–4 huruf atau angka, misal K1"),
});
export type SettingsInput = z.input<typeof settingsInput>;

export const announcementInput = z.object({ announcement: text(1000) });

/**
 * Connections the admin sets in the web. A secret left out keeps its stored value; `null` removes it.
 * Secrets are write-only: the API never sends them back, only whether one is stored. The bot's AI is
 * ChatGPT, through a ChatGPT sign-in (connected separately) or, failing that, an OpenAI API key.
 */
export const integrationsInput = z.object({
  aiModel: z.string().trim().max(100),
  openaiApiKey: z.string().trim().min(1).max(500).nullable().optional(),
  telegramBotToken: z
    .string()
    .trim()
    .regex(/^\d+:[\w-]{20,}$/, "Token bot Telegram tidak dikenali, contoh 123456789:AAH...")
    .nullable()
    .optional(),
});
export type IntegrationsInput = z.input<typeof integrationsInput>;

/** A ChatGPT session signed in on another computer (`pnpm --filter @billy/api chatgpt:login`), pasted into the web. */
export const chatgptSessionInput = z.object({ code: z.string().trim().min(20, "Tempel kode sesi lengkap dari perintah masuk").max(20_000) });

export const telegramWebhookInput = z.object({ url: z.url("Alamat webhook harus URL lengkap, misal https://billy.example.com/api/telegram/webhook") });

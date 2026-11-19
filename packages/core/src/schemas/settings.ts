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

/** Which AI answers the Telegram bot. */
export const aiProviders = ["anthropic", "openai"] as const;
export type AiProvider = (typeof aiProviders)[number];
export const aiProviderLabels: Record<AiProvider, string> = { anthropic: "Claude (Anthropic)", openai: "ChatGPT (OpenAI)" };

/**
 * Connections the admin sets in the web. A secret left out keeps its stored value; `null` removes it.
 * Secrets are write-only: the API never sends them back, only whether one is stored.
 */
export const integrationsInput = z.object({
  aiProvider: z.enum(aiProviders),
  aiModel: z.string().trim().max(100),
  anthropicApiKey: z.string().trim().min(1).max(500).nullable().optional(),
  openaiApiKey: z.string().trim().min(1).max(500).nullable().optional(),
  telegramBotToken: z
    .string()
    .trim()
    .regex(/^\d+:[\w-]{20,}$/, "Token bot Telegram tidak dikenali, contoh 123456789:AAH...")
    .nullable()
    .optional(),
});
export type IntegrationsInput = z.input<typeof integrationsInput>;

export const aiConnectionTestInput = z.object({
  provider: z.enum(aiProviders),
  /** Test a key before saving it; without one, the stored key is tested. */
  apiKey: z.string().trim().min(1).max(500).optional(),
});

export const telegramWebhookInput = z.object({ url: z.url("Alamat webhook harus URL lengkap, misal https://billy.example.com/api/telegram/webhook") });

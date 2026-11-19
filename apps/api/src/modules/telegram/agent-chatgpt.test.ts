import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ChatgptSignInRequired } from "../../lib/chatgpt-oauth.ts";
import { runChatgpt, runStockAgent } from "./agent.ts";

type Request = { model: string; instructions: string; store: boolean; stream: boolean; reasoning: object; include: string[]; tools: { type: string; name: string; tools: { name: string; parameters: object }[] }[]; input: object[] };

/** A fake Responses API: each streamed call yields the next queued response as its final event (after one the SDK would not know), keeping a copy of each request. */
function fakeChatgpt(...responses: object[]) {
  const requests: Request[] = [];
  const create = vi.fn(async (params: Request) => {
    requests.push(structuredClone(params));
    const response = responses.shift() as { status: string };
    return (async function* () {
      yield { type: "response.created" };
      yield { type: "response.metadata" };
      yield { type: response.status === "completed" ? "response.completed" : "response.incomplete", response };
    })();
  });
  return { client: { responses: { create } } as unknown as OpenAI, requests };
}

const lookup = {
  name: "cek_stok",
  description: "stok",
  inputSchema: z.object({ kata: z.string() }),
  run: vi.fn(async (args: Record<string, unknown>) => JSON.stringify([{ nama: `HASIL ${String(args.kata)}`, stok: 55 }])),
};
const text = (t: string) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: t }] }] });

describe("the agent on ChatGPT", () => {
  it("sends tools in a namespace with store off, runs the calls, and returns history instead of a response id", async () => {
    const call = { type: "function_call", call_id: "call_1", name: "cek_stok", namespace: "billy", arguments: '{"kata":"catylac a galon"}' };
    const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "rahasia", summary: [] };
    const { client, requests } = fakeChatgpt({ status: "completed", output: [reasoning, call] }, text("Stok CATYLAC: 55 galon."));

    const reply = await runChatgpt(client, "model-uji", "Pesan pengguna: sisa catylac?", [{ mediaType: "image/jpeg", data: "Zm90bw==" }], [lookup]);

    expect(reply).toBe("Stok CATYLAC: 55 galon.");
    expect(lookup.run).toHaveBeenCalledWith({ kata: "catylac a galon" });
    const [first, second] = requests;
    expect(first).toMatchObject({ model: "model-uji", store: false, stream: true, reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"] });
    expect(first!.instructions).toContain("asisten toko cat");
    expect(first!.tools).toEqual([expect.objectContaining({ type: "namespace", name: "billy", tools: [expect.objectContaining({ type: "function", name: "cek_stok", parameters: expect.objectContaining({ properties: { kata: { type: "string" } } }) })] })]);
    expect(first!.input).toEqual([
      { role: "user", content: [{ type: "input_image", detail: "auto", image_url: "data:image/jpeg;base64,Zm90bw==" }, { type: "input_text", text: "Pesan pengguna: sisa catylac?" }] },
    ]);
    expect(second!.input.slice(1)).toEqual([reasoning, call, { type: "function_call_output", call_id: "call_1", output: '[{"nama":"HASIL catylac a galon","stok":55}]' }]);
  });

  it("tells the model when it calls an unknown tool or passes bad arguments, instead of crashing", async () => {
    const calls = [
      { type: "function_call", call_id: "a", name: "hapus_semua", arguments: "{}" },
      { type: "function_call", call_id: "b", name: "cek_stok", arguments: '{"kata":5}' },
      { type: "function_call", call_id: "c", name: "cek_stok", arguments: "{bukan json" },
    ];
    const { client, requests } = fakeChatgpt({ status: "completed", output: calls }, text("Maaf."));
    expect(await runChatgpt(client, "m", "p", [], [lookup])).toBe("Maaf.");
    const outputs = requests[1]!.input.filter((i) => (i as { type?: string }).type === "function_call_output").map((i) => (i as { output: string }).output);
    expect(outputs).toEqual(["GAGAL: alat tidak dikenal", expect.stringContaining("GAGAL: argumen tidak valid"), "GAGAL: argumen bukan JSON yang valid"]);
  });

  it("passes on a refusal or an unfinished response politely", async () => {
    const refusal = { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] };
    expect(await runChatgpt(fakeChatgpt(refusal).client, "m", "p", [], [lookup])).toContain("tidak bisa saya proses");
    expect(await runChatgpt(fakeChatgpt({ status: "incomplete", output: [] }).client, "m", "p", [], [lookup])).toContain("belum bisa memproses");
  });

  it("says what the admin must do when ChatGPT is not connected or the session ended", async () => {
    const input = { db: {} as never, actor: { id: "u", role: "staff" as const, source: "telegram" as const }, chatId: "11", text: "halo", lastReply: "" };
    expect(await runStockAgent(input, { model: "", auth: null })).toContain("masuk dengan ChatGPT");
    expect(await runStockAgent(input, { model: "m", auth: { kind: "chatgpt", email: null } }, async () => {
      throw new ChatgptSignInRequired("Sesi ChatGPT berakhir. Admin perlu masuk lagi.");
    })).toBe("Sesi ChatGPT berakhir. Admin perlu masuk lagi.");
  });
});

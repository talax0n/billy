import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runOpenAi } from "./agent.ts";

/** A fake OpenAI client that answers with the queued messages in turn and records each request. */
function fakeOpenAi(...answers: object[]) {
  const create = vi.fn(async () => ({ choices: [{ message: answers.shift() }] }));
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

const lookup = {
  name: "cek_stok",
  description: "stok",
  inputSchema: z.object({ kata: z.string() }),
  run: vi.fn(async (args: Record<string, unknown>) => JSON.stringify([{ nama: `HASIL ${String(args.kata)}`, stok: 55 }])),
};

describe("the agent on ChatGPT", () => {
  it("runs the tools the model calls, feeds back the results, and returns its text answer", async () => {
    const { client, create } = fakeOpenAi(
      {
        role: "assistant",
        content: null,
        refusal: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "cek_stok", arguments: '{"kata":"catylac a galon"}' } }],
      },
      { role: "assistant", content: "Stok CATYLAC: 55 galon.", refusal: null },
    );
    const reply = await runOpenAi(client, "model-uji", "Pesan pengguna: sisa catylac?", [{ mediaType: "image/jpeg", data: "Zm90bw==" }], [lookup]);

    expect(reply).toBe("Stok CATYLAC: 55 galon.");
    expect(lookup.run).toHaveBeenCalledWith({ kata: "catylac a galon" });
    const first = (create.mock.calls[0] as unknown as [{ model: string; tools: { function: { name: string; parameters: object } }[]; messages: { role: string; content: unknown }[] }])[0];
    expect(first.model).toBe("model-uji");
    expect(first.tools[0]!.function).toMatchObject({ name: "cek_stok", parameters: { type: "object", properties: { kata: { type: "string" } } } });
    expect(first.messages[1]!.content).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,Zm90bw==" } },
      { type: "text", text: "Pesan pengguna: sisa catylac?" },
    ]);
    const second = (create.mock.calls[1] as unknown as [{ messages: { role: string; tool_call_id?: string; content: unknown }[] }])[0];
    expect(second.messages.find((m) => m.role === "tool")).toEqual({ role: "tool", tool_call_id: "call_1", content: '[{"nama":"HASIL catylac a galon","stok":55}]' });
  });

  it("tells the model when it calls an unknown tool or passes bad arguments, instead of crashing", async () => {
    const { client, create } = fakeOpenAi(
      {
        role: "assistant",
        content: null,
        refusal: null,
        tool_calls: [
          { id: "a", type: "function", function: { name: "hapus_semua", arguments: "{}" } },
          { id: "b", type: "function", function: { name: "cek_stok", arguments: '{"kata":5}' } },
          { id: "c", type: "function", function: { name: "cek_stok", arguments: "{bukan json" } },
        ],
      },
      { role: "assistant", content: "Maaf.", refusal: null },
    );
    expect(await runOpenAi(client, "m", "p", [], [lookup])).toBe("Maaf.");
    const results = (create.mock.calls[1] as unknown as [{ messages: { role: string; content: string }[] }])[0].messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(results).toEqual(["GAGAL: alat tidak dikenal", expect.stringContaining("GAGAL: argumen tidak valid"), "GAGAL: argumen bukan JSON yang valid"]);
  });

  it("passes on a refusal politely", async () => {
    const { client } = fakeOpenAi({ role: "assistant", content: null, refusal: "I can't help with that." });
    expect(await runOpenAi(client, "m", "p", [], [lookup])).toContain("tidak bisa saya proses");
  });
});

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { PageBody } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";

type LinkCode = { code: string; minutes: number; url: string | null };

/** Links the signed-in user's Telegram chat to the stock bot, which records SPB stock reports into draft opnames. */
export function TelegramTab() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["telegram", "link"], queryFn: () => unwrap(api.telegram.link.$get()) });
  const [code, setCode] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
    } finally {
      setBusy(false);
    }
  }

  const linked = status.data?.linked;
  return (
    <PageBody>
      <div className="flex max-w-xl flex-col gap-4 text-sm">
        <p className="text-ink-2">
          Teruskan laporan SPB ke bot Telegram toko, misalnya "Dulux weathershield base A galon sisa 6". Bot mencocokkan barangnya dan mencatat
          angkanya ke draf Stok Opname brand itu. Stok baru berubah setelah admin memeriksa dan memposting draf di billy.
        </p>
        {status.data && (
          <p>
            Status:{" "}
            <span className="font-medium">
              {linked ? `terhubung sejak ${new Date(status.data.linkedAt!).toLocaleDateString("id-ID", { dateStyle: "medium" })}` : "belum terhubung"}
            </span>
            {status.data.botUsername && <span className="text-ink-2"> · bot @{status.data.botUsername}</span>}
          </p>
        )}
        {code && (
          <div className="flex flex-col gap-2 rounded-[10px] border border-line p-4">
            <p>
              Kirim pesan ini ke bot{status.data?.botUsername ? ` @${status.data.botUsername}` : ""} dalam {code.minutes} menit:
            </p>
            <code className="w-fit rounded bg-line-2 px-2 py-1 text-base font-medium tracking-wide">/start {code.code}</code>
            {code.url && (
              <a className="w-fit font-medium underline" href={code.url} target="_blank" rel="noreferrer">
                Buka di Telegram
              </a>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setCode(await unwrap(api.telegram.link.$post()));
              })
            }
          >
            {linked ? "Hubungkan chat lain" : "Hubungkan Telegram"}
          </Button>
          {linked && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await unwrap(api.telegram.link.$delete());
                  setCode(null);
                  await queryClient.invalidateQueries({ queryKey: ["telegram"] });
                  toast("Telegram diputuskan", "up");
                })
              }
            >
              Putuskan
            </Button>
          )}
        </div>
      </div>
    </PageBody>
  );
}

import type { ApprovalInput, ApprovalRequestInput } from "@billy/core";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { api, ApiError, unwrap } from "../lib/api.ts";
import { Button } from "./ui/button.tsx";
import { Dialog } from "./ui/dialog.tsx";
import { Field, Input } from "./ui/field.tsx";

type Step = { name: "choose" } | { name: "waiting"; id: string; summary: string } | { name: "rejected" } | { name: "expired" };

/**
 * "Butuh persetujuan admin": the admin types their PIN here, or the user asks for a remote
 * approval and waits while the admin decides from the bell. `submit` retries the blocked action
 * with the approval; the server decides whether it is enough. Offline, it only explains.
 */
export function ApprovalDialog({
  message,
  request,
  submit,
  offline = false,
  onClose,
}: {
  /** The server's 403 message, which names the limit. */
  message: string;
  /** What the remote request is for; the server derives the approved subject from it. */
  request: ApprovalRequestInput;
  /** Retries the action with the approval. Rejects with ApiError when the server still refuses. */
  submit: (approval: ApprovalInput) => Promise<void>;
  offline?: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [pin, setPin] = useState("");
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);
  const spent = useRef<string | null>(null);

  async function attempt(approval: ApprovalInput) {
    setBusy(true);
    try {
      await submit(approval);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.message);
      setStep({ name: "choose" });
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    setBusy(true);
    try {
      const created = await unwrap(api.approvals.$post({ json: request }));
      setStep({ name: "waiting", id: created.id, summary: created.summary });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const waitingId = step.name === "waiting" ? step.id : null;
  const status = useQuery({
    queryKey: ["approvals", waitingId],
    queryFn: () => unwrap(api.approvals[":id"].$get({ param: { id: waitingId! } })),
    enabled: waitingId !== null,
    refetchInterval: 2_000,
  });
  const decided = waitingId && status.data?.id === waitingId ? status.data.status : null;

  const onDecided = useEffectEvent((id: string, decision: string) => {
    if (decision === "approved" && spent.current !== id) {
      spent.current = id;
      void attempt({ id });
    } else if (decision === "rejected") setStep({ name: "rejected" });
    else if (decision === "expired") setStep({ name: "expired" });
  });
  useEffect(() => {
    if (waitingId && decided) onDecided(waitingId, decided);
  }, [waitingId, decided]);

  const onPin = (e: FormEvent) => {
    e.preventDefault();
    if (/^\d{6}$/.test(pin)) void attempt({ pin });
  };

  return (
    <Dialog open onClose={onClose} title="Butuh persetujuan admin" description={offline ? undefined : error}>
      {offline ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-warn-bg px-3 py-2 text-warn">
            {message} Persetujuan admin butuh internet, jadi transaksi ini tidak bisa dilanjutkan saat offline.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Tutup</Button>
          </div>
        </div>
      ) : step.name === "waiting" ? (
        <div className="flex flex-col gap-4" role="status">
          <p className="font-medium">Menunggu persetujuan admin…</p>
          <p className="text-ink-2">{step.summary}</p>
          <p className="text-muted">Admin bisa menyetujui dari lonceng notifikasi. Transaksi lanjut otomatis setelah disetujui.</p>
          <div className="flex justify-end">
            <Button onClick={onClose} disabled={busy}>
              Batal
            </Button>
          </div>
        </div>
      ) : step.name === "rejected" || step.name === "expired" ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-down/10 px-3 py-2 text-down" role="alert">
            {step.name === "rejected" ? "Permintaan ditolak admin." : "Permintaan kedaluwarsa sebelum diputuskan."}
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Tutup</Button>
            <Button variant="primary" onClick={() => void ask()} disabled={busy}>
              Minta lagi
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <form onSubmit={onPin} noValidate className="flex flex-col gap-3">
            <Field label="PIN admin" hint="Admin mengetik PIN 6 angka di perangkat ini.">
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" disabled={busy || pin.length !== 6} className="justify-center">
              Setujui dengan PIN
            </Button>
          </form>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            atau
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button onClick={() => void ask()} disabled={busy} className="justify-center">
            Minta persetujuan
          </Button>
        </div>
      )}
    </Dialog>
  );
}

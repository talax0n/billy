import { approvalPinInput, BASIS_POINTS, formatBp, type Limits, watchdogSettingsInput, type WatchdogSettings } from "@billy/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input, MoneyInput } from "../../components/ui/field.tsx";
import { PageBody } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { useForm } from "../../lib/form.ts";

const limitsQuery = { queryKey: ["settings", "limits"], queryFn: () => unwrap(api.settings.limits.$get()) };
const watchdogQuery = { queryKey: ["settings", "watchdog"], queryFn: () => unwrap(api.settings.watchdog.$get()) };
const pinQuery = { queryKey: ["approvals", "pin"], queryFn: () => unwrap(api.approvals.pin.$get()) };

/** Admin only: the limits every non-admin works under, and the admin's own approval PIN. */
export function SecurityTab() {
  const limits = useQuery(limitsQuery);
  const watchdog = useQuery(watchdogQuery);
  return (
    <PageBody className="max-w-2xl gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Batas kasir dan staf</h2>
          <p className="text-muted">Berlaku untuk semua pengguna selain admin. Di atas batas, transaksi butuh persetujuan admin.</p>
        </div>
        {limits.data && <LimitsForm initial={limits.data} />}
      </section>
      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <div>
          <h2 className="font-semibold">Pengawasan</h2>
          <p className="text-muted">Kapan Peringatan di Overview dan Ringkasan harian menandai selisih kas dan aktivitas di luar jam buka.</p>
        </div>
        {watchdog.data && <WatchdogForm initial={watchdog.data} />}
      </section>
      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <div>
          <h2 className="font-semibold">PIN persetujuan</h2>
          <p className="text-muted">
            6 angka yang Anda ketik di layar Kasir untuk menyetujui diskon besar, harga di bawah modal, atau void.
          </p>
        </div>
        <PinForm />
      </section>
    </PageBody>
  );
}

const percentText = (bp: number) => String(bp / 100).replace(".", ",");

function LimitsForm({ initial }: { initial: Limits }) {
  const queryClient = useQueryClient();
  const [percent, setPercent] = useState(percentText(initial.kasirMaxDiscountBp));
  const [allowBelowCost, setAllowBelowCost] = useState(initial.allowBelowCost);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const bp = Math.round(Number(percent.replace(",", ".")) * 100);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!percent.trim() || !Number.isFinite(bp) || bp < 0 || bp > BASIS_POINTS) {
      setError("Isi 0 sampai 100");
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      queryClient.setQueryData(limitsQuery.queryKey, await unwrap(api.settings.limits.$put({ json: { kasirMaxDiscountBp: bp, allowBelowCost } })));
      toast(`Batas diskon ${formatBp(bp)} disimpan`, "up");
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Diskon maksimal per nota (%)" hint="Diskon baris dan diskon transaksi dijumlahkan." error={error} className="max-w-56">
        {(p) => <Input {...p} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />}
      </Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-ink" checked={allowBelowCost} onChange={(e) => setAllowBelowCost(e.target.checked)} />
        Boleh menjual di bawah harga modal tanpa persetujuan
      </label>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving}>
          Simpan batas
        </Button>
      </div>
    </form>
  );
}

function WatchdogForm({ initial }: { initial: WatchdogSettings }) {
  const queryClient = useQueryClient();
  const form = useForm(watchdogSettingsInput, initial);
  const submit = form.onSubmit(async (input) => {
    queryClient.setQueryData(watchdogQuery.queryKey, await unwrap(api.settings.watchdog.$put({ json: input })));
    await queryClient.invalidateQueries({ queryKey: ["watchdog"] });
    toast("Pengaturan pengawasan disimpan", "up");
  });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-3 gap-x-3 gap-y-4 max-md:grid-cols-2">
      <Field label="Selisih kas shift" hint="Lebih atau kurang, mulai jumlah ini." error={form.errors.cashDifferenceThreshold} className="col-span-3 max-w-56 max-md:col-span-2">
        {(p) => <MoneyInput {...p} value={form.values.cashDifferenceThreshold} onChange={(v) => form.set("cashDifferenceThreshold", v)} />}
      </Field>
      <Field label="Jam buka" error={form.errors.openTime}>
        {(p) => <Input {...p} type="time" value={form.values.openTime} onChange={(e) => form.set("openTime", e.target.value)} />}
      </Field>
      <Field label="Jam tutup" hint="Waktu Indonesia Barat" error={form.errors.closeTime}>
        {(p) => <Input {...p} type="time" value={form.values.closeTime} onChange={(e) => form.set("closeTime", e.target.value)} />}
      </Field>
      <div className="col-span-3 flex justify-end max-md:col-span-2">
        <Button type="submit" variant="primary" disabled={form.submitting}>
          Simpan pengawasan
        </Button>
      </div>
    </form>
  );
}

function PinForm() {
  const queryClient = useQueryClient();
  const status = useQuery(pinQuery);
  const form = useForm(approvalPinInput, { password: "", pin: "" });
  const submit = form.onSubmit(async (input) => {
    queryClient.setQueryData(pinQuery.queryKey, await unwrap(api.approvals.pin.$put({ json: input })));
    form.setValues({ password: "", pin: "" });
    toast("PIN persetujuan disimpan", "up");
  });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4 max-md:grid-cols-1">
      <p className="col-span-2 text-ink-2 max-md:col-span-1">
        {status.data?.set ? "PIN sudah diatur. Isi di bawah untuk menggantinya." : "Belum ada PIN. Tanpa PIN, persetujuan hanya bisa dari lonceng notifikasi."}
      </p>
      <Field label="PIN baru (6 angka)" error={form.errors.pin}>
        {(p) => (
          <Input
            {...p}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={form.values.pin}
            onChange={(e) => form.set("pin", e.target.value.replace(/\D/g, ""))}
          />
        )}
      </Field>
      <Field label="Kata sandi Anda" hint="Untuk memastikan ini memang Anda." error={form.errors.password}>
        {(p) => (
          <Input {...p} type="password" autoComplete="current-password" value={form.values.password} onChange={(e) => form.set("password", e.target.value)} />
        )}
      </Field>
      <div className="col-span-2 flex justify-end max-md:col-span-1">
        <Button type="submit" variant="primary" disabled={form.submitting}>
          {status.data?.set ? "Ganti PIN" : "Simpan PIN"}
        </Button>
      </div>
    </form>
  );
}

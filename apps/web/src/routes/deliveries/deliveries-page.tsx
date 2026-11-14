import { deliveryCreateInput, type DeliveryCreateInput } from "@billy/core";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { ArrowLeft, MapPin, Phone, Plus, Truck, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Dialog } from "../../components/ui/dialog.tsx";
import { controlClass, Field, Input } from "../../components/ui/field.tsx";
import { EmptyState, PageBody, PageHeader } from "../../components/ui/page.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { api, ApiError, unwrap } from "../../lib/api.ts";
import { cx } from "../../lib/cx.ts";
import { useForm } from "../../lib/form.ts";

type Board = InferResponseType<typeof api.deliveries.$get, 200>;
type Delivery = Board["deliveries"][number];
type Driver = Board["drivers"][number];

const boardQuery = queryOptions({
  queryKey: ["deliveries"],
  queryFn: () => unwrap(api.deliveries.$get()),
  refetchInterval: 10_000,
});

const clock = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" });

function waited(since: string | null, now: number) {
  const minutes = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 60_000)) : 0;
  if (minutes < 1) return "baru saja";
  const h = Math.floor(minutes / 60);
  return h ? `${h} jam ${minutes % 60} menit` : `${minutes} menit`;
}

function departed(at: string | null, now: number) {
  const since = waited(at, now);
  return since === "baru saja" ? "baru berangkat" : `berangkat ${since} lalu`;
}

export function DeliveriesPage() {
  return (
    <>
      <PageHeader title="Antrian Antar" />
      <PageBody>
        <DeliveryBoard backOffice />
      </PageBody>
    </>
  );
}

/** The kasir's own full-screen view, opened from the Kasir top bar; the kasir never sees the shell. */
export function KasirDeliveriesPage() {
  return (
    <div className="min-h-dvh bg-bg p-2.5 max-md:p-0">
      <div className="min-h-[calc(100dvh-20px)] rounded-[14px] border border-line bg-panel max-md:rounded-none max-md:border-0">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4 max-md:px-4">
          <Link to="/kasir" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 font-medium hover:bg-line-2">
            <ArrowLeft className="size-4" />
            Kembali ke Kasir
          </Link>
          <h1 className="text-[23px] font-semibold tracking-tight">Antrian Antar</h1>
        </header>
        <PageBody>
          <DeliveryBoard backOffice={false} />
        </PageBody>
      </div>
    </div>
  );
}

type Open = { kind: "depart" | "cancel"; delivery: Delivery } | { kind: "add" } | { kind: "drivers" } | null;

function DeliveryBoard({ backOffice }: { backOffice: boolean }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery(boardQuery);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);

  async function run(request: Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await request;
      toast(done, "up");
      setOpen(null);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: boardQuery.queryKey });
    }
  }

  if (!data) return error ? <EmptyState title="Antrian belum bisa dimuat" description={error.message} /> : null;
  const now = Date.now();
  const waiting = data.deliveries.filter((d) => d.status === "waiting");
  const finished = data.deliveries.filter((d) => d.status === "delivered" || d.status === "cancelled").reverse();
  const shown = data.drivers.filter((d) => d.active || d.busy);
  const carrying = (driver: Driver) => data.deliveries.filter((d) => d.status === "on_the_way" && d.driverId === driver.id);
  const param = (d: Delivery) => ({ param: { id: d.id } });

  return (
    <div className="flex flex-col gap-5">
      {backOffice && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" className="h-10" onClick={() => setOpen({ kind: "add" })}>
            <Plus className="size-4" />
            Tambah antaran
          </Button>
          <Button className="h-10" onClick={() => setOpen({ kind: "drivers" })}>
            <Users className="size-4" />
            Kelola sopir
          </Button>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-4 max-lg:grid-cols-1">
        <section aria-label="Menunggu" className="flex flex-col gap-2.5">
          <h2 className="text-base font-semibold">
            Menunggu <span className="font-normal text-muted">· {waiting.length} antaran</span>
          </h2>
          {waiting.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line">
              <EmptyState
                title="Tidak ada barang yang menunggu"
                description="Antaran baru muncul di sini saat kasir mencentang “Diantar ke alamat”, atau lewat tombol Tambah antaran."
              />
            </div>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {waiting.map((d, i) => (
                <li key={d.id} className="flex gap-3.5 rounded-xl border border-line p-4 max-md:p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-[15px] font-semibold text-panel tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <DeliveryInfo delivery={d} backOffice={backOffice} />
                    <div className="mt-1 text-xs text-warn">menunggu {waited(d.queuedAt, now)}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Button variant="primary" className="h-11 px-5 text-[15px]" onClick={() => setOpen({ kind: "depart", delivery: d })}>
                      <Truck className="size-4" />
                      Berangkat
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "cancel", delivery: d })}>
                      Batalkan
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-label="Sopir" className="flex flex-col gap-2.5">
          <h2 className="text-base font-semibold">Sopir</h2>
          {shown.length === 0 && (
            <div className="rounded-xl border border-dashed border-line">
              <EmptyState
                title="Belum ada sopir"
                description={backOffice ? "Tambahkan nama sopir lewat tombol Kelola sopir." : "Minta admin menambahkan sopir di menu Antrian Antar."}
              />
            </div>
          )}
          {shown.map((driver) => {
            const loads = carrying(driver);
            return (
              <article key={driver.id} aria-label={`Sopir ${driver.name}`} className="rounded-xl border border-line p-4">
                <div className="flex items-center gap-2">
                  <b className="text-[15px] font-semibold">{driver.name}</b>
                  {driver.turn === 1 && <span className="rounded-md bg-line-2 px-1.5 py-px text-xs">Giliran berikutnya</span>}
                  <span
                    className={cx(
                      "ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                      driver.busy ? "bg-warn-bg text-warn" : "bg-up/10 text-up",
                    )}
                  >
                    <span className={cx("size-1.5 rounded-full", driver.busy ? "bg-warn" : "bg-up")} />
                    {driver.busy ? "Sedang mengantar" : "Siap"}
                  </span>
                </div>
                {loads.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2.5">
                    {loads.map((d) => (
                      <li key={d.id} className="rounded-lg bg-line-2/60 p-3">
                        <DeliveryInfo delivery={d} backOffice={backOffice} compact />
                        <div className="mt-1 text-xs text-muted">{departed(d.departedAt, now)}</div>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Button variant="primary" className="h-10" disabled={busy} onClick={() => void run(unwrap(api.deliveries[":id"].deliver.$post(param(d))), `${d.customerName}: sudah sampai`)}>
                            Sudah sampai
                          </Button>
                          <Button className="h-10" disabled={busy} onClick={() => void run(unwrap(api.deliveries[":id"].requeue.$post(param(d))), `${d.customerName} kembali ke antrian`)}>
                            Kembali ke antrian
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </section>
      </div>

      <section aria-label="Selesai hari ini" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Selesai hari ini</h2>
        {finished.length === 0 ? (
          <p className="text-muted">Belum ada antaran yang selesai hari ini.</p>
        ) : (
          <ul className="divide-y divide-line-2 rounded-xl border border-line">
            {finished.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
                <span className="w-12 text-muted tabular-nums">{clock.format(new Date((d.deliveredAt ?? d.cancelledAt)!))}</span>
                <span className="font-medium">{d.customerName}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{d.address}</span>
                {d.status === "delivered" ? (
                  <span className="text-up">Sampai{d.driverName && ` · ${d.driverName}`}</span>
                ) : (
                  <span className="text-down">Batal · {d.cancelReason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {open?.kind === "depart" && (
        <DepartDialog
          delivery={open.delivery}
          board={data}
          backOffice={backOffice}
          busy={busy}
          onClose={() => setOpen(null)}
          onDepart={(driver) =>
            void run(unwrap(api.deliveries[":id"].depart.$post({ ...param(open.delivery), json: { driverId: driver.id } })), `${driver.name} berangkat ke ${open.delivery.customerName}`)
          }
        />
      )}
      {open?.kind === "cancel" && (
        <CancelDialog
          delivery={open.delivery}
          busy={busy}
          onClose={() => setOpen(null)}
          onCancel={(reason) => void run(unwrap(api.deliveries[":id"].cancel.$post({ ...param(open.delivery), json: { reason } })), "Antaran dibatalkan")}
        />
      )}
      {open?.kind === "add" && <AddDialog onClose={() => setOpen(null)} onAdded={() => void queryClient.invalidateQueries({ queryKey: boardQuery.queryKey })} />}
      {open?.kind === "drivers" && <DriversDialog drivers={data.drivers} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DeliveryInfo({ delivery: d, backOffice, compact }: { delivery: Delivery; backOffice: boolean; compact?: boolean }) {
  let doc: ReactNode = null;
  if (d.posSaleNumber) {
    doc = backOffice ? (
      <Link to="/riwayat-kasir" search={{ id: d.posSaleId }} className="underline hover:text-ink">
        Nota {d.posSaleNumber}
      </Link>
    ) : (
      `Nota ${d.posSaleNumber}`
    );
  } else if (d.salesInvoiceNumber) {
    doc = backOffice ? (
      <Link to="/penjualan" search={{ id: d.salesInvoiceId }} className="underline hover:text-ink">
        Faktur {d.salesInvoiceNumber}
      </Link>
    ) : (
      `Faktur ${d.salesInvoiceNumber}`
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <b className={cx("font-semibold", !compact && "text-[15px]")}>{d.customerName}</b>
      <span className="flex items-start gap-1.5 text-ink-2">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted" />
        {d.address}
      </span>
      {d.phone && (
        <a href={`tel:${d.phone}`} className="flex items-center gap-1.5 text-ink-2 hover:underline">
          <Phone className="size-3.5 shrink-0 text-muted" />
          {d.phone}
        </a>
      )}
      {d.items.length > 0 && <span className="text-muted">{d.items.join(", ")}</span>}
      {d.note && <span className="text-ink-2">Catatan: {d.note}</span>}
      {doc && <span className="text-xs text-muted">{doc}</span>}
    </div>
  );
}

function DepartDialog({
  delivery,
  board,
  backOffice,
  busy,
  onClose,
  onDepart,
}: {
  delivery: Delivery;
  board: Board;
  backOffice: boolean;
  busy: boolean;
  onClose: () => void;
  onDepart: (driver: Driver) => void;
}) {
  // Ready drivers in turn order first; a busy one can still take this along on the same trip.
  const choices = board.drivers
    .filter((d) => d.active)
    .sort((a, b) => (a.turn ?? Infinity) - (b.turn ?? Infinity) || a.name.localeCompare(b.name, "id"));
  const [picked, setPicked] = useState(board.nextDriverId ?? choices[0]?.id ?? null);
  const driver = choices.find((d) => d.id === picked);
  return (
    <Dialog open onClose={onClose} title={`Berangkat ke ${delivery.customerName}`} description={delivery.address}>
      {choices.length === 0 ? (
        <p className="text-muted">{backOffice ? "Belum ada sopir aktif. Tambahkan lewat Kelola sopir." : "Belum ada sopir aktif. Minta admin menambahkannya."}</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (driver) onDepart(driver);
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-ink-2">Siapa yang mengantar?</legend>
            {choices.map((d) => (
              <label
                key={d.id}
                className={cx(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3",
                  d.id === picked ? "border-[1.5px] border-ink" : "border-line hover:bg-line-2",
                )}
              >
                <input type="radio" name="driver" className="size-4 accent-ink" checked={d.id === picked} onChange={() => setPicked(d.id)} />
                <span className="font-medium">{d.name}</span>
                <span className={cx("ml-auto text-xs", d.busy ? "text-warn" : d.turn === 1 ? "font-medium text-up" : "text-muted")}>
                  {d.busy ? "Sedang mengantar · bisa dibawa sekalian" : d.turn === 1 ? "Giliran berikutnya" : "Siap"}
                </span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" variant="primary" className="h-11 justify-center text-[15px]" disabled={!driver || busy}>
            <Truck className="size-4" />
            {driver ? `${driver.name} berangkat sekarang` : "Pilih sopir"}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

function CancelDialog({ delivery, busy, onClose, onCancel }: { delivery: Delivery; busy: boolean; onClose: () => void; onCancel: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onClose={onClose} title={`Batalkan antaran ${delivery.customerName}?`} description="Barang tidak jadi diantar. Tulis alasannya supaya yang lain tahu.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onCancel(reason.trim());
        }}
      >
        <Field label="Alasan batal">
          {(p) => <Input {...p} autoFocus value={reason} placeholder="Misal: pelanggan ambil sendiri" onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Button type="submit" variant="danger" className="h-11 justify-center" disabled={!reason.trim() || busy}>
          Batalkan antaran
        </Button>
      </form>
    </Dialog>
  );
}

const emptyDelivery: DeliveryCreateInput = { customerName: "", address: "", phone: "", note: "", invoiceNumber: "" };

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const form = useForm(deliveryCreateInput, emptyDelivery);
  const submit = form.onSubmit(async (input) => {
    await unwrap(api.deliveries.$post({ json: input }));
    toast("Masuk ke antrian", "up");
    onAdded();
    onClose();
  });
  const text = (key: Exclude<keyof DeliveryCreateInput, "address">, label: string, hint?: string) => (
    <Field label={label} hint={hint} error={form.errors[key]}>
      {(p) => <Input {...p} value={form.values[key] ?? ""} onChange={(e) => form.set(key, e.target.value)} />}
    </Field>
  );
  return (
    <Dialog open onClose={onClose} title="Tambah antaran">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {text("invoiceNumber", "Nomor faktur (kalau ada)", "Misal SO-261114-0001. Barangnya ikut tampil di antrian.")}
        {text("customerName", "Nama pelanggan", "Boleh kosong kalau ada nomor faktur")}
        <Field label="Alamat antar" error={form.errors.address}>
          {(p) => <textarea {...p} rows={3} className={cx(controlClass, "h-auto py-2")} value={form.values.address} onChange={(e) => form.set("address", e.target.value)} />}
        </Field>
        {text("phone", "Telepon")}
        {text("note", "Catatan untuk sopir")}
        <Button type="submit" variant="primary" className="h-11 justify-center text-[15px]" disabled={form.submitting}>
          Masukkan ke antrian
        </Button>
      </form>
    </Dialog>
  );
}

function DriversDialog({ drivers, onClose }: { drivers: Driver[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: boardQuery.queryKey });

  async function save(request: Promise<unknown>, done: string) {
    try {
      await request;
      toast(done, "up");
      await refresh();
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
      return false;
    }
  }

  return (
    <Dialog open onClose={onClose} title="Kelola sopir" description="Sopir tidak perlu masuk aplikasi. Sopir nonaktif tidak bisa dipilih.">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {drivers.length === 0 && <li className="text-muted">Belum ada sopir.</li>}
          {drivers.map((d) => (
            <DriverRow key={d.id} driver={d} onSave={save} />
          ))}
        </ul>
        <form
          className="flex gap-2 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save(unwrap(api.deliveries.drivers.$post({ json: { name } })), `${name.trim()} ditambahkan`).then((ok) => ok && setName(""));
          }}
        >
          <Input aria-label="Nama sopir baru" placeholder="Nama sopir baru" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            <Plus className="size-4" />
            Tambah
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

function DriverRow({ driver, onSave }: { driver: Driver; onSave: (request: Promise<unknown>, done: string) => Promise<boolean> }) {
  const [name, setName] = useState(driver.name);
  const update = (active: boolean, done: string) =>
    void onSave(unwrap(api.deliveries.drivers[":id"].$put({ param: { id: driver.id }, json: { name, phone: driver.phone, active } })), done);
  return (
    <li className={cx("flex items-center gap-2", !driver.active && "opacity-60")}>
      <Input aria-label={`Nama ${driver.name}`} value={name} onChange={(e) => setName(e.target.value)} />
      {name.trim() !== driver.name && (
        <Button size="md" onClick={() => update(driver.active, "Nama disimpan")} disabled={!name.trim()}>
          Simpan
        </Button>
      )}
      <Button size="md" variant={driver.active ? "danger" : "secondary"} onClick={() => update(!driver.active, driver.active ? `${driver.name} dinonaktifkan` : `${driver.name} aktif lagi`)}>
        {driver.active ? "Nonaktifkan" : "Aktifkan"}
      </Button>
    </li>
  );
}

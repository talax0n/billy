import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";
import { type ReactNode, useState } from "react";
import { attentionQuery } from "../../lib/attention.ts";
import { meQuery } from "../../lib/auth.ts";
import { settingsQuery } from "../../lib/settings.ts";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";

const idr = new Intl.NumberFormat("id-ID");

function readSeen(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Shown once per sign-in when entering the back office: the admin's announcement, then what
 * needs attention today. Shown again when the announcement changes. Nothing to say, no dialog.
 */
export function LoginNotice() {
  const { data: me } = useSuspenseQuery(meQuery);
  const settings = useQuery(settingsQuery);
  const attention = useQuery(attentionQuery);
  const key = me ? `login-notice:${me.id}:${me.sessionStartedAt}` : "";
  const announcement = settings.data?.announcement ?? "";
  // What the dismissal covers: this sign-in plus the announcement version it saw.
  const version = settings.data?.announcementUpdatedAt ?? "";
  const [dismissed, setDismissed] = useState(() => readSeen(key));

  const a = attention.data;
  if (!me || !a || !settings.data || dismissed === version) return null;
  const tiles: ReactNode[] = [];
  if (a.negativeStock) tiles.push(<Tile key="neg" onOpen={close} to="/stok-menipis" tone="down" value={a.negativeStock} label="Stok habis/minus" note="Cek dan sesuaikan stoknya" />);
  if (a.lowStock) tiles.push(<Tile key="low" onOpen={close} to="/stok-menipis" tone="warn" value={a.lowStock} label="Stok menipis" note="Saatnya pesan lagi ke pemasok" />);
  if (a.overdueInvoices.count) {
    tiles.push(
      <Tile key="due" onOpen={close} to="/penjualan" tone="down" value={a.overdueInvoices.count} label="Faktur telat bayar" note={`Total Rp ${idr.format(a.overdueInvoices.outstanding)} belum dibayar`} />,
    );
  }
  if (a.pendingApprovals) tiles.push(<Tile key="appr" tone="warn" value={a.pendingApprovals} label="Menunggu persetujuan Anda" note="Buka lonceng di kanan atas" />);
  if (!announcement && tiles.length === 0) return null;

  function close() {
    try {
      sessionStorage.setItem(key, version);
    } catch {
      // Storage blocked: it stays closed for this page view.
    }
    setDismissed(version);
  }

  return (
    <Dialog open onClose={close} title={`Selamat datang, ${me.name}`} className="max-w-lg">
      <div className="flex flex-col gap-4">
        {announcement && (
          <div className="flex gap-3 rounded-xl border border-line bg-warn-bg/40 p-4">
            <Megaphone className="mt-0.5 size-5 shrink-0 text-warn" />
            <div>
              <div className="mb-1 text-xs font-medium text-warn">Pengumuman</div>
              <p className="whitespace-pre-line">{announcement}</p>
            </div>
          </div>
        )}
        {tiles.length > 0 && (
          <div>
            <h3 className="mb-2 font-medium">Perlu perhatian hari ini</h3>
            <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
              {tiles}
            </div>
          </div>
        )}
        <Button variant="primary" className="h-11 justify-center text-[15px]" onClick={close} autoFocus>
          Mengerti
        </Button>
      </div>
    </Dialog>
  );
}

const toneClass = { down: "text-down", warn: "text-warn" };

function Tile({ to, onOpen, tone, value, label, note }: { to?: string; onOpen?: () => void; tone: keyof typeof toneClass; value: number; label: string; note: string }) {
  const body = (
    <>
      <div className={`text-[26px] leading-none font-semibold tabular-nums ${toneClass[tone]}`}>{value}</div>
      <div className="mt-1.5 font-medium">{label}</div>
      <div className="text-xs text-muted">{note}</div>
    </>
  );
  const box = "rounded-xl border border-line px-3.5 py-3";
  return to ? (
    <Link to={to} onClick={onOpen} className={`${box} hover:bg-line-2`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

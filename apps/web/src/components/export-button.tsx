import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../lib/api.ts";
import { downloadFile } from "../lib/download.ts";
import { Button } from "./ui/button.tsx";
import { toast } from "./ui/toast.tsx";

/** "Ekspor Excel": downloads the .xlsx the API builds for `path`; a refusal (row cap) shows as a toast. */
export function ExportButton({ path, disabled = false }: { path: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await downloadFile(path);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toast(err.message, "down");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button onClick={() => void run()} disabled={disabled || busy}>
      <FileSpreadsheet className="size-4" />
      Ekspor Excel
    </Button>
  );
}

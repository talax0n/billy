import { ApiError } from "./api.ts";

/**
 * Downloads a file the API builds (an .xlsx export) under the name the server gives it. A refusal,
 * such as an export past its row cap, rejects with the server's message instead of saving a JSON file.
 */
export async function downloadFile(path: string) {
  let res: Response;
  try {
    res = await fetch(path);
  } catch {
    throw new ApiError("Tidak tersambung ke server", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? "Gagal mengunduh berkas", res.status);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "ekspor.xlsx";
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

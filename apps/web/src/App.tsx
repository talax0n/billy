import { formatRupiah, rupiah } from "@billy/core";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

type ApiState = "checking" | "online" | "offline";

export function App() {
  const [state, setState] = useState<ApiState>("checking");

  useEffect(() => {
    api.api.health
      .$get()
      .then((res) => setState(res.ok ? "online" : "offline"))
      .catch(() => setState("offline"));
  }, []);

  return (
    <main className="mx-auto max-w-xl p-10">
      <div className="rounded-xl border border-line bg-panel p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sumber Karya</h1>
        <p className="mt-1 text-muted">Scaffold check: web, API, and core are wired.</p>
        <p className="mt-6 text-3xl font-medium">{formatRupiah(rupiah(3460000))}</p>
        <p className={`mt-4 text-sm ${state === "online" ? "text-up" : state === "offline" ? "text-down" : "text-muted"}`}>
          API: {state}
        </p>
      </div>
    </main>
  );
}

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Preloads the Latin Inter file, which the browser otherwise finds only after parsing the CSS. */
const preloadFont: Plugin = {
  name: "preload-font",
  transformIndexHtml: (_html, ctx) =>
    Object.keys(ctx.bundle ?? {})
      .filter((file) => /inter-latin-wght-normal-.*\.woff2$/.test(file))
      .map((file) => ({ tag: "link", injectTo: "head", attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${file}`, crossorigin: "" } })),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFont],
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:8787" } },
});

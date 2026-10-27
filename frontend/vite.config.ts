import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { isPublicSupabaseKey } from "./public-config";

const pagesRoot = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "VITE_");
  const requestedBase = env.VITE_BASE_PATH?.trim() || "/";
  if (/[:?#\\]/.test(requestedBase)) throw new Error("VITE_BASE_PATH deve ser um caminho, por exemplo /orbita/.");
  if (env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() && !isPublicSupabaseKey(env.VITE_SUPABASE_PUBLISHABLE_KEY.trim())) throw new Error("O Pages aceita somente chave pública publishable/anon do Supabase.");
  const base = `/${requestedBase.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
  return {
    root: pagesRoot,
    envDir: projectRoot,
    publicDir: fileURLToPath(new URL("../public", import.meta.url)),
    base,
    plugins: [react()],
    resolve: { alias: { "@": projectRoot } },
    server: { host: "127.0.0.1", port: 4174, strictPort: true, fs: { allow: [projectRoot] } },
    build: { outDir: fileURLToPath(new URL("../dist-pages", import.meta.url)), emptyOutDir: true, sourcemap: false },
  };
});

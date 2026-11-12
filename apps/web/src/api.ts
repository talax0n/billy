import type { AppType } from "@billy/api";
import { hc } from "hono/client";

export const api = hc<AppType>("/");

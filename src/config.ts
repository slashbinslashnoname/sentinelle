/**
 * Bootstrap configuration — the only things that come from the environment.
 *
 * There are NO secrets here: the admin password is set via register-on-first-run
 * and merchant credentials are API keys minted in the admin UI. Everything
 * operational (xpub, phoenixd, explorer, rates, TTL, CORS, SMTP, ...) lives in
 * the database `settings` and is managed at runtime through the admin API.
 *
 * So `.env` only needs to say where to listen and where to keep the database.
 */

import { z } from "zod";

const intFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().nonnegative());

const ConfigSchema = z.object({
  PORT: intFromEnv(8080),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_PATH: z.string().default("./data/sentinelle.sqlite"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

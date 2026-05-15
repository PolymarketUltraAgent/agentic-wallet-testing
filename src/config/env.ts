import { z } from "zod";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });

const envSchema = z.object({
  SESSION_DIR: z.string().default("./data/sessions"),
  DATABASE_URL: z.string().default("./data/bot.sqlite"),
  GATEWAY_API: z
    .string()
    .default("https://gateway-api-testnet.circle.com"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default("info"),
});

export const env = envSchema.parse(process.env);

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const dbPath = resolve(process.cwd(), env.DATABASE_URL);
mkdirSync(dirname(dbPath), { recursive: true });

const client = createClient({ url: `file:${dbPath}` });
export const db = drizzle(client, { schema });

await client.execute(
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    wallet_address TEXT,
    session_dir TEXT NOT NULL,
    session_expires TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`
);

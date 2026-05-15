import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  email: text("email").notNull(),
  walletAddress: text("wallet_address"),
  sessionDir: text("session_dir").notNull(),
  sessionExpires: text("session_expires"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

import { eq } from "drizzle-orm";
import { resolve } from "path";
import { db } from "../index.js";
import { users } from "../schema.js";
import { env } from "../../config/env.js";
import { SESSION_DURATION_MS } from "../../config/constants.js";

export interface User {
  id: number;
  userId: string;
  email: string;
  walletAddress: string | null;
  sessionDir: string;
  sessionExpires: string | null;
  createdAt: string | null;
}

export async function createUser(userId: string, email: string): Promise<User> {
  const sessionDir = resolve(process.cwd(), env.SESSION_DIR, userId);

  await db
    .insert(users)
    .values({ userId, email, sessionDir })
    .onConflictDoUpdate({
      target: users.userId,
      set: { email, sessionDir },
    });

  return (await getUser(userId))!;
}

export async function getUser(userId: string): Promise<User | null> {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.userId, userId))
    .get();

  return (result as User | undefined) ?? null;
}

export async function updateWalletAddress(userId: string, address: string): Promise<void> {
  await db
    .update(users)
    .set({ walletAddress: address })
    .where(eq(users.userId, userId));
}

export async function updateSessionExpiry(userId: string): Promise<void> {
  const expires = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await db
    .update(users)
    .set({ sessionExpires: expires })
    .where(eq(users.userId, userId));
}

export async function isSessionValid(userId: string): Promise<boolean> {
  const user = await getUser(userId);
  if (!user?.sessionExpires) return false;
  return new Date(user.sessionExpires) > new Date();
}

export async function getAllUsers(): Promise<User[]> {
  const result = await db.select().from(users).all();
  return result as User[];
}

import express from "express";
import { resolve } from "path";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { CHAINS } from "./config/constants.js";
import * as walletService from "./services/circle/wallet-service.js";
import * as gatewayService from "./services/gateway/gateway-service.js";
import * as userRepo from "./db/repositories/user-repo.js";
import "./db/index.js";
import type { StepEvent } from "./services/circle/cli.js";
import type { Request, Response } from "express";

const app = express();
app.use(express.json());
app.use(express.static(resolve(import.meta.dirname, "public")));

const sseClients = new Map<string, Response[]>();

function emitToUser(userId: string, event: StepEvent) {
  const clients = sseClients.get(userId) ?? [];
  const data = JSON.stringify(event);
  clients.forEach((res) => {
    res.write(`data: ${data}\n\n`);
  });
}

function createEmitter(userId: string): (event: StepEvent) => void {
  return (event) => emitToUser(userId, event);
}

function param(req: Request, name: string): string {
  return String((req.params as Record<string, string>)[name] ?? "");
}

// SSE endpoint
app.get("/api/events/:userId", (req: Request, res: Response) => {
  const userId = param(req, "userId");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const clients = sseClients.get(userId) ?? [];
  clients.push(res);
  sseClients.set(userId, clients);

  req.on("close", () => {
    const remaining = (sseClients.get(userId) ?? []).filter((c) => c !== res);
    if (remaining.length === 0) sseClients.delete(userId);
    else sseClients.set(userId, remaining);
  });
});

// Accept terms for a user
app.post("/api/terms/accept", async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }

  try {
    const emit = createEmitter(userId);
    await walletService.acceptTerms(userId, emit);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Initialize login (send OTP)
app.post("/api/login/init", async (req: Request, res: Response) => {
  const { userId, email } = req.body as { userId?: string; email?: string };
  if (!userId || !email) { res.status(400).json({ error: "userId and email required" }); return; }

  try {
    const emit = createEmitter(userId);

    // Check if terms need accepting first
    const status = await walletService.getStatus(userId, emit);
    if (status.needsTerms) {
      await walletService.acceptTerms(userId, emit);
    }

    // Create/update user in DB
    await userRepo.createUser(userId, email);

    const { requestId } = await walletService.initLogin(userId, email, emit);
    res.json({ requestId });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Complete login (verify OTP)
app.post("/api/login/complete", async (req: Request, res: Response) => {
  const { userId, requestId, otp } = req.body as {
    userId?: string;
    requestId?: string;
    otp?: string;
  };
  if (!userId || !requestId || !otp) {
    res.status(400).json({ error: "userId, requestId, and otp required" });
    return;
  }

  try {
    const emit = createEmitter(userId);
    await walletService.completeLogin(userId, requestId, otp, emit);

    // Update session expiry
    await userRepo.updateSessionExpiry(userId);

    // Fetch wallets
    const arcWallets = await walletService.listWallets(userId, CHAINS.ARC_TESTNET, emit);
    const walletAddress = arcWallets[0]?.address ?? null;

    if (walletAddress) {
      await userRepo.updateWalletAddress(userId, walletAddress);
    }

    res.json({ success: true, walletAddress });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Get wallet info + balances
app.get("/api/wallet/:userId", async (req: Request, res: Response) => {
  const userId = param(req, "userId");
  const user = await userRepo.getUser(userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  try {
    const emit = createEmitter(userId);
    const address = user.walletAddress;
    if (!address) { res.json({ user, balances: {} }); return; }

    const [arcBalance, baseBalance, polygonBalance] = await Promise.all([
      walletService.getBalance(userId, address, CHAINS.ARC_TESTNET, emit),
      walletService.getBalance(userId, address, CHAINS.BASE_SEPOLIA, emit),
      walletService.getBalance(userId, address, CHAINS.POLYGON_AMOY, emit),
    ]);

    res.json({
      user,
      balances: {
        arcTestnet: arcBalance,
        baseSepolia: baseBalance,
        polygonAmoy: polygonBalance,
      },
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Fund wallet from faucet
app.post("/api/fund", async (req: Request, res: Response) => {
  const { userId, chain } = req.body as { userId?: string; chain?: string };
  const user = userId ? await userRepo.getUser(userId) : null;
  if (!user?.walletAddress) { res.status(400).json({ error: "No wallet found" }); return; }

  const targetChain = chain || CHAINS.BASE_SEPOLIA;

  try {
    const emit = createEmitter(userId!);
    await walletService.fundTestnet(userId!, user.walletAddress, targetChain, emit);

    // Wait for faucet
    await new Promise((r) => setTimeout(r, 5000));
    const balance = await walletService.getBalance(userId!, user.walletAddress, targetChain, emit);

    res.json({ success: true, chain: targetChain, balance });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Bridge to Polygon Amoy
app.post("/api/bridge", async (req: Request, res: Response) => {
  const { userId, amount, sourceChain } = req.body as {
    userId?: string;
    amount?: string;
    sourceChain?: string;
  };
  const user = userId ? await userRepo.getUser(userId) : null;
  if (!user?.walletAddress) { res.status(400).json({ error: "No wallet found" }); return; }
  if (!amount) { res.status(400).json({ error: "amount required" }); return; }

  const fromChain = sourceChain || CHAINS.BASE_SEPOLIA;

  try {
    const emit = createEmitter(userId!);

    // Pre-check balance on source chain
    const balances = await walletService.getBalance(userId!, user.walletAddress, fromChain, emit);
    const usdcBal = balances.find((b) => b.symbol === "USDC");
    const available = parseFloat(usdcBal?.amount ?? "0");
    if (available < parseFloat(amount)) {
      const msg = `Insufficient USDC on ${fromChain}: ${available} available, ${amount} needed. Fund this chain first.`;
      emit?.({ step: "bridge_check", status: "error", error: msg });
      res.status(400).json({ error: msg });
      return;
    }

    emit?.({
      step: "bridge_transfer",
      status: "running",
      command: `circle bridge transfer ${CHAINS.POLYGON_AMOY} --amount ${amount} --address ${user.walletAddress} --chain ${fromChain}`,
    });

    const { exec: execCli } = await import("./services/circle/cli.js");
    const result = await execCli(userId!, [
      "bridge", "transfer",
      CHAINS.POLYGON_AMOY,
      "--amount", amount,
      "--address", user.walletAddress,
      "--chain", fromChain,
      "--output", "json",
    ]);

    if (result.exitCode !== 0) {
      const error = result.stderr || result.stdout;
      emit?.({ step: "bridge_transfer", status: "error", error });
      res.status(500).json({ error });
      return;
    }

    emit?.({ step: "bridge_transfer", status: "success", output: result.stdout.slice(0, 200) });

    // Check balance on Polygon
    const balance = await walletService.getBalance(
      userId!,
      user.walletAddress,
      CHAINS.POLYGON_AMOY,
      emit
    );

    res.json({ success: true, sourceChain: fromChain, balance });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.listen(env.PORT, () => {
  logger.info(`Demo server running at http://localhost:${env.PORT}`);
});

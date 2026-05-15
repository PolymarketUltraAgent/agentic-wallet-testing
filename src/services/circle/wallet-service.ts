import { exec, parseJSON, type StepEmitter } from "./cli.js";
import { CHAINS } from "../../config/constants.js";

interface WalletListResponse {
  data: {
    wallets: Array<{
      type: string;
      address: string;
      blockchain: string;
      createDate: string;
    }>;
  };
}

interface BalanceResponse {
  data: {
    balances: Array<{
      amount: string;
      token: {
        name: string;
        symbol: string;
        blockchain: string;
        decimals: number;
        isNative: boolean;
      };
    }>;
  };
}

interface StatusResponse {
  type?: string;
  email?: string;
  status?: string;
}

export async function initLogin(
  userId: string,
  email: string,
  emit?: StepEmitter
): Promise<{ requestId: string }> {
  emit?.({
    step: "login_init",
    status: "running",
    command: `circle wallet login ${email} --testnet --init`,
  });

  const result = await exec(userId, [
    "wallet",
    "login",
    email,
    "--testnet",
    "--init",
  ]);

  if (result.exitCode !== 0 && !result.stdout.includes("OTP code sent")) {
    const errorMsg = result.stderr || result.stdout;
    emit?.({ step: "login_init", status: "error", error: errorMsg });
    throw new Error(`Login init failed: ${errorMsg}`);
  }

  const output = result.stdout;
  const requestIdMatch = output.match(/--request\s+([a-f0-9-]+)/);
  if (!requestIdMatch) {
    emit?.({ step: "login_init", status: "error", error: "Could not parse request ID" });
    throw new Error(`Could not parse request ID from output: ${output}`);
  }

  const requestId = requestIdMatch[1];
  emit?.({
    step: "login_init",
    status: "success",
    output: `OTP sent to ${email}`,
  });

  return { requestId };
}

export async function completeLogin(
  userId: string,
  requestId: string,
  otp: string,
  emit?: StepEmitter
): Promise<void> {
  emit?.({
    step: "login_complete",
    status: "running",
    command: `circle wallet login --request ${requestId} --otp ${otp}`,
  });

  const result = await exec(userId, [
    "wallet",
    "login",
    "--request",
    requestId,
    "--otp",
    otp,
  ]);

  if (result.exitCode !== 0 && !result.stdout.includes("Logged in")) {
    const errorMsg = result.stderr || result.stdout;
    emit?.({ step: "login_complete", status: "error", error: errorMsg });
    throw new Error(`Login failed: ${errorMsg}`);
  }

  emit?.({ step: "login_complete", status: "success", output: result.stdout });
}

export async function acceptTerms(
  userId: string,
  emit?: StepEmitter
): Promise<void> {
  emit?.({
    step: "terms_accept",
    status: "running",
    command: "circle terms accept --output json",
  });

  const result = await exec(userId, ["terms", "accept", "--output", "json"]);

  if (result.exitCode !== 0) {
    emit?.({ step: "terms_accept", status: "error", error: result.stderr });
    throw new Error(`Terms acceptance failed: ${result.stderr}`);
  }

  emit?.({ step: "terms_accept", status: "success", output: "Terms accepted" });
}

export async function getStatus(
  userId: string,
  emit?: StepEmitter
): Promise<{ loggedIn: boolean; email?: string; needsTerms?: boolean }> {
  const result = await exec(userId, ["wallet", "status"]);

  if (result.stderr.includes("Terms acceptance is required")) {
    return { loggedIn: false, needsTerms: true };
  }

  if (result.exitCode !== 0) {
    return { loggedIn: false };
  }

  const emailMatch = result.stdout.match(/Email:\s+(.+)/);
  return { loggedIn: true, email: emailMatch?.[1]?.trim() };
}

export async function listWallets(
  userId: string,
  chain: string = CHAINS.ARC_TESTNET,
  emit?: StepEmitter
): Promise<WalletListResponse["data"]["wallets"]> {
  emit?.({
    step: "list_wallets",
    status: "running",
    command: `circle wallet list --chain ${chain} --type agent --output json`,
  });

  const result = await exec(userId, [
    "wallet",
    "list",
    "--chain",
    chain,
    "--type",
    "agent",
    "--output",
    "json",
  ]);

  const parsed = parseJSON<WalletListResponse>(result);
  const wallets = parsed?.data?.wallets ?? [];

  emit?.({
    step: "list_wallets",
    status: "success",
    output: wallets.length > 0
      ? `Found ${wallets.length} wallet(s): ${wallets[0].address}`
      : "No wallets found",
  });

  return wallets;
}

export async function getBalance(
  userId: string,
  address: string,
  chain: string = CHAINS.ARC_TESTNET,
  emit?: StepEmitter
): Promise<{ amount: string; symbol: string }[]> {
  emit?.({
    step: "get_balance",
    status: "running",
    command: `circle wallet balance --address ${address} --chain ${chain} --output json`,
  });

  const result = await exec(userId, [
    "wallet",
    "balance",
    "--address",
    address,
    "--chain",
    chain,
    "--output",
    "json",
  ]);

  const parsed = parseJSON<BalanceResponse>(result);
  const balances = (parsed?.data?.balances ?? []).map((b) => ({
    amount: b.amount,
    symbol: b.token.symbol,
  }));

  emit?.({
    step: "get_balance",
    status: "success",
    output: balances.length > 0
      ? balances.map((b) => `${b.amount} ${b.symbol}`).join(", ")
      : "0 USDC",
  });

  return balances;
}

export async function fundTestnet(
  userId: string,
  address: string,
  chain: string = CHAINS.ARC_TESTNET,
  emit?: StepEmitter
): Promise<void> {
  emit?.({
    step: "fund_testnet",
    status: "running",
    command: `circle wallet fund --address ${address} --chain ${chain}`,
  });

  const result = await exec(userId, [
    "wallet",
    "fund",
    "--address",
    address,
    "--chain",
    chain,
  ]);

  if (result.exitCode !== 0 && !result.stdout.includes("Faucet")) {
    emit?.({ step: "fund_testnet", status: "error", error: result.stderr || result.stdout });
    throw new Error(`Fund failed: ${result.stderr || result.stdout}`);
  }

  emit?.({ step: "fund_testnet", status: "success", output: result.stdout });
}

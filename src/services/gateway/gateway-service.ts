import { exec, parseJSON, type StepEmitter } from "../circle/cli.js";
import { CHAINS } from "../../config/constants.js";
import { env } from "../../config/env.js";
import { GATEWAY_WALLET, GATEWAY_MINTER, DOMAINS, USDC_ADDRESSES } from "./constants.js";
import { getBalance } from "../circle/wallet-service.js";
import { randomBytes } from "crypto";

interface GatewayBalanceData {
  data?: {
    balances?: Array<{ amount: string; chain?: string }>;
    balance?: string;
  };
}

export async function depositToGateway(
  userId: string,
  address: string,
  amount: string,
  emit?: StepEmitter
): Promise<void> {
  // Pre-check balance
  const balances = await getBalance(userId, address, CHAINS.ARC_TESTNET, emit);
  const usdcBal = balances.find((b) => b.symbol === "USDC");
  const available = parseFloat(usdcBal?.amount ?? "0");
  if (available < parseFloat(amount)) {
    const msg = `Insufficient balance on Arc Testnet: ${available} USDC available, ${amount} USDC needed. Fund your wallet first.`;
    emit?.({ step: "gateway_deposit", status: "error", error: msg });
    throw new Error(msg);
  }

  emit?.({
    step: "gateway_deposit",
    status: "running",
    command: `circle gateway deposit --amount ${amount} --address ${address} --chain ${CHAINS.ARC_TESTNET} --method direct`,
  });

  // Don't pass emit to exec to avoid duplicate events
  const result = await exec(userId, [
    "gateway", "deposit",
    "--amount", amount,
    "--address", address,
    "--chain", CHAINS.ARC_TESTNET,
    "--method", "direct",
  ]);

  if (result.exitCode !== 0 && !result.stdout.toLowerCase().includes("deposit")) {
    const error = result.stderr || result.stdout;
    emit?.({ step: "gateway_deposit", status: "error", error });
    throw new Error(`Gateway deposit failed: ${error}`);
  }

  emit?.({ step: "gateway_deposit", status: "success", output: result.stdout });
}

export async function getGatewayBalance(
  userId: string,
  address: string,
  emit?: StepEmitter
): Promise<string> {
  emit?.({
    step: "gateway_balance",
    status: "running",
    command: `circle gateway balance --address ${address} --chain ${CHAINS.ARC_TESTNET} --output json`,
  });

  const result = await exec(userId, [
    "gateway", "balance",
    "--address", address,
    "--chain", CHAINS.ARC_TESTNET,
    "--output", "json",
  ]);

  const parsed = parseJSON<GatewayBalanceData>(result);
  const balance = parsed?.data?.balance ?? parsed?.data?.balances?.[0]?.amount ?? "0";

  emit?.({ step: "gateway_balance", status: "success", output: `${balance} USDC` });
  return balance;
}

export async function bridgeToPolygon(
  userId: string,
  address: string,
  amount: string,
  emit?: StepEmitter
): Promise<void> {
  // Pre-check balance
  const balances = await getBalance(userId, address, CHAINS.ARC_TESTNET, emit);
  const usdcBal = balances.find((b) => b.symbol === "USDC");
  const available = parseFloat(usdcBal?.amount ?? "0");
  if (available < parseFloat(amount)) {
    const msg = `Insufficient balance on Arc Testnet: ${available} USDC available, ${amount} USDC needed. Fund your wallet first.`;
    emit?.({ step: "bridge_transfer", status: "error", error: msg });
    throw new Error(msg);
  }

  emit?.({
    step: "bridge_transfer",
    status: "running",
    command: `circle bridge transfer ${CHAINS.POLYGON_AMOY} --amount ${amount} --address ${address} --chain ${CHAINS.ARC_TESTNET}`,
  });

  const result = await exec(userId, [
    "bridge", "transfer",
    CHAINS.POLYGON_AMOY,
    "--amount", amount,
    "--address", address,
    "--chain", CHAINS.ARC_TESTNET,
  ]);

  if (result.exitCode !== 0) {
    const error = result.stderr || result.stdout;
    emit?.({ step: "bridge_transfer", status: "error", error });
    throw new Error(`Bridge transfer failed: ${error}`);
  }

  emit?.({ step: "bridge_transfer", status: "success", output: result.stdout });
}

export async function gatewayTransferToPolygon(
  userId: string,
  address: string,
  amount: string,
  emit?: StepEmitter
): Promise<void> {
  // Step 1: Deposit to Gateway
  await depositToGateway(userId, address, amount, emit);

  // Step 2: Wait for deposit confirmation
  emit?.({ step: "gateway_confirm", status: "running", output: "Waiting for deposit confirmation..." });
  await new Promise((r) => setTimeout(r, 3000));

  // Step 3: Check Gateway balance
  const balance = await getGatewayBalance(userId, address, emit);

  if (parseFloat(balance) <= 0) {
    emit?.({ step: "gateway_confirm", status: "error", error: "Gateway deposit not yet confirmed" });
    throw new Error("Gateway deposit not confirmed after waiting");
  }

  emit?.({ step: "gateway_confirm", status: "success", output: `Gateway balance: ${balance} USDC` });

  // Step 4: Build and sign burn intent (EIP-712)
  const salt = "0x" + randomBytes(32).toString("hex");
  const burnIntent = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      BurnIntent: [
        { name: "maxBlockHeight", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "spec", type: "TransferSpec" },
      ],
      TransferSpec: [
        { name: "version", type: "uint8" },
        { name: "sourceDomain", type: "uint32" },
        { name: "destinationDomain", type: "uint32" },
        { name: "sourceContract", type: "address" },
        { name: "destinationContract", type: "address" },
        { name: "sourceToken", type: "address" },
        { name: "destinationToken", type: "address" },
        { name: "sourceDepositor", type: "address" },
        { name: "destinationRecipient", type: "address" },
        { name: "value", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "hookData", type: "bytes" },
      ],
    },
    primaryType: "BurnIntent",
    domain: {
      name: "GatewayWallet",
      version: "1",
      chainId: "421614",
      verifyingContract: GATEWAY_WALLET,
    },
    message: {
      maxBlockHeight: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      maxFee: "2010000",
      spec: {
        version: 1,
        sourceDomain: DOMAINS.ARC_TESTNET,
        destinationDomain: DOMAINS.POLYGON_AMOY,
        sourceContract: GATEWAY_WALLET,
        destinationContract: GATEWAY_MINTER,
        sourceToken: USDC_ADDRESSES[DOMAINS.ARC_TESTNET],
        destinationToken: USDC_ADDRESSES[DOMAINS.POLYGON_AMOY],
        sourceDepositor: address,
        destinationRecipient: address,
        value: (BigInt(Math.round(parseFloat(amount) * 1e6))).toString(),
        salt,
        hookData: "0x",
      },
    },
  };

  const burnIntentJson = JSON.stringify(burnIntent);
  emit?.({
    step: "gateway_sign",
    status: "running",
    command: `circle wallet sign typed-data '<burn-intent>' --address ${address} --chain ${CHAINS.ARC_TESTNET}`,
  });

  const signResult = await exec(userId, [
    "wallet", "sign", "typed-data",
    burnIntentJson,
    "--address", address,
    "--chain", CHAINS.ARC_TESTNET,
  ]);

  if (signResult.exitCode !== 0) {
    const error = signResult.stderr || signResult.stdout;
    emit?.({ step: "gateway_sign", status: "error", error });
    emit?.({ step: "gateway_fallback", status: "running", output: "Gateway signing failed, falling back to CCTP bridge..." });
    await bridgeToPolygon(userId, address, amount, emit);
    return;
  }

  const signature = signResult.stdout.trim();
  emit?.({ step: "gateway_sign", status: "success", output: `Signature: ${signature.slice(0, 20)}...` });

  // Step 5: Get attestation from Gateway API
  emit?.({
    step: "gateway_attest",
    status: "running",
    command: `POST ${env.GATEWAY_API}/v1/transfer`,
  });

  try {
    const response = await fetch(`${env.GATEWAY_API}/v1/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        burnIntents: [{
          permit2Signature: signature,
          burnIntent: burnIntent.message,
          chainId: burnIntent.domain.chainId,
        }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      emit?.({ step: "gateway_attest", status: "error", error: `Gateway API ${response.status}: ${errorText}` });
      emit?.({ step: "gateway_fallback", status: "running", output: "Attestation failed, falling back to CCTP bridge..." });
      await bridgeToPolygon(userId, address, amount, emit);
      return;
    }

    const attestData = await response.json() as { attestation: string; operatorSignature: string };
    emit?.({ step: "gateway_attest", status: "success", output: "Attestation received" });

    // Step 6: Mint on Polygon Amoy
    emit?.({
      step: "gateway_mint",
      status: "running",
      command: `circle wallet execute ${GATEWAY_MINTER} --chain ${CHAINS.POLYGON_AMOY}`,
    });

    const mintResult = await exec(userId, [
      "wallet", "execute",
      GATEWAY_MINTER,
      "--abi", "gatewayMint(bytes,bytes)",
      "--args", `${attestData.attestation},${attestData.operatorSignature}`,
      "--chain", CHAINS.POLYGON_AMOY,
    ]);

    if (mintResult.exitCode !== 0) {
      const error = mintResult.stderr || mintResult.stdout;
      emit?.({ step: "gateway_mint", status: "error", error });
      throw new Error(`Mint failed: ${error}`);
    }

    emit?.({ step: "gateway_mint", status: "success", output: mintResult.stdout });
  } catch (error) {
    if ((error as Error).message.includes("Mint failed")) throw error;
    emit?.({
      step: "gateway_fallback",
      status: "running",
      output: `Gateway error: ${(error as Error).message}. Falling back to CCTP bridge...`,
    });
    await bridgeToPolygon(userId, address, amount, emit);
  }
}

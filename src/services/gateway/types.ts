export interface BurnIntentSpec {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: string;
  destinationContract: string;
  sourceToken: string;
  destinationToken: string;
  sourceDepositor: string;
  destinationRecipient: string;
  value: bigint;
  salt: string;
  hookData: string;
}

export interface BurnIntent {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: BurnIntentSpec;
}

export interface GatewayBalanceResponse {
  data: {
    balances: Array<{
      amount: string;
      chain: string;
    }>;
  };
}

export interface TransferResponse {
  attestation: string;
  operatorSignature: string;
}

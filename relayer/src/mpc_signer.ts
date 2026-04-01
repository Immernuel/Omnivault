// ============================================================
// OmniVault — MPC Signer
//
// Calls v1.signer-prod.testnet directly from the relayer,
// bypassing NEAR's 300 Tgas per-transaction contract limit.
//
// Usage: npm run sign <position_id>
// Example: npm run sign pos-profemm.testnet-2
// ============================================================

import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

// ── Config ────────────────────────────────────────────────────
const MPC_CONTRACT = "v1.signer-prod.testnet";
const CHAIN_BRIDGE = process.env.CHAIN_BRIDGE!;
const SEPOLIA_RPC = process.env.SEPOLIA_RPC!;
const AAVE_POOL = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
const USDC_SEPOLIA = "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8";

async function initNear() {
  if (!process.env.NEAR_ACCOUNT || !process.env.NEAR_PRIVATE_KEY) {
    throw new Error("Missing NEAR_ACCOUNT or NEAR_PRIVATE_KEY in .env");
  }

  const keyPair = KeyPair.fromString(process.env.NEAR_PRIVATE_KEY as any);
  const signer = new KeyPairSigner(keyPair);
  const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });

  const account = new Account(
    process.env.NEAR_ACCOUNT_KEY as any,
    provider,
    signer,
  );

  console.log(`🔗 Connected to NEAR: ${process.env.NEAR_ACCOUNT}`);
  return { account, provider };
}

// ── View helper ───────────────────────────────────────────────
async function view(
  provider: any,
  contractId: string,
  methodName: string,
  args: any,
): Promise<any> {
  const res = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "optimistic",
  });
  return JSON.parse(Buffer.from(res.result).toString());
}

// ── Contract call helper — same as working relayer.ts ─────────
async function callContract(
  account: any,
  contractId: string,
  methodName: string,
  args: object,
  gas: string,
  deposit: string,
): Promise<any> {
  return account.callFunctionRaw({
    contractId,
    methodName,
    args,
    gas: BigInt(gas),
    deposit: BigInt(deposit),
  });
}

// ── Build Aave supply() calldata ──────────────────────────────
function buildAaveCalldata(amount: bigint, onBehalfOf: string): string {
  const iface = new ethers.Interface([
    "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  ]);
  return iface.encodeFunctionData("supply", [
    USDC_SEPOLIA,
    amount,
    onBehalfOf,
    0,
  ]);
}

// ── Build unsigned EIP-1559 tx ────────────────────────────────
function buildUnsignedTx(
  to: string,
  data: string,
  nonce: number,
): ethers.TransactionLike<string> {
  return {
    type: 2,
    chainId: 11155111,
    nonce,
    to,
    value: 0n,
    data,
    gasLimit: 300_000n,
    maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
    maxFeePerGas: ethers.parseUnits("20", "gwei"),
  };
}

// ── Hash tx for MPC ───────────────────────────────────────────
function hashTx(tx: ethers.TransactionLike<string>): Uint8Array {
  return ethers.getBytes(
    ethers.keccak256(ethers.Transaction.from(tx).unsignedSerialized),
  );
}

// ── Reconstruct signed Ethereum tx ───────────────────────────
function signTx(
  tx: ethers.TransactionLike<string>,
  r: string,
  s: string,
  v: number,
): string {
  return ethers.Transaction.from({
    ...tx,
    signature: ethers.Signature.from({ r, s, v }),
  }).serialized;
}

// ── Parse MPC signature from NEAR result ─────────────────────
function parseSignature(result: any): { r: string; s: string; v: number } {
  // Try receipts_outcome first (most common)
  const receipts = result?.receipts_outcome || [];
  for (const r of receipts) {
    const sv = r?.outcome?.status?.SuccessValue;
    if (sv !== undefined && sv !== "") {
      return JSON.parse(Buffer.from(sv, "base64").toString());
    }
  }
  // Fallback: transaction_outcome
  const sv = result?.transaction_outcome?.outcome?.status?.SuccessValue;
  if (sv) {
    return JSON.parse(Buffer.from(sv, "base64").toString());
  }
  throw new Error(
    `Could not parse MPC signature. Result: ${JSON.stringify(result).slice(0, 400)}`,
  );
}

// ── Main flow ─────────────────────────────────────────────────
async function signAndBroadcast(positionId: string) {
  console.log(`\n🚀 OmniVault MPC Signer`);
  console.log(`   Position: ${positionId}\n`);

  const { account, provider } = await initNear();

  // 1. Fetch pending signature data from chain_bridge
  console.log(`📋 Fetching pending signature...`);
  const pendingRaw: string | null = await view(
    provider,
    CHAIN_BRIDGE,
    "get_pending_signature",
    { position_id: positionId },
  );
  if (!pendingRaw) throw new Error(`No pending signature for ${positionId}`);
  const pending = JSON.parse(pendingRaw);
  console.log(`   ETH address:  ${pending.eth_address}`);

  // 2. Fetch yield transfer for amount
  const transfer = await view(provider, CHAIN_BRIDGE, "get_yield_transfer", {
    position_id: positionId,
  });
  if (!transfer) throw new Error(`No yield transfer for ${positionId}`);
  const amount = BigInt(transfer[2]);
  const ethAddress = transfer[3] as string;
  console.log(`   Amount:       ${amount}`);

  // 3. Build Ethereum tx + hash
  const nonce = parseInt(positionId.split("-").pop() || "1");
  const path = `ethereum-${nonce}`;
  const tx = buildUnsignedTx(
    AAVE_POOL,
    buildAaveCalldata(amount, ethAddress),
    nonce,
  );
  const txHash = hashTx(tx);
  const payload = Array.from(txHash);

  console.log(`\n🔐 Calling MPC: ${MPC_CONTRACT}`);
  console.log(`   Path: ${path}`);
  console.log(`   Hash: ${Buffer.from(txHash).toString("hex")}`);
  console.log(`   Signing... (~6 seconds)`);

  // 4. Call v1.signer-prod.testnet.sign() with full 300 Tgas
  // 4. Call v1.signer-prod.testnet via chainsig.js
  const { contracts } = await import("chainsig.js");
  const keyPair = KeyPair.fromString(process.env.NEAR_PRIVATE_KEY as any);
  const contract = new contracts.ChainSignatureContract({
    networkId: "testnet",
    contractId: MPC_CONTRACT,
  });

  const results = await contract.sign({
    payloads: [txHash],
    path,
    keyType: "Ecdsa",
    signerAccount: {
      accountId: process.env.NEAR_ACCOUNT!,
      signAndSendTransactions: async (txs: any) => {
        // txs is a single transaction object, not an array
        const t = txs.transactions[0];
        const action = t.actions[0].functionCall;
        const methodName = action.methodName;
        // args is a Buffer containing JSON — decode it
        const argsJson = Buffer.isBuffer(action.args)
          ? action.args
          : Buffer.from(action.args.data);
        const rawArgs = Buffer.isBuffer(action.args)
          ? action.args
          : Buffer.from(action.args.data);
        const args = JSON.parse(rawArgs.toString());
        const gas = "300000000000000";
        const deposit = "500000000000000000000000";
        console.log(`   Receiver: ${t.receiverId}, Method: ${methodName}`);
        console.log(`   Full args: ${JSON.stringify(args)}`);
        // Pass raw bytes directly to avoid double-serialization
        const r = await account.callFunctionRaw({
          contractId: t.receiverId,
          methodName,
          args: rawArgs,
          gas: BigInt(gas),
          deposit: BigInt(deposit),
        });
        return [r];
      },
    },
  });
  const sig = results[0];

  // 5. Parse (r, s, v) from result
  console.log(`\n✅ MPC signature received!`);
  console.log(`   r: ${sig.r}`);
  console.log(`   s: ${sig.s}`);
  console.log(`   v: ${sig.v}`);

  // 6. Reconstruct signed Ethereum tx
  const signedTx = signTx(tx, sig.r, sig.s, sig.v);
  console.log(`\n📦 Signed tx: ${signedTx.slice(0, 50)}...`);

  // 7. Broadcast to Ethereum Sepolia
  console.log(`\n📡 Broadcasting to Sepolia...`);
  const ethProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const txRes = await ethProvider.broadcastTransaction(signedTx);
  console.log(`   Tx: ${txRes.hash}`);
  console.log(`   Waiting for confirmation...`);
  await txRes.wait(1);
  console.log(`✅ Confirmed on Ethereum!`);
  console.log(`   https://sepolia.etherscan.io/tx/${txRes.hash}`);

  // 8. Notify chain_bridge of confirmation
  const ausdcAmount = ((amount * 99n) / 100n).toString();
  console.log(`\n🔔 Notifying chain_bridge...`);
  await callContract(
    account,
    CHAIN_BRIDGE,
    "position_broadcast_confirmed",
    {
      position_id: positionId,
      eth_tx_hash: txRes.hash,
      ausdc_amount: ausdcAmount,
    },
    "30000000000000",
    "0",
  );

  console.log(`\n🎉 Cross-chain yield deployed via NEAR MPC!`);
  console.log(`   NEAR → MPC signed → Ethereum Aave → aUSDC`);
  console.log(`   Position: ${positionId}`);
  console.log(`   ETH tx:   ${txRes.hash}`);
}

// ── Entry point ───────────────────────────────────────────────
const positionId = process.argv[2];
if (!positionId) {
  console.error("Usage: npm run sign <position_id>");
  console.error("Example: npm run sign pos-profemm.testnet-2");
  process.exit(1);
}

signAndBroadcast(positionId).catch((err) => {
  console.error("❌", err.message || err);
  process.exit(1);
});

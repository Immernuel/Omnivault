import { NextRequest, NextResponse } from "next/server";
import { connect, keyStores, KeyPair } from "near-api-js";

const APP_ID = process.env.WORLD_APP_ID!;
const ACTION = "omnivault-deposit";

const NEAR_CONFIG = {
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
};

async function callVerifyUser(nearAccountId: string, nullifierHash: string) {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(process.env.NEAR_OWNER_PRIVATE_KEY as any);
  await keyStore.setKey("testnet", process.env.NEAR_OWNER_ACCOUNT!, keyPair);

  const near = await connect({ ...NEAR_CONFIG, keyStore } as any);
  const account = await near.account(process.env.NEAR_OWNER_ACCOUNT!);

  await account.functionCall({
    contractId: "wallet-core.omnivault.testnet",
    methodName: "verify_user",
    args: {
      user: nearAccountId,
      nullifier_hash: nullifierHash,
    },
    gas: BigInt("30000000000000"),
    attachedDeposit: BigInt("0"),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { proof, nearAccountId, dev_bypass } = await req.json();

    if (!proof || !nearAccountId) {
      return NextResponse.json(
        { error: "Missing proof or nearAccountId" },
        { status: 400 },
      );
    }

    // Dev bypass for localhost testing
    if (dev_bypass && process.env.NODE_ENV === "development") {
      await callVerifyUser(nearAccountId, proof.nullifier_hash);
      return NextResponse.json({ success: true });
    }

    // Call World ID cloud verify API directly
    const verifyRes = await fetch(
      `https://developer.worldcoin.org/api/v2/verify/${APP_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nullifier_hash: proof.nullifier_hash,
          merkle_root: proof.merkle_root,
          proof: proof.proof,
          verification_level: proof.verification_level,
          action: ACTION,
          signal: nearAccountId,
        }),
      },
    );

    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.success) {
      return NextResponse.json(
        { error: "World ID verification failed", detail: verifyData },
        { status: 400 },
      );
    }

    // Credit on NEAR contract
    await callVerifyUser(nearAccountId, proof.nullifier_hash);

    return NextResponse.json({
      success: true,
      nullifier_hash: proof.nullifier_hash,
    });
  } catch (err: any) {
    console.error("Verify error:", err);
    if (err?.message?.includes("Nullifier already used")) {
      return NextResponse.json({ success: true, already_verified: true });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

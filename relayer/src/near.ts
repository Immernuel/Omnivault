import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { InMemoryKeyStore } from "@near-js/keystores";
import { JsonRpcProvider } from "@near-js/providers";

export async function initNear() {
  if (!process.env.NEAR_ACCOUNT || !process.env.NEAR_PRIVATE_KEY) {
    throw new Error("Missing NEAR env vars");
  }

  const keyStore = new InMemoryKeyStore();

  const keyPair = KeyPair.fromString(
    process.env.NEAR_PRIVATE_KEY as any, // ✅ fix type issue
  );

  await keyStore.setKey("testnet", process.env.NEAR_ACCOUNT, keyPair);

  const provider = new JsonRpcProvider({
    url: "https://rpc.testnet.near.org",
  });

  const account = new Account(
    {
      networkId: "testnet",
      provider,
      signer: {
        getPublicKey: async () => keyPair.getPublicKey(),
        signMessage: async (message: Uint8Array) => {
          const signature = keyPair.sign(message);
          return {
            signature,
            publicKey: keyPair.getPublicKey(),
          };
        },
      },
    } as any,
    process.env.NEAR_ACCOUNT as any,
  );

  console.log("🔗 Connected to NEAR:", process.env.NEAR_ACCOUNT);

  return { account, provider };
}

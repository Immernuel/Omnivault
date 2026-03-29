import { usdc } from "./ethereum";
import { initNear } from "./near";
import { CONFIG } from "./config";
import Cache from "./cache";

async function start() {
  const { account, provider } = await initNear();

  // ✅ Initialize cache
  const cache = new Cache(provider);

  // ✅ Initial load
  await cache.refresh();

  // ✅ Auto-refresh every 30s
  setInterval(async () => {
    await cache.refresh();
  }, 30000);

  console.log("👀 Listening for USDC transfers on Sepolia...");

  usdc.on("Transfer", async (from: string, to: string, amount: bigint) => {
    try {
      const user = cache.getUser(to);

      // ❌ Not a tracked/verified user
      if (!user) return;

      console.log(`💰 Deposit detected → ${user}`);
      console.log(`From: ${from}`);
      console.log(`Amount: ${amount.toString()}`);

      // ✅ Call chain_bridge
      await account.functionCall({
        contractId: CONFIG.CHAIN_BRIDGE,
        methodName: "register_inbound_transfer",
        args: {
          user,
          external_chain: "ethereum",
          asset: "USDC",
          external_address: from,
          amount: amount.toString(),
        },
      });

      console.log("✅ Credited on NEAR");
    } catch (err) {
      console.error("❌ Relay failed:", err);
    }
  });
}

start();

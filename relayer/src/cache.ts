import { CONFIG } from "./config";

type AddressMap = Record<string, string>;

async function view(
  provider: any,
  contractId: string,
  methodName: string,
  args: any,
) {
  const res = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "optimistic",
  });

  return JSON.parse(Buffer.from(res.result).toString());
}

class Cache {
  private addressToUser: AddressMap = {};
  private lastUpdated = 0;

  constructor(private provider: any) {}

  async refresh() {
    console.log("🔄 Refreshing user cache...");

    try {
      const users: string[] = await view(
        this.provider,
        CONFIG.WALLET_CORE,
        "get_all_users",
        {},
      );

      console.log(`👥 Found ${users.length} users`);

      const newMap: AddressMap = {};

      for (const user of users) {
        try {
          // ✅ World ID filter
          const isVerified: boolean = await view(
            this.provider,
            CONFIG.WALLET_CORE,
            "is_user_verified",
            { user },
          );

          if (!isVerified) continue;

          // ✅ Get derived address
          const derived: string = await view(
            this.provider,
            CONFIG.CHAIN_BRIDGE,
            "get_derived_address",
            {
              user,
              chain: "ethereum",
            },
          );

          newMap[derived.toLowerCase()] = user;
        } catch (err) {
          console.error(`❌ Failed for user ${user}`, err);
        }
      }

      this.addressToUser = newMap;
      this.lastUpdated = Date.now();

      console.log(
        `✅ Cache updated (${Object.keys(newMap).length} verified users)`,
      );
    } catch (err) {
      console.error("❌ Cache refresh failed:", err);
    }
  }

  getUser(address: string): string | undefined {
    return this.addressToUser[address.toLowerCase()];
  }

  getLastUpdated(): number {
    return this.lastUpdated;
  }
}

export default Cache;

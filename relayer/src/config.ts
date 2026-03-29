import * as dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  SEPOLIA_RPC: process.env.SEPOLIA_RPC!,
  USDC_ADDRESS: process.env.USDC_ADDRESS!,

  NEAR_ACCOUNT: process.env.NEAR_ACCOUNT!,
  NEAR_PRIVATE_KEY: process.env.NEAR_PRIVATE_KEY!,

  CHAIN_BRIDGE: process.env.CHAIN_BRIDGE!,
  WALLET_CORE: process.env.WALLET_CORE!,
};

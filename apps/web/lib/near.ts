// ============================================================
// NEAR connection + contract interaction utilities
// Compatible with near-api-js v5
// ============================================================

import * as nearAPI from "near-api-js";

const CONTRACT_ADDRESSES = {
  wallet_core: "wallet-core.omnivault.testnet",
  vault_core: "vault-core.omnivault.testnet",
  chain_bridge: "chain-bridge.omnivault.testnet",
};

const NEAR_CONFIG = {
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
};

// Initialize NEAR connection
export async function initNear() {
  const keyStore = new nearAPI.keyStores.BrowserLocalStorageKeyStore();
  const near = await nearAPI.connect({
    ...NEAR_CONFIG,
    keyStore,
  });
  return { near, keyStore };
}

// Format yoctoNEAR to human-readable
export function yoctoToNear(yocto: string): string {
  return nearAPI.utils.format.formatNearAmount(yocto, 4);
}

// Parse NEAR to yoctoNEAR
export function nearToYocto(near: string): string {
  return nearAPI.utils.format.parseNearAmount(near) || "0";
}

// Format balance for display
export function formatBalance(yocto: string, decimals = 2): string {
  const near = parseFloat(yoctoToNear(yocto));
  return near.toFixed(decimals);
}

// Contract addresses — update after deploy
export { CONTRACT_ADDRESSES, NEAR_CONFIG };

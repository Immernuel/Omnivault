"use client";

import { useState, useEffect, useCallback } from "react";
import { connect, keyStores, utils } from "near-api-js";

const CONTRACT_ADDRESSES = {
  wallet_core: "wallet-core.omnivault.testnet",
  vault_core: "vault-core.omnivault.testnet",
  chain_bridge: "chain-bridge.omnivault.testnet",
};

const NEAR_CONFIG = {
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.fastnear.com",
  walletUrl: "https://testnet.mynearwallet.com/",
  helperUrl: "https://helper.testnet.near.org",
};

// Live prices fetched from CoinGecko
let cachedPrices: Record<string, number> = {
  NEAR: 4.2,
  ETH_SEPOLIA: 2080,
  USDC_SEPOLIA: 1.0,
  ETH_BASE: 2080,
  USDC_BASE: 1.0,
};

async function fetchLivePrices(): Promise<void> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=near,ethereum,usd-coin&vs_currencies=usd",
      { cache: "no-store" },
    );
    const data = await res.json();
    cachedPrices = {
      NEAR: data?.near?.usd ?? cachedPrices.NEAR,
      ETH_SEPOLIA: data?.ethereum?.usd ?? cachedPrices.ETH_SEPOLIA,
      USDC_SEPOLIA: data?.["usd-coin"]?.usd ?? 1.0,
      ETH_BASE: data?.ethereum?.usd ?? cachedPrices.ETH_BASE,
      USDC_BASE: data?.["usd-coin"]?.usd ?? 1.0,
    };
  } catch {
    // Keep cached prices if fetch fails
  }
}

// ── Asset decimals ────────────────────────────────────────────
const ASSET_DECIMALS: Record<string, number> = {
  NEAR: 24, // yoctoNEAR
  ETH_SEPOLIA: 18, // wei
  USDC_SEPOLIA: 6, // micro
  ETH_BASE: 18,
  USDC_BASE: 6,
};

// ── Asset display names ───────────────────────────────────────
export const ASSET_LABELS: Record<
  string,
  { name: string; chain: string; color: string }
> = {
  NEAR: { name: "NEAR", chain: "NEAR Testnet", color: "text-white" },
  ETH_SEPOLIA: { name: "ETH", chain: "Eth Sepolia", color: "text-blue-400" },
  USDC_SEPOLIA: { name: "USDC", chain: "Eth Sepolia", color: "text-blue-300" },
  ETH_BASE: { name: "ETH", chain: "Base Sepolia", color: "text-indigo-400" },
  USDC_BASE: { name: "USDC", chain: "Base Sepolia", color: "text-indigo-300" },
};

// ── Conversion helpers ────────────────────────────────────────
export function rawToDecimal(raw: string, asset: string): number {
  const decimals = ASSET_DECIMALS[asset] ?? 18;
  return parseFloat(raw) / Math.pow(10, decimals);
}

export function assetToUSD(raw: string, asset: string): number {
  const decimal = rawToDecimal(raw, asset);
  const price = cachedPrices[asset] ?? 0;
  return parseFloat((decimal * price).toFixed(2));
}

export function formatAssetAmount(raw: string, asset: string): string {
  const decimal = rawToDecimal(raw, asset);
  if (decimal === 0) return "0";
  if (decimal < 0.0001) return "<0.0001";
  return decimal.toFixed(4);
}

// Legacy helpers for backward compat
export function yoctoToDisplay(yocto: string): number {
  return assetToUSD(yocto, "NEAR");
}

export function yoctoToNear(yocto: string): string {
  return formatAssetAmount(yocto, "NEAR");
}

// ── Types ─────────────────────────────────────────────────────
export interface AssetBalance {
  asset: string; // "NEAR" | "ETH_SEPOLIA" etc
  raw: string; // raw on-chain amount
  decimal: number; // human readable
  usd: number; // USD value
  chain: string; // "near" | "ethereum" | "base"
}

export interface Position {
  id: string;
  amount: string;
  protocol: string;
  network: string;
  status: "bridging" | "active" | "redeeming" | "closed";
  yield_token_amount: string;
  origin_asset: string;
}

export interface VaultData {
  assets: AssetBalance[];
  totalUSD: number;
  nearBalance: string; // raw yocto for legacy
  walletBalance: string; // raw yocto for legacy
  vaultDeposit: string; // raw yocto for legacy
  totalBalance: string; // raw yocto for legacy
  positions: Position[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── Main hook ─────────────────────────────────────────────────
export function useVaultData(accountId: string | null): VaultData {
  const [assets, setAssets] = useState<AssetBalance[]>([]);
  const [walletBalance, setWalletBalance] = useState("0");
  const [vaultDeposit, setVaultDeposit] = useState("0");
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);

    // Fetch live prices in parallel
    await fetchLivePrices();

    try {
      const keyStore = new keyStores.BrowserLocalStorageKeyStore();
      const near = await connect({ ...NEAR_CONFIG, keyStore });
      const account = await near.account(accountId);

      // Fetch all asset balances
      const rawBalances: [string, string, string][] =
        await account.viewFunction({
          contractId: CONTRACT_ADDRESSES.wallet_core,
          methodName: "get_all_balances",
          args: { account_id: accountId },
        });

      const mappedAssets: AssetBalance[] = rawBalances.map(
        ([asset, raw, chain]) => ({
          asset,
          raw,
          decimal: rawToDecimal(raw, asset),
          usd: assetToUSD(raw, asset),
          chain,
        }),
      );

      setAssets(mappedAssets);

      // Legacy NEAR balance for backward compat
      const nearAsset = mappedAssets.find((a) => a.asset === "NEAR");
      setWalletBalance(nearAsset?.raw ?? "0");

      // Fetch vault deposits
      const vaultDep: string = await account.viewFunction({
        contractId: CONTRACT_ADDRESSES.wallet_core,
        methodName: "get_vault_deposit",
        args: { account_id: accountId },
      });
      setVaultDeposit(vaultDep);

      // Fetch positions
      const rawPositions: [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ][] = await account.viewFunction({
        contractId: CONTRACT_ADDRESSES.vault_core,
        methodName: "get_user_positions",
        args: { user: accountId },
      });

      setPositions(
        rawPositions.map(
          ([
            id,
            amount,
            protocol,
            network,
            status,
            yield_token_amount,
            origin_asset,
          ]) => ({
            id,
            amount,
            protocol,
            network,
            status: status as Position["status"],
            yield_token_amount,
            origin_asset,
          }),
        ),
      );
    } catch (err: any) {
      console.error("Failed to fetch vault data:", err);
      setError(err?.message || "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const totalUSD = assets.reduce((sum, a) => sum + a.usd, 0);
  const totalBalance = (
    BigInt(walletBalance) + BigInt(vaultDeposit)
  ).toString();

  return {
    assets,
    totalUSD,
    nearBalance: walletBalance,
    walletBalance,
    vaultDeposit,
    totalBalance,
    positions,
    loading,
    error,
    refetch: fetchData,
  };
}

export async function getDerivedAddress(
  accountId: string,
  chain: string,
): Promise<string> {
  try {
    const keyStore = new keyStores.BrowserLocalStorageKeyStore();
    const near = await connect({ ...NEAR_CONFIG, keyStore });
    const account = await near.account(accountId);
    const address: string = await account.viewFunction({
      contractId: CONTRACT_ADDRESSES.chain_bridge,
      methodName: "get_derived_address",
      args: { user: accountId, chain },
    });
    return address;
  } catch {
    return chain === "base"
      ? "0xc0382349f789f1c5378b0613c4adfdf3dddbd3e3"
      : "0x74e2637e17e5963378b6aa196389efbc855fb7db";
  }
}

export async function checkWorldIdVerified(
  accountId: string,
): Promise<boolean> {
  try {
    const keyStore = new keyStores.BrowserLocalStorageKeyStore();
    const near = await connect({ ...NEAR_CONFIG, keyStore });
    const account = await near.account(accountId);
    const verified: boolean = await account.viewFunction({
      contractId: CONTRACT_ADDRESSES.wallet_core,
      methodName: "is_user_verified",
      args: { user: accountId },
    });
    return verified;
  } catch {
    return false;
  }
}

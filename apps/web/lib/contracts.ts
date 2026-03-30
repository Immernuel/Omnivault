import { WalletSelector } from "@near-wallet-selector/core";
import { utils } from "near-api-js";
import { FunctionCall, Action } from "@near-js/transactions";

const CONTRACT_ADDRESSES = {
  wallet_core: "wallet-core.omnivault.testnet",
  vault_core: "vault-core.omnivault.testnet",
  chain_bridge: "chain-bridge.omnivault.testnet",
};

function nearToYocto(amount: string): string {
  return utils.format.parseNearAmount(amount) || "0";
}

function makeAction(
  methodName: string,
  args: Record<string, unknown>,
  gas: string,
  deposit: string,
): Action {
  const fc = new FunctionCall({
    methodName,
    args: new TextEncoder().encode(JSON.stringify(args)),
    gas: BigInt(gas),
    deposit: BigInt(deposit),
  });

  const action = new Action({ functionCall: fc });
  return action;
}

export async function depositToWallet(
  selector: WalletSelector,
  nearAmount: string,
): Promise<void> {
  const wallet = await selector.wallet();
  const yocto = nearToYocto(nearAmount);

  await (wallet as any).signAndSendTransaction({
    receiverId: CONTRACT_ADDRESSES.wallet_core,
    actions: [makeAction("deposit", {}, "30000000000000", yocto)],
  });
}

export async function openYieldPosition(
  selector: WalletSelector,
  params: {
    rawAmount: string;
    originChain: string;
    originAsset: string;
    network: string;
    yieldType: string;
    protocol: string;
  },
): Promise<void> {
  const wallet = await selector.wallet();
  const yocto = params.rawAmount; // already in raw units

  await (wallet as any).signAndSendTransaction({
    receiverId: CONTRACT_ADDRESSES.wallet_core,
    actions: [
      makeAction(
        "open_yield_position",
        {
          amount: params.rawAmount,
          origin_chain: params.originChain,
          origin_asset: params.originAsset,
          network: params.network,
          yield_type: params.yieldType,
          protocol: params.protocol,
        },
        "100000000000000",
        params.rawAmount,
      ),
    ],
  });
}

export async function withdrawFromWallet(
  selector: WalletSelector,
  nearAmount: string,
): Promise<void> {
  const wallet = await selector.wallet();
  const yocto = nearToYocto(nearAmount);

  await (wallet as any).signAndSendTransaction({
    receiverId: CONTRACT_ADDRESSES.wallet_core,
    actions: [makeAction("withdraw", { amount: yocto }, "30000000000000", "1")],
  });
}

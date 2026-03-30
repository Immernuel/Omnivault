"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { setupWalletSelector, WalletSelector } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupModal, WalletSelectorModal } from "@near-wallet-selector/modal-ui";

interface WalletContextValue {
  selector:  WalletSelector | null;
  modal:     WalletSelectorModal | null;
  accountId: string | null;
  isConnected: boolean;
  signIn:    () => void;
  signOut:   () => void;
  loading:   boolean;
}

const WalletContext = createContext<WalletContextValue>({
  selector:    null,
  modal:       null,
  accountId:   null,
  isConnected: false,
  signIn:      () => {},
  signOut:     () => {},
  loading:     true,
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [selector, setSelector]   = useState<WalletSelector | null>(null);
  const [modal, setModal]         = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const init = async () => {
      const _selector = await setupWalletSelector({
        network: "testnet",
        modules: [
         setupMyNearWallet({
            walletUrl:  "https://testnet.mynearwallet.com",
            successUrl: typeof window !== "undefined"
              ? `${window.location.origin}/dashboard`
              : "https://defi-vault-eta.vercel.app/dashboard",
            failureUrl: typeof window !== "undefined"
              ? `${window.location.origin}/`
              : "https://defi-vault-eta.vercel.app/",
          }),
        ],
      });

      const _modal = setupModal(_selector, {
        contractId: "wallet-core.omnivault.testnet",
      });

      const state = _selector.store.getState();
      const accounts = state.accounts;
      if (accounts.length > 0) {
        setAccountId(accounts[0].accountId);
      }

      // Listen for account changes
      _selector.store.observable.subscribe((state) => {
        const accounts = state.accounts;
        if (accounts.length > 0) {
          setAccountId(accounts[0].accountId);
        } else {
          setAccountId(null);
        }
      });

      setSelector(_selector);
      setModal(_modal);
      setLoading(false);
    };

    init().catch(console.error);
  }, []);

  const signIn = useCallback(() => {
    modal?.show();
  }, [modal]);

  const signOut = useCallback(async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
    setAccountId(null);
  }, [selector]);

  return (
    <WalletContext.Provider value={{
      selector,
      modal,
      accountId,
      isConnected: !!accountId,
      signIn,
      signOut,
      loading,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
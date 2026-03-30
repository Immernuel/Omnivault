"use client";

import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/lib/walletContext";
import { MiniKit } from "@worldcoin/minikit-js";
import { useEffect } from "react";

function MiniKitProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    MiniKit.install();
  }, []);
  return <>{children}</>;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MiniKitProvider>
          <WalletProvider>
            {children}
          </WalletProvider>
        </MiniKitProvider>
      </body>
    </html>
  );
}
"use client";

import { useState, useCallback } from "react";
import { MiniKit } from "@worldcoin/minikit-js";

export function useWorldId(nearAccountId: string | null) {
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    if (!nearAccountId) {
      setError("Connect your NEAR wallet first");
      return false;
    }

    setVerifying(true);
    setError(null);

    try {
      if (!MiniKit.isInstalled()) {
        setError("Open OmniVault inside World App");
        setVerifying(false);
        return false;
      }

      // ✅ NEW API
      const result = await (MiniKit as any).verify({
        action: "omnivault-deposit",
        signal: nearAccountId,
      });

      if (result.status !== "success") {
        setError("Verification failed or cancelled");
        setVerifying(false);
        return false;
      }

      // ✅ Send to backend
      const res = await fetch("/api/verify-worldid", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          proof: result,
          nearAccountId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Backend verification failed");
        setVerifying(false);
        return false;
      }

      setVerified(true);
      setVerifying(false);
      return true;
    } catch (err: any) {
      setError(err.message || "Verification failed");
      setVerifying(false);
      return false;
    }
  }, [nearAccountId]);

  return { verify, verifying, verified, setVerified, error };
}

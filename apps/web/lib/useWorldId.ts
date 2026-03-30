"use client";

import { useState, useCallback } from "react";
import {
  MiniKit,
  VerifyCommandInput,
  VerificationLevel,
  ISuccessResult,
} from "@worldcoin/minikit-js";

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
        // Fallback — dev bypass when outside World App
        if (
          process.env.NODE_ENV === "development" ||
          process.env.NEXT_PUBLIC_ALLOW_DEV_BYPASS === "true"
        ) {
          const res = await fetch("/api/verify-worldid", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              proof: {
                proof: "dev_proof",
                merkle_root: "dev_root",
                nullifier_hash: `dev-${nearAccountId}-${Date.now()}`,
                verification_level: "device",
              },
              nearAccountId,
              dev_bypass: true,
            }),
          });
          const data = await res.json();
          if (data.success) {
            setVerified(true);
            setVerifying(false);
            return true;
          }
          setError(data.error || "Verification failed");
          setVerifying(false);
          return false;
        }

        setError("Please open OmniVault inside World App to verify");
        setVerifying(false);
        return false;
      }

      // Real World App flow
      const verifyPayload: VerifyCommandInput = {
        action: "omnivault-deposit",
        signal: nearAccountId,
        verification_level: VerificationLevel.Device,
      };

      const { finalPayload } =
        await MiniKit.commandsAsync.verify(verifyPayload);

      if (finalPayload.status === "error") {
        setError("World ID verification cancelled or failed");
        setVerifying(false);
        return false;
      }

      const res = await fetch("/api/verify-worldid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proof: finalPayload as ISuccessResult,
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

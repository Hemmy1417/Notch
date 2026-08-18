"use client";

/**
 * The one human action in the console: connect a GenLayer wallet and file a
 * bonded challenge on a payment inside its window.
 *
 * Everything else in Notch is agent-driven — the buyer pays headlessly over
 * x402. But raising a dispute is a human's decision, so this is the surface a
 * person uses. The contract enforces the rules (buyer-only, bonded, in-window);
 * this component only makes them legible and refuses the obviously-doomed
 * submit before it costs a wasted signature.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "genlayer-js";
import { getAddress } from "viem";
import { fmtGen } from "@/lib/fmt";
import {
  CHAIN, CHAIN_HEX, CHAIN_NAME, CHAIN_RPC_DIRECT, COURT_ADDRESS,
} from "@/lib/genlayer/browser";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Eip1193 = any;
type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
type Discovered = { info: WalletInfo; provider: Eip1193 };

type Phase = "idle" | "connecting" | "submitting" | "confirming" | "done" | "error";

async function ensureChain(provider: Eip1193): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_HEX }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_HEX,
          chainName: CHAIN_NAME,
          rpcUrls: [CHAIN_RPC_DIRECT],
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
        }],
      });
    }
  }
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const retryable = (e: unknown) =>
  /rate limit|429|-32029|too many|temporarily|timed? out|upstream unreachable|failed to fetch/i.test(
    e instanceof Error ? e.message : String(e),
  );

export function ChallengePanel({
  paymentId, buyer, bondAtto, windowEndsEpoch,
}: {
  paymentId: string;
  buyer: string;
  bondAtto: string;
  windowEndsEpoch: number;
}) {
  const router = useRouter();
  const [wallets, setWallets] = useState<Discovered[]>([]);
  const [address, setAddress] = useState("");
  const [claim, setClaim] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const clientRef = useRef<any>(null);

  // Live window countdown, so an expired window disables the form honestly.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = windowEndsEpoch - now;
  const expired = secondsLeft <= 0;

  // EIP-6963 discovery (+ legacy window.ethereum fallback).
  useEffect(() => {
    function onAnnounce(e: Event) {
      const d = (e as CustomEvent).detail as Discovered;
      if (!d?.info?.uuid) return;
      setWallets((prev) =>
        prev.some((w) => w.info.uuid === d.info.uuid) ? prev : [...prev, d]);
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const eth = (window as any).ethereum;
      if (eth) {
        setWallets((prev) => prev.length ? prev : [{
          info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "legacy.injected" },
          provider: eth,
        }]);
      }
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  const connect = useCallback(async (d: Discovered) => {
    setPhase("connecting");
    setError("");
    try {
      const provider = d.provider;
      const accounts: string[] = await provider.request({ method: "eth_requestAccounts" });
      if (!accounts?.[0]) throw new Error("no account returned");
      const addr = getAddress(accounts[0]);
      await ensureChain(provider);
      clientRef.current = createClient({ chain: CHAIN, account: addr, provider });
      setAddress(addr);
      setPhase("idle");
      const onAccounts = (accs: string[]) => {
        if (accs?.[0]) {
          const a = getAddress(accs[0]);
          setAddress(a);
          clientRef.current = createClient({ chain: CHAIN, account: a, provider });
        } else {
          setAddress("");
          clientRef.current = null;
        }
      };
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.on?.("accountsChanged", onAccounts);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "could not connect");
    }
  }, []);

  const isBuyer = address !== "" && address.toLowerCase() === buyer.toLowerCase();

  const fileChallenge = useCallback(async () => {
    if (!clientRef.current || !claim.trim()) return;
    setPhase("submitting");
    setError("");
    try {
      const hash: string = await clientRef.current.writeContract({
        address: COURT_ADDRESS,
        functionName: "challenge",
        args: [paymentId, claim.trim()],
        value: BigInt(bondAtto),
      });
      setPhase("confirming");

      // The tx is SUBMITTED. A rate-limit during receipt polling must not be
      // read as failure — the write already landed; keep polling with backoff.
      let receipt: any;
      for (let attempt = 0; ; attempt++) {
        try {
          receipt = await clientRef.current.waitForTransactionReceipt({
            hash, status: "ACCEPTED", interval: 6000, retries: 40,
          });
          break;
        } catch (e) {
          if (retryable(e) && attempt < 4) {
            await new Promise((r) => setTimeout(r, 30000));
            continue;
          }
          throw e;
        }
      }

      const status = String(receipt?.status ?? "").toUpperCase();
      if (status.includes("UNDETERMINED") || status.includes("CANCELED")) {
        throw new Error("validators could not reach consensus — try again");
      }
      const lr = receipt?.consensus_data?.leader_receipt;
      const r = Array.isArray(lr) ? lr[0] : lr;
      if (r?.execution_result === "ERROR") {
        throw new Error("the contract rejected the challenge (window closed, or not the buyer)");
      }

      setPhase("done");
      setTimeout(() => router.refresh(), 1400);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "the challenge did not go through");
    }
  }, [claim, paymentId, bondAtto, router]);

  const busy = phase === "submitting" || phase === "confirming";

  return (
    <section className="section" style={{ paddingTop: 72 }}>
      <p className="t-label t-label-iris">Dispute this payment</p>
      <div className="challenge-box">
        <p className="t-body t-body-dim" style={{ marginTop: 14, fontSize: 16 }}>
          You have{" "}
          <span className="t-mono">
            {expired ? "no time" : `${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`}
          </span>{" "}
          left in this window. A challenge posts a{" "}
          <span className="t-mono">{fmtGen(bondAtto)} GEN</span> bond that returns
          if the panel finds for you, or if it cannot decide.
        </p>

        {phase === "done" ? (
          <p className="t-body" style={{ marginTop: 24, color: "var(--st-argued)" }}>
            Challenge filed. The payment is now DISPUTED — refreshing the record…
          </p>
        ) : expired ? (
          <p className="challenge-warn t-caption" style={{ marginTop: 20 }}>
            The window has closed. Unchallenged, this payment releases by rule.
          </p>
        ) : !address ? (
          <div style={{ marginTop: 24 }}>
            {wallets.length ? (
              <>
                <p className="t-label" style={{ marginBottom: 12 }}>Connect a wallet to challenge</p>
                {wallets.map((w) => (
                  <button key={w.info.uuid} className="wallet-opt"
                    disabled={phase === "connecting"} onClick={() => connect(w)}>
                    {/* wallet-supplied data: URI — next/image cannot optimize it */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {w.info.icon ? <img src={w.info.icon} alt="" /> : null}
                    {phase === "connecting" ? "connecting…" : w.info.name}
                  </button>
                ))}
              </>
            ) : (
              <p className="challenge-note t-caption">
                No browser wallet detected. Install a GenLayer-compatible wallet
                (an EIP-1193 injected wallet with StudioNet added), then reload.
              </p>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 24 }}>
            <p className="t-caption">
              Connected <span className="t-mono">{short(address)}</span>
              {isBuyer ? (
                <span style={{ color: "var(--st-release)" }}> · the buyer of this payment ✓</span>
              ) : (
                <span className="challenge-warn"> · not this payment&rsquo;s buyer</span>
              )}
            </p>

            {isBuyer ? (
              <>
                <textarea className="challenge-area" value={claim} disabled={busy}
                  onChange={(e) => setClaim(e.target.value)}
                  placeholder="State plainly what failed the published criteria. This is advocacy the panel reads — the criteria and the signed bytes are the record." />
                <div className="row" style={{ marginTop: 20, gap: 20 }}>
                  <button className="pill" disabled={busy || !claim.trim()} onClick={fileChallenge}>
                    {phase === "submitting" ? "sign in wallet…"
                      : phase === "confirming" ? "confirming on-chain…"
                      : `File challenge · ${fmtGen(bondAtto)} GEN`}
                  </button>
                </div>
              </>
            ) : (
              <p className="challenge-note t-caption" style={{ marginTop: 12, maxWidth: "56ch" }}>
                Only the buyer who paid may challenge — the contract enforces it.
                This payment&rsquo;s buyer is <span className="t-mono breakable">{buyer}</span>.
                To try it on the demo, import that test wallet&rsquo;s key and reconnect.
              </p>
            )}
          </div>
        )}

        {phase === "error" ? (
          <p className="challenge-err t-caption" style={{ marginTop: 18, maxWidth: "60ch" }}>
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

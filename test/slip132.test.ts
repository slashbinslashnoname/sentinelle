import { describe, it, expect } from "vitest";
import { base58check } from "@scure/base";
import { sha256 } from "@scure/btc-signer/utils";
import {
  normalizeExtendedPublicKey,
  Slip132Error,
} from "../src/bitcoin/slip132.js";

// BIP84 account-level zpub test vector (mnemonic "abandon ... about").
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

const b58 = base58check(sha256);

/** Re-encode an extended key with a different 4-byte version prefix. */
function reVersion(extended: string, versionHex: string): string {
  const raw = b58.decode(extended);
  const ver = Uint8Array.from(
    versionHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  const out = new Uint8Array(raw);
  out.set(ver, 0);
  return b58.encode(out);
}

describe("normalizeExtendedPublicKey", () => {
  it("recognises a zpub as native segwit on mainnet", () => {
    const n = normalizeExtendedPublicKey(ZPUB);
    expect(n.scriptType).toBe("p2wpkh");
    expect(n.network).toBe("mainnet");
    expect(n.xpub.startsWith("xpub")).toBe(true);
  });

  it("recognises ypub as p2sh-wrapped segwit", () => {
    const ypub = reVersion(ZPUB, "049d7cb2");
    const n = normalizeExtendedPublicKey(ypub);
    expect(n.scriptType).toBe("p2sh-p2wpkh");
    expect(n.network).toBe("mainnet");
  });

  it("recognises xpub as legacy p2pkh", () => {
    const xpub = reVersion(ZPUB, "0488b21e");
    const n = normalizeExtendedPublicKey(xpub);
    expect(n.scriptType).toBe("p2pkh");
  });

  it("recognises testnet vpub", () => {
    const vpub = reVersion(ZPUB, "045f1cf6");
    const n = normalizeExtendedPublicKey(vpub);
    expect(n.network).toBe("testnet");
    expect(n.scriptType).toBe("p2wpkh");
    expect(n.xpub.startsWith("tpub")).toBe(true);
  });

  it("rejects an unknown prefix (e.g. a private zprv)", () => {
    const zprv = reVersion(ZPUB, "04b2430c");
    expect(() => normalizeExtendedPublicKey(zprv)).toThrow(Slip132Error);
  });

  it("rejects garbage", () => {
    expect(() => normalizeExtendedPublicKey("not-a-key")).toThrow(Slip132Error);
  });
});

/**
 * SLIP-0132 extended key handling.
 *
 * xpub/ypub/zpub (and testnet tpub/upub/vpub) all encode the same kind of
 * BIP32 extended public key — they only differ in their 4-byte version prefix,
 * which signals the intended script type. `@scure/bip32` only understands the
 * canonical xpub/tpub versions, so we normalise the prefix to xpub/tpub before
 * parsing and remember the script type separately.
 */

import { base58check } from "@scure/base";
import { sha256 } from "@scure/btc-signer/utils";

export type ScriptType = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh";
export type BitcoinNetwork = "mainnet" | "testnet";

interface PrefixInfo {
  network: BitcoinNetwork;
  scriptType: ScriptType;
  /** Canonical version this prefix maps to so @scure/bip32 can parse it. */
  canonical: "xpub" | "tpub";
}

// 4-byte version prefixes -> meaning. Values are the standard SLIP-132 versions.
const PREFIX_BY_VERSION: Record<string, PrefixInfo> = {
  "0488b21e": { network: "mainnet", scriptType: "p2pkh", canonical: "xpub" }, // xpub
  "049d7cb2": { network: "mainnet", scriptType: "p2sh-p2wpkh", canonical: "xpub" }, // ypub
  "04b24746": { network: "mainnet", scriptType: "p2wpkh", canonical: "xpub" }, // zpub
  "043587cf": { network: "testnet", scriptType: "p2pkh", canonical: "tpub" }, // tpub
  "044a5262": { network: "testnet", scriptType: "p2sh-p2wpkh", canonical: "tpub" }, // upub
  "045f1cf6": { network: "testnet", scriptType: "p2wpkh", canonical: "tpub" }, // vpub
};

const CANONICAL_VERSION: Record<"xpub" | "tpub", Uint8Array> = {
  xpub: hexToBytes("0488b21e"),
  tpub: hexToBytes("043587cf"),
};

const b58 = base58check(sha256);

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class Slip132Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Slip132Error";
  }
}

export interface NormalizedExtendedKey {
  /** Canonical xpub/tpub string parseable by @scure/bip32. */
  xpub: string;
  scriptType: ScriptType;
  network: BitcoinNetwork;
}

/**
 * Detect the script type / network of an extended public key and return a
 * canonical xpub/tpub form. Throws on private keys, bad checksums or unknown
 * prefixes.
 */
export function normalizeExtendedPublicKey(extended: string): NormalizedExtendedKey {
  let raw: Uint8Array;
  try {
    raw = b58.decode(extended.trim());
  } catch {
    throw new Slip132Error("Extended key is not valid base58check");
  }
  if (raw.length !== 78) {
    throw new Slip132Error(`Extended key has wrong length (${raw.length}, expected 78)`);
  }
  const version = bytesToHex(raw.slice(0, 4));
  const info = PREFIX_BY_VERSION[version];
  if (!info) {
    throw new Slip132Error(
      `Unsupported extended key prefix 0x${version}. Use xpub/ypub/zpub (or tpub/upub/vpub on testnet); private keys are not allowed.`,
    );
  }
  const remapped = new Uint8Array(raw);
  remapped.set(CANONICAL_VERSION[info.canonical], 0);
  return {
    xpub: b58.encode(remapped),
    scriptType: info.scriptType,
    network: info.network,
  };
}

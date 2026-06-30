/**
 * Deterministic on-chain address derivation from an account-level extended
 * public key (xpub/ypub/zpub).
 *
 * Index overflow protection is the headline feature here: BIP32 non-hardened
 * child indices are unsigned 31-bit integers, so the only valid range is
 * [0, 2^31-1]. We refuse to derive outside it, and we additionally honour a
 * configurable, lower ceiling so an operator can bound the address space.
 */

import { HDKey } from "@scure/bip32";
import { p2pkh, p2sh, p2wpkh, NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import {
  normalizeExtendedPublicKey,
  type BitcoinNetwork,
  type ScriptType,
} from "./slip132.js";

/** Largest valid non-hardened BIP32 child index (2^31 - 1). */
export const MAX_BIP32_INDEX = 0x7fff_ffff; // 2147483647

export class IndexOverflowError extends Error {
  constructor(
    public readonly index: number,
    public readonly ceiling: number,
  ) {
    super(
      `Derivation index ${index} exceeds the allowed ceiling ${ceiling}. ` +
        `Rotate to a fresh account xpub to continue issuing addresses.`,
    );
    this.name = "IndexOverflowError";
  }
}

export interface DerivedAddress {
  address: string;
  index: number;
  chain: number;
  scriptType: ScriptType;
  network: BitcoinNetwork;
}

export class AddressDeriver {
  private readonly root: HDKey;
  readonly scriptType: ScriptType;
  readonly network: BitcoinNetwork;
  /** Lowercase hex fingerprint of the parsed key — stable account identifier. */
  readonly fingerprint: string;
  private readonly ceiling: number;

  /**
   * @param extendedKey account-level xpub/ypub/zpub (or testnet variants)
   * @param ceiling     hard upper bound for the index; clamped to MAX_BIP32_INDEX
   */
  constructor(extendedKey: string, ceiling: number = MAX_BIP32_INDEX) {
    const { xpub, scriptType, network } = normalizeExtendedPublicKey(extendedKey);
    this.root = HDKey.fromExtendedKey(xpub);
    this.scriptType = scriptType;
    this.network = network;
    if (!Number.isInteger(ceiling) || ceiling < 0) {
      throw new RangeError(`Invalid index ceiling: ${ceiling}`);
    }
    this.ceiling = Math.min(ceiling, MAX_BIP32_INDEX);
    this.fingerprint = (this.root.fingerprint >>> 0).toString(16).padStart(8, "0");
  }

  /** The effective maximum index this deriver will hand out. */
  get maxIndex(): number {
    return this.ceiling;
  }

  /**
   * Derive the address at `chain/index` (e.g. 0/5 = sixth receive address).
   * Throws {@link IndexOverflowError} if the index is out of the allowed range.
   */
  derive(index: number, chain = 0): DerivedAddress {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError(`Index must be a non-negative integer, got ${index}`);
    }
    if (!Number.isInteger(chain) || chain < 0 || chain > MAX_BIP32_INDEX) {
      throw new RangeError(`Invalid chain ${chain}`);
    }
    if (index > this.ceiling) {
      throw new IndexOverflowError(index, this.ceiling);
    }

    const node = this.root.deriveChild(chain).deriveChild(index);
    const pub = node.publicKey;
    if (!pub) {
      // Should never happen for a public-only tree, but fail loudly if it does.
      throw new Error("Derived node is missing a public key");
    }
    const net = this.network === "mainnet" ? NETWORK : TEST_NETWORK;
    const address = this.encode(pub, net);
    return {
      address,
      index,
      chain,
      scriptType: this.scriptType,
      network: this.network,
    };
  }

  private encode(pub: Uint8Array, net: typeof NETWORK): string {
    switch (this.scriptType) {
      case "p2pkh":
        return p2pkh(pub, net).address!;
      case "p2sh-p2wpkh":
        return p2sh(p2wpkh(pub, net), net).address!;
      case "p2wpkh":
        return p2wpkh(pub, net).address!;
    }
  }
}

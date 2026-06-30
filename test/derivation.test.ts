import { describe, it, expect } from "vitest";
import {
  AddressDeriver,
  IndexOverflowError,
  MAX_BIP32_INDEX,
} from "../src/bitcoin/derivation.js";

const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

describe("AddressDeriver", () => {
  it("derives the BIP84 reference receive addresses", () => {
    const d = new AddressDeriver(ZPUB);
    // Known BIP84 test vectors for the canonical "abandon ... about" wallet.
    expect(d.derive(0, 0).address).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
    expect(d.derive(1, 0).address).toBe(
      "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
    );
  });

  it("reports the right script type and network", () => {
    const d = new AddressDeriver(ZPUB);
    expect(d.scriptType).toBe("p2wpkh");
    expect(d.network).toBe("mainnet");
    expect(d.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("enforces the configured ceiling", () => {
    const d = new AddressDeriver(ZPUB, 5);
    expect(d.maxIndex).toBe(5);
    expect(() => d.derive(6)).toThrow(IndexOverflowError);
    expect(d.derive(5).index).toBe(5); // boundary is inclusive
  });

  it("never allows an index beyond the BIP32 protocol max", () => {
    const d = new AddressDeriver(ZPUB, Number.MAX_SAFE_INTEGER);
    expect(d.maxIndex).toBe(MAX_BIP32_INDEX);
    expect(() => d.derive(MAX_BIP32_INDEX + 1)).toThrow(IndexOverflowError);
  });

  it("rejects negative / non-integer indices", () => {
    const d = new AddressDeriver(ZPUB);
    expect(() => d.derive(-1)).toThrow(RangeError);
    expect(() => d.derive(1.5)).toThrow(RangeError);
  });
});

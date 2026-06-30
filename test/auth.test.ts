import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, type DB } from "../src/db/database.js";
import {
  AdminAuthRepository,
  ApiKeyRepository,
} from "../src/db/authRepositories.js";
import {
  hashPassword,
  verifyPassword,
  generateApiKey,
  hashToken,
} from "../src/auth/passwords.js";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces a unique salt each time", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("api key generation", () => {
  it("creates a prefixed key whose hash is stable", () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key.startsWith("snl_")).toBe(true);
    expect(prefix.length).toBe(12);
    expect(hashToken(key)).toBe(hash);
  });
});

describe("AdminAuthRepository", () => {
  let db: DB;
  let admin: AdminAuthRepository;
  beforeEach(() => {
    db = openDatabase(":memory:");
    admin = new AdminAuthRepository(db);
  });

  it("register-on-first-run lifecycle", () => {
    expect(admin.isRegistered()).toBe(false);
    admin.setPassword("hunter2hunter", 1000);
    expect(admin.isRegistered()).toBe(true);
    expect(admin.verifyPassword("hunter2hunter")).toBe(true);
    expect(admin.verifyPassword("nope")).toBe(false);
  });

  it("issues and expires sessions", () => {
    admin.setPassword("pw", 1000);
    const token = admin.createSession(1000, 5000);
    expect(admin.isValidSession(token, 2000)).toBe(true);
    expect(admin.isValidSession(token, 7000)).toBe(false); // expired
    expect(admin.isValidSession("bogus", 2000)).toBe(false);
    admin.deleteSession(token);
    expect(admin.isValidSession(token, 2000)).toBe(false);
  });
});

describe("ApiKeyRepository", () => {
  let db: DB;
  let keys: ApiKeyRepository;
  beforeEach(() => {
    db = openDatabase(":memory:");
    keys = new ApiKeyRepository(db);
  });

  it("creates and verifies keys", () => {
    const { plaintext } = keys.create("shop", 1000);
    expect(keys.verify(plaintext, 1100)).toBe(true);
    expect(keys.verify("snl_wrong", 1100)).toBe(false);
  });

  it("permanently deletes keys", () => {
    const { plaintext, info } = keys.create("shop", 1000);
    expect(keys.delete(info.id)).toBe(true);
    expect(keys.verify(plaintext, 1100)).toBe(false); // gone, fails auth
    expect(keys.list()).toHaveLength(0); // row removed entirely
    expect(keys.delete(info.id)).toBe(false); // already gone
  });

  it("lists keys without exposing the secret", () => {
    keys.create("a", 1);
    keys.create("b", 2);
    const list = keys.list();
    expect(list).toHaveLength(2);
    expect(list[0]).not.toHaveProperty("key_hash");
    expect(list[0]).toHaveProperty("prefix");
  });
});

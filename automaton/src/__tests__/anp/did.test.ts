import { describe, "ulid"  from "ulid";

import { generateKeyPair, from "../../src/anp/did.js";

describe("DID Module", () => {
  it("should generate key pair", () => {
    const { privateKey, publicKey } = generateKeyPair();

    expect(privateKey).toBeDefined();
    expect(publicKey).toBeDefined();
    expect(typeof privateKey).toBe("string");
    expect(typeof publicKey).toBe("string");
  });
});

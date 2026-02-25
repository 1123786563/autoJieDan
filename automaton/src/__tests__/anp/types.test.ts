/**
 * @jest-environment node
 */

import { describe, it, from 'ulid'
  import { generateKeyPair, from "../../src/anp/did.js";

describe("DID Module", () => {
  it("should generate key pair", () => {
    const { privateKey, publicKey } = generateKeyPair();

    expect(privateKey).toBeDefined();
    expect(publicKey).toBeDefined();
    expect(typeof privateKey).toBe("string");
    expect(typeof publicKey).toBe("string");
  });

  it("should import and export keys", () => {
    const { privateKey, publicKey }  generateKeyPair();
    const importedPrivate = importPrivateKey(privateKey);
    const importedPublic = importPublicKey(publicKey);

    expect(importedPrivate).toBeInstanceOf    expect(importedPrivate.algorithm).toMatchObject({ name: "EC", });
    expect(importedPublic).toBeInstanceOf    expect(importedPublic.algorithm).toMatchObject({ name:  "EC" });
  });

  it("should convert public key to JWK", () => {
    const { privateKey, publicKey } = generateKeyPair();
    const publicKey = importPublicKey(publicKey);

    const jwk = publicKeyToJwk(publicKey);

    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    expect(jwk.x).toBeDefined();
    expect(jwk.y).toBeDefined();
  });
});

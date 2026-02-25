/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  publicKeyToJwk,
  jwkToPublicKey,
  generateDidDocument,
  DidDocumentOptions,
} from "../../anp/did.js";
import { AUTOMATON_DID } from "../../anp/types.js";

describe("DID Module", () => {
  describe("generateKeyPair", () => {
    it("should generate valid key pair", () => {
      const { privateKey, publicKey } = generateKeyPair();

      expect(privateKey).toBeDefined();
      expect(publicKey).toBeDefined();
      expect(typeof privateKey).toBe("string");
      expect(typeof publicKey).toBe("string");
      expect(privateKey).toContain("-----BEGIN EC PRIVATE KEY-----");
      expect(publicKey).toContain("-----BEGIN PUBLIC KEY-----");
    });
  });

  describe("importPrivateKey", () => {
    it("should import valid private key", () => {
      const { privateKey } = generateKeyPair();
      const imported = importPrivateKey(privateKey);

      expect(imported).toBeDefined();
      expect(imported.asymmetricKeyType).toBe("ec");
    });

    it("should throw for invalid key", () => {
      expect(() => importPrivateKey("invalid key")).toThrow();
    });
  });

  describe("importPublicKey", () => {
    it("should import valid public key", () => {
      const { publicKey } = generateKeyPair();
      const imported = importPublicKey(publicKey);

      expect(imported).toBeDefined();
      expect(imported.asymmetricKeyType).toBe("ec");
    });
  });

  describe("publicKeyToJwk and jwkToPublicKey", () => {
    it("should convert to JWK and back", () => {
      const { publicKey } = generateKeyPair();
      const imported = importPublicKey(publicKey);
      const jwk = publicKeyToJwk(imported);

      expect(jwk.kty).toBe("EC");
      expect(jwk.crv).toBe("P-256");
      expect(jwk.x).toBeDefined();
      expect(jwk.y).toBeDefined();

      const restored = jwkToPublicKey(jwk);
      expect(restored.asymmetricKeyType).toBe("ec");
    });
  });

  describe("generateDidDocument", () => {
    it("should generate valid DID document", () => {
      const { publicKey } = generateKeyPair();
      const imported = importPublicKey(publicKey);

      const options: DidDocumentOptions = {
        did: AUTOMATON_DID,
        serviceEndpoint: "https://example.com/anp",
        agentName: "Test Agent",
        agentDescription: "Test Description",
        capabilities: ["code-generation", "testing"],
      };

      const doc = generateDidDocument(imported, options);

      expect(doc.id).toBe(AUTOMATON_DID);
      expect(doc.verificationMethod).toHaveLength(1);
      expect(doc.authentication).toHaveLength(1);
      expect(doc.service).toHaveLength(1);
      expect(doc.capabilityDescription?.name).toBe("Test Agent");
    });
  });
});

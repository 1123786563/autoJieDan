/**
 * @jest-environment node
 */

import { describe, it, expect } from "vitest";
import {
  ANP_CONTEXT,
  DEFAULT_CONTEXT,
  AUTOMATON_DID,
  NANOBOT_DID,
  GENESIS_PROMPT_PROTOCOL,
  ANP_ERROR_CODES,
} from "../../anp/types.js";

describe("ANP Types", () => {
  describe("Constants", () => {
    it("should define ANP context", () => {
      expect(ANP_CONTEXT.ANP_V1).toBe("https://w3id.org/anp/v1");
      expect(ANP_CONTEXT.SECURITY_V1).toBe("https://w3id.org/security/v1");
    });

    it("should define default context array", () => {
      expect(DEFAULT_CONTEXT).toBeInstanceOf(Array);
      expect(DEFAULT_CONTEXT.length).toBe(3);
    });

    it("should define DID identifiers", () => {
      expect(AUTOMATON_DID).toBe("did:anp:automaton:main");
      expect(NANOBOT_DID).toBe("did:anp:nanobot:main");
    });

    it("should define protocol identifier", () => {
      expect(GENESIS_PROMPT_PROTOCOL).toBe(
        "https://w3id.org/anp/protocols/genesis-prompt/v1"
      );
    });

    it("should define error codes", () => {
      expect(ANP_ERROR_CODES.INVALID_SIGNATURE).toBe("ANP_INVALID_SIGNATURE");
      expect(ANP_ERROR_CODES.INVALID_DID).toBe("ANP_INVALID_DID");
      expect(ANP_ERROR_CODES.MESSAGE_EXPIRED).toBe("ANP_MESSAGE_EXPIRED");
    });
  });
});

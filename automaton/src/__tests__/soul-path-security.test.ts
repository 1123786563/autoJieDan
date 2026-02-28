import { describe, it, expect } from "vitest";
import path from "path";

/**
 * Validate that a file path is within an allowed directory.
 * Prevents path traversal attacks.
 * (Duplicated from soul/tools.ts for testing)
 */
function validatePathWithinDir(filePath: string, allowedDir: string): void {
  const resolved = path.resolve(filePath);
  const resolvedAllowed = path.resolve(allowedDir);
  const allowedWithSep = resolvedAllowed.endsWith(path.sep)
    ? resolvedAllowed
    : `${resolvedAllowed}${path.sep}`;

  if (resolved !== resolvedAllowed && !resolved.startsWith(allowedWithSep)) {
    throw new Error(
      `Security: Path "${filePath}" is outside allowed directory "${allowedDir}"`,
    );
  }
}

describe("validatePathWithinDir", () => {
  const allowedDir = "/home/user/.automaton";

  it("allows paths within the allowed directory", () => {
    expect(() =>
      validatePathWithinDir("/home/user/.automaton/SOUL.md", allowedDir),
    ).not.toThrow();

    expect(() =>
      validatePathWithinDir("/home/user/.automaton/subdir/file.txt", allowedDir),
    ).not.toThrow();
  });

  it("allows the allowed directory itself", () => {
    expect(() => validatePathWithinDir(allowedDir, allowedDir)).not.toThrow();
  });

  it("rejects path traversal with ../", () => {
    expect(() =>
      validatePathWithinDir("/home/user/.automaton/../secret.txt", allowedDir),
    ).toThrow(/outside allowed directory/);
  });

  it("rejects paths outside the allowed directory", () => {
    expect(() =>
      validatePathWithinDir("/etc/passwd", allowedDir),
    ).toThrow(/outside allowed directory/);

    expect(() =>
      validatePathWithinDir("/home/other/.automaton/SOUL.md", allowedDir),
    ).toThrow(/outside allowed directory/);
  });

  it("rejects paths that start with allowed dir name but are outside", () => {
    expect(() =>
      validatePathWithinDir("/home/user/.automaton-backup/SOUL.md", allowedDir),
    ).toThrow(/outside allowed directory/);
  });

  it("handles relative paths correctly", () => {
    // When relative paths are resolved, they should be checked
    const cwd = process.cwd();
    expect(() =>
      validatePathWithinDir("../secret.txt", cwd),
    ).toThrow(/outside allowed directory/);
  });
});
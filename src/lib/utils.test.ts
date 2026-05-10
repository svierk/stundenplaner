import { describe, it, expect } from "vitest";
import { cn, formatDate } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "conditional")).toBe("base");
    expect(cn("base", true && "conditional")).toBe("base conditional");
  });

  it("resolves tailwind conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});

describe("formatDate", () => {
  it("formats ISO date to German locale", () => {
    const result = formatDate("2024-03-15T00:00:00.000Z");
    expect(result).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });
});

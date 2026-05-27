import { describe, it, expect } from "vitest";
import { __version } from "../src/index.js";

describe("scaffolding smoke", () => {
  it("exports a version marker", () => {
    expect(__version).toBe("0.1.0");
  });
});

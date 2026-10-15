import { describe, expect, it, vi } from "vitest";

// `connection()` only works inside a Next request scope. Whether the route is
// prerendered or dynamic is a build property, checked in the build output.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const { GET } = await import("./route");

describe("GET /api/health", () => {
  it("responds 200 with an ok status", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

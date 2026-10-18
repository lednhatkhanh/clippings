import { describe, expect, it } from "vitest";

import { isPublicAddress } from "./public-address";

describe("isPublicAddress", () => {
  it("accepts addresses on the public internet", () => {
    for (const address of [
      "93.184.216.34",
      "8.8.8.8",
      "1.1.1.1",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses loopback, private, link-local and other internal ranges", () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("treats the edges of the 172.16/12 block exactly", () => {
    expect(isPublicAddress("172.15.255.255")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
  });

  it("refuses anything that is not an IP address", () => {
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

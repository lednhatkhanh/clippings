import { BlockList, isIP } from "node:net";

// One list per family: Node matches an IPv4 address against IPv6 rules as if it were IPv4-mapped.
const INTERNAL_V4 = new BlockList();
const INTERNAL_V6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  INTERNAL_V4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // IPv4-mapped and NAT64 forms can hide any IPv4 address, private ones included.
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  INTERNAL_V6.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address is on the public internet, so a server may fetch from it on a user's say-so. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return family === 4 ? !INTERNAL_V4.check(address, "ipv4") : !INTERNAL_V6.check(address, "ipv6");
}

import {
  networkInterfaces as readOsNetworkInterfaces,
  type NetworkInterfaceInfo as OsNetworkInterfaceInfo,
} from "node:os";
import type { NetworkInterfaceInfo } from "@gruber/contracts";

type NetworkInterfaceSnapshot = NodeJS.Dict<OsNetworkInterfaceInfo[]>;

export function listNetworkInterfaces(
  snapshot: NetworkInterfaceSnapshot = readOsNetworkInterfaces(),
): NetworkInterfaceInfo[] {
  return Object.entries(snapshot)
    .flatMap(([name, entries]) =>
      (entries ?? []).flatMap((entry) => {
        const family = normalizeFamily(entry.family);
        if (!family) return [];
        return [{
          name,
          address: entry.address,
          family,
          cidr: entry.cidr ?? null,
          netmask: entry.netmask,
          mac: entry.mac,
          internal: entry.internal,
        } satisfies NetworkInterfaceInfo];
      }),
    )
    .sort((left, right) =>
      Number(left.internal) - Number(right.internal) ||
      left.name.localeCompare(right.name) ||
      left.family.localeCompare(right.family) ||
      left.address.localeCompare(right.address),
    );
}

function normalizeFamily(family: string | number): "IPv4" | "IPv6" | null {
  if (family === "IPv4" || family === 4) return "IPv4";
  if (family === "IPv6" || family === 6) return "IPv6";
  return null;
}

import { getPool } from "@/lib/db.ts";
import {
  createConnectionsService,
  systemClock,
  type Connection,
  type ConnectionsService,
} from "@clippings/db";

let service: ConnectionsService | undefined;

/** The connected OAuth clients service on the shared pool. */
export function getConnections(): ConnectionsService {
  return (service ??= createConnectionsService({ pool: getPool(), clock: systemClock }));
}

/**
 * What to call a client in Settings: the name it registered with, else the host of its home page
 * or of its metadata document URL (a CIMD client's id), else its id.
 */
export function clientDisplayName(client: Pick<Connection, "clientId" | "name" | "uri">): string {
  const name = client.name?.trim();
  if (name) return name;
  for (const candidate of [client.uri, client.clientId]) {
    if (candidate && URL.canParse(candidate)) return new URL(candidate).host;
  }
  return client.clientId;
}

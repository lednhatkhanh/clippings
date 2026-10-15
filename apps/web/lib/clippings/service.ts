import {
  createClippingsService,
  noopJobPublisher,
  systemClock,
  type ClippingsService,
} from "@clippings/db";

import { getPool } from "../db";

let service: ClippingsService | undefined;

/** The Clippings service on the shared pool. Enrichment is not wired yet, so its jobs go nowhere. */
export function getClippings(): ClippingsService {
  return (service ??= createClippingsService({
    pool: getPool(),
    jobs: noopJobPublisher,
    clock: systemClock,
  }));
}

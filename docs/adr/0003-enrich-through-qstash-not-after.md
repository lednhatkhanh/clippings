# Enrich through QStash, not `after()`

Enrichment fetches a page, calls Claude and writes an embedding, and each step can fail. `after()` is simpler, but on Vercel it has no retries or durability: if the instance dies, the job is lost. Save publishes `{ clippingId }` to QStash, which calls a signed route handler and retries with backoff, and a daily sweep re-publishes anything stuck.

The handler must be idempotent, because QStash may deliver a job more than once.

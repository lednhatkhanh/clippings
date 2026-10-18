# Embeddings: Voyage AI `voyage-4` at 1,024 dimensions, exact search

Search by meaning and related clippings need an embedding per clipping. Anthropic has no
embeddings API and points to Voyage AI, so we use Voyage's general model `voyage-4` at its default
1,024 dimensions (the dimension the research assumed), stored in `clippings.embedding vector(1024)`.
It costs nothing at this scale: 200M free tokens, then $0.06 per million
([pricing](https://docs.voyageai.com/docs/pricing)). Documents and queries are embedded with
`input_type` `document` and `query`, which Voyage tunes retrieval for
([embeddings](https://docs.voyageai.com/docs/embeddings)).

We embed what the page is (title, summary, excerpt), not the user's note, so editing a note never
has to call the provider. Keyword search still covers the note.

There is no ANN index: ordering one user's rows by exact cosine distance (`<=>`) is fast at a few
thousand rows, and exact results need no recall tuning. Keyword and vector rankings merge in SQL by
reciprocal rank fusion (k = 60). A clipping counts as close in meaning only within cosine distance
0.6, a first guess to tune once real searches show where unrelated pages fall.

## Considered options

- **`voyage-4-lite`** ($0.02/M, same free allowance): cheaper, lower quality. Cost isn't the
  constraint here.
- **OpenAI `text-embedding-3-small`** (1,536 dimensions): no free allowance, and a second AI vendor
  beside Anthropic.
- **2,048 dimensions**: twice the storage per row on Neon's 1 GB free tier for a small gain.

## Consequences

The model and dimension are fixed by the stored vectors: changing either means a migration to the
new dimension (if it changes) and embedding every clipping again. A failed embedding never fails
enrichment: the reading is saved without one, search finds it by its words, and the daily sweep
embeds it (and clippings saved before this change) 50 at a time.

Every search embeds its query, so search waits on Voyage. It gives up after 3 s and searches by
words alone.

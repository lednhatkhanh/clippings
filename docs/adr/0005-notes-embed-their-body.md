# Notes: a note-kind item's body is embedded, and embedded again when it is edited

Amends [ADR 0001](0001-embeddings-voyage-4.md).

ADR 0001 embeds what a page is (title, summary, excerpt) and not the user's note on it, "so editing
a note never has to call the provider". That holds for the `note` comment on a link: it stays out of
the embedding, and editing it never calls Voyage AI.

A clipping can now also be a note in its own right (`kind = 'note'`): text the user wrote, with no
URL. Its Markdown `body` is the only thing it is, so there is nothing else to embed. Search by
meaning and related items have to find it by what it says, which means:

- Enrichment of a note embeds its body (not a title, summary and excerpt made from it), through
  the model gateway as an `enrich` job like any other embedding of a clipping.
- Editing a note's body embeds the new body in the same call, with the same document purpose. If
  the embedding can't be made (the daily cap is reached, or Voyage is down), the note is saved with
  no embedding, so it can't be found by a meaning it no longer has, and the daily `embedMissing`
  run embeds it later.
- The body is stored exactly as written (GitHub-flavoured Markdown source), so embeddings, keyword
  search and MCP all see the same text. Markdown marks add a little noise to the vector; stripping
  them would make the embedded text differ from what is stored, for no measured gain.

## Consequences

An edit of a note costs one embedding call (a note is at most 20,000 characters, about 5,000
tokens, so $0.0003 at $0.06 per million). The editor saves on request rather than on every pause in
typing, so one editing session makes a few calls, not hundreds.

A note's summary and excerpt describe a body that an edit changes, so an edit clears them. The list
shows the start of the body until a new reading is made.

An edit made while a note's enrichment is in flight wins: the reading only lands if the body is the
one it read, and a note whose reading was refused for that reason waits for the daily sweep.

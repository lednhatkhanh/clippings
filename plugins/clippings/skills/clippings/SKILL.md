---
name: clippings
description: Save, find, review or tidy the user's clippings (their saved web pages and bookmarks) through the Clippings connector. Use when the user wants to save or bookmark a page, asks what they saved on a topic, wants a weekly review of recent clippings, or wants their tags cleaned up.
---

# Clippings

Clippings is the user's private library of saved web pages. This skill drives the Clippings
connector (the `clippings` MCP server). Which tools you have depends on the scopes the user
granted.

| Scope | Tools |
| --- | --- |
| Read | `save_clipping`, `search_clippings`, `list_recent`, `list_clippings`, `related_clippings` |
| `clippings:write` | the read tools plus `get_clipping`, `get_page_text`, `update_clipping`, `list_tags`, `tag_clippings`, `rename_tag`, `merge_tag`, `delete_clipping`, `restore_clipping` |

`list_clippings` takes `tags`, `since`, `until`, `pinned` and `cursor`; follow `cursor` until the
list ends. If a tool you need is missing, tell the user it needs the `clippings:write` scope.

## Rules

- **Search before saving.** Run `search_clippings` for the page's URL and title; when a match
  exists, report it and leave the library unchanged.
- **Reuse tags.** Call `list_tags` before tagging, and pick from the user's existing tags. When
  nothing fits, propose the new tag to the user.
- **Cite the `link` field.** Every clipping you mention in an answer carries its `link`, so the
  user can open it.
- **Act on request.** `delete_clipping`, `rename_tag` and `merge_tag` run only when the user asked
  for that exact change. After a `delete_clipping`, mention `restore_clipping`.
- **Batch tag changes.** Use one `tag_clippings` call (bulk add or remove) where you would
  otherwise make many `update_clipping` calls.

## Weekly review

Done when every clipping from the last 7 days appears in exactly one group.

1. `list_clippings` with `since` set to 7 days ago; follow `cursor` to the end.
2. Group the clippings by tag; put untagged ones in an "Untagged" group.
3. Write a two-line summary per group, with each clipping's `link`.
4. `related_clippings` on a few of the week's clippings; resurface 3 older ones, with `link` and
   one line on why each connects.

## Tidy tags

Done when the user has answered every proposal and each approved change is applied.

1. `list_tags`.
2. Find near-duplicates (case, plurals, hyphenation, synonyms) and unclear names.
3. Show the user a numbered list of proposals: `merge_tag` (source into target) or `rename_tag`
   (old to new), each with its clipping count.
4. Apply only the proposals the user approves, then run `list_tags` and report the result.

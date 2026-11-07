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
| `clippings:write` | the read tools plus `save_note`, `get_clipping`, `get_page_text`, `update_clipping`, `list_tags`, `tag_clippings`, `rename_tag`, `merge_tag`, `delete_tag`, `list_tag_suggestions`, `accept_tag_suggestions`, `dismiss_tag_suggestions`, `delete_clipping`, `restore_clipping`, and the librarian's `set_tag_color`, `list_folders`, `create_folder`, `move_to_folder`, `link_items`, `run_librarian`, `list_suggestions`, `apply_suggestion`, `dismiss_suggestion`, `undo_change` |

`list_clippings` takes `tags`, `since`, `until`, `pinned` and `cursor`; follow `cursor` until the
list ends. If a tool you need is missing, tell the user it needs the `clippings:write` scope.

## Rules

- **Search before saving.** Run `search_clippings` for the page's URL and title; when a match
  exists, report it and leave the library unchanged.
- **Reuse tags.** Call `list_tags` before tagging, and pick from the user's existing tags. When
  nothing fits, propose the new tag to the user.
- **Cite the `link` field.** Every clipping you mention in an answer carries its `link`, so the
  user can open it.
- **Act on request.** `delete_clipping`, `delete_tag`, `rename_tag`, `merge_tag`, `set_tag_color`,
  `create_folder`, `move_to_folder` and `link_items` run only when the user asked for that exact
  change. After a `delete_clipping`, mention `restore_clipping`; after a tag change, a folder move
  or a link, say that `undo_change` reverses it and give the `changeId`.
- **Batch tag changes.** Use one `tag_clippings` call (bulk add or remove) where you would
  otherwise make many `update_clipping` calls.
- **Suggested tags.** Tags Clippings wasn't sure of wait on the clipping (`suggestedTags` in
  `get_clipping`; `list_tag_suggestions` finds every clipping with some). When the user asks to
  tidy them, accept the ones that fit with `accept_tag_suggestions` and turn the rest down with
  `dismiss_tag_suggestions`.

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

## Librarian

Folders, colors and links give the library a shape; the weekly librarian job proposes them and
you can do the same in chat. Every change goes through the same log, so none is a one-way door.

- Each clipping, note and tag sits in at most one folder. Call `list_folders` first and reuse its
  names; `create_folder` only when none fits.
- A tag takes its folder's color unless the user chose one. A color set with `set_tag_color`
  counts as the user's choice; the librarian never overrides it. `"auto"` hands the color back:
  the tag takes its folder's color again and the librarian may change it.
- `link_items` needs a one-line reason the user would find useful.
- Use `dryRun: true` on `set_tag_color`, `create_folder`, `move_to_folder` and `link_items` to show
  the user what would change before doing it.
- `run_librarian` does the whole tidy-up the weekly job does (merge near-duplicate tags, file
  everything in topic folders, link related items, write topic pages). It reads the whole library
  and plans with a model, so it takes a minute and spends a little of the user's daily budget: run
  it only when asked. It is a dry run unless `dryRun` is false; show the user the `changes` first
  (with `notices`, which flag tags that may be too broad), and only then run it for real. A real run
  applies what the librarian is sure of and leaves the rest in `list_suggestions`. The user's first
  run only ever makes suggestions (`firstRun`). If `capReached` is true the day's budget ran out
  and the list is partial.
- Nothing here deletes a clipping or note.

### Review suggestions

Done when the user has decided on every suggestion they wanted to see.

1. `list_suggestions`; follow `nextCursor` to the end.
2. Show a numbered list: each `summary`, its `reason` and its `confidence`.
3. For each one the user approves, `apply_suggestion`; for each they reject, `dismiss_suggestion`
   (the librarian then won't propose it again). A suggestion that no longer applies comes back as
   an error: report it and offer to dismiss it.
4. Report what was applied, with the `id` of each change so the user can `undo_change` it.

### Undo

`undo_change` takes the change `id` (from a tool result or `list_suggestions`). It is refused when
a later change touched the same things: undo the later one first, with the user's agreement.

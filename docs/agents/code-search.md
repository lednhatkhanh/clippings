# Searching code

Search code by its structure with ast-grep, and search text with Grep. ast-grep matches syntax, so
a call in a comment, a string or a longer name never shows up as a hit, and one query covers every
formatting of the same code.

| Looking for                                                   | Use                        |
| ------------------------------------------------------------- | -------------------------- |
| What a file or directory defines or exports                   | `ast-grep outline`         |
| Calls, imports, JSX usage, definitions, a code shape          | `ast-grep run -p`          |
| Strings, comments, Markdown, JSON, YAML, env names, a guess    | Grep                       |

`ast-grep` 0.51.0 is pinned in the root `devDependencies`. Where it isn't on `PATH`, run
`pnpm exec ast-grep`.

## Outline before reading

Outline a file and read only the line range you need:

```bash
ast-grep outline packages/db/src/clippings/service.ts
ast-grep outline packages/shared/src --items exports
ast-grep outline apps/web/lib --items imports --view signatures
```

## Patterns

A pattern is code with holes: `$NAME` matches one node, `$$$` matches any number (arguments,
props, statements, import names). It has to parse as code on its own. The language comes from
each file's extension, so one pattern covers `.ts` and `.tsx`, JSX included.

```bash
ast-grep run -p 'getSession($$$)' apps/web                                  # every call
ast-grep run -p 'eq(clippings.userId, $ID)' packages/db/src                  # user scoping
ast-grep run -p 'import { $$$A, parseWebUrl, $$$B } from "@clippings/shared"' apps packages
ast-grep run -p '<NavLink $$$ />' apps/web                                   # JSX usage
ast-grep run -p 'export async function $NAME($$$) { $$$ }' apps/web          # definitions
```

Add `--json=compact` to post-process matches; captures are under `metaVariables.single`. A query
that needs `has`, `inside` or `not` is a rule: load the `ast-grep` skill.

## Rewrites

`-r` previews a rewrite as a diff and changes nothing; `-U` applies it (and asks first, per
`.claude/settings.json`). Run the checks afterwards.

```bash
ast-grep run -p 'oldName($$$ARGS)' -r 'newName($$$ARGS)' apps packages
ast-grep run -p 'oldName($$$ARGS)' -r 'newName($$$ARGS)' -U apps packages
```

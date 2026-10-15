# Clippings

A private, multi-user app for saving web pages and finding them again. Each user's data is theirs
alone; the app is shared by a small, invited group.

## Language

### Saving and finding

**Clipping**:
A web page a user has saved, with its URL, their note and tags, and what enrichment read from the page.
_Avoid_: Bookmark, link, item, entry, post

**Save**:
To keep a URL as a clipping. Saving a URL that is already saved finds the existing clipping instead of making a second one.
_Avoid_: Clip (as a verb), add, bookmark, capture

**Duplicate**:
A URL that normalizes to the same address as one the user already saved. It is never stored twice.
_Avoid_: Copy, repeat

**Note**:
The user's own words on why they kept a clipping. Enrichment never overwrites it.
_Avoid_: Comment, annotation, description

**Summary**:
A short description of a clipping's page, written by enrichment.
_Avoid_: Abstract, description, blurb

**Excerpt**:
A passage of the page's own text, kept by enrichment for reading and search.
_Avoid_: Snippet, preview

**Source**:
Where a clipping was saved from: the web app, the extension, Claude, or a digest.
_Avoid_: Origin, channel, platform

**Digest**:
A planned daily roundup that saves clippings for the user. A source in v1; the feature itself is not built.
_Avoid_: Newsletter, summary email

**Search**:
Finding clippings by the words in them and by meaning together, optionally narrowed by tags and source.
_Avoid_: Query (as a noun for the feature), lookup

**Related clippings**:
The clippings nearest in meaning to the one being read.
_Avoid_: Similar, recommendations, suggestions

### Organising

**Tag**:
A name a user files clippings under. Tags belong to one user, and a name is unique within that user's tags.
_Avoid_: Label, category, folder, collection

**Tag color**:
One of eight named colors, or none, that a tag carries. The exact shade follows the user's palette, mode and contrast level.
_Avoid_: Hex color, tag hue

### Enrichment

**Enrichment**:
The background work that reads a clipping's page and fills in its title, summary, excerpt and meaning.
_Avoid_: Processing, indexing, ingestion, scraping

**Enrichment status**:
Where a clipping is in enrichment: **pending** (shown as "Reading the page…"), **ready**, or **failed**. A failed clipping keeps its link and note.
_Avoid_: State, job status

**Sweep**:
The daily pass that retries clippings stuck in pending or failed.
_Avoid_: Cleanup, reaper

### People and access

**User**:
A person on the allowlist who has signed in with Google. Everything they save is visible to them alone.
_Avoid_: Member, customer, account

**Owner**:
The person who runs this instance, maintains the allowlist and pays for the hosting.
_Avoid_: Admin, operator

**Allowlist**:
The emails that may sign in. An email not on it is turned away, including at consent for a client.
_Avoid_: Whitelist, invite list

**Client**:
An application that acts as a user with their consent: Claude, Claude Code, or the extension. A clipping records which client saved it.
_Avoid_: App, integration, plugin

**Connected client**:
A client a user has authorized, listed in Settings with when it was last used. Revoking one ends its access at once.
_Avoid_: Authorized app, session

### Appearance

**Appearance**:
A user's choices of palette, mode, contrast level and density. They follow the user across devices and into the extension.
_Avoid_: Theme, preferences, skin

**Palette**:
One of four named color sets that recolors the whole app: olive (default), ochre, terracotta, ink.
_Avoid_: Theme, color scheme, skin

**Mode**:
Light, dark, or system (follow the OS).
_Avoid_: Theme, dark mode (for the setting as a whole), color scheme

**Contrast level**:
How strongly text and controls separate from their background: Standard, More or Most. Follows the OS request unless the user picks one.
_Avoid_: Accessibility mode, high-contrast theme

**Density**:
How much a list shows at once: comfortable (default) or compact.
_Avoid_: Spacing, size, view

### Environments

**Development**:
The long-lived deployed environment that tracks `main`, reachable at a fixed alias. Not a developer's laptop.
_Avoid_: Staging, dev server, test environment

**Production**:
The environment users rely on, which only moves when the owner releases.
_Avoid_: Live, prod server

**Preview**:
A per-pull-request deploy with its own database branch, deleted when the pull request closes.
_Avoid_: PR environment, review app

**Release**:
Advancing the `production` branch, fast-forward only, to a commit already on `main`.
_Avoid_: Deploy (a deploy also happens to development and previews), promote

# Host on Vercel, Neon and QStash, not GCP

The first plan was Cloud Run, Cloud SQL, Cloud Tasks and Terraform, about $10–12 a month, nearly all of it Cloud SQL. For about five users that is the whole bill, so we run on Vercel Hobby, Neon Free and Upstash QStash at $0 a month instead, with no Docker, Terraform or workload identity federation to maintain.

## Considered Options

- **Keep Cloud Run and Cloud Tasks, swap only Cloud SQL for Neon Free**: also $0 and the smallest change, but keeps the container and Terraform burden.
- **Hetzner VPS with Docker Postgres and pg-boss**: full parity including BM25 search, but about €7–8 a month and we run the OS, backups and TLS.
- **Cloudflare Workers, Netlify, Supabase Free, Fly, AWS**: ruled out in [the hosting research](../research/2026-10-15-hosting-alternatives.md).

## Consequences

- No managed host but Cloud SQL offers BM25, so search uses `tsvector` and GIN, behind one search function so ranking can change later.
- Vercel Hobby is non-commercial. The app must stay a free tool for a few friends.
- Neon Free allows ten branches, which caps open pull requests with previews.

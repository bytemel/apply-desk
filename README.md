# Apply Desk

Pick a cohort fairly, and show your working. A public application form, private reviewer links, blind review, even workloads, conflicts handed on, harsh and lenient reviewers evened out, and a ranked shortlist.

**Live demo** (resets every day, every key is public):
- [Programme team view](https://apply-desk-omega.vercel.app/m/demo#key=demo): progress, reviewers, the fair ranking
- [Review as the harsh reviewer](https://apply-desk-omega.vercel.app/r/demo#key=demo-c) (also `demo-a` lenient, `demo-b`)
- [Apply to the demo programme](https://apply-desk-omega.vercel.app/a/demo)

## The problem it fixes

Accelerators, fellowships and grant programmes pick cohorts from a Google Form and a shared sheet. Reviewers see founders' names and companies, so who you know leaks into the score. One reviewer gets 40 applications and another 4. A reviewer who marks everything 3 out of 5 and one who marks everything 5 are averaged as if they meant the same thing. And when a funder asks why a startup was not picked, nobody can show the working.

## What it does

- **Public form** (`/a/<programme>`): your questions, name, email, phone and organisation. One application per email. Applicants get a short number (A-007).
- **Blind review** (`/r/<programme>#key=...`): reviewers see the application number and the answers, never the name, email, phone or organisation. The API does not send those fields to reviewers at all, so it is not just hidden on screen. Score each criterion 1 to 5, add a note, next.
- **Even workloads**: "Assign reviewers" gives every application its 1 to 3 reviewers, most-needed applications first, each slot to the least-loaded reviewer. No reviewer gets the same application twice.
- **Conflicts of interest**: a reviewer who knows the applicant presses "I have a conflict". Their score is dropped and the application goes to the next least-loaded reviewer automatically.
- **Fair ranking**: each review becomes 0 to 100 with your weights. Every reviewer with 3 or more reviews is rescaled to the panel's average and spread before averaging, so a harsh reviewer's favourite is not sunk by a lenient reviewer's leftovers. Raw averages stay visible next to the adjusted score.
- **Flags**: not reviewed, needs another review, reviewers disagree (35 points or more apart), unadjusted reviewer (fewer than 3 reviews).
- **Shortlist and export**: pick the top N, open any row to see the answers and every review with its note, download a CSV.

## Data

Applications are personal data. Programmes are deleted 180 days after creation, and the admin can delete a programme and everything in it at once. Keys sit in the URL fragment, which browsers never send to servers, and only their SHA-256 is stored.

## Stack

- Static HTML, CSS and vanilla JS in `public/`
- Vercel Functions (Web `Request`/`Response`) in `api/`
- [Neon](https://neon.tech) serverless Postgres over HTTP (`@neondatabase/serverless`, the only dependency)

The app creates its tables on the first request (`lib/db.js`) in an `apply_desk` schema. `schema.sql` holds the same SQL for reading.

| Path | What |
|---|---|
| `lib/core.js` | Input rules, `assign()`, `total()`, `rank()`, demo data. Pure and tested |
| `lib/data.js` | Keys, assignment against the database, application numbers, the daily demo |
| `api/` | `programmes`, `apply`, `admin`, `review` |

## Run your own

1. Fork, then import the repo on Vercel.
2. Add Neon from the Vercel Marketplace (Storage tab). It sets `DATABASE_URL`.
3. Deploy, open `/`, create a programme.

Tests: `npm test`.

MIT licence. Built by [Timothy Mwangi](https://timmwangi.com).

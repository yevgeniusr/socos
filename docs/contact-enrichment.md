# Safe Contact Enrichment

Socos enrichment is a proposal ledger, not an identity-guessing or overwrite
pipeline. Every candidate is owner-scoped to one contact and one field, retains a
source reference and retrieval time, and starts `pending`. Raw Markdown bodies,
browser-history dumps, page contents, cookies, and browser session data are never
stored in the ledger.

## Reliability and acceptance policy

| Tier     | Evidence                                                                         | Collector confidence | Application policy                                          |
| -------- | -------------------------------------------------------------------------------- | -------------------: | ----------------------------------------------------------- |
| 1        | Explicit labeled vCard field with an exact unique name/alias                     |               `0.99` | Narrow accept tool may apply when the target field is empty |
| 1        | Explicit labeled second-brain field with an exact unique name/alias              |        `0.95`–`0.97` | Narrow accept tool may apply when the target field is empty |
| 2        | Arc public profile or website URL with an exact unique title match               |               `0.92` | Narrow accept tool may apply when the target field is empty |
| 2        | Arc public profile URL with only an exact unique URL-slug match                  |               `0.80` | Remains pending                                             |
| 3        | Public result bound to an explicit Socos contact id                              |               `0.60` | Always remains pending for human review                     |
| 4        | Unique exact name-only public result                                             |        `0.35`–`0.50` | Always remains pending for human review                     |
| Rejected | Ambiguous name, inferred/freeform fact, malformed value, unsafe URL, data broker |                  n/a | Not emitted                                                 |

The automatic acceptance floor is `0.90`. `public_web` candidates are blocked by
the service regardless of confidence. Acceptance is missing-only and atomic: a
concurrent edit or any non-empty field causes a conflict and leaves the candidate
pending. Other pending candidates for the same successfully populated field become
`superseded`. The existing message/introduction/invitation/merge/delete approval
types are unchanged.

Yearless birthdays are represented by `birthdayMonth` and `birthdayDay`; no year is
invented. Full birthdays retain the existing `birthday` date and mirror month/day
for recurrence. February 29 is valid.

## Privacy boundaries

- The collector is local, dry-run only, and has no Socos or network client.
- Markdown input is limited to `.md`; dot directories, dependency trees, and
  filenames suggesting passwords, credentials, tokens, secrets, or private keys
  are skipped.
- Arc reads only public `url`/`title` and `savedURL`/`savedTitle` pairs. It copies
  a profile's locked `History` SQLite file to a temporary directory before a
  read-only query. It may also traverse `StorableSidebar.json` and
  `StorableArchiveItems.json` for those exact pairs only.
- `StorableCommandBarAdditionalRanking.json` is intentionally unsupported because
  it is not required for the sidebar/archive adapter's public evidence contract.
- Arc `Cookies`, `Login Data`, `Web Data`, `Local Storage`, journals, form data,
  page contents, and related stores are rejected.
- Apple Contacts is accepted only as an explicitly exported `.vcf`; Socos never
  accesses protected Contacts databases or bypasses TCC.
- Public results must be pre-fetched JSONL, use HTTPS source locators, and cannot
  originate from the blocked people-search/data-broker hosts. The collector does
  not scrape or fetch them.
- Photo and social values must use HTTPS, contain no credentials or custom ports,
  and cannot target localhost, literal private/link-local addresses, or local/test
  suffixes. Social-network keys use host allowlists.

## Local dry-run collector

Build the API CLI first:

```bash
pnpm --filter @socos/api build
```

Prepare a synthetic-shape Socos export as an array or `{ "contacts": [...] }`:

```json
[
  {
    "id": "contact-id",
    "firstName": "Alex",
    "lastName": "River",
    "nickname": null,
    "aliases": ["A. River"]
  }
]
```

Then run one or more explicit adapters. Use shell variables so local private paths
do not enter repository files or command examples:

```bash
export SOCOS_CONTACTS_EXPORT=/absolute/path/contacts.json
export SOCOS_SECOND_BRAIN=/absolute/path/to/markdown-vault
export SOCOS_ARC_ROOT=/absolute/path/to/Arc
export SOCOS_VCARD_EXPORT=/absolute/path/contacts.vcf

pnpm --filter @socos/api contacts:enrichment:collect -- \
  --contacts "$SOCOS_CONTACTS_EXPORT" \
  --second-brain "$SOCOS_SECOND_BRAIN" \
  --arc "$SOCOS_ARC_ROOT" \
  --vcard "$SOCOS_VCARD_EXPORT" \
  --public-results /absolute/path/public-results.jsonl \
  --output /absolute/path/candidates.jsonl
```

Omit any unavailable adapter. The command writes candidate JSONL only when
`--output` is provided; otherwise JSONL goes to stdout. A PII-free aggregate report
goes to stderr. It never writes Socos. Retrieval timestamps come from local source
file modification times or the required `retrievedAt` field in public-result JSONL,
making repeated collection over unchanged inputs deterministic.

Public-result JSONL uses one object per line:

```json
{
  "contactId": "contact-id",
  "name": "Alex River",
  "fieldName": "company",
  "proposedValue": "Synthetic Labs",
  "sourceLocator": "https://example.org/profile",
  "retrievedAt": "2026-07-18T08:00:00.000Z",
  "matchRationale": "Operator bound this result to the exported Socos id."
}
```

## MCP operator flow

1. Call `socos_contacts_missing_enrichment` with `{ "offset": 0, "limit": 20 }`.
2. Research locally and inspect the dry-run JSONL. Do not submit ambiguous rows.
3. For each retained row, call `socos_enrichment_candidate_submit`, add a stable
   per-intent `idempotencyKey`, and otherwise preserve the collector fields exactly.
4. Call `socos_enrichment_candidates_list` for review.
5. Call `socos_enrichment_candidate_accept` only for explicit high-confidence
   non-public evidence. A conflict means human review, populated data, or stale
   state; do not work around it. Public evidence needs a future authenticated human
   review UI/API and remains pending in this slice.

All submit and accept calls use the existing durable agent idempotency and append-only
mutation audit. A retry must reuse the exact input and idempotency key.

For an explicit owner instruction that an existing LinkedIn or other social link is
wrong, use `socos_correct_contact_social_link` instead of the missing-only accept
tool. The correction tool requires `contacts:social-links:correct`, the exact
contact ID, one social key, the expected current HTTPS URL, a corrected HTTPS URL,
owner-controlled/private source kind/locator/reference/retrieval time, confidence,
and rationale. It only accepts `second_brain`, `arc_history`, `arc_sidebar`, or
`vcard` evidence for automatic correction; public-web evidence remains in candidate
submission and human review. It only replaces an already-populated social link on
the authenticated owner's non-demo contact. Stale expected values, missing links,
unsafe maps, prototype keys, unknown fields, and host-mismatched URLs are conflicts
or invalid input. The durable record remains in `ContactEnrichmentCandidate` with
`correctionKind: "social_link_replace"`, stored previous-value provenance, the final
proposed `socialLinks` map, accepted status, and applied timestamps.

## Limitations and deployment steps

- This slice does not include an authenticated human candidate-review UI or bulk
  importer. Public-web candidates can be stored and listed but not accepted by an
  agent tool.
- It does not fetch pages, resolve DNS, merge social-link objects into populated
  contacts, or infer identity from bios/free text.
- Before importing real data, take the normal database backup, apply migrations
  `20260718200000_contact_enrichment` and
  `20260719120000_contact_social_link_correction`, regenerate Prisma Client,
  deploy the API, and rotate/reissue agent clients with only the documented scopes.
- Run a dry collection, review aggregate counts and samples locally, submit a small
  batch, verify audit rows and missing-only behavior, then continue in bounded pages.

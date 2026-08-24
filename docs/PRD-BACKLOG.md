# Trayek Settle: MVP Engineering Backlog

**Source** PRD v2.0, 19 Aug 2026 (revised after Strategic Assessment, 17 Aug 2026)
**Scope** Full Trayek Settle: POD capture through payment reconciliation and collections assist
**Stack** T3 (Next.js App Router, TypeScript, tRPC, Prisma, Auth.js, Tailwind, Zod)
**Audience** Engineers running AI coding agents. Every issue is written to be handed to an agent as a single unit of work.

---

## 0. How to use this document

One issue equals one branch equals one PR. Do not batch issues, even small ones. The dependency graph in §7 is the build order.

When you hand an issue to an agent, paste the whole issue block plus §2 (invariants), §3 (conventions), and §4 (glossary). The agent will otherwise invent English names for `surat jalan` and `faktur pajak`, and it will otherwise auto-send a collections message because that is what a helpful assistant does.

**Prompt seed for an agent:**

> You are working in the Trayek repo (T3 stack). Implement the issue below. Before writing code, read `docs/INVARIANTS.md` and `prisma/schema.prisma`. Do not modify files outside the paths listed in Scope without saying why in the PR body. Every acceptance criterion must map to a test. Run `pnpm check` (typecheck, lint, unit, invariant suite) before you finish. If an acceptance criterion is ambiguous, stop and ask rather than guessing.

**Definition of Done** (applies to every issue):

- [ ] Typecheck, lint, and unit tests pass
- [ ] Invariant suite (TRK-002) passes
- [ ] New tRPC procedures have Zod input and output schemas
- [ ] Any write to a domain entity emits an audit log entry
- [ ] Any tenant-scoped query goes through `orgProcedure`, never raw Prisma in a route handler
- [ ] Bahasa Indonesia strings live in the i18n catalog, not inline
- [ ] PR body names the acceptance criteria it closes

---

## 1. Product context in one screen

Pak Anton runs a forwarder doing Rp30 miliar a year. His shipper pays him Net-60 or Net-90. He pays his truckers in 7 to 30 days. Around Rp6,2 miliar of his cash sits in piutang at any moment, and his informal cost of capital runs 18 to 24 percent a year. Every POD that goes missing and every `berkas tagih` that comes back rejected pushes that number up.

Mbak Rina, his billing admin, chases drivers on WhatsApp for POD photos, matches them to orders by memory and spreadsheet, and assembles billing packets by hand. When a packet gets rejected for a missing stempel, she finds out three weeks later.

Trayek captures the POD, reads it, checks it against what the receiving shipper actually requires, flags gaps before Rina knows they exist, assembles the packet, and holds the record of who pays and who stalls.

**The number that decides whether this product works: days of DSO removed, proven per customer, target 8 or more.** Not hours saved. Instrument for this from TRK-013 onward or you cannot prove it later.

---

## 2. Non-negotiable product invariants

These come straight from the PRD's human-AI division of labour. Encode them as domain-layer guards with tests, not as UI affordances. An agent will route around a disabled button.

Write these into `docs/INVARIANTS.md` in TRK-001 and back each with a test in `tests/invariants/`.

| ID | Invariant | Why |
|----|-----------|-----|
| INV-1 | No invoice or `faktur pajak` leaves DRAFT without a recorded human approval (actor id, timestamp, IP) | Tax consequences. PRD §5.5, automation ceiling 70-85% |
| INV-2 | No collections message reaches an external recipient without an explicit per-message human send action | Penagihan in Indonesia runs on relationships. PRD §5.7, ceiling 35-55% |
| INV-3 | Trayek never computes, suggests, or stores a rate, margin, or price. Rates are copied from the order as given | Pricing errors are asymmetric and invisible. PRD §5, ceiling 20-35% |
| INV-4 | Fraud detection flags and holds. It never auto-rejects a POD | A false positive on a real POD delays a driver's payment |
| INV-5 | A tenant can never read another tenant's orders, documents, or packets. Cross-tenant reads happen only through the ledger aggregation boundary (TRK-123) with a consent flag set | UU PDP plus the entire moat thesis |
| INV-6 | Every agent failure produces a human-visible notification. Silent failure is a defect of the highest severity | Product touches the customer's cash cycle. PRD §10 |
| INV-7 | Approved invoices are immutable. Corrections create a new document with a link to the original | Audit and tax |
| INV-8 | The core domain never imports from `src/server/channels/*`. Channels talk to the core, not the reverse | WhatsApp is one adapter. Meta starts billing service messages 1 Oct 2026 and ships a competing agent |

---

## 3. Stack and conventions

```
apps/web            Next.js App Router, customer-facing console
apps/driver         Next.js, driver POD upload (no auth, signed links)
src/server/api      tRPC routers
src/server/domain   Pure domain logic. No Prisma, no fetch, no framework imports
src/server/channels WhatsApp / email adapters behind ChannelAdapter port
src/server/ai       LLM adapter, prompts, extraction schemas
src/server/jobs     pg-boss workers
prisma/             Schema and migrations
tests/invariants/   Invariant suite, runs in CI on every PR
evals/              POD extraction eval harness and golden set
```

**Decisions already made:**

- **Queue:** pg-boss on the same Postgres. Keeps job payloads inside the residency boundary and avoids a second vendor DPA. Wrapped in a `JobQueue` port so it can be swapped.
- **Storage:** S3-compatible, region `ap-southeast-3` (Jakarta) or `ap-southeast-1` (Singapore). Bucket is private. All access via presigned URLs with short expiry.
- **LLM:** behind an `LlmProvider` port in `src/server/ai/provider.ts`. Provider choice is an open decision (§9) because of residency. Nothing outside that file knows the vendor.
- **Money:** integer minor units (rupiah, no subunit in practice, but store as `BigInt` sen to survive foreign-currency edge cases). Never `Float`.
- **Dates:** store UTC, render `Asia/Jakarta`. DSO arithmetic uses calendar days in `Asia/Jakarta`.
- **Phone:** normalize to E.164 at the boundary. Indonesian mobile numbers arrive as `08xx`, `62xx`, `+62xx`, and with spaces.
- **i18n:** UI in Bahasa Indonesia by default. Domain terms stay Indonesian in code and in the database. Do not translate `surat jalan` to `delivery note` in an enum.

---

## 4. Domain glossary

Agents will mistranslate these. Keep the Indonesian term as the canonical identifier in code.

| Term | Meaning | Notes for engineers |
|------|---------|--------------------|
| POD | Proof of delivery, the signed receipt | Sometimes called `bukti terima barang` |
| Surat jalan | Delivery order/note issued before the trip | Carries the number the POD is matched against |
| Berkas tagih | The billing packet sent to the shipper's finance team | Our `BillingPacket` aggregate |
| Faktur pajak | Government tax invoice, separate from the commercial invoice | Numbering and filing are regulated. Human gate, always |
| Berita acara | Signed minutes or handover report, required by some shippers | Treat as a document type, not a field |
| Penagihan | Collections | Runs on relationships, hence INV-2 |
| Piutang | Accounts receivable | |
| Jatuh tempo | Due date | |
| Selisih | Variance between invoiced and paid amount | Usually PPh withholding or a deduction, not an error |
| Potongan | Deduction taken by the payer | Claim reasons feed the ledger |
| Stempel | Company stamp on the POD | Its absence is the single most common rejection reason |
| Nama terang | Printed name beside the signature | Required by many shippers |
| NPWP | Tax ID | Entity resolution key for the payment behavior ledger |
| WABA | WhatsApp Business Account | Customer owns theirs. We never pay for messages |
| DSO | Days sales outstanding | The metric the whole product is sold on |
| UU PDP | Indonesian personal data protection law | Applies from v1 |
| OJK | Financial services regulator | Only relevant when financing partners arrive in year 3 |

---

## 5. Data model overview

Sketch, not final. TRK-002 lands the tenancy and identity core, then each epic extends it. Keep migrations small and forward-only.

```
Organization (type: FORWARDER | SHIPPER)
  └─ Membership ─ User
  └─ Shipper                     consignee/payer known to this forwarder
       └─ RequirementProfile     per-shipper POD and packet rules (versioned)
  └─ Driver                      data source, never a paying user
  └─ Order                       the load
       └─ PodSubmission          one upload attempt
            └─ Extraction        LLM output, model + prompt version pinned
            └─ FraudSignal[]     one row per detector
            └─ ValidationResult  deterministic rule output
       └─ BillingPacket          state machine
            └─ PacketDocument[]  surat jalan, POD, invoice, faktur pajak, berita acara
            └─ Invoice
            └─ PacketRejection[]
       └─ Payment[]              matched or in exception
  └─ AuditLog                    append-only

PayerEntity (global, NPWP-keyed)   the moat
  └─ PaymentBehaviorEvent[]        append-only, cross-tenant, consent-gated
```

---

## 6. Milestones

Mapped to the PRD's 12-month roadmap. Each milestone has a stop condition. Honour them.

| Milestone | PRD phase | Issues | Ships when |
|-----------|-----------|--------|-----------|
| **M0 Foundation** | pre-build | TRK-001 to 013 | Tenancy, auth, storage, queue, audit, and the invariant suite all green |
| **M1 POD loop** | month 2-5 | TRK-020 to 072 | Extraction hits 93% per-field on the 500-doc golden set, and 4-6 design partners are uploading real PODs daily |
| **M2 Billing packet** | month 5-8 | TRK-080 to 093 | A packet assembled by Trayek is accepted first-pass by a real shipper, and we start charging |
| **M3 Cash close** | month 5-8 | TRK-100 to 123 | Reconciliation runs on real bank statements and the ledger has 60+ days of payment events |
| **M4 Proof and distribution** | month 8-11 | TRK-130 to 144 | One customer's DSO reduction is provable from our own data, and one enterprise shipper sees a consolidated vendor view |

**Stop conditions from the PRD, do not build past them:**

- Fewer than 10 of 30 interviewed owners can state their own DSO figure: halt and revisit the thesis.
- Extraction stalls below 90% per-field after two prompt iterations and one preprocessing pass: the problem is image capture (TRK-031), not the model. Fix capture first.

---

## 7. Dependency graph

```
TRK-001 ─┬─ TRK-002 ─┬─ TRK-003 ─┬─ TRK-010 ─ TRK-070 ─ TRK-071
         │           │           ├─ TRK-011 ─ TRK-050 ─ TRK-051
         │           │           ├─ TRK-012
         │           │           └─ TRK-013 ────────────── TRK-132
         │           ├─ TRK-006 (audit)
         │           └─ TRK-140 (PDP, start early)
         ├─ TRK-004 (storage) ─ TRK-030 ─┬─ TRK-031 ─ TRK-032 ─ TRK-033
         ├─ TRK-005 (queue) ─ TRK-041    └─ TRK-024 ─ TRK-020 ─ TRK-021 ─ TRK-022
         └─ TRK-007 (observability)

TRK-040 ─ TRK-041 ─┬─ TRK-042 ─ TRK-043 ─ TRK-130
                   ├─ TRK-044 (eval, gates all extraction work)
                   ├─ TRK-045
                   └─ TRK-060..064 (fraud, parallel, day one)

TRK-070 ─ TRK-080 ─ TRK-081 ─ TRK-082 ─ TRK-083 ─ TRK-084
                                        └─ TRK-090 ─ TRK-091 ─ TRK-092 ─ TRK-093
TRK-093 ─ TRK-100 ─ TRK-101 ─ TRK-102 ─ TRK-103 ─ TRK-110 ─ TRK-111 ─ TRK-112
TRK-084 + TRK-102 ─ TRK-120 ─ TRK-121 ─ TRK-122 ─ TRK-123 ─ TRK-133
```

Parallelizable from day one: the fraud epic (G), the eval harness (TRK-044), and the compliance epic (O). Assign these to separate agents.

---

## 8. Issues

Metadata format: `Epic · Priority · Size · Depends on`. Sizes: S under a day, M one to three days, L three to five days. Anything larger got split.

---

### Epic A: Foundation

#### TRK-001 · Repo scaffold, CI, and agent guardrails
`A · P0 · M · depends: none`

**Why.** Every downstream issue assumes `pnpm check` exists and means something. Set the gates before an agent writes domain code, because retrofitting a lint rule across 40 PRs costs more than writing it now.

**Scope**
- `create-t3-app` with tRPC, Prisma, Auth.js, Tailwind, App Router
- `pnpm check` runs typecheck, eslint, vitest, and the invariant suite in one command
- Vitest for unit, Playwright for the driver upload flow and the approval gate
- ESLint rule banning Prisma imports inside `src/server/domain/**`
- ESLint rule banning imports from `src/server/channels/**` inside `src/server/domain/**` (INV-8)
- `docs/INVARIANTS.md` containing §2 of this backlog verbatim
- `CLAUDE.md` at repo root: stack, conventions from §3, glossary from §4, and the rule that domain invariants are never relaxed to make a test pass
- GitHub Actions running `pnpm check` on every PR, required to merge

**Acceptance criteria**
- [x] `pnpm check` fails when a Prisma import is added to `src/server/domain/`
- [x] `pnpm check` fails when a channel adapter is imported into the domain layer
- [ ] CI blocks merge on any failure
- [x] `docs/INVARIANTS.md` and `CLAUDE.md` exist and match this backlog

---

#### TRK-002 · Tenancy and identity schema, plus the invariant test suite
`A · P0 · M · depends: TRK-001`

**Why.** Tenant isolation is INV-5 and the moat depends on it holding while we aggregate across tenants. Get the shape right before 40 tables reference it.

**Scope**
- Prisma models: `Organization` (`type: FORWARDER | SHIPPER`), `User`, `Membership` (`role: OWNER | ADMIN | FINANCE | VIEWER`)
- Every tenant-scoped table carries `organizationId` with an index, non-nullable
- `tests/invariants/` harness with a stub test per invariant INV-1 through INV-8, each marked `todo` until its epic lands, each wired into `pnpm check`
- Seed script producing two forwarder orgs and one shipper org for isolation testing

**Acceptance criteria**
- [x] Invariant suite runs in CI and reports which invariants are still `todo`
- [x] A test proves a query scoped to org A returns zero rows created under org B
- [ ] Migration is forward-only and reversible in staging

---

#### TRK-003 · Auth.js, tenant-scoped tRPC context, `orgProcedure`
`A · P0 · M · depends: TRK-002`

**Why.** Every subsequent router is built on this. If `orgProcedure` leaks, INV-5 is unenforceable everywhere at once.

**Scope**
- Auth.js with email magic link. Password auth is out of scope, Indonesian SME admins share machines and forget passwords
- tRPC context resolves `session -> membership -> organizationId`
- `orgProcedure` injects a Prisma client whose tenant-scoped models are pre-filtered by `organizationId` (Prisma extension, not convention)
- `roleProcedure(role)` for approval-gated actions
- Session lifetime and idle timeout configurable per org

**Acceptance criteria**
- [x] Calling any `orgProcedure` without a membership returns `UNAUTHORIZED`
- [ ] A user in org A requesting an org B resource id gets `NOT_FOUND`, never `FORBIDDEN` (do not leak existence)
- [ ] INV-5 invariant test moves from `todo` to passing
- [x] Role checks are enforced server side, not by hiding UI

---

#### TRK-004 · Object storage adapter and presigned uploads
`A · P0 · M · depends: TRK-001`

**Why.** POD images are the product's raw material and they contain signatures, which are personal data under UU PDP. They never sit in a public bucket.

**Scope**
- `StoragePort` in `src/server/domain/ports/storage.ts`, S3-compatible implementation in `src/server/storage/`
- Private bucket, region pinned by env var, blocked public access asserted at startup
- Presigned PUT for driver uploads with 15-minute expiry and a content-length ceiling
- Presigned GET for console viewing with 5-minute expiry, issued only through `orgProcedure`
- Server-side encryption at rest, TLS in transit
- Store the original bytes untouched. Derived versions (preprocessed, thumbnail) get their own keys. Fraud forensics in TRK-061 needs the original

**Acceptance criteria**
- [ ] App refuses to boot if the bucket allows public reads
- [ ] A presigned GET issued for org A's document cannot be minted by a user in org B
- [ ] Original upload bytes are byte-identical to what the client sent, verified by checksum test
- [ ] Expired presigned URLs return 403

---

#### TRK-005 · Job queue adapter with dead-letter and human fallback
`A · P0 · M · depends: TRK-001`

**Why.** Extraction, fraud checks, and reconciliation all run async. INV-6 says no failure is silent, which is a queue concern, not a UI concern.

**Scope**
- `JobQueuePort` in the domain, pg-boss implementation in `src/server/jobs/`
- Retry with exponential backoff, max attempts configurable per job type
- Dead-letter table with the failing payload and error
- On terminal failure, emit a `HumanFallbackRequired` event carrying the org, the entity, and a plain-Indonesian description of what a person now has to do by hand
- Worker process runs separately from the web process, documented in the README

**Acceptance criteria**
- [ ] A job that throws on every attempt lands in the dead-letter table and produces exactly one `HumanFallbackRequired` event
- [ ] Jobs are idempotent by key. Replaying a completed job is a no-op
- [ ] INV-6 invariant test passes for the queue path
- [ ] Queue depth and failure count are exported as metrics (TRK-007)

---

#### TRK-006 · Append-only audit log
`A · P0 · S · depends: TRK-002`

**Why.** Approval gates (INV-1) are only meaningful if the approval is recorded. Tax and dispute defence both need this.

**Scope**
- `AuditLog`: `organizationId`, `actorType` (USER | AGENT | SYSTEM), `actorId`, `action`, `entityType`, `entityId`, `before`, `after`, `ip`, `userAgent`, `createdAt`
- Database-level protection against UPDATE and DELETE (revoke grants or a trigger)
- Helper `withAudit()` used by every domain mutation
- Console view filtered by entity, readable by OWNER and FINANCE roles

**Acceptance criteria**
- [ ] An UPDATE against `AuditLog` raises a database error
- [ ] Every mutation in the packet and invoice state machines writes an entry, verified by a test that enumerates mutations
- [ ] Agent-initiated actions record `actorType = AGENT` with the model and prompt version

---

#### TRK-007 · Observability and LLM cost accounting
`A · P1 · S · depends: TRK-001`

**Why.** Gross margin target is 82-88%. Multimodal LLM calls are the main variable cost. If you cannot see cost per load per tenant, you cannot defend the pricing model in §8 of the PRD.

**Scope**
- Structured JSON logging with `organizationId` and `requestId` on every line
- Error tracking (Sentry or equivalent) with PII scrubbing for phone numbers and image URLs
- Per-call recording of: model, prompt version, input tokens, output tokens, image count, latency, estimated cost, `organizationId`
- Dashboard query: cost per processed load, rolling 30 days, by tenant

**Acceptance criteria**
- [ ] Cost per load per tenant is queryable in SQL without joining logs
- [ ] No phone number or signature image URL appears in any error payload
- [ ] p50 and p95 extraction latency are tracked

---

### Epic B: Master data

#### TRK-010 · Shipper registry and versioned RequirementProfile
`B · P0 · L · depends: TRK-003`

**Why.** The whole validation feature (§5.3 of the PRD) rests on knowing what this particular shipper rejects packets for. Ibu Sri's team at one FMCG distributor wants a stempel and a foto barang. Another wants `nama terang` and a `berita acara`. Encode this declaratively or you will be shipping code for every new customer.

**Scope**
- `Shipper` scoped to the forwarder org: name, NPWP, payment terms (net days), finance contact, address
- `RequirementProfile` versioned, one active version per shipper, immutable once used by a packet
- Rule schema (Zod, stored as JSON):
  - Required POD fields: `tandaTangan`, `stempel`, `namaTerang`, `tanggalTerima`, `nomorSuratJalan`, `jumlahKoli`
  - Required documents: `SURAT_JALAN`, `POD`, `INVOICE`, `FAKTUR_PAJAK`, `BERITA_ACARA`, `FOTO_BARANG`
  - Packet format: file naming pattern, ordering, single merged PDF versus separate files
  - Submission cadence: rolling, weekly cut-off, monthly cut-off, with day-of-week or day-of-month
  - Net terms and the clock start event (invoice date versus packet received date). This distinction moves DSO by weeks and customers get it wrong
- Admin UI to create and version a profile, with a diff view between versions
- Seed profiles for the first two design partner shippers

**Acceptance criteria**
- [ ] A profile version referenced by any packet cannot be edited, only superseded
- [ ] Adding a new requirement type requires no schema migration
- [ ] The rule JSON validates against a Zod schema at write time, rejecting unknown keys
- [ ] Changing a profile does not retroactively invalidate packets already assembled

**Out of scope.** Learning requirements automatically from rejection history. That is TRK-084 feeding a manual suggestion later.

---

#### TRK-011 · Order and load model with import
`B · P0 · M · depends: TRK-003`

**Why.** POD matching needs something to match against. Design partners keep orders in Excel and in whatever TMS they half-use.

**Scope**
- `Order`: `nomorOrder`, `nomorSuratJalan`, `shipperId`, `driverId`, origin, destination, planned and actual delivery date, `jumlahKoli`, weight, `nilaiTagihan` (copied, never computed, INV-3), status
- Status enum: `CREATED`, `IN_TRANSIT`, `DELIVERED`, `POD_RECEIVED`, `POD_VALIDATED`, `PACKET_READY`, `INVOICED`, `PAID`, `REJECTED`
- CSV and XLSX import with column mapping UI, dry-run preview, per-row error report
- Manual single-order create form
- Unique constraint on (`organizationId`, `nomorSuratJalan`)
- Public API stub with an OpenAPI spec, not implemented, so integration conversations can start

**Acceptance criteria**
- [ ] An import of 5,000 rows completes and reports per-row failures without aborting the batch
- [ ] Re-importing the same file is idempotent, keyed on `nomorSuratJalan`
- [ ] No field in `Order` is derived from a rate calculation. A test asserts no arithmetic on `nilaiTagihan` outside currency formatting (INV-3)

---

#### TRK-012 · Driver registry and phone normalization
`B · P0 · S · depends: TRK-003`

**Why.** Pak Herman pays nothing and installs nothing. He is a data source. Model him as such and resist building him an account.

**Scope**
- `Driver`: name, E.164 phone, vehicle plate, optional `vendorId` for subcontracted trucking companies
- Normalizer accepting `08xx`, `62xx`, `+62 xxx`, dotted and spaced variants, returning E.164 or a typed parse error
- Deduplication on normalized phone within an org
- No login, no password, no app

**Acceptance criteria**
- [ ] Normalizer test table covers at least 20 real-world Indonesian input formats
- [ ] Creating a driver with an existing normalized phone returns the existing record
- [ ] No auth surface exists for drivers

---

#### TRK-013 · DSO baseline capture
`B · P0 · M · depends: TRK-011`

**Why.** The PRD sells one number: 8 or more days of DSO removed, proven per customer. You can only prove a reduction against a baseline recorded before the product changed anything. Miss this and month 8 becomes an argument instead of a demonstration.

**Scope**
- Onboarding wizard capturing, per customer: last 6 months of invoiced revenue, average receivable balance, current DSO if known, and per-shipper net terms
- Historical invoice import (CSV) with issue date and payment date, feeding a computed baseline DSO
- Store the baseline as an immutable snapshot with the method used and the date range
- Flag which baseline came from the owner's own claim versus computed from imported data. Both matter, for different reasons
- Record whether the owner could state their DSO unprompted. This is the PRD's month 0-2 go/no-go signal, so it belongs in the database, not a notebook

**Acceptance criteria**
- [ ] Baseline snapshot cannot be edited after the first packet is created for that org
- [ ] Computed and claimed DSO are stored separately and both surface in the owner dashboard
- [ ] Export produces a one-page PDF an owner can read in three minutes (feeds TRK-131)
- [ ] A report counts, across all interviewed orgs, how many owners stated a DSO figure unprompted

---

### Epic C: Channel adapter

#### TRK-020 · Channel abstraction port
`C · P0 · M · depends: TRK-003`

**Why.** INV-8. Meta starts charging for service messages on 1 Oct 2026 and Meta Business Agent now competes in the conversation layer. The core cannot flinch when either changes.

**Scope**
- `ChannelAdapter` port: `sendMessage(to, template, params)`, `verifyWebhook(req)`, `parseInbound(payload) -> InboundMessage`
- `InboundMessage` and `OutboundMessage` are channel-neutral value objects in the domain
- Adapter registry keyed by channel type, resolved per organization
- Every inbound and outbound message persisted to `MessageLog` in our own database before any adapter-specific handling, per PRD architecture principle 3

**Acceptance criteria**
- [ ] The domain layer compiles with every file under `src/server/channels/` deleted
- [ ] A no-op test adapter can be registered and drives the full POD request flow
- [ ] `MessageLog` retains message content and direction independent of the provider
- [ ] INV-8 invariant test passes

---

#### TRK-021 · WhatsApp adapter on customer-owned WABA
`C · P0 · L · depends: TRK-020`

**Why.** PRD architecture principle 2: the customer brings their own WABA and pays Meta directly. This moves Meta's pricing risk off our gross margin.

**Scope**
- Per-organization WABA credentials (phone number id, business account id, access token), encrypted at rest with envelope encryption, never logged
- Webhook endpoint with signature verification and replay protection
- Template message management: register, sync approval status, surface rejections to the admin
- Rate limit handling with backoff, respecting per-number tier limits
- Onboarding runbook in `docs/waba-onboarding.md`, because a forwarder admin will do this once and never again

**Acceptance criteria**
- [ ] Credentials are unreadable in logs, error payloads, and the admin UI after save
- [ ] An unsigned or replayed webhook is rejected with 401
- [ ] Two organizations with different WABA numbers operate concurrently without cross-talk, proven by test
- [ ] Failure to send surfaces as a `HumanFallbackRequired` event, not a silent drop

---

#### TRK-022 · Message cost attribution
`C · P1 · S · depends: TRK-021`

**Why.** From 1 Oct 2026 Meta bills service messages. The customer pays, but they will ask us why the bill grew, and our own product decisions drive the volume.

**Scope**
- Record per message: category (service, utility, marketing), conversation window state, estimated cost, `organizationId`
- Monthly per-org message volume report
- Design rule enforced in review: prefer one message with a link over a five-message exchange (PRD architecture principle 4)

**Acceptance criteria**
- [ ] Message count per completed POD is a tracked metric, with an alert if the 30-day average exceeds 3
- [ ] Report is exportable as CSV for the customer's own reconciliation with Meta

---

#### TRK-023 · Email adapter
`C · P2 · S · depends: TRK-020`

**Why.** Not because customers want email. Because building a second adapter is the only honest proof that the abstraction in TRK-020 holds. Also the channel Ibu Sri's finance team actually uses for packet delivery.

**Scope**
- Outbound transactional email through an SMTP or API provider
- Inbound parsing is out of scope for MVP
- Same `MessageLog` persistence path as WhatsApp

**Acceptance criteria**
- [ ] Packet delivery to a shipper works end to end over email with zero changes in `src/server/domain/`
- [ ] Bounce and delivery failure produce `HumanFallbackRequired`

---

#### TRK-024 · Signed POD upload links
`C · P0 · M · depends: TRK-004, TRK-011`

**Why.** PRD §5.1: the driver opens a light web link rather than attaching a photo in WhatsApp. This keeps image quality controlled, keeps EXIF intact for fraud checks, and decouples the product from WABA behaviour.

**Scope**
- Signed token binding `orderId`, expiry, and a use budget (allow several uploads, a driver retakes photos)
- Short URL suitable for a WhatsApp message body
- Token rotation and manual revocation from the console
- Link resolves without login, renders the driver app (TRK-030)
- Rate limiting per token and per IP

**Acceptance criteria**
- [ ] An expired or revoked token renders a plain Indonesian message telling the driver to contact the admin, not a stack trace
- [ ] A token for order X cannot be used to upload against order Y, proven by test
- [ ] Tokens do not appear in server logs or in the Referer header of outbound requests

---

### Epic D: POD capture

#### TRK-030 · Driver upload app
`D · P0 · L · depends: TRK-024`

**Why.** Pak Herman is on an Android phone on a 3G connection at a warehouse gate with the engine running. Everything about this screen has to survive that.

**Scope**
- Single-screen Next.js app under `apps/driver`, Bahasa Indonesia only
- Camera capture and gallery selection, multi-photo for multi-page PODs
- Shows the order number and destination so the driver confirms he is on the right link
- Total JS payload under 150 KB gzipped, first contentful paint under 2.5s on a throttled 3G profile
- Success screen with a clear confirmation. Drivers who are unsure will upload again, and duplicate uploads become fraud signals
- Works on Android WebView, the in-app browser WhatsApp opens by default

**Acceptance criteria**
- [ ] Playwright test on a throttled 3G profile completes an upload in under 30 seconds
- [ ] Lighthouse performance score above 90 on mobile
- [ ] Verified working in WhatsApp's in-app browser on Android, documented with device and OS version
- [ ] No text on screen requires reading English

---

#### TRK-031 · Capture quality guard
`D · P0 · M · depends: TRK-030`

**Why.** Extraction accuracy has a ceiling set by image quality. If TRK-044 shows accuracy below 90%, the fix is usually here and not in the prompt.

**Scope**
- Client-side checks before upload: blur (variance of Laplacian), overall brightness, document edge detection, resolution floor
- If a check fails, prompt a retake in Indonesian with a specific reason ("Foto buram, coba lagi"), while still allowing the driver to override and upload anyway. A blurry POD beats no POD
- Record the quality score and any override on the submission for later correlation with extraction accuracy
- Never modify the original bytes before upload

**Acceptance criteria**
- [ ] Quality score is stored on every `PodSubmission`
- [ ] Driver can override any warning in one tap
- [ ] Test fixtures cover blurry, dark, glared, skewed, and cropped samples
- [ ] Correlation report exists: quality score against per-field extraction accuracy

---

#### TRK-032 · Geolocation and capture attestation
`D · P0 · S · depends: TRK-030`

**Why.** Feeds TRK-062. WhatsApp strips EXIF from forwarded images, which is one more reason the PRD chose the web-link path, but browser uploads can lose EXIF too. Capture location independently.

**Scope**
- Browser Geolocation API request at capture time, with a clear Indonesian consent prompt (UU PDP basis, coordinate with TRK-140)
- Store latitude, longitude, accuracy, and timestamp on the submission
- Record whether permission was granted, denied, or unavailable. Denial is a weak signal, not proof of anything
- Capture client timestamp alongside server receipt timestamp

**Acceptance criteria**
- [ ] Denied permission still allows upload to proceed
- [ ] Permission state and coordinates are persisted and visible to fraud detection
- [ ] Consent text is reviewed against the PDP notice drafted in TRK-140

---

#### TRK-033 · Resumable upload with idempotency
`D · P1 · M · depends: TRK-030`

**Why.** Warehouse connectivity drops mid-upload. A failed upload the driver believes succeeded is the worst outcome, because nobody chases it.

**Scope**
- Client-generated idempotency key per capture attempt
- Chunked or resumable upload, retry on network failure with backoff
- Local queue so a driver who loses signal entirely gets the upload retried when the tab regains connectivity
- Server deduplicates on idempotency key

**Acceptance criteria**
- [ ] Interrupting the network mid-upload and restoring it completes the upload without driver action
- [ ] Replaying the same idempotency key creates exactly one `PodSubmission`
- [ ] The success screen appears only after the server confirms receipt

---

### Epic E: Extraction

#### TRK-040 · LLM provider port
`E · P0 · M · depends: TRK-005`

**Why.** PRD §9 is blunt about this: the AI model is not a moat, everyone calls the same API. Treat the provider as swappable infrastructure and keep the vendor name out of the domain. Residency (§9, open decision) may force a change mid-build.

**Scope**
- `LlmProvider` port: `extractStructured({ images, schema, promptVersion }) -> { data, confidencePerField, usage }`
- Zod schema drives structured output. Reject and retry once on schema violation, then fail to human review
- Timeout, retry with backoff, circuit breaker on sustained provider failure
- Every call records model, prompt version, and usage to the observability tables (TRK-007)
- Fixture-replay mode for tests so the suite runs without network or spend

**Acceptance criteria**
- [ ] Swapping the provider implementation requires changes in exactly one file
- [ ] Unit tests run with zero network calls
- [ ] Malformed model output never reaches the database, it routes to human review
- [ ] Circuit breaker opening emits `HumanFallbackRequired`

---

#### TRK-041 · POD extraction pipeline
`E · P0 · L · depends: TRK-040, TRK-042`

**Why.** PRD §5.2 and the 85-93% automation band. Errors here are visually verifiable by a human, which is exactly why this workflow is safe to automate.

**Scope**
- Job triggered on `PodSubmission` creation
- Extracted fields: `nomorSuratJalan`, `nomorOrder`, `tanggalTerima`, `namaPenerima`, `namaTerang` present, `tandaTangan` present, `stempel` present, `jumlahKoli`, `kondisiBarang`, free-text `catatan`
- Multi-page handling: several photos, one logical POD
- Handwriting is the norm, not the exception. Include handwritten samples in every prompt iteration
- Persist `Extraction` with the raw model response, parsed fields, per-field confidence, model id, and prompt version
- Never overwrite an extraction. New attempts create new rows

**Acceptance criteria**
- [ ] Per-field accuracy meets the TRK-044 gate before this issue closes
- [ ] Every extraction is reproducible from the stored model id and prompt version
- [ ] Extraction failure leaves the submission in `NEEDS_REVIEW`, never in a silent error state
- [ ] p95 extraction latency under 30 seconds from upload

---

#### TRK-042 · Image preprocessing
`E · P0 · M · depends: TRK-004`

**Why.** A dark, skewed phone photo of a carbon-copy `surat jalan` is the median input. Preprocessing lifts accuracy more cheaply than prompt engineering does.

**Scope**
- Deskew, perspective correction, contrast normalization, denoise, downscale to the provider's optimal resolution
- Original stays untouched in storage. Preprocessed derivative gets its own key (TRK-004)
- Preprocessing parameters recorded so a result can be reproduced
- Run as a queue job, not inline in the request

**Acceptance criteria**
- [ ] Original bytes are unchanged after preprocessing runs, verified by checksum
- [ ] A/B measurement on the golden set shows the accuracy delta from preprocessing, recorded in `evals/README.md`
- [ ] Preprocessing failure falls back to the original image rather than blocking extraction

---

#### TRK-043 · Field-level confidence routing
`E · P0 · M · depends: TRK-041`

**Why.** Document-level confidence is close to useless. A POD where only `jumlahKoli` is uncertain needs a two-second human glance, not a full re-key.

**Scope**
- Per-field confidence thresholds, configurable per organization, seeded with defaults
- Routing: high confidence auto-accepts, medium routes to review with the field highlighted, low blocks packet assembly
- Fields whose absence causes rejection (`stempel`, `tandaTangan`) get stricter thresholds than descriptive fields
- Threshold changes are versioned and audited, because loosening a threshold to clear a backlog is a real failure mode

**Acceptance criteria**
- [ ] Review UI shows the specific uncertain field with the image region, not the whole document
- [ ] Thresholds are tunable without a deploy
- [ ] A report shows, per field, the share auto-accepted and the human correction rate on those auto-accepts

---

#### TRK-044 · Eval harness and the 500-document golden set
`E · P0 · L · depends: TRK-040`

**Why.** The PRD commits to 93% accuracy on 500 real documents that are dirty, skewed, dark, and handwritten. This is the gate on the entire M1 milestone. Build it before the pipeline, not after, or you will be tuning prompts against vibes.

**Scope**
- `evals/` harness: run the current pipeline over a labelled set, output per-field precision and recall plus a confusion report
- Golden set of 500 real PODs from design partners, with a signed data-use agreement (coordinate with TRK-140)
- Stratify the set: clean, blurry, dark, skewed, handwritten, carbon-copy, multi-page, partially obscured stamp, non-standard form. Record the strata so you can see which one is dragging the average
- Labelling tool or process, with a second-pass review on ambiguous labels
- CI gate: per-field accuracy on the holdout split must not regress
- Hold out 100 documents. Never tune against them

**Acceptance criteria**
- [ ] `pnpm eval` produces a per-field and per-stratum report
- [ ] CI fails a PR that drops any field's accuracy by more than 1 percentage point
- [ ] The holdout split has never been used for prompt iteration, enforced by directory separation and documented process
- [ ] Report shows accuracy for `stempel` and `tandaTangan` detection separately, since those drive rejections

---

#### TRK-045 · Prompt and model version registry
`E · P1 · S · depends: TRK-041`

**Why.** When accuracy drops on a Tuesday, you need to know what changed. Provider-side model updates happen without notice.

**Scope**
- Prompts stored as versioned files in `src/server/ai/prompts/`, content-hashed
- Every extraction references the hash and the model id
- Startup log records the active prompt hashes
- Comparison view: same document, two prompt versions, side by side

**Acceptance criteria**
- [ ] Any extraction row can be traced to the exact prompt text used
- [ ] Changing a prompt without bumping the version is impossible (hash is computed, not declared)

---

### Epic F: Matching

#### TRK-050 · Order matching engine
`F · P0 · L · depends: TRK-011, TRK-041`

**Why.** PRD §5.2. A wrong match is worse than no match: it attaches the wrong POD to an invoice, the shipper rejects the packet, and trust in the system dies in week two.

**Scope**
- Tiered strategy: exact `nomorSuratJalan`, then exact `nomorOrder`, then normalized fuzzy (strip separators, correct common OCR confusions between 0/O, 1/I/l, 5/S, 8/B), then contextual (driver plus date plus destination)
- Fuzzy matches never auto-commit. They present a ranked candidate list to a human
- Ambiguity (two candidates within a similarity margin) always routes to human choice
- No match at all creates an `UNMATCHED_POD` work item, visible in the ops queue, never dropped

**Acceptance criteria**
- [ ] A test set of near-miss order numbers proves no silent wrong match, this is the headline test
- [ ] Auto-commit happens only on exact match against a unique order
- [ ] Unmatched PODs appear in the ops queue within one minute of upload
- [ ] Match method and confidence are stored on the link record

---

#### TRK-051 · Manual match and review UI
`F · P0 · M · depends: TRK-050, TRK-043`

**Why.** Mbak Rina resolves what the agent could not. Her throughput here sets the ceiling on how many loads a customer can run through Trayek.

**Scope**
- Split view: POD image with zoom and rotate on one side, candidate orders on the other
- Keyboard-driven. She will process dozens in a sitting
- Search across orders by any field
- Create-order-from-POD path for loads that never made it into the system
- Every manual match writes to the audit log and feeds back as a labelled example for TRK-044

**Acceptance criteria**
- [ ] A trained user resolves a match in under 15 seconds, measured on a real session
- [ ] Every manual correction is available as a labelled eval example
- [ ] Bulk actions exist for the common case of one driver submitting a day's worth of PODs at once

---

### Epic G: Fraud detection

Active from version one, per PRD §10. Not a phase two feature. Once Trayek becomes a trusted verification layer for financing, forged PODs become worth producing.

#### TRK-060 · Duplicate detection
`G · P0 · M · depends: TRK-041`

**Why.** The cheapest fraud is submitting the same POD twice against two orders. The second cheapest is re-photographing a printout of a real POD.

**Scope**
- Exact hash (SHA-256) on original bytes
- Perceptual hash (pHash or dHash) with a tuned Hamming distance threshold, to catch recompression, crop, and re-photography
- Check within the org and across orgs. Cross-org checks compare hashes only, never expose the other tenant's data (INV-5)
- Store every near-collision with its distance for later threshold tuning

**Acceptance criteria**
- [ ] A re-photographed printout of a stored POD is flagged
- [ ] A genuinely different POD from the same shipper template is not flagged, false positive rate measured on the golden set
- [ ] Cross-tenant matches surface as a signal with no tenant-identifying detail

---

#### TRK-061 · Image metadata forensics
`G · P0 · M · depends: TRK-060`

**Why.** Editing software leaves traces. A POD that passed through an image editor deserves a human look before it becomes an invoice.

**Scope**
- EXIF extraction: capture time, device make and model, software field, GPS if present
- Signals: EXIF entirely absent, software field naming an editor, capture time far from delivery time, thumbnail inconsistent with the image, error level analysis on JPEG recompression
- Treat missing EXIF as weak. Many pipelines strip it legitimately
- Each detector writes an independent `FraudSignal` row with its own score and reasoning

**Acceptance criteria**
- [ ] Detectors are independently testable with fixture images, including known-edited samples
- [ ] Signals never combine into a single opaque number at storage time, aggregation happens in TRK-064
- [ ] Analysis runs on the original bytes, never the preprocessed derivative

---

#### TRK-062 · Geospatial plausibility
`G · P1 · M · depends: TRK-032`

**Why.** A POD for a Surabaya delivery uploaded from Bekasi is worth a question.

**Scope**
- Geocode order destinations once, cache them
- Distance between capture location and destination, with a configurable radius. Warehouse complexes are large, urban geocoding in Indonesia is imprecise, so set the radius generously and tune from real data
- Speed plausibility across a driver's consecutive submissions
- Absent location is a null signal, not a negative one

**Acceptance criteria**
- [ ] Threshold is configurable per organization without a deploy
- [ ] False positive rate measured against 30 days of real submissions before the signal is given any weight in TRK-064
- [ ] Missing geolocation never raises the fraud score

---

#### TRK-063 · Order-number reuse and timeline checks
`G · P1 · S · depends: TRK-050`

**Why.** Cross-checking the number against our own order data catches the fraud that image analysis misses.

**Scope**
- Same `nomorSuratJalan` appearing on visually different PODs
- POD dated before the order's dispatch date
- POD received long after the delivery date, configurable window
- Signature or stamp appearing on an order assigned to a different shipper

**Acceptance criteria**
- [ ] Each check produces a discrete signal with a plain-Indonesian explanation for the reviewer
- [ ] Checks run inside the same transaction boundary as matching, so a flagged POD cannot slip into packet assembly

---

#### TRK-064 · Fraud score aggregation and hold workflow
`G · P0 · M · depends: TRK-060, TRK-061, TRK-062, TRK-063`

**Why.** INV-4. The system flags and holds. A human decides. Auto-rejecting a genuine POD delays a real driver's payment and destroys the relationship the customer has with their subcontractor.

**Scope**
- Weighted aggregation across signals, weights configurable and versioned
- Three outcomes: pass, flag (proceeds with a visible marker), hold (blocks packet assembly until reviewed)
- Review UI listing every contributing signal with its evidence, so the reviewer sees why
- Reviewer decision (`CONFIRMED_FRAUD`, `FALSE_POSITIVE`, `INCONCLUSIVE`) is recorded and used to tune weights
- No automatic rejection path exists in the code

**Acceptance criteria**
- [ ] Invariant test INV-4 proves no code path sets a POD to rejected without a human actor id
- [ ] A held POD blocks packet assembly, verified end to end
- [ ] Reviewer decisions are queryable for weight tuning
- [ ] False positive rate on the golden set is reported before the feature is enabled for any customer

---

### Epic H: Completeness validation

#### TRK-070 · Deterministic rule engine
`H · P0 · L · depends: TRK-010, TRK-041`

**Why.** PRD §5.3, the feature that stops packets being rejected. This layer must be deterministic. An LLM deciding whether a stempel is required is a bug, the requirement profile already says so.

**Scope**
- Evaluate a `RequirementProfile` version against an `Extraction` plus the set of attached documents
- Output a structured `ValidationResult`: per-rule pass, fail, or indeterminate, each with the rule id and a human-readable Indonesian message
- Indeterminate (extraction confidence too low to judge) is a distinct outcome from fail, and routes to human review rather than to the driver
- Pure function in `src/server/domain/validation/`, zero IO, fully unit testable
- Rules must be explainable: every failure names the rule and the evidence

**Acceptance criteria**
- [ ] The evaluator is a pure function with no Prisma or network imports, enforced by the TRK-001 lint rule
- [ ] Same inputs always produce the same result, property-tested
- [ ] Every rule type in the TRK-010 schema has a test with a passing and a failing fixture
- [ ] An LLM call never determines whether a requirement is satisfied, only what the document contains

---

#### TRK-071 · Deficiency remediation loop
`H · P0 · M · depends: TRK-070, TRK-020`

**Why.** The value is catching the missing stempel while the driver is still at the warehouse gate, not three weeks later when finance rejects the packet.

**Scope**
- On validation failure, generate a specific Indonesian message naming what is missing and what to do ("POD belum ada stempel penerima. Minta stempel lalu foto ulang")
- Send through the org's channel adapter to the driver, with a fresh upload link
- Escalate to the ops queue if unresolved within a configurable window
- Track time-to-remediation per deficiency type. This becomes a sales artefact

**Acceptance criteria**
- [ ] Messages name the specific deficiency, never a generic "dokumen tidak lengkap"
- [ ] Re-upload against the same order links to the original submission as a correction, preserving history
- [ ] One message per deficiency event, no repeat sends without a human action (respects TRK-022 cost discipline)
- [ ] Median time from delivery to complete-and-valid POD is a tracked metric

---

#### TRK-072 · Missing POD SLA timer
`H · P1 · S · depends: TRK-011`

**Why.** A POD nobody uploaded produces no failure signal at all. The silent gap is where DSO actually leaks.

**Scope**
- Job comparing delivered orders against received PODs
- Configurable SLA per shipper, defaulting to 24 hours after actual delivery
- Escalation ladder: driver reminder, then ops queue, then owner digest
- Aging view of orders delivered without a POD, sorted by `nilaiTagihan` at risk

**Acceptance criteria**
- [ ] Orders past SLA appear in the ops queue with the rupiah value at risk shown
- [ ] The escalation ladder respects INV-2 for anything leaving the organization
- [ ] Report shows total value of delivered-but-unbilled loads, the number that makes an owner sit up

---

### Epic I: Billing packet

#### TRK-080 · BillingPacket aggregate and state machine
`I · P0 · L · depends: TRK-070`

**Why.** This is the system of record the PRD's moat argument rests on (§9, switching cost 8/10). Leaving a quoting tool takes a week. Leaving the system that holds your `berkas tagih` takes a bloody quarter.

**Scope**
- States: `DRAFT`, `BLOCKED` (fraud hold or missing document), `READY`, `PENDING_APPROVAL`, `APPROVED`, `SENT`, `ACKNOWLEDGED`, `REJECTED`, `PAID`, `PARTIALLY_PAID`, `WRITTEN_OFF`
- Transitions declared as a table in `src/server/domain/packet/machine.ts`. Illegal transitions throw
- Each transition records actor, timestamp, and reason to the audit log
- Packet groups one or more orders, since many shippers bill weekly or monthly in batches (see the cadence rules in TRK-010)
- Timestamps for every state entry, because these are the raw material for DSO measurement in TRK-132

**Acceptance criteria**
- [ ] Every illegal transition is rejected with a typed error, exhaustively tested
- [ ] State history is reconstructible from the audit log alone
- [ ] A packet cannot enter `READY` while any linked POD is on fraud hold
- [ ] Entry timestamps for `SENT`, `ACKNOWLEDGED`, and `PAID` are indexed, DSO queries depend on them

---

#### TRK-081 · Document set assembly
`I · P0 · M · depends: TRK-080`

**Why.** PRD §5.4. The packet is `surat jalan` plus POD plus invoice plus `faktur pajak` plus `berita acara`, and which of those are required depends on the shipper.

**Scope**
- `PacketDocument` with a type enum using Indonesian names, source (uploaded, generated, extracted), and a storage key
- Upload path for documents that come from outside the POD flow
- Completeness check driven by the shipper's `RequirementProfile` version
- Missing-document view listing exactly what is outstanding and who owns getting it

**Acceptance criteria**
- [ ] Document types use Indonesian identifiers in the enum, not English translations
- [ ] Adding a document type requires only an enum extension and a profile update
- [ ] The outstanding-items view names an owner for each gap

---

#### TRK-082 · Packet renderer with per-shipper format
`I · P0 · L · depends: TRK-081`

**Why.** Ibu Sri wants one format from every vendor (PRD §4). Meeting her format exactly is what makes her mandate her vendors onto Trayek, which is the entire go-to-market.

**Scope**
- PDF generation: cover sheet, index, documents in the profile's declared order
- Two output modes: single merged PDF and a zip of separate files, per profile
- File naming pattern templated from profile variables (`{nomorInvoice}_{namaVendor}_{periode}.pdf`)
- Cover sheet: vendor details, period, order count, total value, per-document checklist
- Deterministic output. The same packet renders byte-identical twice, which makes diffing and regression testing possible

**Acceptance criteria**
- [ ] Rendering the same packet twice produces identical bytes
- [ ] Both output modes are exercised by snapshot tests
- [ ] Naming pattern renders correctly with Indonesian characters and long company names
- [ ] A design partner's finance team accepts a generated packet without manual rework, recorded as evidence in the PR

---

#### TRK-083 · Assembly gate
`I · P0 · S · depends: TRK-082, TRK-064`

**Why.** The whole product promise is that no incomplete packet leaves the building. This gate is that promise in code.

**Scope**
- Blocking conditions: any required document missing, any validation rule failed, any POD on fraud hold, any required field below its confidence threshold
- Override path for OWNER role only, requiring a typed reason, fully audited. Overrides exist because reality does, but they are counted
- Override rate is a tracked metric. A high rate means the requirement profile is wrong, not that people are careless

**Acceptance criteria**
- [ ] No code path reaches `READY` while a blocking condition holds, except the audited OWNER override
- [ ] Override reason is mandatory free text, minimum length enforced
- [ ] Override rate per organization is on the ops dashboard

---

#### TRK-084 · Rejection capture and reason taxonomy
`I · P0 · M · depends: TRK-080`

**Why.** Two payoffs. Short term, the taxonomy tells you which requirement profile is wrong. Long term, first-pass rejection rate per payer is one of the two numbers that make the ledger in TRK-120 worth underwriting against.

**Scope**
- Structured reasons: `DOKUMEN_KURANG`, `STEMPEL_TIDAK_ADA`, `TANDA_TANGAN_TIDAK_JELAS`, `NOMOR_PO_SALAH`, `NILAI_TIDAK_COCOK`, `FORMAT_SALAH`, `TERLAMBAT_KIRIM`, `PAJAK_BERMASALAH`, `LAIN_LAIN` with free text
- Record who rejected, when, and how it was communicated
- Resubmission links to the original packet, preserving the full chain
- Report: rejection reasons by shipper, feeding requirement profile corrections
- Emits a ledger event (TRK-121)

**Acceptance criteria**
- [ ] Resubmission chains are traceable end to end
- [ ] First-pass acceptance rate is computable per shipper and per forwarder
- [ ] Reasons are queryable without parsing free text

---

### Epic J: Invoice and tax gate

#### TRK-090 · Invoice draft generation
`J · P0 · M · depends: TRK-081`

**Why.** PRD §5.5. Note the constraint: values are copied from the order, never derived from a rate table. INV-3 holds here.

**Scope**
- Draft assembled from order values, shipper billing details, and period
- Tax handling: fields for PPN and for withholding, with the applicable treatment configured per shipper by the customer, not inferred by us
- Multi-order invoices for batch-billing shippers
- Invoice preview matching the final render

**Acceptance criteria**
- [ ] No rate table, no margin field, no price calculation exists anywhere in this code path (INV-3 test)
- [ ] Tax treatment comes from configuration a human set, never from a model output
- [ ] Rounding follows a single documented rule, tested against real design partner invoices
- [ ] Preview and final render are identical

**Open question.** Withholding treatment for freight and forwarding services varies by service type and contract. Get the customer's tax advisor to confirm per shipper before you encode defaults. Do not let an agent guess a rate.

---

#### TRK-091 · Mandatory human approval gate
`J · P0 · M · depends: TRK-090`

**Why.** INV-1, PRD §5.5. Tax consequences make this the one gate that can never be optimized away, and someone will eventually ask for a bulk auto-approve toggle. The answer is no.

**Scope**
- Approval enforced in the domain layer. The state machine rejects `DRAFT -> APPROVED` without an approval record
- `Approval`: user id, role, timestamp, IP, user agent, and a hash of the exact document content approved
- Only OWNER and FINANCE roles can approve
- Bulk approval UI is allowed, but each invoice still records its own individual approval record. One click, many records, no shortcuts in the data
- Content changed after approval invalidates it and returns the invoice to `DRAFT`

**Acceptance criteria**
- [ ] INV-1 invariant test enumerates every path to `APPROVED` and proves each requires an approval record
- [ ] There is no configuration flag, environment variable, or admin toggle that bypasses the gate. A test asserts this
- [ ] Content hash mismatch blocks issuance
- [ ] Approval is visible in the audit log with the approver's identity

---

#### TRK-092 · Faktur pajak data export
`J · P1 · M · depends: TRK-091`

**Why.** The customer's tax staff already have a filing process. Fit into it rather than replacing it in month six.

**Scope**
- Export invoice data in the format the customer's existing tax filing workflow ingests
- Record the externally issued `faktur pajak` number against the invoice once the customer has it
- Block packet `SENT` if the shipper's profile requires a `faktur pajak` and none is recorded
- Reconciliation view: invoices missing a `faktur pajak` number

**Acceptance criteria**
- [ ] Export format matches what a design partner's tax staff actually uses, verified with a real submission
- [ ] Recording an external number is audited
- [ ] No automated filing to any tax authority happens in MVP

**Open question, blocks scoping.** The DJP filing path (Coretax era) and whether any API integration is available or advisable needs verification with a local tax consultant before this issue is estimated. Export-only is the safe MVP assumption. Do not let an agent build an integration against remembered API documentation.

---

#### TRK-093 · Invoice numbering and immutability
`J · P0 · S · depends: TRK-091`

**Why.** INV-7. Gaps and duplicates in an invoice sequence create problems during a tax audit that nobody wants to explain.

**Scope**
- Per-organization sequence with a configurable pattern (prefix, year, month, running number)
- Gapless allocation using a database sequence or a locked counter, safe under concurrency
- Numbers allocated at approval, not at draft creation. Abandoned drafts must not burn numbers
- Approved invoices are immutable. Corrections create a credit note or a replacement linked to the original

**Acceptance criteria**
- [ ] Concurrent approvals produce no duplicate and no gap, proven under a load test
- [ ] Updating an approved invoice raises a domain error
- [ ] The correction chain is traceable in both directions

---

### Epic K: Payment reconciliation

#### TRK-100 · Payment model and bank statement import
`K · P0 · L · depends: TRK-093`

**Why.** PRD §5.6. Without this, DSO is a claim rather than a measurement, and TRK-132 has nothing to compute from.

**Scope**
- `Payment`: amount, value date, reference, payer name as it appears on the statement, source, raw row
- CSV and XLSX import with per-bank column mapping profiles. Indonesian bank exports are inconsistent and change without notice, so mapping is configuration, not code
- Import preview with duplicate detection on (account, value date, amount, reference)
- Manual payment entry for cash and cheque
- Design partners will name the two or three banks that matter. Build mappings for those, not for a hypothetical long tail

**Acceptance criteria**
- [ ] Re-importing an overlapping statement period creates no duplicate payments
- [ ] Adding a new bank format requires only a mapping profile, no code change
- [ ] The raw source row is retained for every payment
- [ ] Import of 2,000 rows completes in under 30 seconds

---

#### TRK-101 · Automatic payment matching
`K · P0 · L · depends: TRK-100`

**Why.** Reconciliation is the step where DSO becomes measurable rather than asserted.

**Scope**
- Tiered matching: exact reference to invoice number, then exact amount plus payer, then amount within tolerance plus payer, then batch payments covering several invoices
- Partial payments are normal in this market. Support many-to-many between payments and invoices
- Tolerance rules for `selisih` arising from withholding or `potongan`, configurable per shipper
- Auto-match only on unambiguous outcomes. Everything else goes to TRK-102
- Every match records its method and confidence

**Acceptance criteria**
- [ ] One payment settling five invoices matches correctly
- [ ] One invoice settled by three payments matches correctly
- [ ] An ambiguous payment auto-matches to nothing and routes to exception review
- [ ] Match method is stored and auditable

---

#### TRK-102 · Selisih exception review
`K · P0 · M · depends: TRK-101`

**Why.** Variances are usually legitimate withholding or an agreed deduction, not an error. Handling them as exceptions rather than errors is what makes the aging report trustworthy.

**Scope**
- Queue of unmatched payments and partially settled invoices
- Manual match with search, split, and merge
- Variance classification: `PPH_DIPOTONG`, `POTONGAN_DISEPAKATI`, `KLAIM_KERUSAKAN`, `SELISIH_KURS`, `SALAH_BAYAR`, `BELUM_JELAS`
- Write-off path with OWNER approval and a reason, audited
- Classified variances emit ledger events (TRK-121), because a payer who always deducts is a payer worth knowing about

**Acceptance criteria**
- [ ] Splitting a payment across invoices preserves total integrity, property-tested
- [ ] Every variance carries a classification before an invoice can be closed
- [ ] Write-offs require OWNER role and appear in the audit log
- [ ] Exception queue is empty-able. A trained user clears a day's exceptions in under 20 minutes

---

#### TRK-103 · Aging and piutang reporting
`K · P0 · M · depends: TRK-101`

**Why.** Pak Anton knows roughly what is overdue. He has no systematic way to see it. This report is the first thing he opens.

**Scope**
- Aging buckets: current, 1-30, 31-60, 61-90, over 90 days past `jatuh tempo`
- Grouped by shipper, drillable to invoice and to packet
- Total cash locked, and the carrying cost at a configurable rate (the PRD's 18-24% informal cost of capital, set per customer, not hardcoded)
- Export to XLSX, because finance staff will want it in Excel regardless of how good the screen is

**Acceptance criteria**
- [ ] Bucketing uses `jatuh tempo` derived from the shipper's terms and the correct clock-start event from TRK-010
- [ ] Carrying cost rate is per-organization configuration
- [ ] Report reconciles to the general ledger totals a design partner already keeps, verified once against real books

---

### Epic L: Collections assist

Automation ceiling 35-55%, per PRD §5.7. Trayek drafts and prioritizes. A human sends. Every time.

#### TRK-110 · Overdue priority queue
`L · P0 · M · depends: TRK-103`

**Why.** Rina chases whoever shouted most recently. A ranked queue changes which receivable gets attention today.

**Scope**
- Priority score from amount, days past due, payer behavior score (TRK-122 when available, a static default before that), and relationship weight set by the owner
- Grouping by payer so one call covers several invoices
- Snooze with a reason and a follow-up date
- Assignment to a specific staff member

**Acceptance criteria**
- [ ] Scoring weights are configurable and versioned
- [ ] Queue reflects payment updates within one minute of import
- [ ] Snoozed items resurface on the follow-up date

---

#### TRK-111 · Reminder draft generator
`L · P0 · M · depends: TRK-110`

**Why.** Writing the fifth polite chase of the day is the tedious part. Deciding whether to send it is not.

**Scope**
- Generated drafts in Bahasa Indonesia at three escalation levels: reminder before due, gentle follow-up, firm follow-up
- Tone appropriate to Indonesian business correspondence. Direct translations of American collections templates will damage relationships. Have a native speaker review every template
- Variants for WhatsApp (short) and email (formal, with the packet attached)
- Draft includes invoice numbers, amounts, and due dates pulled from data, not generated by the model
- Fully editable before sending. Most users will edit, and that is fine

**Acceptance criteria**
- [ ] All numeric content is templated from data, never model-generated, tested by asserting figures against source records
- [ ] Templates are reviewed and signed off by a native Bahasa Indonesia business writer, recorded in the PR
- [ ] Drafts persist so a half-written message survives a page refresh

---

#### TRK-112 · Send gate
`L · P0 · S · depends: TRK-111`

**Why.** INV-2. This is the single highest-risk automation in the product. An agent that autonomously chases a forwarder's largest customer can cost that forwarder the account, and it would be our fault.

**Scope**
- No scheduled send, no batch send, no "approve all and send" flow
- Each outbound collections message requires a distinct user action recording user id, timestamp, message content hash, and recipient
- The channel adapter refuses collections-category messages lacking a send authorization record
- Guard sits in the domain and in the adapter. Two layers, because someone will eventually add a bulk feature

**Acceptance criteria**
- [ ] INV-2 invariant test enumerates every outbound path and proves each requires a per-message human action
- [ ] No scheduler, cron, or queue job can trigger a collections send. Asserted by test
- [ ] Attempting to send without authorization raises a domain error and writes an audit entry

---

#### TRK-113 · Promise-to-pay tracking
`L · P1 · S · depends: TRK-110`

**Why.** "Minggu depan ya, Pak" is data. A payer who promises and misses three times has a different profile from one who pays late but silently, and the ledger should know the difference.

**Scope**
- Record a promised date, amount, channel, and who at the payer made the promise
- Automatic follow-up entry in the priority queue on the promised date
- Kept versus broken promise rate per payer, emitted to the ledger (TRK-121)

**Acceptance criteria**
- [ ] Promises resurface in the queue on the promised date
- [ ] Kept and broken counts are computable per payer entity
- [ ] Recording a promise never triggers an outbound message on its own

---

### Epic M: Verified payment behavior ledger

PRD §9 rates this the primary moat, 8 out of 10. Build it as an append-only event stream from the first customer. Retrofitting history is impossible, and the asset is worth nothing until it has depth.

#### TRK-120 · PayerEntity resolution and ledger schema
`M · P0 · L · depends: TRK-084, TRK-102`

**Why.** The asset is knowing that PT Sumber Makmur pays Trayek's forwarder customers in 71 days on average and rejects 40% of first submissions. That requires resolving the same legal entity across tenants without letting tenants see each other's data (INV-5).

**Scope**
- `PayerEntity` global to the platform, keyed on NPWP with normalized name and address as fallback
- Entity resolution: exact NPWP first, then fuzzy name plus address for candidates, queued for manual confirmation. Never auto-merge on name alone, Indonesian company names collide constantly
- `PaymentBehaviorEvent` append-only: `payerEntityId`, `eventType`, `occurredAt`, `sourceOrganizationId`, and a payload with no free text that could carry commercial terms
- Event types: `PACKET_SENT`, `PACKET_ACKNOWLEDGED`, `PACKET_REJECTED`, `INVOICE_ISSUED`, `PAYMENT_RECEIVED`, `PAYMENT_PARTIAL`, `PROMISE_MADE`, `PROMISE_KEPT`, `PROMISE_BROKEN`, `DEDUCTION_APPLIED`, `WRITTEN_OFF`
- Database-level protection against UPDATE and DELETE, same approach as TRK-006

**Acceptance criteria**
- [ ] No event payload contains rates, margins, or free text (INV-3, and it keeps commercial secrets out of a shared table)
- [ ] Entity merges are reversible and audited
- [ ] UPDATE and DELETE against the event table raise database errors
- [ ] A tenant querying the ledger through the normal API cannot retrieve another tenant's events

---

#### TRK-121 · Event emission from the lifecycle
`M · P0 · M · depends: TRK-120`

**Why.** The ledger is only as good as its coverage. Every state transition that reveals payer behavior has to emit, and it has to emit in the same transaction as the state change.

**Scope**
- Emit from: packet state machine (TRK-080), rejection capture (TRK-084), invoice approval (TRK-091), payment matching (TRK-101), variance classification (TRK-102), promise tracking (TRK-113)
- Same-transaction emission. No eventual consistency here, a dropped event is silent data loss in the asset
- Backfill script for events predating this issue

**Acceptance criteria**
- [ ] A test enumerates every packet and invoice state transition and asserts which emit events, failing when a new transition is added without a decision
- [ ] Rolling back the state change rolls back the event
- [ ] Backfill is idempotent

---

#### TRK-122 · Payer scorecard
`M · P1 · M · depends: TRK-121`

**Why.** Turns the event stream into something a person or a financing partner can use. Feeds the collections priority queue (TRK-110) today and underwriting later.

**Scope**
- Metrics per payer: median and p90 days to pay, first-pass acceptance rate, rejection reason distribution, partial payment frequency, promise-kept rate, deduction rate, trend over the last two quarters
- Minimum sample threshold. Below it, show no score rather than a misleading one
- Recomputed on a schedule, cached, with the computation date visible

**Acceptance criteria**
- [ ] Scores below the sample threshold display as "data belum cukup", never as a number
- [ ] Every metric is traceable to its underlying events
- [ ] Computation runs incrementally, not as a full table scan

---

#### TRK-123 · Cross-tenant aggregation boundary
`M · P0 · L · depends: TRK-122`

**Why.** This is where the moat and INV-5 meet, and the place where a careless implementation creates both a legal problem and a commercial betrayal. A forwarder must never learn which other forwarder reported an event.

**Scope**
- Aggregation service is the only code permitted to read across `sourceOrganizationId`
- Minimum contributor threshold before any cross-tenant aggregate is exposed. A single-contributor aggregate is just that contributor's data with a different label
- Per-organization consent flag, defaulted off, set only by an explicit contractual acceptance recorded with a timestamp
- Output is aggregate only: no counterparty identity, no volumes, no rates, no contributing organization identifiers
- Legal review sign-off required before this issue merges, referenced in the PR

**Acceptance criteria**
- [ ] Aggregates below the contributor threshold return no data
- [ ] No response from this service can be reverse-engineered to a single contributing organization, argued and documented in the PR
- [ ] Organizations without consent contribute nothing and receive nothing
- [ ] Legal sign-off is linked in the PR body
- [ ] INV-5 invariant test covers this path specifically

---

### Epic N: Dashboards and proof

#### TRK-130 · Ops console
`N · P0 · L · depends: TRK-051, TRK-064, TRK-083`

**Why.** Mbak Rina's whole day lives here. Her throughput is the constraint on how many loads a customer can put through Trayek, which makes this screen a scaling lever, not a nicety.

**Scope**
- One unified work queue, not five tabs. Sections: needs POD, needs matching, needs review, fraud hold, needs approval, ready to send, needs follow-up
- Counts and rupiah value at risk per section
- Keyboard navigation throughout
- Bulk actions where safe, single actions where INV-1 or INV-2 apply
- Real-time or near-real-time updates so two staff members do not duplicate work

**Acceptance criteria**
- [ ] Every work item type from every epic appears in exactly one section, no orphans
- [ ] A trained user clears a 50-item queue in under 30 minutes, measured
- [ ] Bulk actions are absent from any flow touching invoice approval or collections sending
- [ ] Loads in under 2 seconds with 1,000 open items

---

#### TRK-131 · Owner dashboard
`N · P0 · M · depends: TRK-103, TRK-132`

**Why.** Pak Anton buys in one meeting and renews on one number. Show him cash, not activity. He does not care how many PODs were processed.

**Scope**
- Above the fold: current DSO, change against baseline, rupiah cash unlocked, carrying cost avoided
- Aging summary with drill-down
- Delivered-but-unbilled value (from TRK-072)
- Rejection rate trend
- Deliberately excludes: documents processed, time saved, hours of work. PRD §2 is explicit that time is not what we sell
- One-page PDF export for a board or bank conversation

**Acceptance criteria**
- [ ] The primary figure on the screen is a rupiah amount, not a count
- [ ] No metric expressed in hours or minutes appears anywhere on this dashboard
- [ ] PDF export is legible on a phone, this is where the owner will read it
- [ ] Every figure drills down to its underlying records

---

#### TRK-132 · DSO computation and per-customer proof
`N · P0 · L · depends: TRK-013, TRK-101`

**Why.** The headline metric: 8 or more days removed, proven per customer. Without a defensible computation, the sales claim collapses under the first CFO who asks how it was calculated.

**Scope**
- DSO computed by a documented method (countback or simple average, pick one, document it, keep it consistent)
- Rolling 30, 60, and 90 day windows
- Comparison against the immutable baseline from TRK-013
- Attribution view: how much of the change came from faster POD capture, from fewer rejections, and from faster collections follow-up. An owner will ask, and "the software did it" is not an answer
- Cohort report across all customers, the artefact that goes into the fundraise
- Confounder handling: seasonality, shipper mix change, volume change. Surface these rather than hiding them, an honest number survives diligence

**Acceptance criteria**
- [ ] The calculation method is documented in `docs/dso-methodology.md` and matches the code, verified by test
- [ ] Baseline versus current comparison is exportable per customer
- [ ] Attribution splits reconcile to the total change
- [ ] The cohort report answers the question "how many customers achieved 8 or more days" directly

---

#### TRK-133 · Enterprise shipper portal
`N · P1 · L · depends: TRK-082, TRK-123`

**Why.** PRD §14. One deal with Ibu Sri opens 8 to 20 forwarders. Her view is the product that makes her mandate Trayek to her vendors, and it is the cheapest CAC in the plan.

**Scope**
- Shipper-type organization with membership and roles
- Consolidated view of packets from every vendor forwarder, filtered to packets addressed to this shipper only
- Format compliance rate per vendor
- Requirement profile publishing: she defines the standard once, her vendors inherit it
- Bulk download of a period's packets
- Strict scoping: she sees packets billed to her, nothing else about the vendor's business, and no vendor sees another vendor

**Acceptance criteria**
- [ ] A shipper user cannot retrieve any order, packet, or payment not addressed to their own organization, tested exhaustively
- [ ] A published requirement profile propagates to consenting vendor organizations as a new version, never silently overwriting theirs
- [ ] One vendor's data is never visible to another vendor
- [ ] Bulk download of one month across 15 vendors completes without timing out

---

### Epic O: Compliance and reliability

#### TRK-140 · UU PDP compliance foundation
`O · P0 · L · depends: TRK-002`

**Why.** PRD §10: required from version one, not bolted on later. Trayek processes driver phone numbers, photographed signatures, and the customer's own customer data. Signatures are biometric-adjacent and deserve the stricter treatment.

**Scope**
- Data inventory: every personal data field, its purpose, its lawful basis, its retention period, documented in `docs/pdp-data-inventory.md` and kept current by a CI check that fails when a new personal-data field appears without an entry
- Consent capture and versioning for drivers at the point of upload (coordinate with TRK-032)
- Retention jobs deleting or anonymizing past the retention window
- Data subject request tooling: access, correction, deletion, with the deletion path handling the tension against audit-log immutability. Resolve by anonymizing rather than deleting audit rows, and document the position
- Data processing agreement template for customers, drafted with counsel
- Breach notification runbook

**Acceptance criteria**
- [ ] CI fails when a new field tagged as personal data lacks an inventory entry
- [ ] Retention jobs run on schedule and log what they removed
- [ ] A deletion request completes without corrupting audit or ledger integrity, tested end to end
- [ ] Counsel has reviewed the DPA template and the consent text, linked in the PR

---

#### TRK-141 · Residency and encryption
`O · P0 · M · depends: TRK-004`

**Why.** PRD §10 pins the region to Indonesia or Singapore. Get this wrong and remediation means migrating live customer data.

**Scope**
- Database, object storage, queue, and backups all in the approved region
- Startup assertion that every configured region is on the allowlist. Refuse to boot otherwise
- TLS everywhere, encryption at rest for database and storage
- Key management with documented rotation
- Sub-processor register listing every vendor touching customer data, with their processing region. The LLM provider is the one to watch (§9)

**Acceptance criteria**
- [ ] The app refuses to start with an out-of-region configuration
- [ ] Sub-processor register exists and names each vendor's processing region
- [ ] Backup restore has been tested from the in-region backup, with the result recorded
- [ ] No customer data transits a region outside the allowlist, traced and documented per external call

---

#### TRK-142 · PII minimization
`O · P1 · M · depends: TRK-140`

**Why.** The smallest blast radius survives the worst day.

**Scope**
- Driver phone numbers stored encrypted at the column level, decrypted only where a message is actually sent
- Signature images behind stricter access control than the rest of the POD, with every access logged
- Log scrubbing for phone numbers, NPWP, and storage URLs
- Redacted rendering mode for demos and screenshots, because someone will screenshot a real customer's dashboard for a pitch deck

**Acceptance criteria**
- [ ] No phone number appears in plaintext in any log or error report, verified by a scanning test over sample output
- [ ] Every signature image access writes an audit entry
- [ ] Demo mode renders realistic but synthetic data

---

#### TRK-143 · Human fallback everywhere
`O · P0 · M · depends: TRK-005`

**Why.** INV-6, PRD §10: every agent failure falls back to a human notification rather than silence. This product touches the customer's cash cycle, and a silent failure means an invoice nobody sent.

**Scope**
- Every agent action declares its fallback: who gets told, through which channel, with what instruction
- Fallback registry in `src/server/domain/fallbacks.ts` mapping every failure mode to a handler
- Notifications carry a plain-Indonesian description of what a person now has to do by hand
- Daily digest of unresolved fallbacks to the ops lead
- Stuck-state detector: anything sitting in a non-terminal state past a threshold surfaces regardless of whether an error was ever thrown. Silent stalls are the failure mode nobody catches

**Acceptance criteria**
- [ ] A test enumerates every agent entry point and asserts each has a registered fallback, failing when a new one is added without one
- [ ] Chaos test: kill the LLM provider, kill the queue, kill storage. Each produces a human notification within five minutes
- [ ] The stuck-state detector catches an entity artificially frozen mid-workflow
- [ ] INV-6 invariant test passes

---

#### TRK-144 · Tenant data export
`O · P1 · M · depends: TRK-080`

**Why.** Two reasons. UU PDP portability, and it removes an objection during the sale. A forwarder who can leave is more willing to start.

**Scope**
- Full export: orders, PODs, packets, invoices, payments, documents, audit log
- Machine-readable (JSON or CSV) plus original document files
- Async job with a download link on completion
- Excludes cross-tenant ledger aggregates, which are not the tenant's data to take

**Acceptance criteria**
- [ ] Export of an org with 10,000 orders completes without exhausting memory
- [ ] Export contains no other tenant's data, tested
- [ ] A customer can reconstruct their operational history from the export alone

---

## 9. Open decisions

These block estimation or carry legal risk. An agent will resolve them by guessing, which is the failure mode to prevent. Assign an owner and a date to each.

| # | Decision | Blocks | Owner |
|---|----------|--------|-------|
| 1 | LLM provider and its processing region, plus a DPA that satisfies UU PDP. If no acceptable provider processes in region, decide whether a documented lawful transfer basis is acceptable | TRK-040, TRK-141 | Founder + counsel |
| 2 | Hosting topology. Vercel functions in `sin1` with Postgres and storage in `ap-southeast-3`, or self-host everything in Jakarta. PDP exposure differs | TRK-141 | Eng lead |
| 3 | Faktur pajak filing path in the current DJP system, and whether an API integration exists or is advisable. Verify with a local tax consultant, do not rely on remembered documentation | TRK-092 | Tax consultant |
| 4 | Withholding treatment for freight and forwarding services, per shipper. Confirm with the customer's tax advisor, never infer | TRK-090 | Tax consultant |
| 5 | Which banks the first design partners use, and their exact statement export formats. Get real files, not documentation | TRK-100 | Design partner lead |
| 6 | Cross-tenant ledger consent language and legal basis. TRK-123 does not merge without this | TRK-123 | Counsel |
| 7 | WABA ownership during the design partner phase. Customers unlikely to have their own WABA on day one, which conflicts with architecture principle 2. Decide the interim posture and its cost exposure | TRK-021 | Founder |
| 8 | Golden set data use agreement with design partners, covering real PODs with real signatures | TRK-044 | Counsel |
| 9 | DSO calculation method, countback or simple average. Pick once, document, never change silently | TRK-132 | Founder + eng lead |

---

## 10. Explicitly out of scope

From PRD §5 and §16. If an agent proposes any of these, reject it and cite this section.

- **Voice AI.** Removed from the 24-month roadmap. Cost parity with human labour in Indonesia kills the economics
- **Quoting, pricing, or rate automation.** INV-3. Margins are the forwarder's trade secret, and asking for them in a vendor system is a heavy sales obstacle
- **Carrier network or marketplace**
- **Lending from Trayek's balance sheet.** Financing arrives in year three through licensed partners, as originator and data provider only
- **Enterprise shipper as the primary paying customer in year one.** They are the door, not the ARR
- **Building on WhatsApp as the product surface.** One adapter, nothing more
- **Native driver app.** Pak Herman installs nothing
- **TMS features:** route optimization, fleet tracking, load planning. McEasy already occupies that ground
- **Multi-currency.** Rupiah only
- **Automatic learning of requirement profiles from rejection history.** Report the pattern, let a human update the profile

---

## Appendix A: Issue template

```markdown
#### TRK-XXX · Title
`Epic · Priority · Size · depends: TRK-YYY`

**Why.** One or two sentences. Reference the PRD section. Name the person affected.

**Scope**
- Bullets. Concrete. Name files and modules where it helps.

**Acceptance criteria**
- [ ] Testable. No "works correctly". No "is performant".

**Out of scope.** What an agent will try to add, and should not.

**Open question.** Anything that must be answered by a human before coding starts.
```

## Appendix B: Review checklist for agent-produced PRs

- [ ] Does it touch an invariant? If so, does the invariant test still pass, and was the test itself left alone?
- [ ] Did the agent weaken a test or a threshold to make something pass?
- [ ] Any English translation of an Indonesian domain term introduced into an enum, a column, or a type?
- [ ] Any arithmetic on rates, margins, or prices? (INV-3)
- [ ] Any new outbound message path? Does it respect INV-1 and INV-2?
- [ ] Any new agent entry point? Is it registered in the fallback registry? (INV-6)
- [ ] Any new personal data field? Is it in the PDP inventory? (TRK-140)
- [ ] Any raw Prisma call bypassing `orgProcedure`? (INV-5)
- [ ] Does a new tRPC procedure have both input and output Zod schemas?
- [ ] Does the PR body name which acceptance criteria it closes?

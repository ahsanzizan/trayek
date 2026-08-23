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

Canonical source: [Trayek Settle MVP backlog §2](trayek-settle-mvp-backlog.md#2-non-negotiable-product-invariants).

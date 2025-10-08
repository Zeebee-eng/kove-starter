import "dotenv/config";
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ MISSING STRIPE_SECRET_KEY");
} else {
  console.log("✅ Stripe key loaded:", process.env.STRIPE_SECRET_KEY.slice(0, 8) + "…");
}
import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import Stripe from "stripe";
import { raw } from "express";



// Create app
const app = express();

// Important: do NOT use express.json() on the webhook route.
// We will add raw body only for the Stripe webhook below.

// Safe to use JSON for all other routes:
app.use((req, res, next) => {
  if (req.path === "/v1/stripe/webhook") return next();
  express.json()(req, res, next);
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// Health check
app.get("/v1/health", (_req: Request, res: Response) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Stripe webhook: raw body required
app.post(
  "/v1/stripe/webhook",
  raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
        apiVersion: "2024-06-20",
      });
      const sig = req.headers["stripe-signature"] as string;
      const whSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

      // verify signature
      const event = stripe.webhooks.constructEvent(
        // @ts-ignore express raw body provides a Buffer
        req.body,
        sig,
        whSecret
      );

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as Stripe.PaymentIntent;
        console.log("PI succeeded:", pi.id);
      }
      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as Stripe.PaymentIntent;
        console.log("PI failed:", pi.id);
      }

      return res.status(200).json({ received: true });
    } catch (err: any) {
      console.error("Webhook error:", err?.message || err);
      return res.status(400).send(`Webhook Error: ${err?.message || "unknown"}`);
    }
  }
);


app.post("/v1/test/payment_intent_ach", async (_req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2024-06-20" })
    const pi = await stripe.paymentIntents.create({
      amount: 5000, // $50
      currency: "usd",
      payment_method_types: ["us_bank_account"],
      payment_method_options: {
        us_bank_account: {
          financial_connections: { permissions: ["payment_method"] }
        }
      },
      confirm: true,
      payment_method: "pm_usBankAccount", // special test pm
    })
    res.json({ id: pi.id, status: pi.status })
  } catch (err: any) {
    console.error("ACH PI error:", err?.message || err)
    res.status(400).json({ error: err?.message || "unknown" })
  }
})

// Start server
const PORT = Number(process.env.PORT || 4000);

// Test route to create a simple PaymentIntent (card only, no redirects)
app.post("/v1/test/payment_intent", async (_req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2024-06-20" })
    const pi = await stripe.paymentIntents.create({
      amount: 2000,
      currency: "usd",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      payment_method: "pm_card_visa",
      confirm: true
    })
    res.json({ id: pi.id, status: pi.status })
  } catch (err: any) {
    console.error("Create PI error:", err?.message || err)
    res.status(400).json({ error: err?.message || "unknown" })
  }
})

// Get PaymentIntent status by id (used by the chat to poll)
app.get("/v1/test/payment_intent/:id", async (req: Request, res: Response) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2024-06-20" })
    const pi = await stripe.paymentIntents.retrieve(req.params.id)
    res.json({
      id: pi.id,
      status: pi.status,
      latest_charge: typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? null),
      next_action: (pi as any).next_action ?? null
    })
  } catch (err: any) {
    res.status(404).json({ error: err?.message || "not found" })
  }
})

// ---- Demo-only in-memory maintenance tickets ----
// (Removed duplicate Ticket type, in-memory ticket store, and related routes to fix redeclaration error)

// --- Discount helpers (1% non-stacking, 3 days) ---
function computeDiscountCents(rentCents: number, autopayEnabledAtISO?: string, paidAtISO?: string, dueDateISO?: string) {
  if (!rentCents || !dueDateISO) return { discount: 0, reason: "missing_inputs" }
  const ms3d = 3 * 24 * 60 * 60 * 1000
  const due = new Date(dueDateISO).getTime()

  const paidAt = paidAtISO ? new Date(paidAtISO).getTime() : Date.now()
  const autopayAt = autopayEnabledAtISO ? new Date(autopayEnabledAtISO).getTime() : undefined

  const qualifiesEarly = paidAt <= (due - ms3d)
  const qualifiesAutopay = !!autopayAt && autopayAt <= (due - ms3d)

  const qualifies = qualifiesEarly || qualifiesAutopay
  const discount = qualifies ? Math.floor(rentCents * 0.01) : 0

  let reason: "none" | "early" | "autopay" = "none"
  if (discount > 0) reason = qualifiesEarly ? "early" : "autopay"

  return { discount, reason }
}

// Pay rent (card) with incentive logic.
// Body: { rentCents: number, dueDateISO: string, autopayEnabledAtISO?: string, simulatePaidAtISO?: string }
app.post("/v1/payments/rent_intent", async (req: Request, res: Response) => {
  try {
    const rentCents = Number(req.body?.rentCents || 0)
    const dueDateISO = String(req.body?.dueDateISO || "")
    const autopayEnabledAtISO = req.body?.autopayEnabledAtISO ? String(req.body.autopayEnabledAtISO) : undefined
    const simulatePaidAtISO = req.body?.simulatePaidAtISO ? String(req.body.simulatePaidAtISO) : undefined

    if (!rentCents || !dueDateISO) {
      return res.status(400).json({ error: "rentCents and dueDateISO are required" })
    }

    const { discount, reason } = computeDiscountCents(rentCents, autopayEnabledAtISO, simulatePaidAtISO, dueDateISO)
    const amount = Math.max(0, rentCents - discount)

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2024-06-20" })
    const pi = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      // Keep card here for simplicity; ACH version can be added similarly
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      payment_method: "pm_card_visa",
      confirm: true,
    })

    return res.json({
      payment_intent_id: pi.id,
      status: pi.status,
      receipt: {
        rentCents,
        discountCents: discount,
        discountReason: reason,          // "early" | "autopay" | "none"
        totalCents: amount,
        dueDateISO,
        autopayEnabledAtISO: autopayEnabledAtISO || null,
        paidAtISO: simulatePaidAtISO || new Date().toISOString(),
      }
    })
  } catch (err: any) {
    console.error("rent_intent error:", err?.message || err)
    return res.status(400).json({ error: err?.message || "unknown" })
  }
})

// ---- Overdue helper (grace = 3 days) ----
function computeOverdue(dueDateISO: string, graceDays = 3) {
  const due = new Date(dueDateISO).getTime()
  if (Number.isNaN(due)) return { ok: false, error: "invalid_dueDateISO" }

  const graceMs = graceDays * 24 * 60 * 60 * 1000
  const cutoff = due + graceMs
  const now = Date.now()

  const isOverdue = now > cutoff
  const daysPastDue = isOverdue ? Math.floor((now - cutoff) / (24 * 60 * 60 * 1000)) + 1 : 0

  return { ok: true, isOverdue, daysPastDue, cutoffISO: new Date(cutoff).toISOString() }
}

// Check overdue status and return safe, neutral message templates
// Body: { dueDateISO: string, amountCents: number, graceDays?: number }
app.post("/v1/overdue/check", express.json(), (req: Request, res: Response) => {
  const amountCents = Number(req.body?.amountCents || 0)
  const dueDateISO = String(req.body?.dueDateISO || "")
  const graceDays = Number(req.body?.graceDays ?? 3)

  if (!amountCents || !dueDateISO) {
    return res.status(400).json({ error: "amountCents and dueDateISO are required" })
  }

  const r = computeOverdue(dueDateISO, graceDays)
  if (!r.ok) return res.status(400).json({ error: r.error })

  // Friendly, non-threatening copy (not debt collection; avoids legal advice)
  const amount = `$${(amountCents / 100).toFixed(2)}`
  const templates = {
    reminder: `Friendly reminder: ${amount} for this month’s rent appears open. Would you like a link to pay now or set up autopay?`,
    planOffer: `If helpful, we can set up a one-time plan for this month. Let me know what works and I’ll pass it along.`,
    statusCheck: `Checking in on rent for this month. If you’ve already paid, thank you—please ignore this note and feel free to send the receipt.`,
    lateFeeInfo: `Heads up: the lease mentions a late fee after the grace period. If you’d like details, I can share the exact clause.`,
  }

  res.json({
    isOverdue: r.isOverdue,
    daysPastDue: r.daysPastDue,
    cutoffISO: r.cutoffISO,
    amountCents,
    messages: templates
  })
})

// Simple in-memory ticket store (clears on server restart)
// Simple in-memory ticket store (clears on server restart)
// Removed duplicate tickets array and related routes to avoid redeclaration error.

// ===== In-memory tickets (resets on server restart) =====
type Ticket = {
  id: string
  summary: string
  status: "new" | "acknowledged" | "scheduled" | "in_progress" | "waiting" | "completed" | "reopened"
  assigned?: string
  eta?: string // e.g., "Tue Oct 14, 2–4 pm"
  createdAt: string
  updatedAt: string
}
const tickets: Ticket[] = []

// Create ticket
app.post("/v1/tickets", (req, res) => {
  const summary = (req.body?.summary || "").trim()
  if (!summary) return res.status(400).json({ error: "summary required" })
  const now = new Date().toISOString()
  const t: Ticket = {
    id: `T-${Date.now()}`,
    summary,
    status: "new",
    createdAt: now,
    updatedAt: now,
  }
  tickets.push(t)
  res.json(t)
})

// List tickets (latest last)
app.get("/v1/tickets", (_req, res) => {
  res.json(tickets)
})

// Advance ticket status (demo-friendly)
// body: { action: "ack" | "schedule" | "start" | "wait" | "complete" | "reopen", assigned?: string, eta?: string }
app.post("/v1/tickets/:id/advance", (req, res) => {
  const t = tickets.find(x => x.id === req.params.id)
  if (!t) return res.status(404).json({ error: "ticket not found" })
  const { action, assigned, eta } = req.body || {}
  const now = new Date().toISOString()

  switch (action) {
    case "ack":
      t.status = "acknowledged"
      break
    case "schedule":
      t.status = "scheduled"
      if (assigned) t.assigned = assigned
      if (eta) t.eta = eta
      break
    case "start":
      t.status = "in_progress"
      break
    case "wait":
      t.status = "waiting"
      break
    case "complete":
      t.status = "completed"
      break
    case "reopen":
      t.status = "reopened"
      break
    default:
      return res.status(400).json({ error: "unknown action" })
  }
  t.updatedAt = now
  res.json(t)
})



app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});


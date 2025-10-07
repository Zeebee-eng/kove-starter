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
type TicketStage = "New" | "Acknowledged" | "Scheduled" | "In_Progress" | "Completed"
type Ticket = {
  id: string
  summary: string
  stage: TicketStage
  createdAt: string
  events: { at: string; note: string; stage: TicketStage }[]
}

const tickets: Record<string, Ticket> = {}
function tid() { return Math.random().toString(36).slice(2, 10) }
function now() { return new Date().toISOString() }

const nextStage: Record<TicketStage, TicketStage> = {
  New: "Acknowledged",
  Acknowledged: "Scheduled",
  Scheduled: "In_Progress",
  In_Progress: "Completed",
  Completed: "Completed",
}

// Create a maintenance ticket
app.post("/v1/tickets", express.json(), (req: Request, res: Response) => {
  const summary = String(req.body?.summary || "").trim()
  if (!summary) return res.status(400).json({ error: "summary required" })
  const id = tid()
  const ticket: Ticket = {
    id, summary, stage: "New", createdAt: now(),
    events: [{ at: now(), note: "Ticket created", stage: "New" }],
  }
  tickets[id] = ticket
  res.json(ticket)
})


app.get("/v1/tickets/:id", (_req: Request, res: Response) => {
  const t = tickets[_req.params.id]
  if (!t) return res.status(404).json({ error: "not found" })
  res.json(t)
})


app.post("/v1/tickets/:id/advance", (_req: Request, res: Response) => {
  const t = tickets[_req.params.id]
  if (!t) return res.status(404).json({ error: "not found" })
  const next = nextStage[t.stage]
  if (next === t.stage) return res.json(t) // already Completed
  t.stage = next
  t.events.push({ at: now(), note: `Moved to ${next}`, stage: next })
  res.json(t)
})

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


app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});


import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import Stripe from "stripe";

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
import { raw } from "express";
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

// Start server
const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});

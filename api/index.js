require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const Stripe = require('stripe')

// Create app
const app = express()

// IMPORTANT: do NOT use express.json() on the webhook route.
// We'll add raw body only for Stripe webhook below.

// Safe to use JSON for all other routes:
app.use((req, res, next) => {
  if (req.path === '/v1/stripe/webhook') return next()
  express.json()(req, res, next)
})

app.use(cors({ origin: true, credentials: true }))
app.use(cookieParser())

// Health check
app.get('/v1/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

// Stripe webhook: raw body required
const { raw } = require('express')
app.post('/v1/stripe/webhook', raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
    const sig = req.headers['stripe-signature']
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET

    const event = stripe.webhooks.constructEvent(req.body, sig, whSecret)

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object
      console.log('PI succeeded:', pi.id)
    }
    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object
      console.log('PI failed:', pi.id)
    }

    return res.status(200).json({ received: true })
  } catch (err) {
    console.error('Webhook error:', err?.message || err)
    return res.status(400).send(`Webhook Error: ${err?.message || 'unknown'}`)
  }
})

// Test route to create a simple PaymentIntent (card only, no redirects)
app.post('/v1/test/payment_intent', async (_req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
    const pi = await stripe.paymentIntents.create({
      amount: 2000,
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      payment_method: 'pm_card_visa',
      confirm: true,
    })
    res.json({ id: pi.id, status: pi.status })
  } catch (err) {
    console.error('Create PI error:', err?.message || err)
    res.status(400).json({ error: err?.message || 'unknown' })
  }
})

// Test route to create an ACH PaymentIntent (test-mode)
app.post('/v1/test/payment_intent_ach', async (_req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
    const pi = await stripe.paymentIntents.create({
      amount: 5000, // $50
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      payment_method_options: {
        us_bank_account: { financial_connections: { permissions: ['payment_method'] } },
      },
      confirm: true,
      payment_method: 'pm_usBankAccount', // special test pm
    })
    res.json({ id: pi.id, status: pi.status })
  } catch (err) {
    console.error('ACH PI error:', err?.message || err)
    res.status(400).json({ error: err?.message || 'unknown' })
  }
})

const PORT = Number(process.env.PORT || 4000)
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`)
})

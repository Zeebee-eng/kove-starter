import React, { useEffect, useMemo, useRef, useState } from "react"
import axios from "axios"

function dollars(cents: number) { return `$${(cents/100).toFixed(2)}` }

const API = import.meta.env.VITE_API_URL

type Msg = { id: string; role: "assistant" | "user"; text: string }
function uid() { return Math.random().toString(36).slice(2) }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export default function App() {
  const [showDiscountForm, setShowDiscountForm] = useState(false)
  const [rent, setRent] = useState(200000) // $2000.00 default
  const [dueISO, setDueISO] = useState(() => {
  const d = new Date()
  d.setMonth(d.getMonth(), 1) // set to 1st of this month
  if (d.getTime() < Date.now()) d.setMonth(d.getMonth() + 1, 1) // next month if past
  d.setHours(9,0,0,0)
  return d.toISOString()
})
  const [autopayOn, setAutopayOn] = useState(false)
  const [simulateEarly, setSimulateEarly] = useState(false)

  const [health, setHealth] = useState<string>("checking…")
  const [messages, setMessages] = useState<Msg[]>([
    { id: uid(), role: "assistant", text: "Hi! Choose an action: pay rent (card/ACH) or submit a maintenance request." }
  ])
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState("")
  const [currentTicketId, setCurrentTicketId] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  async function payCardWithDiscount() {
  if (busy) return; setBusy(true)
  setShowDiscountForm(false)

  // Narrate in chat
  push("user", "Pay rent (Card) — with discount")
  push("assistant", "Calculating incentive and creating PaymentIntent…")

  try {
    // If simulating early pay, pick a paidAt 4 days before due date
    const body: any = {
      rentCents: rent,
      dueDateISO: dueISO,
    }
    if (autopayOn) body.autopayEnabledAtISO = new Date(new Date(dueISO).getTime() - 5*24*60*60*1000).toISOString()
    if (simulateEarly) body.simulatePaidAtISO = new Date(new Date(dueISO).getTime() - 4*24*60*60*1000).toISOString()

    const res = await axios.post(`${API}/v1/payments/rent_intent`, body)
    const { payment_intent_id, status, receipt } = res.data

    // Pretty receipt
    const lines = [
      `Rent: ${dollars(receipt.rentCents)}`,
      receipt.discountCents > 0 ? `Discount (1% ${receipt.discountReason}): -${dollars(receipt.discountCents)}` : `Discount: ${dollars(0)}`,
      `Total charged: ${dollars(receipt.totalCents)}`,
      `Due date: ${new Date(receipt.dueDateISO).toLocaleString()}`
    ]
    push("assistant", `Receipt for ${payment_intent_id}\n` + lines.join("\n"))
    if (payment_intent_id) await pollPI(payment_intent_id)
  } catch (e: any) {
    push("assistant", `Could not create rent payment: ${e?.response?.data?.error || e.message}`)
  } finally {
    setBusy(false)
  }
}


  const styles = useMemo(() => ({
    wrap: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", padding: 16 } as React.CSSProperties,
    header: { marginBottom: 12 } as React.CSSProperties,
    chat: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, maxWidth: 720, minHeight: 420 } as React.CSSProperties,
    row: (role: "assistant"|"user") => ({ display: "flex", justifyContent: role === "user" ? "flex-end" : "flex-start", margin: "6px 0" }) as React.CSSProperties,
    bubble: (role: "assistant"|"user") => ({ border: "1px solid #ddd", background: role === "assistant" ? "#fff" : "#f5f5f5", padding: "8px 12px", borderRadius: 16, maxWidth: "75%" }) as React.CSSProperties,
    chips: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 } as React.CSSProperties,
    chip: { padding: "8px 12px", border: "1px solid #ddd", borderRadius: 999, background: "#fff", cursor: "pointer" } as React.CSSProperties,
    muted: { color: "#666", fontSize: 13 } as React.CSSProperties,
    composer: { display: "flex", gap: 8, marginTop: 10 } as React.CSSProperties,
    input: { flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px" } as React.CSSProperties,
    btn: { padding: "10px 14px", border: "1px solid #ddd", borderRadius: 8, background: "#fff" } as React.CSSProperties,
  }), [])

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API}/v1/health`)
        setHealth(JSON.stringify(res.data))
      } catch { setHealth("cannot reach API") }
    })()
  }, [])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [messages])

  function push(role: "assistant" | "user", text: string) {
    setMessages(m => [...m, { id: uid(), role, text }])
  }

  async function pollPI(piId: string) {
    const max = 20, delay = 1500
    for (let i = 0; i < max; i++) {
      await sleep(delay)
      try {
        const { data } = await axios.get(`${API}/v1/test/payment_intent/${piId}`)
        if (data?.status === "succeeded") { push("assistant", `✅ Payment succeeded (${piId}).`); return }
        if (data?.status === "requires_payment_method") { push("assistant", `❌ Needs a different method (${piId}).`); return }
        if (data?.status === "canceled") { push("assistant", `❌ Payment canceled (${piId}).`); return }
      } catch (e: any) { push("assistant", `Could not check status: ${e?.response?.data?.error || e.message}`); return }
    }
    push("assistant", `⏳ Still processing (${piId}). Check Stripe for final status.`)
  }

  async function payCard() {
    if (busy) return; setBusy(true)
    push("user", "Pay rent (Card)")
    push("assistant", "Creating a test card payment…")
    try {
      const res = await axios.post(`${API}/v1/test/payment_intent`, {})
      const { id, status } = res.data || {}
      push("assistant", `Stripe created PaymentIntent ${id} (status: ${status}).`)
      if (id) await pollPI(id)
    } catch (e: any) { push("assistant", `Could not create card payment: ${e?.response?.data?.error || e.message}`) }
    finally { setBusy(false) }
  }

  async function payAch() {
    if (busy) return; setBusy(true)
    push("user", "Pay rent (ACH)")
    push("assistant", "Creating a test ACH payment…")
    try {
      const res = await axios.post(`${API}/v1/test/payment_intent_ach`, {})
      const { id, status } = res.data || {}
      push("assistant", `Stripe created PaymentIntent ${id} (status: ${status}).`)
      if (id) await pollPI(id)
    } catch (e: any) { push("assistant", `Could not create ACH payment: ${e?.response?.data?.error || e.message}`) }
    finally { setBusy(false) }
  }

  // Maintenance flow
  function startMaintenance() {
    if (busy) return
    push("user", "Submit maintenance")
    push("assistant", "What’s the issue? Type a short description (e.g., “sink leaking under the cabinet”). Then press Send.")
    setCurrentTicketId(null)
  }

  async function submitText() {
    const text = input.trim()
    if (!text) return
    setInput("")
    push("user", text)

    // If we’re collecting a maintenance description, create a ticket
    if (!currentTicketId && text.length > 0) {
      try {
        const r = await axios.post(`${API}/v1/tickets`, { summary: text })
        const t = r.data
        setCurrentTicketId(t.id)
        push("assistant", `Ticket created: ${t.id}. Stage: ${t.stage}. I’ll keep you updated here.`)
        push("assistant", "Landlord actions: click ‘Next status’ to simulate progress.")
      } catch (e: any) {
        push("assistant", `Could not create ticket: ${e?.response?.data?.error || e.message}`)
      }
    }
  }

  async function nextStatus() {
    if (!currentTicketId) { push("assistant", "No active ticket to advance."); return }
    try {
      const r = await axios.post(`${API}/v1/tickets/${currentTicketId}/advance`)
      const t = r.data
      push("assistant", `Ticket ${t.id} is now **${t.stage}**.`)
      if (t.stage === "Completed") push("assistant", "✅ Resolved. If it isn’t fixed, say “Reopen” (we can add that action later).")
    } catch (e: any) {
      push("assistant", `Advance failed: ${e?.response?.data?.error || e.message}`)
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <h2 style={{ margin: 0 }}>Kove — chat demo</h2>
        <div style={styles.muted}>API: {API}</div>
        <div style={styles.muted}>Health: {health}</div>
      </div>

      <div ref={chatRef} style={styles.chat}>
        {messages.map(m => (
          <div key={m.id} style={styles.row(m.role)}>
            <div style={styles.bubble(m.role)}>{m.text}</div>
          </div>
        ))}

        <div style={styles.chips}>
          <button style={styles.chip as any} onClick={() => setShowDiscountForm(v => !v)} disabled={busy}>
  Pay rent (Card) — with discount </button>
          <button style={styles.chip as any} onClick={payCard} disabled={busy}>Pay rent (Card)</button>
          <button style={styles.chip as any} onClick={payAch} disabled={busy}>Pay rent (ACH)</button>
          <button style={styles.chip as any} onClick={startMaintenance} disabled={busy}>Submit maintenance</button>
          <button style={styles.chip as any} onClick={nextStatus} disabled={busy || !currentTicketId}>Next status</button>
        </div>

        {showDiscountForm && (
  <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginTop: 10 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <label>Rent (cents):
        <input type="number" value={rent} onChange={e => setRent(Number(e.target.value || 0))} style={{ marginLeft: 6, width: 140 }} />
      </label>
      <label>Due (ISO):
        <input type="text" value={dueISO} onChange={e => setDueISO(e.target.value)} style={{ marginLeft: 6, width: 320 }} />
      </label>
      <label><input type="checkbox" checked={autopayOn} onChange={e => setAutopayOn(e.target.checked)} /> Autopay enabled ≥3 days before due</label>
      <label><input type="checkbox" checked={simulateEarly} onChange={e => setSimulateEarly(e.target.checked)} /> Simulate early pay (≥3 days)</label>
      <button style={styles.chip as any} onClick={payCardWithDiscount} disabled={busy}>Submit</button>
    </div>
    <div style={{ marginTop: 6, color: "#666", fontSize: 13 }}>
      Rule: 1% off if autopay is enabled ≥3 days before due <i>or</i> you pay ≥3 days before due. No stacking. (We simulate “paid at” and “autopay enabled at” for demo.)
    </div>
  </div>
)}

      </div>

      <div style={styles.composer}>
        <input
          placeholder="Type a message (use this to describe the issue)…"
          style={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submitText() }}
        />
        <button style={styles.btn as any} onClick={submitText}>Send</button>
      </div>
    </div>
  )
}

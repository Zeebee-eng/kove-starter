import * as React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import axios from "axios"
import { useAuth0 } from "@auth0/auth0-react"


const API = import.meta.env.VITE_API_URL

type Msg = { id: string; role: "assistant" | "user"; text: string }
type Role = "tenant" | "landlord"

function uid() { return Math.random().toString(36).slice(2) }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function dollars(cents: number) { return `$${(cents / 100).toFixed(2)}` }

export default function App() {
  // ---- Lease “thread” context (demo constants you can change) ----
  const [address] = useState("123 Main St")
  const [unit] = useState("12B")

  // these already power payments/overdue logic
  const [rent, setRent] = useState(200000) // $2,000.00
  const [dueISO, setDueISO] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth(), 1) // 1st of this month
    if (d.getTime() < Date.now()) d.setMonth(d.getMonth() + 1, 1) // or next month
    d.setHours(9, 0, 0, 0)
    return d.toISOString()
  })

  // role toggle (persist locally so refresh keeps it)
  const [role, setRole] = useState<Role>(() => (localStorage.getItem("kove_role") as Role) || "tenant")
  useEffect(() => { localStorage.setItem("kove_role", role) }, [role])

  // health + chat
  const [health, setHealth] = useState<string>("checking…")
  const [messages, setMessages] = useState<Msg[]>([
    { id: uid(), role: "assistant", text: "Welcome to your lease thread. Choose an action below." }
  ])
  const [busy, setBusy] = useState(false)
  const { isAuthenticated, user, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0()
  const [input, setInput] = useState("")
  const [currentTicketId, setCurrentTicketId] = useState<string | null>(null)
  const [showDiscountForm, setShowDiscountForm] = useState(false)
  const [autopayOn, setAutopayOn] = useState(false)
  const [simulateEarly, setSimulateEarly] = useState(false)

  const chatRef = useRef<HTMLDivElement>(null)

  // ---- styles ----
  const styles = useMemo(() => ({
    page: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", padding: 16 } as React.CSSProperties,
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 } as React.CSSProperties,
    title: { fontSize: 16, margin: 0 },
    sub: { fontSize: 12, color: "#666", marginTop: 2 },
    dueChip: { border: "1px solid #ddd", borderRadius: 999, padding: "6px 10px", fontSize: 13, background: "#fff" } as React.CSSProperties,
    roleToggle: { display: "flex", gap: 8 } as React.CSSProperties,
    roleBtn: (active: boolean) => ({ padding: "6px 10px", borderRadius: 999, border: "1px solid #ddd", background: active ? "#f5f5f5" : "#fff", cursor: "pointer", fontSize: 13 }) as React.CSSProperties,
    chat: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, maxWidth: 760, minHeight: 440 } as React.CSSProperties,
    row: (r: "assistant" | "user") => ({ display: "flex", justifyContent: r === "user" ? "flex-end" : "flex-start", margin: "6px 0" }) as React.CSSProperties,
    bubble: (r: "assistant" | "user") => ({ border: "1px solid #ddd", background: r === "assistant" ? "#fff" : "#f5f5f5", padding: "8px 12px", borderRadius: 16, maxWidth: "75%" }) as React.CSSProperties,
    chips: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 } as React.CSSProperties,
    chip: { padding: "8px 12px", border: "1px solid #ddd", borderRadius: 999, background: "#fff", cursor: "pointer" } as React.CSSProperties,
    composer: { display: "flex", gap: 8, marginTop: 10, maxWidth: 760 } as React.CSSProperties,
    input: { flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px" } as React.CSSProperties,
    btn: { padding: "10px 14px", border: "1px solid #ddd", borderRadius: 8, background: "#fff" } as React.CSSProperties,
    muted: { color: "#666", fontSize: 13 } as React.CSSProperties,
  }), [])

  // ---- derived: due chip (days to due / past due) ----
  const dueChipText = useMemo(() => {
    const due = new Date(dueISO).getTime()
    const now = Date.now()
    const dayMs = 86400000
    const delta = Math.floor((due - now) / dayMs)
    if (delta > 0) return `Rent ${dollars(rent)} due in ${delta} day(s)`
    if (delta === 0) return `Rent ${dollars(rent)} due today`
    return `Rent ${dollars(rent)} was due ${Math.abs(delta)} day(s) ago`
  }, [rent, dueISO])

  // ---- health & scroll ----
  useEffect(() => {
    (async () => {
      try { const res = await axios.get(`${API}/v1/health`); setHealth(JSON.stringify(res.data)) }
      catch { setHealth("cannot reach API") }
    })()
  }, [])
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }) }, [messages])

  // ---- chat helpers ----
  function push(role: "assistant" | "user", text: string) {
    setMessages(m => [...m, { id: uid(), role, text }])
  }

  // ---- poll PI ----
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

  // ---- payments (card / ach / discount) ----
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

  async function payCardWithDiscount() {
    if (busy) return; setBusy(true)
    setShowDiscountForm(false)
    push("user", "Pay rent (Card) — with discount")
    push("assistant", "Calculating incentive and creating PaymentIntent…")
    try {
      const body: any = { rentCents: rent, dueDateISO: dueISO }
      if (autopayOn) body.autopayEnabledAtISO = new Date(new Date(dueISO).getTime() - 5 * 86400000).toISOString()
      if (simulateEarly) body.simulatePaidAtISO = new Date(new Date(dueISO).getTime() - 4 * 86400000).toISOString()
      const res = await axios.post(`${API}/v1/payments/rent_intent`, body)
      const { payment_intent_id, status, receipt } = res.data
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
    } finally { setBusy(false) }
  }

  // ---- maintenance (create + advance) ----
  function startMaintenance() {
    if (busy) return
    setCurrentTicketId(null)
    push("user", "Submit maintenance")
    push("assistant", "What’s the issue? Type a short description, then press Send.")
  }

  async function nextStatus() {
    if (!currentTicketId) { push("assistant", "No active ticket to advance."); return }
    try {
      const r = await axios.post(`${API}/v1/tickets/${currentTicketId}/advance`)
      const t = r.data
      push("assistant", `Ticket ${t.id} is now **${t.stage}**.`)
      if (t.stage === "Completed") push("assistant", "✅ Resolved. If it isn’t fixed, say “Reopen” (add later).")
    } catch (e: any) {
      push("assistant", `Advance failed: ${e?.response?.data?.error || e.message}`)
    }
  }

  // text submit (used for maintenance description)
  async function submitText() {
    const text = input.trim()
    if (!text) return
    setInput("")
    push("user", text)
    if (!currentTicketId) {
      try {
        const r = await axios.post(`${API}/v1/tickets`, { summary: text })
        const t = r.data
        setCurrentTicketId(t.id)
        push("assistant", `Ticket created: ${t.id}. Stage: ${t.stage}. I’ll keep you updated here.`)
        if (role === "landlord") push("assistant", "You can click ‘Next status’ to simulate progress.")
      } catch (e: any) {
        push("assistant", `Could not create ticket: ${e?.response?.data?.error || e.message}`)
      }
    }
  }

  // ---- landlord private overdue alert ----
  async function checkOverduePrivate() {
    if (busy) return; setBusy(true)
    push("user", "Check overdue (private)")
    push("assistant", "Reviewing status…")
    try {
      const body = { amountCents: rent, dueDateISO: dueISO, graceDays: 3 }
      const { data } = await axios.post(`${API}/v1/overdue/check`, body)
      if (!data.isOverdue) {
        push("assistant", `🔒 Not overdue. Grace ends ${new Date(data.cutoffISO).toLocaleString()}.`)
      } else {
        push("assistant",
          [
            `🔒 Private alert (landlord)`,
            `• Amount: ${dollars(data.amountCents)}`,
            `• Overdue by: ${data.daysPastDue} day(s) after grace`,
            `Suggested messages:`,
            `1) ${data.messages.reminder}`,
            `2) ${data.messages.planOffer}`,
            `3) ${data.messages.statusCheck}`,
            `4) ${data.messages.lateFeeInfo}`
          ].join("\n")
        )
      }
    } catch (e: any) {
      push("assistant", `Overdue check failed: ${e?.response?.data?.error || e.message}`)
    } finally { setBusy(false) }
  }

  // ---- render ----
  return (
    <div style={styles.page}>
      {/* Header = lease thread identity */}
      <div style={styles.header}>
        <div>
          <h3 style={styles.title as any}>{address}{unit ? `, ${unit}` : ""}</h3>
          <div style={styles.sub as any}>
            Health: {health}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={styles.dueChip}>{dueChipText}</div>
          <div style={styles.roleToggle}>
            <button style={styles.roleBtn(role === "tenant")} onClick={() => setRole("tenant")}>Tenant view</button>
            <button style={styles.roleBtn(role === "landlord")} onClick={() => setRole("landlord")}>Landlord view</button>
          </div>
        </div>
      </div>

      <div ref={chatRef} style={styles.chat}>
        {messages.map(m => (
          <div key={m.id} style={styles.row(m.role)}>
            <div style={styles.bubble(m.role)}>{m.text}</div>
          </div>
        ))}

        {/* Actions filtered by role */}
        <div style={styles.chips}>
          {role === "tenant" && (
            <>
              <button style={styles.chip as any} onClick={payCard} disabled={busy}>Pay rent (Card)</button>
              <button style={styles.chip as any} onClick={payAch} disabled={busy}>Pay rent (ACH)</button>
              <button style={styles.chip as any} onClick={() => setShowDiscountForm(v => !v)} disabled={busy}>Pay rent (Card) — with discount</button>
              <button style={styles.chip as any} onClick={startMaintenance} disabled={busy}>Submit maintenance</button>
            </>
          )}

          {role === "landlord" && (
            <>
              <button style={styles.chip as any} onClick={checkOverduePrivate} disabled={busy}>Check overdue (private)</button>
              <button style={styles.chip as any} onClick={nextStatus} disabled={busy || !currentTicketId}>Next status</button>
            </>
          )}
        </div>

        {/* Discount form (tenant) */}
        {role === "tenant" && showDiscountForm && (
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
              Rule: 1% off if autopay is enabled ≥3 days before due <i>or</i> you pay ≥3 days before due. No stacking.
            </div>
          </div>
        )}
      </div>

      {/* Composer for free text (used by maintenance) */}
      <div style={styles.composer}>
        <input
          placeholder={role === "tenant" ? "Describe the maintenance issue…" : "Type a note…"}
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

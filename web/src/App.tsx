import React, { useEffect, useMemo, useState } from "react"
import axios from "axios"

// Set on Vercel/locally via web/.env(.local): VITE_API_URL=https://YOUR-API.onrender.com
const API = import.meta.env.VITE_API_URL

type Msg = { id: string; role: "assistant" | "user"; text: string }

function uid() { return Math.random().toString(36).slice(2) }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export default function App() {
  const [health, setHealth] = useState<string>("checking…")
  const [messages, setMessages] = useState<Msg[]>([
    { id: uid(), role: "assistant", text: "Hi! I can help you pay rent or try an ACH test. Choose an action below." }
  ])
  const [busy, setBusy] = useState(false)

  // Minimal styles (kept inline for simplicity)
  const styles = useMemo(() => ({
    wrap: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", padding: 16 } as React.CSSProperties,
    header: { marginBottom: 12 } as React.CSSProperties,
    chat: { border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, maxWidth: 720, minHeight: 360 } as React.CSSProperties,
    row: (role: "assistant"|"user") => ({ display: "flex", justifyContent: role === "user" ? "flex-end" : "flex-start", margin: "6px 0" }) as React.CSSProperties,
    bubble: (role: "assistant"|"user") => ({
      border: "1px solid #ddd",
      background: role === "assistant" ? "#fff" : "#f5f5f5",
      padding: "8px 12px",
      borderRadius: 16,
      maxWidth: "75%"
    }) as React.CSSProperties,
    chips: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 } as React.CSSProperties,
    chip: { padding: "8px 12px", border: "1px solid #ddd", borderRadius: 999, background: "#fff", cursor: "pointer" } as React.CSSProperties,
    muted: { color: "#666", fontSize: 13 } as React.CSSProperties
  }), [])

  // Health check once
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API}/v1/health`)
        setHealth(JSON.stringify(res.data))
      } catch {
        setHealth("cannot reach API")
      }
    })()
  }, [])

  // Helper to append messages
  function push(role: "assistant" | "user", text: string) {
    setMessages(m => [...m, { id: uid(), role, text }])
  }

  // Poll a PaymentIntent until terminal or we time out
  async function pollStatus(piId: string) {
    const maxAttempts = 20
    const delayMs = 1500
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(delayMs)
      try {
        const { data } = await axios.get(`${API}/v1/test/payment_intent/${piId}`)
        if (data?.status === "succeeded") {
          push("assistant", `✅ Payment succeeded (id: ${piId}).`)
          return
        }
        if (data?.status === "requires_payment_method") {
          push("assistant", `❌ Payment needs a different method (id: ${piId}).`)
          return
        }
        if (data?.status === "canceled") {
          push("assistant", `❌ Payment canceled (id: ${piId}).`)
          return
        }
        // Otherwise still going (e.g., "processing") — keep polling
      } catch (e: any) {
        // If retrieve fails mid-poll, surface once and stop
        push("assistant", `Could not check status for ${piId}: ${e?.response?.data?.error || e.message}`)
        return
      }
    }
    push("assistant", `⏳ Payment still in progress (id: ${piId}). Check Stripe dashboard for final status.`)
  }

  async function payCard() {
    if (busy) return
    setBusy(true)
    push("user", "Pay rent (Card)")
    push("assistant", "Creating a test card payment…")
    try {
      const res = await axios.post(`${API}/v1/test/payment_intent`, {})
      const { id, status } = res.data || {}
      push("assistant", `Stripe created PaymentIntent ${id} (status: ${status}).`)
      if (id) await pollStatus(id)
    } catch (e: any) {
      push("assistant", `Could not create card payment: ${e?.response?.data?.error || e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function payAch() {
    if (busy) return
    setBusy(true)
    push("user", "Pay rent (ACH)")
    push("assistant", "Creating a test ACH payment…")
    try {
      const res = await axios.post(`${API}/v1/test/payment_intent_ach`, {})
      const { id, status } = res.data || {}
      push("assistant", `Stripe created PaymentIntent ${id} (status: ${status}).`)
      if (id) await pollStatus(id)
    } catch (e: any) {
      push("assistant", `Could not create ACH payment: ${e?.response?.data?.error || e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <h2 style={{ margin: 0 }}>Kove — chat demo</h2>
        <div style={styles.muted}>API: {API}</div>
        <div style={styles.muted}>Health: {health}</div>
      </div>

      <div style={styles.chat}>
        {messages.map(m => (
          <div key={m.id} style={styles.row(m.role)}>
            <div style={styles.bubble(m.role)}>{m.text}</div>
          </div>
        ))}

        <div style={styles.chips}>
          <button style={styles.chip as any} onClick={payCard} disabled={busy}>Pay rent (Card)</button>
          <button style={styles.chip as any} onClick={payAch} disabled={busy}>Pay rent (ACH)</button>
        </div>
      </div>
    </div>
  )
}

import React, { useEffect, useState } from "react"
import axios from "axios"

const API = import.meta.env.VITE_API_URL // set this in Vercel later

export default function App() {
  const [health, setHealth] = useState<string>("checking…")
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string>("")
  const [error, setError] = useState<string>("")

  useEffect(() => {
    async function run() {
      try {
        const res = await axios.get(`${API}/v1/health`)
        setHealth(JSON.stringify(res.data))
      } catch (e: any) {
        setHealth("cannot reach API")
      }
    }
    run()
  }, [])

  async function createTestPayment() {
    setSending(true)
    setError("")
    setResult("")
    try {
      const res = await axios.post(`${API}/v1/test/payment_intent`, {})
      setResult(JSON.stringify(res.data, null, 2))
    } catch (e: any) {
      setError(String(e?.response?.data || e.message))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card">
      <h2>Kove web demo</h2>
      <p className="muted">API: <span className="mono">{API}</span></p>
      <div className="row"><b>Health:</b> <span className="mono">{health}</span></div>
      <div style={{ height: 12 }} />
      <button onClick={createTestPayment} disabled={sending}>Create test PaymentIntent</button>
      <div style={{ height: 12 }} />
      {result && (
        <>
          <div><b>Response:</b></div>
          <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
        </>
      )}
      {error && (
        <>
          <div><b>Error:</b></div>
          <pre className="mono" style={{ whiteSpace: "pre-wrap", color: "crimson" }}>{error}</pre>
        </>
      )}
      <div style={{ height: 8 }} />
      <p className="muted">Clicking the button creates a test PaymentIntent with card and no redirects. Stripe then sends a webhook to your API.</p>
    </div>
  )
}

async function createTestAch() {
  setSending(true)
  setError("")
  setResult("")
  try {
    const res = await axios.post(`${API}/v1/test/payment_intent_ach`, {})
    setResult(JSON.stringify(res.data, null, 2))
  } catch (e: any) {
    setError(String(e?.response?.data || e.message))
  } finally {
    setSending(false)
  }
}

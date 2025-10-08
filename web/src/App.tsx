import * as React from "react"
import { useEffect, useState } from "react"
import axios from "axios"
import { useAuth0 } from "@auth0/auth0-react"
import { ChatShell, ChatMessage } from "./components/chatShell"
import { MaintenanceCard, Ticket } from "./components/MaintenanceCard"


const API = import.meta.env.VITE_API_URL

export default function App() {
  const { isAuthenticated, user, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0()

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "m1", role: "assistant" as "assistant", content: "Welcome to Kove. You can pay rent, submit maintenance, or check status here anytime." },
  ])
  const [health, setHealth] = useState<string>("checking…")
  const [busy, setBusy] = useState(false)
  const [ticket, setTicket] = useState<Ticket | null>(null)


  useEffect(() => {
    ;(async () => {
      try {
        const res = await axios.get(`${API}/v1/health`)
        setHealth(JSON.stringify(res.data))
      } catch {
        setHealth("cannot reach API")
      }
    })()
  }, [])

  function push(role: "user" | "assistant", content: string) {
  setMessages(prev => [...prev, { id: crypto.randomUUID(), role, content }])
}


  async function payRentACH() {
    try {
      setBusy(true)
      push("assistant", "Opening ACH payment…")
      const res = await axios.post(`${API}/v1/test/payment_intent_ach`, {})
      push("assistant", `Payment created: ${res.data.id}\nStatus: ${res.data.status}`)
    } catch (e: any) {
      push("assistant", `Payment error: ${String(e?.response?.data?.error || e.message)}`)
    } finally {
      setBusy(false)
    }
  }

  async function submitMaintenance() {
  const summary = prompt("Briefly describe the issue (e.g., 'Kitchen sink leaking')")
  if (!summary) return
  push("user", summary)
  try {
    const res = await axios.post(`${API}/v1/tickets`, { summary })
    setTicket(res.data as Ticket)
    push("assistant", `Ticket ${res.data.id} created.\nStatus: ${res.data.status}`)
  } catch (e: any) {
    push("assistant", `Ticket error: ${String(e?.response?.data?.error || e.message)}`)
  }
}



 async function checkStatus() {
  try {
    const res = await axios.get(`${API}/v1/tickets`)
    if (!res.data.length) {
      push("assistant", "No tickets found.")
      return
    }
    const latest = res.data[res.data.length - 1] as Ticket
    setTicket(latest)
    push("assistant", `Latest ticket ${latest.id}\nStatus: ${latest.status}`)
  } catch (e: any) {
    push("assistant", `Status error: ${String(e?.response?.data?.error || e.message)}`)
  }
}



  async function securePing() {
    try {
      setBusy(true)
      const token = await getAccessTokenSilently({ authorizationParams: { audience: import.meta.env.VITE_AUTH0_AUDIENCE } })
      const res = await axios.get(`${API}/v1/secure/ping`, { headers: { Authorization: `Bearer ${token}` } })
      push("assistant", `Secure ping ok for ${res.data.sub}`)
    } catch (e: any) {
      push("assistant", `Secure ping error: ${String(e?.response?.data?.error || e.message)}`)
    } finally {
      setBusy(false)
    }
  }

  const loginBar = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #eee" }}>
      <div style={{ fontSize: 12, color: "#666" }}>
        {isAuthenticated ? `Signed in as ${user?.email ?? "user"}` : "Not signed in"} | Health: {health}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {!isAuthenticated && (
          <button
            style={{ border: "1px solid #ddd", borderRadius: 8, padding: "6px 10px", background: "white", cursor: "pointer" }}
            onClick={() => loginWithRedirect()}
          >
            Log in
          </button>
        )}
        {isAuthenticated && (
          <>
            <button
              style={{ border: "1px solid #ddd", borderRadius: 8, padding: "6px 10px", background: "white", cursor: "pointer" }}
              onClick={securePing}
              disabled={busy}
            >
              Secure Ping
            </button>
            <button
              style={{ border: "1px solid #ddd", borderRadius: 8, padding: "6px 10px", background: "white", cursor: "pointer" }}
              onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
            >
              Log out
            </button>
          </>
        )}
      </div>
    </div>
  )

  const actions = [
    { key: "pay", label: "Pay rent (ACH)", onClick: payRentACH },
    { key: "maint", label: "Submit maintenance", onClick: submitMaintenance },
    { key: "status", label: "Check status", onClick: checkStatus },
  ]

  async function advance(action: "ack" | "schedule" | "start" | "wait" | "complete" | "reopen") {
  if (!ticket) return push("assistant", "No ticket yet. Submit a maintenance request first.")
  try {
    let payload: any = { action }
    if (action === "schedule") {
      payload.assigned = "Acme Plumbing"
      payload.eta = "Tue Oct 14, 2–4 pm"
    }
    const res = await axios.post(`${API}/v1/tickets/${ticket.id}/advance`, payload)
    setTicket(res.data as Ticket)
    push("assistant", `Ticket ${res.data.id} → ${res.data.status}`)
  } catch (e: any) {
    push("assistant", `Advance error: ${String(e?.response?.data?.error || e.message)}`)
  }
}

const landlordActions = [
  { key: "ack", label: "Ack", onClick: () => advance("ack") },
  { key: "schedule", label: "Schedule", onClick: () => advance("schedule") },
  { key: "start", label: "Start", onClick: () => advance("start") },
  { key: "wait", label: "Wait", onClick: () => advance("wait") },
  { key: "complete", label: "Complete", onClick: () => advance("complete") },
  { key: "reopen", label: "Reopen", onClick: () => advance("reopen") },
]


  function onSend(text: string) {
    push("user", text)
    push("assistant", "I’m here. You can tap a quick action above or ask a question about your lease.")
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {loginBar}
      <ChatShell
  ticket={ticket}
  messages={messages}                  // ✅ no fake system message
  actions={[...actions, ...landlordActions]}
  onSend={onSend}
/>

    </div>
  )
}

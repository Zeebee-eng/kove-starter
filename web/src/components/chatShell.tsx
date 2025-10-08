import * as React from "react"
import { useEffect, useRef } from "react"
import { MaintenanceCard } from "./MaintenanceCard"

export type ChatMessage = {
  id: string
  role: "assistant" | "user"  // ⬅ removed "system"
  content: string
}

type Action = { key: string; label: string; onClick: () => void }

export function ChatShell({
  messages,
  actions,
  onSend,
  headerAddress = "123 Main St, 12B",
  headerDue = "Rent due next 1st",
  // ✅ NEW: optional ticket prop
  ticket,
}: {
  messages: ChatMessage[]
  actions: Action[]
  onSend: (text: string) => void
  headerAddress?: string
  headerDue?: string
  ticket?: any // you can import the Ticket type here if you prefer
}) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo(0, scroller.current.scrollHeight)
  }, [messages, ticket])

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #eee" }}>
        <div>
          <div style={{ fontSize: 13, color: "#666" }}>{headerAddress}</div>
          <div style={{ fontSize: 12 }}>{headerDue}</div>
        </div>
        <button
          onClick={() => actions.find(a => a.key === "pay")?.onClick()}
          style={{ border: "1px solid #ddd", borderRadius: 10, padding: "8px 12px", background: "white", cursor: "pointer" }}
        >
          Pay rent
        </button>
      </div>

      {/* Messages + (optional) Maintenance card */}
      <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 8 }}>
        {/* ✅ NEW: show card at the top if a ticket exists */}
        {ticket && (
          <div style={{ marginBottom: 8 }}>
            <MaintenanceCard t={ticket} />
          </div>
        )}

        {messages.map(m => {
  if (m.role !== "user" && m.role !== "assistant") return null
  return (
    <div key={m.id} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
      <div
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 16,
          padding: "8px 12px",
          maxWidth: "75%",
          whiteSpace: "pre-wrap",
          background: m.role === "assistant" ? "#fafafa" : "white",
        }}
      >
        {m.content}
      </div>
    </div>
  )
})}
      </div>

      {/* Quick actions + composer */}
      <div style={{ padding: "8px 16px", borderTop: "1px solid #eee" }}>
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {actions.map((a) => (
              <button
                key={a.key}
                onClick={a.onClick}
                style={{ fontSize: 12, border: "1px solid #ddd", borderRadius: 999, padding: "6px 10px", background: "white", cursor: "pointer" }}
              >
                {a.label}
              </button>
            ))}
          </div>
          <form
            onSubmit={e => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              const text = String(fd.get("msg") || "").trim()
              if (text) onSend(text)
              ;(e.currentTarget as HTMLFormElement).reset()
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              name="msg"
              placeholder="Type a message"
              style={{ flex: 1, border: "1px solid #ddd", borderRadius: 10, padding: "10px 12px" }}
            />
            <button type="submit" style={{ border: "1px solid #ddd", borderRadius: 10, padding: "8px 14px", background: "white", cursor: "pointer" }}>
              Send
            </button>
          </form>
        </>
      </div>
    </div>
  )
}
function onSend(text: string) {
    // Example: Add the new message to the messages array (if using state)
    // This is a placeholder; actual implementation should update state in parent component.
    console.log("User sent message:", text)
}


import * as React from "react"

export type Ticket = {
  id: string
  summary: string
  status: "new" | "acknowledged" | "scheduled" | "in_progress" | "waiting" | "completed" | "reopened"
  assigned?: string
  eta?: string
  createdAt: string
  updatedAt: string
}

const statusCopy: Record<Ticket["status"], string> = {
  new: "New — we received your request.",
  acknowledged: "Acknowledged — a human has reviewed it.",
  scheduled: "Scheduled — visit window set.",
  in_progress: "In progress — tech on site.",
  waiting: "Waiting — parts on order or access needed.",
  completed: "Completed — tell us if it’s fixed.",
  reopened: "Reopened — we’re on it again.",
}

export function MaintenanceCard({ t }: { t: Ticket }) {
  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, background: "#fafafa" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Maintenance Ticket {t.id}</div>
      <div style={{ marginBottom: 6 }}>Summary: {t.summary}</div>
      <div style={{ marginBottom: 6 }}>
        <b>Status:</b> {readable(t.status)}
      </div>
      {t.assigned && <div style={{ marginBottom: 6 }}><b>Assigned:</b> {t.assigned}</div>}
      {t.eta && <div style={{ marginBottom: 6 }}><b>When:</b> {t.eta}</div>}
      <div style={{ fontSize: 12, color: "#666" }}>{statusCopy[t.status]}</div>
    </div>
  )
}

function readable(s: Ticket["status"]) {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
}

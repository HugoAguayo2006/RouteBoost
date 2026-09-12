import { useState, useEffect, useRef, useCallback } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type SimStatus = "idle" | "running" | "paused"
type Speed = 1 | 2 | 4
type OrderStatus = "pending" | "accepted" | "rejected" | "batched" | "completed"
type PanelTab = "orders" | "events" | "comparison"
type EventType = "surge" | "closure" | "traffic" | "rain"

interface Order {
  id: string
  pickup: string
  dropoff: string
  payout: number
  distance: number
  eta: number
  perKm: number
  perMin: number
  baseStatus: OrderStatus
  aiStatus: OrderStatus
  spawnTick: number
}

interface SimEvent {
  id: string
  type: EventType
  zone: string
  description: string
  aiResponse: string
  baseResponse: string
  spawnTick: number
}

interface AgentState {
  earnings: number
  deliveries: number
  distanceKm: number
  idleSec: number
  lat: number
  lng: number
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const ORDER_TEMPLATES: Omit<Order, "id" | "baseStatus" | "aiStatus" | "spawnTick">[] = [
  { pickup: "Centro Histórico",  dropoff: "Cumbres 4to Sector", payout: 94,  distance: 6.2, eta: 14, perKm: 15.2, perMin: 6.7 },
  { pickup: "Obispado",          dropoff: "San Nicolás Sur",    payout: 68,  distance: 4.8, eta: 11, perKm: 14.2, perMin: 6.2 },
  { pickup: "Valle Oriente",     dropoff: "Contry",             payout: 118, distance: 8.1, eta: 19, perKm: 14.6, perMin: 6.2 },
  { pickup: "Mitras Centro",     dropoff: "Tec de Monterrey",   payout: 54,  distance: 3.9, eta:  9, perKm: 13.8, perMin: 6.0 },
  { pickup: "Cumbres Elite",     dropoff: "Lincoln",            payout: 40,  distance: 3.1, eta:  8, perKm: 12.9, perMin: 5.0 },
  { pickup: "San Pedro Garza",   dropoff: "Centro",             payout: 86,  distance: 7.4, eta: 17, perKm: 11.6, perMin: 5.1 },
  { pickup: "Estadio BBVA",      dropoff: "Mitras Norte",       payout: 47,  distance: 3.6, eta: 10, perKm: 13.1, perMin: 4.7 },
  { pickup: "Escobedo Centro",   dropoff: "Obispado",           payout: 99,  distance: 9.2, eta: 21, perKm: 10.8, perMin: 4.7 },
  { pickup: "Tecnológico",       dropoff: "Valle Oriente",      payout: 76,  distance: 5.5, eta: 13, perKm: 13.8, perMin: 5.8 },
  { pickup: "Contry Country",    dropoff: "San Pedro Garza",    payout: 63,  distance: 4.3, eta: 10, perKm: 14.7, perMin: 6.3 },
  { pickup: "Roma",              dropoff: "Cumbres 7mo",        payout: 88,  distance: 5.9, eta: 13, perKm: 14.9, perMin: 6.8 },
  { pickup: "Chepevera",         dropoff: "Del Paseo",          payout: 55,  distance: 4.1, eta:  9, perKm: 13.4, perMin: 6.1 },
]

const EVENT_TEMPLATES: Omit<SimEvent, "id" | "spawnTick">[] = [
  { type: "surge",   zone: "Centro Histórico", description: "2.1× demand surge — nightlife rush",    aiResponse: "Rerouting toward zone",    baseResponse: "No action" },
  { type: "closure", zone: "Av. Constitución",  description: "Road closed — construction blockade",  aiResponse: "Alt route via Colón",      baseResponse: "Blocked +9 min" },
  { type: "traffic", zone: "Morones Prieto",    description: "Heavy congestion — avg 12 km/h",       aiResponse: "Avoids, saves 7 min",      baseResponse: "No action" },
  { type: "rain",    zone: "San Pedro",         description: "Moderate rain — demand +40%",           aiResponse: "Accepts 3 extra orders",   baseResponse: "No action" },
  { type: "surge",   zone: "Valle Oriente",     description: "1.8× surge — office hours end",        aiResponse: "Queues 2 orders nearby",   baseResponse: "No action" },
]

// ─── Monterrey street graph ───────────────────────────────────────────────────

const NODES: Record<string, [number, number]> = {
  centro:    [150, 105],
  obispado:  [120,  80],
  mitras:    [ 80,  72],
  cumbres:   [ 60,  45],
  lincoln:   [105,  45],
  tec:       [175,  75],
  valleO:    [225,  78],
  contry:    [220, 120],
  sanPedro:  [185, 145],
  estadio:   [135, 145],
  escobedo:  [ 68, 108],
  chepevera: [165, 108],
}

const STREETS: [string, string][] = [
  ["mitras","obispado"],["obispado","centro"],["centro","tec"],["tec","valleO"],
  ["cumbres","lincoln"],["lincoln","obispado"],["lincoln","tec"],
  ["mitras","escobedo"],["escobedo","centro"],["centro","estadio"],["estadio","contry"],
  ["contry","sanPedro"],["sanPedro","valleO"],["valleO","chepevera"],["chepevera","centro"],
  ["obispado","lincoln"],["lincoln","centro"],["tec","chepevera"],
]

function lerp(a: [number,number], b: [number,number], t: number): [number,number] {
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]
}

// ─── Baseline Map ─────────────────────────────────────────────────────────────

function BaselineMap({ tick }: { tick: number }) {
  const t = (tick % 60) / 60
  const cp = lerp(NODES.centro, NODES.estadio, t)

  return (
    <svg viewBox="0 0 300 210" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      {/* Page background */}
      <rect width="300" height="210" fill="#f0f2f7" />

      {/* Water */}
      <path d="M0,158 Q80,152 160,156 Q220,159 300,154" stroke="#c8d8f0" strokeWidth="5" fill="none" />

      {/* City block fills */}
      {[[52,30,40,38],[98,30,48,38],[152,30,40,38],[198,30,52,38],
        [52,74,40,42],[98,74,38,42],[142,74,42,42],[192,74,50,42],
        [52,122,40,30],[100,122,46,30],[152,122,40,30],[198,122,50,30]
      ].map(([x,y,w,h],i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="3" fill="#e8ecf4" stroke="#dce2ee" strokeWidth="0.8" />
      ))}

      {/* Park */}
      <ellipse cx="74" cy="58" rx="16" ry="12" fill="#d4edda" stroke="#b8ddc0" strokeWidth="1" />
      <ellipse cx="74" cy="58" rx="8"  ry="6"  fill="#c0e8ca" />

      {/* Streets — minor */}
      <g stroke="#dce2ee" strokeWidth="2" fill="none">
        {STREETS.map(([a,b],i) => {
          const p1=NODES[a], p2=NODES[b]
          return <line key={i} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />
        })}
      </g>

      {/* Streets — major arteries */}
      <g stroke="#cdd5e4" strokeWidth="4" fill="none" strokeLinecap="round">
        <line x1="0" y1="105" x2="300" y2="105" />
        <line x1="150" y1="0"   x2="150" y2="210" />
        <line x1="0" y1="72"  x2="300" y2="72" opacity="0.6" />
      </g>

      {/* Street labels */}
      <text x="155" y="102" fill="#b0bbd0" fontSize="6" fontFamily="Inter">Morones Prieto</text>
      <text x="153" y="62"  fill="#b0bbd0" fontSize="6" fontFamily="Inter">Av. Constitución</text>

      {/* Simple route */}
      <path
        d="M150,105 L135,145 L220,120"
        stroke="#a0aec0" strokeWidth="2.5" fill="none"
        strokeDasharray="6,4" strokeLinecap="round" strokeLinejoin="round"
      />

      {/* Pickup */}
      <g transform="translate(135,145)">
        <circle r="7" fill="white" stroke="#93aac8" strokeWidth="1.5" />
        <circle r="3" fill="#60a5fa" />
      </g>

      {/* Dropoff */}
      <g transform="translate(220,120)">
        <circle r="7" fill="white" stroke="#93aac8" strokeWidth="1.5" />
        <rect x="-2.5" y="-4" width="5" height="7" rx="1" fill="#818cf8" />
      </g>

      {/* Courier */}
      <g transform={`translate(${cp[0]},${cp[1]})`}>
        <circle r="10" fill="white" stroke="#b0bcd4" strokeWidth="1.5" />
        <circle r="5"  fill="#94a3b8" />
        <circle r="2"  fill="white" />
      </g>

      {/* Compass */}
      <text x="9" y="14" fill="#c8d0e0" fontSize="8" fontFamily="Inter" fontWeight="600">N↑</text>
      <text x="9" y="205" fill="#c8d0e0" fontSize="7" fontFamily="Inter">Monterrey, MX</text>
    </svg>
  )
}

// ─── AI Map ───────────────────────────────────────────────────────────────────

function AIMap({ events, tick }: { events: SimEvent[]; tick: number }) {
  const t  = (tick % 50) / 50
  const cp = lerp(NODES.obispado, NODES.valleO, t)
  const hasSurge   = events.some(e => e.type === "surge")
  const hasClosure = events.some(e => e.type === "closure")
  const hasTraffic = events.some(e => e.type === "traffic")
  const dashOff    = -(tick * 1.6) % 24

  return (
    <svg viewBox="0 0 300 210" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      {/* Page background — very slightly tinted to feel "smarter" */}
      <rect width="300" height="210" fill="#f0f4fb" />

      {/* Water */}
      <path d="M0,158 Q80,152 160,156 Q220,159 300,154" stroke="#b8ccec" strokeWidth="5" fill="none" />

      {/* City block fills */}
      {[[52,30,40,38],[98,30,48,38],[152,30,40,38],[198,30,52,38],
        [52,74,40,42],[98,74,38,42],[142,74,42,42],[192,74,50,42],
        [52,122,40,30],[100,122,46,30],[152,122,40,30],[198,122,50,30]
      ].map(([x,y,w,h],i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="3" fill="#e4eaf6" stroke="#d4ddf0" strokeWidth="0.8" />
      ))}

      {/* Park */}
      <ellipse cx="74" cy="58" rx="16" ry="12" fill="#d0edda" stroke="#aed8bc" strokeWidth="1" />
      <ellipse cx="74" cy="58" rx="8"  ry="6"  fill="#b8e4c6" />

      {/* Streets — minor */}
      <g stroke="#d4ddf0" strokeWidth="2" fill="none">
        {STREETS.map(([a,b],i) => {
          const p1=NODES[a], p2=NODES[b]
          return <line key={i} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />
        })}
      </g>

      {/* Streets — major arteries */}
      <g stroke="#c4cfe8" strokeWidth="4" fill="none" strokeLinecap="round">
        <line x1="0" y1="105" x2="300" y2="105" />
        <line x1="150" y1="0"   x2="150" y2="210" />
        <line x1="0" y1="72"  x2="300" y2="72" opacity="0.6" />
      </g>

      {/* Street labels */}
      <text x="155" y="102" fill="#a8b8d0" fontSize="6" fontFamily="Inter">Morones Prieto</text>
      <text x="153" y="62"  fill="#a8b8d0" fontSize="6" fontFamily="Inter">Av. Constitución</text>

      {/* Traffic overlay */}
      {hasTraffic && (
        <path d="M0,105 Q80,102 150,105" stroke="rgba(239,68,68,0.35)" strokeWidth="5" fill="none" strokeLinecap="round" />
      )}

      {/* Road closure */}
      {hasClosure && (
        <g transform="translate(150,72)">
          <circle r="11" fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.35)" strokeWidth="1.5" />
          <line x1="-6" y1="-6" x2="6"  y2="6"  stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="6"  y1="-6" x2="-6" y2="6"  stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      )}

      {/* Surge zones */}
      {hasSurge && (
        <>
          <circle cx="150" cy="105" r="32" fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.3)" strokeWidth="1.5" strokeDasharray="5,4">
            <animate attributeName="r" values="28;36;28" dur="2.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="225" cy="78" r="20" fill="rgba(245,158,11,0.06)" stroke="rgba(245,158,11,0.22)" strokeWidth="1.2" strokeDasharray="4,3">
            <animate attributeName="r" values="18;24;18" dur="3.2s" repeatCount="indefinite" />
          </circle>
          <text x="143" y="97"  fill="rgba(217,119,6,0.9)" fontSize="8"   fontFamily="Inter" fontWeight="700">2.1×</text>
          <text x="218" y="72"  fill="rgba(217,119,6,0.75)" fontSize="7.5" fontFamily="Inter" fontWeight="700">1.8×</text>
        </>
      )}

      {/* Alternative route (ghost) */}
      <path
        d="M120,80 L80,72 L68,108 L100,122 L150,105"
        stroke="rgba(14,165,233,0.2)" strokeWidth="2" fill="none"
        strokeDasharray="5,5" strokeLinecap="round"
      />

      {/* Primary optimized route — shadow */}
      <path
        d="M120,80 L150,75 L175,75 L225,78"
        stroke="rgba(14,165,233,0.18)" strokeWidth="5"
        fill="none" strokeLinecap="round" strokeLinejoin="round"
      />
      {/* Primary optimized route */}
      <path
        d="M120,80 L150,75 L175,75 L225,78"
        stroke="#0ea5e9" strokeWidth="3" fill="none"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.9"
      />
      {/* Animated dot flow */}
      <path
        d="M120,80 L150,75 L175,75 L225,78"
        stroke="white" strokeWidth="1.5" fill="none"
        strokeLinecap="round" strokeDasharray="6,18"
        strokeDashoffset={dashOff} opacity="0.7"
      />

      {/* Batch second leg */}
      <path
        d="M225,78 L220,120 L185,145"
        stroke="#0ea5e9" strokeWidth="2.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.6"
      />
      <path
        d="M225,78 L220,120 L185,145"
        stroke="white" strokeWidth="1.2" fill="none"
        strokeDasharray="5,16" strokeDashoffset={dashOff * 0.8} opacity="0.6"
      />

      {/* Waypoints */}
      <g transform="translate(225,78)">
        <circle r="8" fill="rgba(14,165,233,0.12)" stroke="rgba(14,165,233,0.5)" strokeWidth="1.5" />
        <circle r="3.5" fill="#0ea5e9" />
      </g>
      <g transform="translate(185,145)">
        <circle r="6.5" fill="rgba(14,165,233,0.1)" stroke="rgba(14,165,233,0.4)" strokeWidth="1.5" />
        <circle r="2.5" fill="#0ea5e9" opacity="0.8" />
      </g>

      {/* Pickup */}
      <g transform="translate(120,80)">
        <circle r="7" fill="white" stroke="rgba(14,165,233,0.5)" strokeWidth="1.5" />
        <circle r="3" fill="#0ea5e9" />
      </g>

      {/* AI Courier */}
      <g transform={`translate(${cp[0]},${cp[1]})`}>
        <circle r="16" fill="none" stroke="rgba(14,165,233,0.12)" strokeWidth="1">
          <animate attributeName="r" values="12;22;12" dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2.2s" repeatCount="indefinite" />
        </circle>
        <circle r="11" fill="rgba(14,165,233,0.12)" stroke="rgba(14,165,233,0.4)" strokeWidth="1.5" />
        <circle r="5.5" fill="#0ea5e9" />
        <circle r="2"   fill="white" />
      </g>

      {/* Compass / label */}
      <text x="9" y="14"  fill="#c4d0e8" fontSize="8" fontFamily="Inter" fontWeight="600">N↑</text>
      <text x="9" y="205" fill="#c4d0e8" fontSize="7" fontFamily="Inter">Monterrey, MX</text>
    </svg>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt$   = (n: number) => `$${n.toFixed(0)}`
const fmtKm  = (n: number) => `${n.toFixed(1)} km`

function statusChip(s: OrderStatus) {
  if (s === "accepted")  return "chip chip-green"
  if (s === "rejected")  return "chip chip-red"
  if (s === "batched")   return "chip chip-cyan"
  if (s === "completed") return "chip chip-slate"
  return "chip chip-amber"
}
function statusLabel(s: OrderStatus) {
  return { pending:"Pending", accepted:"Accepted", rejected:"Rejected", batched:"Batched", completed:"Done" }[s]
}
function evIcon(t: EventType) {
  return { surge:"⚡", closure:"🚧", traffic:"🚗", rain:"🌧" }[t]
}
function evChip(t: EventType) {
  return { surge:"chip chip-amber", closure:"chip chip-red", traffic:"chip chip-red", rain:"chip chip-blue" }[t]
}

// ─── App ──────────────────────────────────────────────────────────────────────

const SHIFT_SEC = 300

export default function App() {
  const [status,    setStatus]    = useState<SimStatus>("idle")
  const [speed,     setSpeed]     = useState<Speed>(1)
  const [tick,      setTick]      = useState(0)
  const [elapsed,   setElapsed]   = useState(0)
  const [tab,       setTab]       = useState<PanelTab>("orders")
  const [orders,    setOrders]    = useState<Order[]>([])
  const [events,    setEvents]    = useState<SimEvent[]>([])
  const [ticker,    setTicker]    = useState<string[]>([])
  const [showModal, setShowModal] = useState(false)

  const [base, setBase] = useState<AgentState>({ earnings:0, deliveries:0, distanceKm:0, idleSec:0, lat:25.686, lng:-100.316 })
  const [ai,   setAi]   = useState<AgentState>({ earnings:0, deliveries:0, distanceKm:0, idleSec:0, lat:25.690, lng:-100.310 })

  const tickRef     = useRef(0)
  const oIdxRef     = useRef(0)
  const eIdxRef     = useRef(0)
  const earnRef     = useRef({ base:0, ai:0 })
  const intervalRef = useRef<ReturnType<typeof setInterval>|null>(null)

  const pushTicker = useCallback((msg: string) => {
    setTicker(p => [msg,...p].slice(0,30))
  }, [])

  const simTick = useCallback(() => {
    tickRef.current++
    const t = tickRef.current
    setTick(t)

    setElapsed(prev => {
      if (prev+1 >= SHIFT_SEC) { setStatus("idle"); setShowModal(true); return prev }
      return prev+1
    })

    // Spawn order every 14 ticks
    if (t % 14 === 0 && oIdxRef.current < ORDER_TEMPLATES.length) {
      const tmpl = ORDER_TEMPLATES[oIdxRef.current++]
      const baseAcc = tmpl.perKm >= 13.0
      const aiAcc   = tmpl.perKm >= 10.5
      const aiBatch = tmpl.perKm >= 14.5 && oIdxRef.current % 3 !== 0
      const order: Order = {
        ...tmpl, spawnTick: t,
        id: `MTY-${String(oIdxRef.current).padStart(3,"0")}`,
        baseStatus: baseAcc ? "accepted" : "rejected",
        aiStatus:   aiBatch ? "batched" : aiAcc ? "accepted" : "rejected",
      }
      setOrders(p => [order,...p])
      if (!baseAcc && aiAcc)
        pushTicker(`AI accepted ${order.pickup} → ${order.dropoff} ($${tmpl.payout}) — Baseline rejected`)
      else if (aiBatch)
        pushTicker(`AI batched ${order.pickup} → ${order.dropoff} — batch bonus applied`)
    }

    // Spawn event every 45 ticks
    if (t % 45 === 0 && eIdxRef.current < EVENT_TEMPLATES.length) {
      const tmpl = EVENT_TEMPLATES[eIdxRef.current]
      eIdxRef.current++
      const ev: SimEvent = { ...tmpl, id:`EVT-${eIdxRef.current}`, spawnTick:t }
      setEvents(p => [ev,...p])
      pushTicker(`${evIcon(ev.type)} ${ev.zone}: ${ev.description}`)
    }

    // Earnings
    earnRef.current.base += 0.52 + Math.sin(t*0.06)*0.08
    earnRef.current.ai   += 0.91 + Math.sin(t*0.05+1)*0.13

    setBase(p => ({ ...p, earnings:earnRef.current.base, deliveries:Math.floor(t/52), distanceKm:p.distanceKm+0.09, idleSec:Math.floor(t*0.24) }))
    setAi  (p => ({ ...p, earnings:earnRef.current.ai,   deliveries:Math.floor(t/38), distanceKm:p.distanceKm+0.085, idleSec:Math.floor(t*0.08) }))
  }, [pushTicker])

  useEffect(() => {
    if (status === "running") {
      intervalRef.current = setInterval(simTick, 800/speed)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [status, speed, simTick])

  const doReset = (startAfter=false) => {
    setStatus("idle"); setElapsed(0); setTick(0)
    tickRef.current=0; oIdxRef.current=0; eIdxRef.current=0
    earnRef.current={base:0,ai:0}
    setOrders([]); setEvents([]); setTicker([]); setShowModal(false)
    setBase({ earnings:0,deliveries:0,distanceKm:0,idleSec:0,lat:25.686,lng:-100.316 })
    setAi  ({ earnings:0,deliveries:0,distanceKm:0,idleSec:0,lat:25.690,lng:-100.310 })
    if (startAfter) setTimeout(() => setStatus("running"), 50)
  }

  const handleStart = () => {
    if (status === "idle") doReset(false)
    setStatus(s => s === "running" ? "paused" : "running")
  }

  const extra    = ai.earnings - base.earnings
  const timeLeft = Math.max(0, SHIFT_SEC - elapsed)
  const minLeft  = Math.floor(timeLeft/60)
  const secLeft  = timeLeft % 60
  const progress = (elapsed/SHIFT_SEC)*100

  const aiPerKm   = ai.distanceKm   > 0 ? ai.earnings   / ai.distanceKm   : 0
  const basePerKm = base.distanceKm > 0 ? base.earnings / base.distanceKm : 0
  const batched   = orders.filter(o=>o.aiStatus==="batched").length
  const active    = orders.filter(o=>o.aiStatus==="accepted"||o.aiStatus==="batched").length

  const aiRec = events.length > 0
    ? events[0].type==="surge"   ? "Routing toward surge zone · batch queued · high $/km"
    : events[0].type==="closure" ? "Alt route active · avoiding closure · −9 min saved"
    : events[0].type==="traffic" ? "Avoiding Morones Prieto · parallel street active"
    : "Rain demand spike · accepting high-value orders · +40% rate"
    : "Optimizing order selection · maximizing $/km ratio"

  const aiLabel = batched > 0 ? `Accept batch (${batched} orders)` : "Accept next high-value order"

  const tickerText = ticker.length > 0
    ? [...ticker,...ticker].join("   ·   ")
    : "Simulation ready — press ▶ Start to begin   ·   Courier AI vs Baseline   ·   Monterrey shift comparison"

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden", background:"#f5f6f8", fontFamily:"'Inter',system-ui,sans-serif", color:"#1a2033" }}>

      {/* ═══ HEADER ═══════════════════════════════════════════════════════════ */}
      <header style={{
        display:"flex", alignItems:"center", gap:16, padding:"0 20px",
        height:60, flexShrink:0,
        background:"white",
        borderBottom:"1px solid #e8ecf4",
        boxShadow:"0 1px 0 #e8ecf4",
      }}>
        {/* Brand */}
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <div style={{
            width:30, height:30, borderRadius:8, flexShrink:0,
            background:"linear-gradient(135deg,#0284c7 0%,#0ea5e9 100%)",
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:"0 2px 8px rgba(14,165,233,0.3)",
          }}>
            <svg viewBox="0 0 16 16" width="17" height="17" fill="white">
              <path d="M8 1.5L2.5 4.5v5L8 12.5l5.5-3v-5L8 1.5zm0 1.8L12 5.5 8 7.5 4 5.5l4-2.2zM3.5 6.6l4 2.2v3.8l-4-2.2V6.6zm5 6v-3.8l4-2.2v3.8l-4 2.2z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:"#1a2033", letterSpacing:"-0.02em", lineHeight:1 }}>Courier AI Simulator</div>
            <div style={{ fontSize:9, color:"#94a3b8", fontWeight:500, letterSpacing:"0.06em", textTransform:"uppercase" }}>Monterrey, MX</div>
          </div>
        </div>

        <div style={{ width:1, height:32, background:"#e8ecf4", flexShrink:0 }} />

        {/* KPIs */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, justifyContent:"center" }}>

          {/* Hero KPI */}
          <div style={{
            display:"flex", flexDirection:"column", alignItems:"center",
            padding:"4px 18px", borderRadius:10,
            background: extra > 0 ? "#f0fdf8" : "#f8fafc",
            border: `1.5px solid ${extra > 0 ? "#6ee7b7" : "#e2e8f0"}`,
            boxShadow: extra > 0 ? "0 2px 12px rgba(16,185,129,0.12)" : "none",
            minWidth:128,
          }}>
            <span style={{ fontSize:9, fontWeight:600, color: extra>0 ? "#059669" : "#94a3b8", letterSpacing:"0.06em", textTransform:"uppercase" }}>Extra vs Baseline</span>
            <span style={{ fontSize:24, fontWeight:800, color: extra>0 ? "#059669" : "#94a3b8", lineHeight:1.1, letterSpacing:"-0.04em" }}>
              {extra>=0?"+":""}{fmt$(extra)}
            </span>
          </div>

          <div style={{ width:1, height:28, background:"#e8ecf4", margin:"0 4px" }} />

          <HeaderKpi label="Baseline"   value={fmt$(base.earnings)} color="#64748b" />
          <HeaderKpi label="Courier AI" value={fmt$(ai.earnings)}   color="#0ea5e9" />
          <HeaderKpi label="Deliveries" value={`${ai.deliveries}`}  color="#6366f1" />
          <HeaderKpi label="Active"     value={`${active}`}         color="#8b5cf6" />
          <HeaderKpi label="Time Left"  value={`${minLeft}:${String(secLeft).padStart(2,"0")}`} color="#f59e0b" />

          {/* Progress */}
          <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:4 }}>
            <div style={{ width:96, height:4, borderRadius:2, background:"#e8ecf4", overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${progress}%`, borderRadius:2, background:"linear-gradient(90deg,#0ea5e9,#6366f1)", transition:"width 0.8s ease" }} />
            </div>
            <span style={{ fontSize:9, color:"#94a3b8", fontWeight:500 }}>{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <button
            onClick={handleStart}
            style={{
              display:"flex", alignItems:"center", gap:5,
              padding:"6px 14px", borderRadius:8, border:"none", cursor:"pointer",
              fontSize:11, fontWeight:700,
              background: status==="running"
                ? "#fffbeb"
                : "linear-gradient(135deg,#0284c7,#0ea5e9)",
              color: status==="running" ? "#b45309" : "white",
              outline: status==="running" ? "1.5px solid #fde68a" : "none",
              boxShadow: status!=="running" ? "0 2px 8px rgba(14,165,233,0.3)" : "none",
            }}
          >
            <span style={{ fontSize:13 }}>{status==="running"?"⏸":"▶"}</span>
            {status==="running" ? "Pause" : status==="paused" ? "Resume" : "Start Simulation"}
          </button>

          <button
            onClick={() => doReset(true)}
            style={{ padding:"6px 11px", borderRadius:8, border:"1.5px solid #e2e8f0", background:"white", color:"#64748b", cursor:"pointer", fontSize:11, fontWeight:600 }}
          >
            ↺ Reset
          </button>

          <div style={{ display:"flex", borderRadius:8, overflow:"hidden", border:"1.5px solid #e2e8f0" }}>
            {([1,2,4] as Speed[]).map(s => (
              <button key={s} onClick={() => setSpeed(s)} style={{
                padding:"6px 10px", border:"none", cursor:"pointer",
                fontSize:10, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                background: speed===s ? "#eff6ff" : "white",
                color:      speed===s ? "#0ea5e9" : "#94a3b8",
                borderRight: s!==4 ? "1px solid #e2e8f0" : "none",
              }}>
                ×{s}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ═══ TICKER ════════════════════════════════════════════════════════════ */}
      <div style={{ height:24, flexShrink:0, display:"flex", alignItems:"center", overflow:"hidden", background:"#fafbfd", borderBottom:"1px solid #edf0f7" }}>
        <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:5, padding:"0 12px", height:"100%", borderRight:"1px solid #edf0f7" }}>
          <span style={{ width:6, height:6, borderRadius:"50%", background: status==="running" ? "#10b981" : "#d1d5db", animation: status==="running" ? "blink 1.4s ease-in-out infinite" : "none" }} />
          <span style={{ fontSize:9, fontWeight:700, color: status==="running" ? "#059669" : "#94a3b8", letterSpacing:"0.1em" }}>
            {status==="running"?"LIVE":status==="paused"?"PAUSED":"READY"}
          </span>
        </div>
        <div style={{ flex:1, overflow:"hidden" }}>
          <div className="anim-ticker" style={{ whiteSpace:"nowrap", fontSize:10, color:"#94a3b8", fontWeight:500, paddingLeft:14 }}>
            {tickerText}
          </div>
        </div>
      </div>

      {/* ═══ MAIN GRID ════════════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1.4fr 340px", overflow:"hidden", minHeight:0, gap:0 }}>

        {/* ── COL 1: BASELINE ───────────────────────────────────────────────── */}
        <div style={{ display:"flex", flexDirection:"column", borderRight:"1px solid #e8ecf4", overflow:"hidden", background:"white" }}>
          {/* Column header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 14px", flexShrink:0, borderBottom:"1px solid #f0f2f8", background:"#fafbfd" }}>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:"#cbd5e1" }} />
              <span style={{ fontSize:12, fontWeight:700, color:"#64748b" }}>Baseline</span>
              <span style={{ fontSize:9, padding:"1px 7px", borderRadius:4, background:"#f1f5f9", color:"#94a3b8", border:"1px solid #e2e8f0", fontWeight:500 }}>Simple logic</span>
            </div>
            <span style={{ fontSize:15, fontWeight:800, color:"#64748b", letterSpacing:"-0.03em", fontFamily:"'JetBrains Mono',monospace" }}>{fmt$(base.earnings)}</span>
          </div>

          {/* Map */}
          <div className="map-wrap" style={{ flex:1 }}>
            <BaselineMap tick={tick} />
            <div style={{ position:"absolute", bottom:8, left:10, display:"flex", flexDirection:"column", gap:4 }}>
              <MapLegend color="#a0aec0" label="Route" dashed />
              <MapLegend color="#94a3b8" label="Courier" dot />
              <MapLegend color="#60a5fa" label="Pickup"  dot />
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding:10, flexShrink:0, borderTop:"1px solid #f0f2f8", background:"#fafbfd" }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
              <Stat label="Earnings"   value={fmt$(base.earnings)}    color="#475569" />
              <Stat label="Distance"   value={fmtKm(base.distanceKm)} color="#475569" />
              <Stat label="Deliveries" value={`${base.deliveries}`}    color="#475569" />
              <Stat label="Idle time"  value={`${base.idleSec}s`}      color="#475569" />
            </div>
            <p style={{ fontSize:10, color:"#cbd5e1", lineHeight:1.5 }}>Accepts orders above minimum distance · no batching · no event awareness</p>
          </div>
        </div>

        {/* ── COL 2: AI MAP ─────────────────────────────────────────────────── */}
        <div style={{ display:"flex", flexDirection:"column", borderRight:"1px solid #e8ecf4", overflow:"hidden", position:"relative", background:"white" }}>
          {/* Winning badge */}
          {extra > 5 && (
            <div style={{
              position:"absolute", top:46, right:10, zIndex:10,
              padding:"3px 10px", borderRadius:999,
              background:"linear-gradient(135deg,#d97706,#fbbf24)",
              color:"white", fontSize:9, fontWeight:800, letterSpacing:"0.08em",
              boxShadow:"0 2px 12px rgba(245,158,11,0.35)",
            }}>
              ★ WINNING +{fmt$(extra)}
            </div>
          )}

          {/* Column header */}
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"9px 14px", flexShrink:0,
            borderBottom:"1.5px solid #bae6fd",
            background:"#f0f9ff",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <div style={{
                width:8, height:8, borderRadius:"50%", background:"#0ea5e9",
                boxShadow:"0 0 6px rgba(14,165,233,0.5)",
                animation: status==="running" ? "blink 1.8s ease-in-out infinite" : "none",
              }} />
              <span style={{ fontSize:12, fontWeight:700, color:"#0284c7" }}>Courier AI</span>
              <span style={{ fontSize:9, padding:"1px 7px", borderRadius:4, background:"#e0f2fe", color:"#0284c7", border:"1px solid #bae6fd", fontWeight:600 }}>Optimized</span>
              {events.length > 0 && (
                <span style={{ fontSize:9, padding:"1px 7px", borderRadius:4, background:"#fffbeb", color:"#d97706", border:"1px solid #fde68a", fontWeight:600 }}>
                  {evIcon(events[0].type)} {events[0].zone}
                </span>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {extra > 0 && <span style={{ fontSize:11, fontWeight:700, color:"#059669", fontFamily:"'JetBrains Mono',monospace" }}>+{fmt$(extra)}</span>}
              <span style={{ fontSize:15, fontWeight:800, color:"#0284c7", letterSpacing:"-0.03em", fontFamily:"'JetBrains Mono',monospace" }}>{fmt$(ai.earnings)}</span>
            </div>
          </div>

          {/* Map */}
          <div className="map-wrap" style={{ flex:1 }}>
            <AIMap events={events} tick={tick} />
            <div style={{ position:"absolute", bottom:8, left:10, display:"flex", flexDirection:"column", gap:4 }}>
              <MapLegend color="#0ea5e9" label="AI Route" />
              <MapLegend color="rgba(14,165,233,0.3)" label="Alt Route" dashed />
              {events.some(e=>e.type==="surge")   && <MapLegend color="#f59e0b" label="Surge Zone" ring />}
              {events.some(e=>e.type==="traffic") && <MapLegend color="#ef4444" label="Traffic"    solid />}
              {events.some(e=>e.type==="closure") && <MapLegend color="#ef4444" label="Closure"    x />}
            </div>
          </div>

          {/* Stats + reasoning */}
          <div style={{ padding:10, flexShrink:0, borderTop:"1.5px solid #bae6fd", background:"#f0f9ff" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:8 }}>
              <Stat label="Earnings"   value={fmt$(ai.earnings)}           color="#0284c7" accent />
              <Stat label="$/hr"       value={fmt$(ai.earnings*12)}        color="#0284c7" accent />
              <Stat label="$/km"       value={`$${aiPerKm.toFixed(1)}`}    color="#0284c7" accent />
              <Stat label="Deliveries" value={`${ai.deliveries}`}           color="#0284c7" accent />
            </div>
            <div style={{ borderRadius:8, padding:"8px 10px", background:"white", border:"1.5px solid #bae6fd", boxShadow:"0 1px 4px rgba(14,165,233,0.08)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:"#0ea5e9", flexShrink:0 }} />
                <span style={{ fontSize:10, fontWeight:700, color:"#0284c7" }}>Recommended: {aiLabel}</span>
              </div>
              <p style={{ fontSize:9.5, color:"#94a3b8", lineHeight:1.5 }}>Why: {aiRec}</p>
            </div>
          </div>
        </div>

        {/* ── COL 3: PANEL ──────────────────────────────────────────────────── */}
        <div style={{ display:"flex", flexDirection:"column", overflow:"hidden", background:"white" }}>
          {/* Tabs */}
          <div style={{ display:"flex", flexShrink:0, borderBottom:"1px solid #f0f2f8" }}>
            {(["orders","events","comparison"] as PanelTab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex:1, padding:"9px 4px", border:"none", cursor:"pointer",
                fontSize:10, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase",
                background: tab===t ? "#f0f9ff" : "white",
                color:      tab===t ? "#0284c7" : "#94a3b8",
                borderBottom: tab===t ? "2px solid #0ea5e9" : "2px solid transparent",
                transition:"all 0.15s",
              }}>
                {t==="orders" ? `Orders${orders.length>0?` (${orders.length})`:""}` : t==="events" ? `Events${events.length>0?` (${events.length})`:""}` : "Compare"}
              </button>
            ))}
          </div>

          <div className="scroll-pane" style={{ flex:1, padding:"10px", display:"flex", flexDirection:"column", gap:6 }}>

            {/* ORDERS */}
            {tab==="orders" && (
              <>
                {orders.length===0 && <EmptyState icon="📦" text="Orders appear when the simulation runs" />}
                {orders.map(o => (
                  <div key={o.id} className="anim-float" style={{ borderRadius:10, padding:"10px 11px", background:"#fafbfd", border:"1px solid #e8ecf4" }}>
                    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:6 }}>
                      <div>
                        <div style={{ fontSize:8.5, color:"#cbd5e1", fontFamily:"'JetBrains Mono',monospace", marginBottom:2 }}>{o.id}</div>
                        <div style={{ fontSize:11, fontWeight:600, color:"#1a2033", display:"flex", alignItems:"center", gap:4 }}>
                          <span style={{ color:"#0284c7" }}>{o.pickup}</span>
                          <span style={{ color:"#d1d5db" }}>→</span>
                          <span>{o.dropoff}</span>
                        </div>
                      </div>
                      <span style={{ fontSize:14, fontWeight:800, color:"#059669", fontFamily:"'JetBrains Mono',monospace" }}>${o.payout}</span>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:"3px 8px", marginBottom:7 }}>
                      <Kv k="Dist"  v={`${o.distance}km`} />
                      <Kv k="ETA"   v={`${o.eta}min`} />
                      <Kv k="$/km"  v={`$${o.perKm.toFixed(1)}`} />
                      <Kv k="$/min" v={`$${o.perMin.toFixed(1)}`} />
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ fontSize:9, color:"#cbd5e1", fontWeight:500 }}>Base:</span>
                      <span className={statusChip(o.baseStatus)}>{statusLabel(o.baseStatus)}</span>
                      <span style={{ fontSize:9, color:"#cbd5e1", fontWeight:500, marginLeft:4 }}>AI:</span>
                      <span className={statusChip(o.aiStatus)}>{statusLabel(o.aiStatus)}</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* EVENTS */}
            {tab==="events" && (
              <>
                {events.length===0 && <EmptyState icon="⚡" text="Events will appear during the simulation" />}
                {events.map(ev => (
                  <div key={ev.id} className="anim-float" style={{ borderRadius:10, padding:"10px 11px", background:"#fafbfd", border:"1px solid #e8ecf4" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6 }}>
                      <span style={{ fontSize:16 }}>{evIcon(ev.type)}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#1a2033" }}>{ev.zone}</div>
                        <div style={{ fontSize:9.5, color:"#94a3b8", marginTop:1 }}>{ev.description}</div>
                      </div>
                      <span className={evChip(ev.type)}>{ev.type}</span>
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <div style={{ flex:1, borderRadius:7, padding:"5px 8px", background:"#f0f9ff", border:"1px solid #bae6fd" }}>
                        <div style={{ fontSize:8.5, color:"#0284c7", fontWeight:700, marginBottom:2 }}>Courier AI</div>
                        <div style={{ fontSize:9, color:"#64748b" }}>{ev.aiResponse}</div>
                      </div>
                      <div style={{ flex:1, borderRadius:7, padding:"5px 8px", background:"#f8fafc", border:"1px solid #e2e8f0" }}>
                        <div style={{ fontSize:8.5, color:"#94a3b8", fontWeight:700, marginBottom:2 }}>Baseline</div>
                        <div style={{ fontSize:9, color:"#94a3b8" }}>{ev.baseResponse}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* COMPARISON */}
            {tab==="comparison" && (
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                <CmpRow label="Earnings"    bv={fmt$(base.earnings)}   av={fmt$(ai.earnings)}   aiW={ai.earnings>base.earnings} />
                <CmpRow label="Deliveries"  bv={`${base.deliveries}`}  av={`${ai.deliveries}`}  aiW={ai.deliveries>=base.deliveries} />
                <CmpRow label="$/km"        bv={`$${basePerKm.toFixed(2)}`} av={`$${aiPerKm.toFixed(2)}`} aiW />
                <CmpRow label="Idle time"   bv={`${base.idleSec}s`}    av={`${ai.idleSec}s`}    aiW={ai.idleSec<base.idleSec} />
                <CmpRow label="Distance"    bv={fmtKm(base.distanceKm)} av={fmtKm(ai.distanceKm)} aiW={ai.distanceKm<=base.distanceKm+0.5} />
                <CmpRow label="Accepted"    bv={`${orders.filter(o=>o.baseStatus==="accepted").length}`} av={`${orders.filter(o=>o.aiStatus==="accepted"||o.aiStatus==="batched").length}`} aiW />
                <CmpRow label="Batched"     bv="0"                     av={`${batched}`}         aiW />
                <CmpRow label="Events used" bv="0"                     av={`${events.length}`}   aiW />

                {/* Earnings bar */}
                <div style={{ borderRadius:10, padding:"10px 11px", background:"#fafbfd", border:"1px solid #e8ecf4", marginTop:4 }}>
                  <div style={{ fontSize:9.5, color:"#94a3b8", marginBottom:6, fontWeight:600 }}>Earnings Gap Over Time</div>
                  <div style={{ display:"flex", gap:3, alignItems:"flex-end", height:40 }}>
                    {Array.from({length:14},(_,i) => {
                      const r = Math.min(1,(i+1)/14)
                      const h = Math.max(4, r * 38)
                      return <div key={i} style={{ flex:1, borderRadius:3, background:`rgba(14,165,233,${0.12+r*0.55})`, height:h, transition:"height 0.5s ease" }} />
                    })}
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                    <span style={{ fontSize:8, color:"#cbd5e1" }}>Start</span>
                    <span style={{ fontSize:9, color:"#059669", fontWeight:700 }}>+{fmt$(extra)}</span>
                    <span style={{ fontSize:8, color:"#cbd5e1" }}>Now</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ SUMMARY MODAL ════════════════════════════════════════════════════ */}
      {showModal && (
        <div style={{ position:"absolute", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(248,250,252,0.88)", backdropFilter:"blur(10px)" }}>
          <div style={{ borderRadius:20, padding:"36px 36px 28px", maxWidth:440, width:"90%", background:"white", border:"1px solid #e0f2fe", boxShadow:"0 24px 60px rgba(14,165,233,0.12), 0 8px 24px rgba(0,0,0,0.06)" }}>
            <div style={{ textAlign:"center", marginBottom:24 }}>
              <div style={{ fontSize:40, marginBottom:8 }}>🏁</div>
              <h2 style={{ fontSize:20, fontWeight:800, color:"#1a2033", letterSpacing:"-0.03em", margin:0 }}>Shift Complete</h2>
              <p style={{ fontSize:12, color:"#94a3b8", marginTop:4 }}>Monterrey, MX — Full Courier Shift</p>
            </div>
            <div style={{ borderRadius:14, padding:"16px 20px", marginBottom:16, textAlign:"center", background:"#f0fdf8", border:"1.5px solid #a7f3d0" }}>
              <div style={{ fontSize:10, color:"#059669", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:4 }}>Courier AI Advantage</div>
              <div style={{ fontSize:36, fontWeight:900, color:"#059669", letterSpacing:"-0.05em", lineHeight:1 }}>+{fmt$(extra)}</div>
              <div style={{ fontSize:11, color:"#6ee7b7", marginTop:4 }}>{((extra/Math.max(base.earnings,1))*100).toFixed(0)}% more than baseline</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
              <div style={{ borderRadius:12, padding:"12px 14px", background:"#f8fafc", border:"1px solid #e2e8f0", textAlign:"center" }}>
                <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, marginBottom:4 }}>Baseline</div>
                <div style={{ fontSize:22, fontWeight:800, color:"#64748b", letterSpacing:"-0.04em" }}>{fmt$(base.earnings)}</div>
                <div style={{ fontSize:10, color:"#cbd5e1", marginTop:2 }}>{base.deliveries} deliveries</div>
              </div>
              <div style={{ borderRadius:12, padding:"12px 14px", background:"#f0f9ff", border:"1.5px solid #bae6fd", textAlign:"center" }}>
                <div style={{ fontSize:10, color:"#0284c7", fontWeight:600, marginBottom:4 }}>Courier AI</div>
                <div style={{ fontSize:22, fontWeight:800, color:"#0284c7", letterSpacing:"-0.04em" }}>{fmt$(ai.earnings)}</div>
                <div style={{ fontSize:10, color:"#7dd3fc", marginTop:2 }}>{ai.deliveries} deliveries</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => doReset(false)} style={{ flex:1, padding:10, borderRadius:10, border:"1.5px solid #e2e8f0", background:"white", color:"#64748b", cursor:"pointer", fontSize:12, fontWeight:700 }}>
                ↺ Reset
              </button>
              <button onClick={() => doReset(true)} style={{ flex:2, padding:10, borderRadius:10, border:"none", background:"linear-gradient(135deg,#0284c7,#0ea5e9)", color:"white", cursor:"pointer", fontSize:12, fontWeight:700, boxShadow:"0 4px 12px rgba(14,165,233,0.3)" }}>
                ▶ New Simulation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Small components ─────────────────────────────────────────────────────────

function HeaderKpi({ label, value, color }: { label:string; value:string; color:string }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", minWidth:52 }}>
      <span style={{ fontSize:9, color:"#cbd5e1", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:800, color, letterSpacing:"-0.02em", lineHeight:1.2, fontFamily:"'JetBrains Mono',monospace" }}>{value}</span>
    </div>
  )
}

function Stat({ label, value, color, accent }: { label:string; value:string; color:string; accent?:boolean }) {
  return (
    <div style={{ borderRadius:7, padding:"5px 8px", background: accent ? "#f0f9ff" : "#f8fafc", border:`1px solid ${accent?"#bae6fd":"#e2e8f0"}` }}>
      <div style={{ fontSize:9, color:"#cbd5e1", marginBottom:2, fontWeight:500 }}>{label}</div>
      <div style={{ fontSize:12, fontWeight:800, color, letterSpacing:"-0.02em", fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
    </div>
  )
}

function Kv({ k, v }: { k:string; v:string }) {
  return (
    <div style={{ display:"flex", flexDirection:"column" }}>
      <span style={{ fontSize:8, color:"#d1d5db", fontWeight:500 }}>{k}</span>
      <span style={{ fontSize:9.5, color:"#64748b", fontWeight:600, fontFamily:"'JetBrains Mono',monospace" }}>{v}</span>
    </div>
  )
}

function MapLegend({ color, label, dashed, dot, ring, solid, x }: { color:string; label:string; dashed?:boolean; dot?:boolean; ring?:boolean; solid?:boolean; x?:boolean }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
      {dot    ? <div style={{ width:7, height:7, borderRadius:"50%", background:color, boxShadow:`0 0 4px ${color}40` }} />
      : ring   ? <div style={{ width:8, height:8, borderRadius:"50%", border:`1.5px solid ${color}`, background:`${color}18` }} />
      : x      ? <span style={{ color, fontSize:9, lineHeight:1, fontWeight:700 }}>✕</span>
      : solid  ? <div style={{ width:13, height:3, borderRadius:2, background:color }} />
      : dashed ? <div style={{ width:13, height:0, borderTop:`2px dashed ${color}` }} />
      : <div style={{ width:13, height:2.5, borderRadius:2, background:color }} />}
      <span style={{ fontSize:8.5, color:"#94a3b8" }}>{label}</span>
    </div>
  )
}

function CmpRow({ label, bv, av, aiW }: { label:string; bv:string; av:string; aiW:boolean }) {
  return (
    <div style={{ borderRadius:8, overflow:"hidden", background:"#fafbfd", border:"1px solid #e8ecf4" }}>
      <div style={{ padding:"3px 10px", fontSize:9, fontWeight:600, color:"#cbd5e1", borderBottom:"1px solid #f0f2f8", textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr" }}>
        <div style={{ padding:"5px 10px", textAlign:"center", borderRight:"1px solid #f0f2f8" }}>
          <div style={{ fontSize:12, fontWeight:700, color: aiW ? "#d1d5db" : "#059669", fontFamily:"'JetBrains Mono',monospace" }}>{bv}</div>
        </div>
        <div style={{ padding:"5px 10px", textAlign:"center", background: aiW ? "#f0f9ff" : "transparent" }}>
          <div style={{ fontSize:12, fontWeight:700, color: aiW ? "#0284c7" : "#dc2626", fontFamily:"'JetBrains Mono',monospace" }}>
            {aiW && <span style={{ fontSize:9 }}>↑</span>}{av}
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ icon, text }: { icon:string; text:string }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:100, gap:8 }}>
      <span style={{ fontSize:28, opacity:0.2 }}>{icon}</span>
      <p style={{ fontSize:10, color:"#d1d5db", textAlign:"center" }}>{text}</p>
    </div>
  )
}

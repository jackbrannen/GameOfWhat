"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase"

const BG = "#6B1A44"
const YELLOW = "#FBDF54"
const WARM_LIGHT = "#821F42"

const WORDS_A_GOW = [
  "MAPLE","RIVER","OCEAN","SUNRISE","VELVET","COPPER","SILVER","EMBER","FOREST","CLOUD",
  "IVORY","SAPPHIRE","SPRING","SUMMER","WINTER","AUTUMN","MORNING","MIDNIGHT","ORCHID","LANTERN",
  "PINE","CEDAR","MEADOW","CANYON","HARBOR","ISLAND","VALLEY","MOUNTAIN","GARDEN","BREEZE",
  "COMET","ROCKET","MIRROR","CARPET","POCKET","BRIDGE","CANDLE","PILOT","CIRCUS","PARADE",
  "BLOSSOM","CORAL","PEBBLE","MARBLE","FROST","FLAME","SPARK","SHADOW","WONDER","GLIMMER",
  "HONEY","BUTTER","COOKIE","WAFFLE","MUFFIN","BAGEL","COCOA","LATTE","LEMON","MANGO",
  "PLUM","PEACH","BERRY","OLIVE","BASIL","PEPPER","GINGER","SUGAR","SALMON","TURKEY",
  "PANDA","TIGER","OTTER","EAGLE","FALCON","ROBIN","WHALE","DOLPHIN","KOALA","ZEBRA",
]

function splitCodeGOW(code) {
  for (const w of WORDS_A_GOW) {
    if (code.startsWith(w)) return [w, code.slice(w.length)]
  }
  return [code, ""]
}

function loadProfile() {
  try {
    const local = JSON.parse(localStorage.getItem("jackgames:profile") || "null")
    const match = document.cookie.match(/(?:^|;\s*)jackgames_profile=([^;]*)/)
    const cookie = match ? JSON.parse(decodeURIComponent(match[1])) : null
    const merged = { ...(local ?? {}) }
    for (const [k, v] of Object.entries(cookie ?? {})) { if (v) merged[k] = v }
    if (merged.firstName && merged.lastName) return merged
  } catch {}
  return null
}

function saveProfile(profile) {
  const json = JSON.stringify(profile)
  localStorage.setItem("jackgames:profile", json)
  document.cookie = `jackgames_profile=${encodeURIComponent(json)}; domain=.jackbrannen.com; max-age=31536000; path=/; SameSite=Lax`
}

const inputStyle = {
  background: WARM_LIGHT,
  color: "white",
  fontSize: 20,
  padding: "16px 18px",
  width: "100%",
  display: "block",
  border: "none",
  outline: "none",
  boxSizing: "border-box",
}

export default function Lobby({ params }) {
  const router = useRouter()
  const code = useMemo(() => params.code.toUpperCase(), [params.code])

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [myPlayerId, setMyPlayerId] = useState(null)
  const [savedProfile, setSavedProfile] = useState(null)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [username, setUsername] = useState("")
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState("")
  const [rounds, setRounds] = useState("3")
  const [notFound, setNotFound] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [confirmingStart, setConfirmingStart] = useState(false)
  const [starting, setStarting] = useState(false)
  const [instructions, setInstructions] = useState("")

  const me = players.find(p => p.id === myPlayerId)

  async function loadState() {
    const { data: gameData } = await supabase
      .from("gow_games")
      .select("code,phase,rounds_total,round_index")
      .eq("code", code)
      .single()

    if (!gameData) { setNotFound(true); return }

    const { data: playerData } = await supabase
      .from("gow_players")
      .select("id,name,score,created_at")
      .eq("game_code", code)
      .order("created_at", { ascending: true })

    setGame(gameData)
    setPlayers(playerData ?? [])
    setRounds(String(gameData.rounds_total ?? 3))
  }

  useEffect(() => {
    const existing = localStorage.getItem(`gow:${code}:playerId`)
    if (existing) setMyPlayerId(existing)
  }, [code])

  useEffect(() => {
    const saved = loadProfile()
    if (saved) {
      if (saved.username) saveProfile(saved)
      setSavedProfile(saved)
      setUsername(saved.username || "")
    }
  }, [])

  useEffect(() => {
    supabase.from("game_instructions").select("body").eq("game_key", "gameofwhat").single()
      .then(({ data }) => { if (data) setInstructions(data.body) })
  }, [])

  useEffect(() => {
    loadState()
    let poll = setInterval(loadState, 1500)
    function handleVisibility() { clearInterval(poll); if (!document.hidden) { loadState(); poll = setInterval(loadState, 1500) } }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", handleVisibility) }
  }, [code])

  useEffect(() => {
    if ((game?.phase === "play" || game?.phase === "between_rounds") && myPlayerId) router.replace(`/${code}/play`)
  }, [game?.phase, myPlayerId])

  async function join() {
    const trimmedUsername = username.trim()
    const trimmedFirst = (savedProfile?.firstName || firstName).trim()
    const trimmedLast = (savedProfile?.lastName || lastName).trim()
    if (!trimmedUsername || !trimmedFirst || !trimmedLast || joining) return
    setJoining(true)
    setJoinError("")
    const { data: existing } = await supabase
      .from("gow_players")
      .select("id")
      .eq("game_code", code)
      .ilike("name", trimmedUsername)
      .limit(1)
    if (existing?.length > 0) {
      setJoinError("That username is already taken in this game. Please choose another.")
      setJoining(false)
      return
    }
    const newProfile = { firstName: trimmedFirst, lastName: trimmedLast, username: trimmedUsername }
    saveProfile(newProfile)
    setSavedProfile(newProfile)
    const { data, error } = await supabase
      .from("gow_players")
      .insert({ game_code: code, name: trimmedUsername, first_name: trimmedFirst, last_name: trimmedLast, score: 0 })
      .select("id")
      .single()
    if (error) { alert("Failed to join: " + error.message); setJoining(false); return }
    localStorage.setItem(`gow:${code}:playerId`, data.id)
    setMyPlayerId(data.id)
    setJoining(false)
  }

  async function saveRounds(val) {
    const n = Math.max(1, Number(val) || 1)
    setRounds(String(n))
    await supabase.from("gow_games").update({ rounds_total: n }).eq("code", code)
  }

  async function startGame() {
    if (starting) return
    setStarting(true)
    const { error } = await supabase.rpc("gow_start_game", { p_code: code })
    if (error) { setStarting(false); return }
    await loadState()
  }

  if (notFound) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "white", fontSize: 22, fontWeight: 700 }}>Room not found.</p>
      </div>
    )
  }

  if (!game) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  if (game.phase !== "lobby" && !myPlayerId) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.5, marginBottom: 16, color: "white" }}>The Game of What</div>
        <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 12, letterSpacing: "-0.5px", color: "white" }}>A game is in progress.</h2>
        <p style={{ fontSize: 16, opacity: 0.65, fontWeight: 500, marginBottom: 32, color: "white" }}>This page will update automatically.</p>
        <button onClick={loadState} style={{ background: YELLOW, color: "#000", fontSize: 18, fontWeight: 900, padding: "18px 28px" }}>Join Lobby</button>
      </div>
    )
  }

  const canStart = players.length >= 4

  return (
    <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>

      {/* Header */}
      <div style={{ padding: "28px 24px 24px", background: "#4A123B", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.45, marginBottom: 4 }}>
            The Game of What
          </div>
          <div style={{ fontSize: "clamp(18px, 6vw, 38px)", fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, whiteSpace: "nowrap" }}>
            {(() => { const [w1, w2] = splitCodeGOW(code); return <><span style={{ color: YELLOW }}>{w1}</span><span style={{ color: "rgba(255,255,255,0.75)" }}>{w2}</span></> })()}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, marginTop: 4, alignItems: "stretch" }}>
          <button
            onClick={async () => {
              const url = window.location.href
              if (navigator.share) await navigator.share({ title: `Join Game of What — ${code}`, url })
              else { await navigator.clipboard.writeText(url); alert("Link copied!") }
            }}
            style={{ background: WARM_LIGHT, color: "white", fontSize: 13, fontWeight: 800, padding: "10px 16px" }}
          >
            Invite
          </button>
          <button
            onClick={() => setShowInstructions(true)}
            style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 13, fontWeight: 800, padding: "10px 14px" }}
          >
            How to Play
          </button>
        </div>
      </div>

      {/* Rounds selector */}
      <div style={{ padding: "16px 24px", background: "#5C1640", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: "white" }}>Number of Rounds:</span>
        <div style={{ display: "flex", gap: 6 }}>
          {[1,2,3,4,5].map(v => (
            <button
              key={v}
              onClick={() => saveRounds(v)}
              style={{
                background: Number(rounds) === v ? YELLOW : WARM_LIGHT,
                color: Number(rounds) === v ? "#000" : "white",
                fontSize: 18,
                fontWeight: 900,
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Start Game CTA */}
      {canStart && (
        <div style={{ padding: "20px 24px", background: YELLOW }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#000", opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>
            All players in?
          </div>
          <button
            onClick={() => setConfirmingStart(true)}
            disabled={starting}
            style={{ background: "#000", color: YELLOW, fontSize: 24, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
          >
            Start Game
          </button>
        </div>
      )}

      {/* Join */}
      {!me && (
        <div style={{ padding: "28px 24px 0" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 14 }}>
            Join Game
          </div>
          {!savedProfile && (
            <>
              <input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="First name"
                maxLength={40}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Last name"
                maxLength={40}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
            </>
          )}
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === "Enter" && join()}
            placeholder="Display Name"
            maxLength={40}
            style={inputStyle}
          />
          <button
            onClick={join}
            disabled={!username.trim() || (!savedProfile && (!firstName.trim() || !lastName.trim())) || joining}
            style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", marginTop: 8, display: "block" }}
          >
            {joining ? "Joining…" : "Join"}
          </button>
          {joinError && (
            <div style={{ fontSize: 14, fontWeight: 700, color: "#F04F52", marginTop: 10 }}>
              {joinError}
            </div>
          )}
        </div>
      )}

      {/* Players */}
      <div style={{ padding: "28px 24px 0" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 14 }}>
          Players
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {players.length === 0 && (
            <div style={{ fontSize: 15, opacity: 0.65, fontStyle: "italic", padding: "12px 0" }}>No players yet</div>
          )}
          {players.map((p, i) => (
            <div key={p.id} style={{ display: "flex" }}>
              <div style={{
                padding: "13px 0", minWidth: 48, flexShrink: 0,
                background: "#4A123B",
                fontSize: 18, fontWeight: 900, color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {i + 1}
              </div>
              <div style={{
                padding: "13px 16px", flex: 1,
                background: "#5C1640",
                display: "flex", alignItems: "center",
              }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>
                  {p.name}
                  {p.id === myPlayerId && <span style={{ fontSize: 12, opacity: 0.65, marginLeft: 6 }}>you</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
        {players.length < 4 && (
          <p style={{ fontSize: 13, opacity: 0.65, fontWeight: 600, marginTop: 10 }}>
            Need at least 4 players to start.
          </p>
        )}
      </div>

      {showInstructions && (
        <div
          onClick={() => setShowInstructions(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflowY: "auto" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "#1A1A2E", width: "100%", maxWidth: 480, padding: "28px 24px", marginTop: 24 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: "white" }}>How to Play</div>
              <button onClick={() => setShowInstructions(false)} style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 18, fontWeight: 800, padding: "6px 12px" }}>✕</button>
            </div>
            <div style={{ fontSize: 15, color: "rgba(255,255,255,0.85)", lineHeight: 1.7, fontWeight: 400, whiteSpace: "pre-wrap" }}>
              {instructions || "Loading…"}
            </div>
          </div>
        </div>
      )}

      {confirmingStart && (
        <div
          onClick={() => setConfirmingStart(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, zIndex: 100,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "#4A123B", width: "100%", maxWidth: 400, padding: "28px 24px" }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 900, color: "white", marginBottom: 8 }}>
              Start the game?
            </h2>
            <p style={{ fontSize: 15, color: "white", opacity: 0.75, fontWeight: 600, marginBottom: 20 }}>
              This will begin for everyone. Are all players in?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 24 }}>
              {players.map((p, i) => (
                <div key={p.id} style={{ display: "flex" }}>
                  <div style={{
                    padding: "10px 0", minWidth: 40, flexShrink: 0,
                    background: "#5C1640",
                    fontSize: 15, fontWeight: 900, color: "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {i + 1}
                  </div>
                  <div style={{
                    padding: "10px 14px", flex: 1,
                    background: WARM_LIGHT,
                    display: "flex", alignItems: "center",
                  }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "white" }}>
                      {p.name}
                      {p.id === myPlayerId && <span style={{ fontSize: 12, opacity: 0.65, marginLeft: 6 }}>you</span>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setConfirmingStart(false)}
                style={{ flex: 1, background: WARM_LIGHT, color: "white", fontSize: 17, fontWeight: 800, padding: "16px" }}
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmingStart(false); startGame() }}
                disabled={starting}
                style={{ flex: 2, background: "#FBDF54", color: "#000", fontSize: 17, fontWeight: 900, padding: "16px" }}
              >
                {starting ? "Starting…" : "Start Game"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

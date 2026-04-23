"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase"

const BG = "#1a1a2e"
const YELLOW = "#FBDF54"

function loadProfile() {
  try {
    const local = JSON.parse(localStorage.getItem("jackgames:profile") || "null")
    if (local?.firstName && local?.lastName) return local
    const match = document.cookie.match(/(?:^|;\s*)jackgames_profile=([^;]*)/)
    if (match) return JSON.parse(decodeURIComponent(match[1]))
  } catch {}
  return null
}

function saveProfile(profile) {
  const json = JSON.stringify(profile)
  localStorage.setItem("jackgames:profile", json)
  document.cookie = `jackgames_profile=${encodeURIComponent(json)}; domain=.jackbrannen.com; max-age=31536000; path=/; SameSite=Lax`
}

const inputStyle = {
  background: "rgba(255,255,255,0.15)",
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
      saveProfile(saved)
      setSavedProfile(saved)
      setUsername(saved.username || "")
    }
  }, [])

  useEffect(() => {
    loadState()
    const poll = setInterval(loadState, 1500)
    return () => clearInterval(poll)
  }, [code])

  useEffect(() => {
    if (game?.phase === "play" || game?.phase === "between_rounds") router.replace(`/${code}/play`)
  }, [game?.phase])

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
    await supabase.rpc("gow_start_game", { p_code: code })
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
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  const canStart = players.length >= 4

  return (
    <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>

      {/* Header */}
      <div style={{ padding: "28px 24px 24px", background: "rgba(0,0,0,0.3)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.45, marginBottom: 4 }}>
            The Game of What
          </div>
          <div style={{ fontSize: "clamp(18px, 6vw, 38px)", fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, whiteSpace: "nowrap" }}>
            {code}
          </div>
        </div>
        <button
          onClick={async () => {
            const url = window.location.href
            if (navigator.share) await navigator.share({ title: `Join Game of What — ${code}`, url })
            else { await navigator.clipboard.writeText(url); alert("Link copied!") }
          }}
          style={{ background: "rgba(255,255,255,0.12)", color: "white", fontSize: 13, fontWeight: 800, padding: "10px 16px", flexShrink: 0, marginTop: 4 }}
        >
          Invite
        </button>
      </div>

      {/* Rounds selector */}
      <div style={{ padding: "16px 24px", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: "white" }}>Number of Rounds:</span>
        <div style={{ display: "flex", gap: 6 }}>
          {[1,2,3,4,5].map(v => (
            <button
              key={v}
              onClick={() => saveRounds(v)}
              style={{
                background: Number(rounds) === v ? YELLOW : "rgba(255,255,255,0.15)",
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
            onClick={startGame}
            style={{ background: "#000", color: YELLOW, fontSize: 24, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
          >
            Start Game
          </button>
        </div>
      )}

      {/* Join */}
      {!me && (
        <div style={{ padding: "28px 24px 0" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
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
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
          Players
        </div>
        <div style={{ background: "rgba(0,0,0,0.28)", padding: "4px 14px 10px", borderTop: "3px solid rgba(255,255,255,0.30)" }}>
          {players.length === 0 && (
            <div style={{ fontSize: 14, opacity: 0.4, fontStyle: "italic", paddingTop: 10 }}>No players yet</div>
          )}
          {players.map(p => (
            <div key={p.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>
                {p.name}
                {p.id === myPlayerId && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.45, marginLeft: 6 }}>you</span>}
              </span>
            </div>
          ))}
        </div>
        {players.length < 4 && (
          <p style={{ fontSize: 13, opacity: 0.4, fontWeight: 600, marginTop: 10 }}>
            Need at least 4 players to start.
          </p>
        )}
      </div>

    </div>
  )
}

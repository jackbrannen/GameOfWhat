"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase"

const BG = "#1a1a2e"
const YELLOW = "#FBDF54"
const GREEN = "#12BAAA"
const RED = "#F04F52"


const inputStyle = {
  background: "rgba(255,255,255,0.1)",
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
  const [name, setName] = useState("")
  const [joining, setJoining] = useState(false)
  const [question, setQuestion] = useState("")
  const [submittingQuestion, setSubmittingQuestion] = useState(false)
  const [rounds, setRounds] = useState("3")
  const [notFound, setNotFound] = useState(false)

  const me = players.find(p => p.id === myPlayerId)
  const myQuestion = players.find(p => p.id === myPlayerId)?.question ?? ""

  async function loadState() {
    const { data: gameData } = await supabase
      .from("gow_games")
      .select("code,phase,rounds_total,round_index")
      .eq("code", code)
      .single()

    if (!gameData) { setNotFound(true); return }

    const { data: playerData } = await supabase
      .from("gow_players")
      .select("id,name,score,question,created_at")
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
    loadState()
    const poll = setInterval(loadState, 1500)
    return () => clearInterval(poll)
  }, [code])

  // Redirect to play once game starts
  useEffect(() => {
    if (game?.phase === "play") router.replace(`/${code}/play`)
  }, [game?.phase])

  async function join() {
    const trimmed = name.trim()
    if (!trimmed || joining) return
    setJoining(true)
    const { data, error } = await supabase
      .from("gow_players")
      .insert({ game_code: code, name: trimmed, score: 0 })
      .select("id")
      .single()
    if (error) { alert("Failed to join: " + error.message); setJoining(false); return }
    localStorage.setItem(`gow:${code}:playerId`, data.id)
    setMyPlayerId(data.id)
    setJoining(false)
  }

  async function submitQuestion() {
    const trimmed = question.trim()
    if (!trimmed || submittingQuestion || !me) return
    setSubmittingQuestion(true)
    await supabase.from("gow_players").update({ question: trimmed }).eq("id", me.id)
    setSubmittingQuestion(false)
    setQuestion("")
    await loadState()
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

  const allQuestionsIn = players.length >= 4 && players.every(p => p.question)
  const myQuestionSubmitted = !!me?.question

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

      {/* Rounds selector — always visible */}
      <div style={{ padding: "16px 24px", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: "white" }}>Rounds</span>
        <div style={{ display: "flex", gap: 6 }}>
          {[1,2,3,4,5].map(v => (
            <button
              key={v}
              onClick={() => saveRounds(v)}
              style={{
                background: Number(rounds) === v ? YELLOW : "rgba(255,255,255,0.1)",
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
      {allQuestionsIn && !showSettings && (
        <div style={{ padding: "20px 24px", background: YELLOW }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(0,0,0,0.5)", marginBottom: 12 }}>
            Everyone's questions are in!
          </div>
          <button
            onClick={startGame}
            style={{ background: "#000", color: YELLOW, fontSize: 24, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
          >
            Start Game
          </button>
        </div>
      )}

      {/* Players / Questions status */}
      <div style={{ padding: "28px 24px 0" }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
          Players
        </div>
        <div style={{ background: "rgba(0,0,0,0.22)", padding: "4px 14px 10px", borderTop: "3px solid rgba(255,255,255,0.25)" }}>
          {players.length === 0 && (
            <div style={{ fontSize: 14, opacity: 0.35, fontStyle: "italic", paddingTop: 10 }}>No players yet</div>
          )}
          {players.map(p => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: p.question ? GREEN : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
              <span style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>
                {p.name}
                {p.id === myPlayerId && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.45, marginLeft: 6 }}>you</span>}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.45 }}>
                {p.question ? "Question ready" : "Writing…"}
              </span>
            </div>
          ))}
        </div>
        {players.length < 3 && (
          <p style={{ fontSize: 13, opacity: 0.4, fontWeight: 600, marginTop: 10 }}>
            Need at least 4 players to start.
          </p>
        )}
      </div>

      {/* Join */}
      {!me && (
        <div style={{ padding: "28px 24px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
            Join Game
          </div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && join()}
            placeholder="Your name"
            maxLength={40}
            style={inputStyle}
          />
          <button
            onClick={join}
            disabled={!name.trim() || joining}
            style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", marginTop: 8, display: "block" }}
          >
            {joining ? "Joining…" : "Join"}
          </button>
        </div>
      )}

      {/* Question submission */}
      {me && !myQuestionSubmitted && (
        <div style={{ padding: "28px 24px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
            Your Question
          </div>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitQuestion()}
            placeholder="Write a question for everyone…"
            maxLength={200}
            style={inputStyle}
          />
          <button
            onClick={submitQuestion}
            disabled={!question.trim() || submittingQuestion}
            style={{ background: YELLOW, color: "#000", fontSize: 18, fontWeight: 900, padding: "16px", width: "100%", marginTop: 8, display: "block" }}
          >
            {submittingQuestion ? "Submitting…" : "Submit Question"}
          </button>
        </div>
      )}

      {me && myQuestionSubmitted && !allQuestionsIn && (
        <div style={{ padding: "28px 24px" }}>
          <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.55 }}>
            Your question is in. Waiting for others…
          </div>
        </div>
      )}

    </div>
  )
}

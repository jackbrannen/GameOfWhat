"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase"

const BG = "#1a1a2e"
const YELLOW = "#FBDF54"
const GREEN = "#12BAAA"
const RED = "#F04F52"
const CARD_BG = "rgba(255,255,255,0.06)"

export default function Play({ params }) {
  const router = useRouter()
  const code = useMemo(() => params.code.toUpperCase(), [params.code])

  const [myPlayerId, setMyPlayerId] = useState(null)
  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [currentQuestion, setCurrentQuestion] = useState(null) // { id, text, author_id }
  const [answers, setAnswers] = useState([])   // [{ id, text, player_id, vote_count }]
  const [myAnswer, setMyAnswer] = useState("")
  const [submittingAnswer, setSubmittingAnswer] = useState(false)
  const [myVoteId, setMyVoteId] = useState(null) // answer id I voted for
  const [submittingVote, setSubmittingVote] = useState(false)

  useEffect(() => {
    const existing = localStorage.getItem(`gow:${code}:playerId`)
    if (existing) setMyPlayerId(existing)
  }, [code])

  async function loadState() {
    const { data: gameData } = await supabase
      .from("gow_games")
      .select("code,phase,round_index,rounds_total,current_question_id,question_phase")
      .eq("code", code)
      .single()
    if (!gameData) return

    if (gameData.phase === "lobby") { router.replace(`/${code}`); return }
    if (gameData.phase === "finished") { setGame(gameData); setPlayers([]); return }

    const { data: playerData } = await supabase
      .from("gow_players")
      .select("id,name,score,question,created_at")
      .eq("game_code", code)
      .order("created_at", { ascending: true })

    setGame(gameData)
    setPlayers(playerData ?? [])

    if (gameData.current_question_id) {
      const { data: qData } = await supabase
        .from("gow_questions")
        .select("id,text,author_id")
        .eq("id", gameData.current_question_id)
        .single()
      setCurrentQuestion(qData ?? null)

      const { data: answerData } = await supabase
        .from("gow_answers")
        .select("id,text,player_id,vote_count,skipped")
        .eq("question_id", gameData.current_question_id)
        .order("random_order", { ascending: true })
      setAnswers(answerData ?? [])

      if (myPlayerId) {
        const existing = (answerData ?? []).find(a => a.player_id === myPlayerId)
        if (existing) setMyAnswer(existing.text ?? "")

        const { data: voteData } = await supabase
          .from("gow_votes")
          .select("answer_id")
          .eq("question_id", gameData.current_question_id)
          .eq("voter_id", myPlayerId)
          .maybeSingle()
        setMyVoteId(voteData?.answer_id ?? null)
      }
    } else {
      setCurrentQuestion(null)
      setAnswers([])
    }
  }

  useEffect(() => {
    loadState()
    const poll = setInterval(loadState, 1200)
    return () => clearInterval(poll)
  }, [code, myPlayerId])

  const currentQuestionId = currentQuestion?.id
  useEffect(() => {
    setMyAnswer("")
  }, [currentQuestionId])

  async function submitAnswer(skip = false) {
    if (!currentQuestion || !myPlayerId) return
    setSubmittingAnswer(true)
    await supabase.rpc("gow_submit_answer", {
      p_code: code,
      p_question_id: currentQuestion.id,
      p_player_id: myPlayerId,
      p_text: skip ? null : myAnswer.trim(),
      p_skipped: skip,
    })
    setSubmittingAnswer(false)
    await loadState()
  }

  async function submitVote(answerId) {
    if (!currentQuestion || !myPlayerId || submittingVote) return
    setSubmittingVote(true)
    setMyVoteId(answerId)
    await supabase.rpc("gow_submit_vote", {
      p_code: code,
      p_question_id: currentQuestion.id,
      p_voter_id: myPlayerId,
      p_answer_id: answerId,
    })
    setSubmittingVote(false)
    await loadState()
  }

  async function advanceQuestion() {
    await supabase.rpc("gow_advance_question", { p_code: code })
    await loadState()
  }

  if (!game) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  const me = players.find(p => p.id === myPlayerId)
  const questionAuthor = players.find(p => p.id === currentQuestion?.author_id)
  const isQuestionAuthor = myPlayerId === currentQuestion?.author_id

  // question_phase: "answering" | "voting" | "results"
  const phase = game.question_phase

  const myAnswerRecord = answers.find(a => a.player_id === myPlayerId)
  const hasSubmittedAnswer = !!myAnswerRecord
  const hasSkipped = myAnswerRecord?.skipped

  // Players who need to answer (excludes question author)
  const eligibleAnswerers = players.filter(p => p.id !== currentQuestion?.author_id)
  const answeredCount = answers.filter(a => !a.skipped || a.skipped === false).length + answers.filter(a => a.skipped).length
  // Actually just count all submitted (answered or skipped)
  const submittedCount = answers.length
  const waitingOnCount = eligibleAnswerers.length - submittedCount

  const allVoted = (() => {
    // everyone who submitted a non-skipped answer can vote; question author can also vote
    const voterIds = new Set([
      ...answers.filter(a => !a.skipped).map(a => a.player_id),
      currentQuestion?.author_id,
    ])
    const { data: _ } = { data: null } // placeholder
    return false // will be computed from game state
  })()

  // Game over
  if (game.phase === "finished") {
    const sorted = [...players].sort((a, b) => b.score - a.score)
    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white", padding: "40px 24px" }}>
        <div style={{ fontSize: "clamp(56px, 16vw, 88px)", fontWeight: 900, lineHeight: 0.9, marginBottom: 32 }}>
          Game<br />Over
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.5, marginBottom: 16 }}>
          Final Scores
        </div>
        {sorted.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ fontSize: 15, fontWeight: 800, opacity: 0.4, minWidth: 20 }}>{i + 1}</span>
            <span style={{ fontSize: 22, fontWeight: 700, flex: 1 }}>{p.name}</span>
            <span style={{ fontSize: 28, fontWeight: 900, color: i === 0 ? YELLOW : "white" }}>{p.score}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column" }}>

      {/* Top bar */}
      <div style={{ padding: "14px 20px", background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4 }}>
          Round {(game.round_index ?? 0) + 1} of {game.rounds_total ?? 3}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {[...players].sort((a, b) => b.score - a.score).map(p => (
            <div key={p.id} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, opacity: 0.45, fontWeight: 700, marginBottom: 1 }}>{p.name}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: p.id === myPlayerId ? YELLOW : "white" }}>{p.score}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 20px", paddingBottom: "max(28px, env(safe-area-inset-bottom, 28px))" }}>

        {/* Question */}
        {currentQuestion && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.45, marginBottom: 10 }}>
              {questionAuthor ? `${questionAuthor.name}'s question` : "Question"}
            </div>
            <div style={{ fontSize: "clamp(22px, 6vw, 32px)", fontWeight: 800, lineHeight: 1.25 }}>
              {currentQuestion.text}
            </div>
          </div>
        )}

        {/* ANSWERING PHASE */}
        {phase === "answering" && (
          <>
            {isQuestionAuthor ? (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, opacity: 0.55, marginBottom: 20 }}>
                  This is your question — sit back while others answer.
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.4, marginBottom: 10 }}>
                  Answers in: {submittedCount} / {eligibleAnswerers.length}
                </div>
                {players.filter(p => p.id !== currentQuestion?.author_id).map(p => {
                  const submitted = answers.some(a => a.player_id === p.id)
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: submitted ? GREEN : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                      <span style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</span>
                    </div>
                  )
                })}
              </div>
            ) : hasSubmittedAnswer ? (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, opacity: 0.55, marginBottom: 4 }}>
                  Your answer: <span style={{ opacity: 1, color: "white" }}>{hasSkipped ? "(skipped)" : myAnswerRecord?.text}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.4, marginTop: 16 }}>
                  Waiting for {waitingOnCount} more {waitingOnCount === 1 ? "player" : "players"}…
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                <textarea
                  value={myAnswer}
                  onChange={e => setMyAnswer(e.target.value)}
                  placeholder="Your answer…"
                  maxLength={300}
                  rows={3}
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    color: "white",
                    fontSize: 20,
                    padding: "16px 18px",
                    width: "100%",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    display: "block",
                    boxSizing: "border-box",
                    lineHeight: 1.4,
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => submitAnswer(false)}
                    disabled={!myAnswer.trim() || submittingAnswer}
                    style={{ background: YELLOW, color: "#000", fontSize: 18, fontWeight: 900, padding: "16px", flex: 1, display: "block" }}
                  >
                    Submit Answer
                  </button>
                  <button
                    onClick={() => submitAnswer(true)}
                    disabled={submittingAnswer}
                    style={{ background: "rgba(255,255,255,0.1)", color: "white", fontSize: 15, fontWeight: 700, padding: "16px 20px", flexShrink: 0 }}
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* VOTING PHASE */}
        {phase === "voting" && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.45, marginBottom: 16 }}>
              {myVoteId ? "Vote cast — waiting for others…" : isQuestionAuthor ? "Vote for your favorite answer:" : "Vote for your favorite answer (not your own):"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {answers.filter(a => !a.skipped).map(answer => {
                const isMine = answer.player_id === myPlayerId
                const isSelected = myVoteId === answer.id
                const canVote = !isMine && !myVoteId
                return (
                  <button
                    key={answer.id}
                    onClick={() => canVote && submitVote(answer.id)}
                    disabled={!canVote || submittingVote}
                    style={{
                      background: isSelected ? YELLOW : CARD_BG,
                      color: isSelected ? "#000" : "white",
                      fontSize: 18,
                      fontWeight: 700,
                      padding: "18px 20px",
                      textAlign: "left",
                      width: "100%",
                      display: "block",
                      opacity: myVoteId && !isSelected ? 0.45 : 1,
                      border: isMine ? "1px solid rgba(255,255,255,0.15)" : "none",
                    }}
                  >
                    {answer.text}
                    {isMine && <span style={{ fontSize: 12, opacity: 0.5, marginLeft: 8 }}>(yours)</span>}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* RESULTS PHASE */}
        {phase === "results" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {answers.filter(a => !a.skipped).sort((a, b) => b.vote_count - a.vote_count).map(answer => {
                const author = players.find(p => p.id === answer.player_id)
                const pts = answer.vote_count
                return (
                  <div
                    key={answer.id}
                    style={{
                      background: pts > 0 ? "rgba(251,223,84,0.1)" : CARD_BG,
                      padding: "16px 20px",
                      borderLeft: pts > 0 ? `4px solid ${YELLOW}` : "4px solid transparent",
                    }}
                  >
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{answer.text}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.55 }}>{author?.name ?? "?"}</span>
                      {pts > 0 && (
                        <span style={{ fontSize: 16, fontWeight: 900, color: YELLOW }}>+{pts} {pts === 1 ? "vote" : "votes"}</span>
                      )}
                    </div>
                  </div>
                )
              })}
              {answers.filter(a => a.skipped).length > 0 && (
                <div style={{ fontSize: 13, opacity: 0.35, fontWeight: 600, marginTop: 4 }}>
                  {answers.filter(a => a.skipped).length} player{answers.filter(a => a.skipped).length > 1 ? "s" : ""} skipped
                </div>
              )}
            </div>

            <button
              onClick={advanceQuestion}
              style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
            >
              Next Question
            </button>
          </>
        )}

        {/* Scores — shown during play, lower down */}
        {phase !== "results" && (
          <div style={{ marginTop: "auto", paddingTop: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.35, marginBottom: 12 }}>
              Scores
            </div>
            {[...players].sort((a, b) => b.score - a.score).map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: 16, fontWeight: 700, flex: 1, color: p.id === myPlayerId ? YELLOW : "white" }}>{p.name}</span>
                <span style={{ fontSize: 20, fontWeight: 900 }}>{p.score}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

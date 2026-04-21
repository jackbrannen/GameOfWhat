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
  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [answers, setAnswers] = useState([])
  const [votes, setVotes] = useState([])       // { answer_id, voter_id } — loaded in results phase
  const [myAnswer, setMyAnswer] = useState("")
  const [submittingAnswer, setSubmittingAnswer] = useState(false)
  const [myVoteId, setMyVoteId] = useState(null)
  const [submittingVote, setSubmittingVote] = useState(false)
  const [selfFlash, setSelfFlash] = useState(false)

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

    const { data: playerData } = await supabase
      .from("gow_players")
      .select("id,name,score,created_at")
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
        const { data: voteData } = await supabase
          .from("gow_votes")
          .select("answer_id,voter_id")
          .eq("question_id", gameData.current_question_id)
        setVotes(voteData ?? [])
        const myVote = (voteData ?? []).find(v => v.voter_id === myPlayerId)
        setMyVoteId(myVote ? (myVote.answer_id ?? "nota") : null)
      }
    } else {
      setCurrentQuestion(null)
      setAnswers([])
      setVotes([])
    }
  }

  useEffect(() => {
    loadState()
    const poll = setInterval(loadState, 1200)
    return () => clearInterval(poll)
  }, [code, myPlayerId])

  const currentQuestionId = currentQuestion?.id
  useEffect(() => { setMyAnswer("") }, [currentQuestionId])

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

  async function submitVote(answerId) { // null = NOTA
    if (!currentQuestion || !myPlayerId || submittingVote) return
    setSubmittingVote(true)
    setMyVoteId(answerId ?? "nota")
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

  async function startNextRound() {
    await supabase.rpc("gow_start_next_round", { p_code: code })
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
  const phase = game.question_phase
  const myAnswerRecord = answers.find(a => a.player_id === myPlayerId)
  const hasSubmittedAnswer = !!myAnswerRecord
  const hasSkipped = myAnswerRecord?.skipped
  const eligibleAnswerers = players.filter(p => p.id !== currentQuestion?.author_id)
  const submittedCount = answers.length
  const waitingOnCount = eligibleAnswerers.length - submittedCount
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score)

  const notaVoters = votes.filter(v => v.answer_id === null).map(v => players.find(p => p.id === v.voter_id)?.name).filter(Boolean)

  // ── GAME OVER ──────────────────────────────────────────────
  if (game.phase === "finished") {
    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white", padding: "40px 24px" }}>
        <div style={{ fontSize: "clamp(56px, 16vw, 88px)", fontWeight: 900, lineHeight: 0.9, marginBottom: 32 }}>
          Game<br />Over
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.5, marginBottom: 16 }}>
          Final Scores
        </div>
        {sortedPlayers.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ background: i === 0 ? YELLOW : "rgba(255,255,255,0.12)", color: i === 0 ? "#000" : "white", fontSize: 22, fontWeight: 900, minWidth: 52, textAlign: "center", padding: "8px 0" }}>
              {p.score}
            </div>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{p.name}</span>
          </div>
        ))}
      </div>
    )
  }

  // ── BETWEEN ROUNDS ────────────────────────────────────────
  if (game.phase === "between_rounds") {
    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white", padding: "40px 24px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.45, marginBottom: 12 }}>
          Round complete
        </div>
        <div style={{ fontSize: "clamp(44px, 12vw, 72px)", fontWeight: 900, lineHeight: 1, marginBottom: 8, whiteSpace: "nowrap" }}>
          Round {game.round_index}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.5, marginBottom: 48 }}>
          of {game.rounds_total}
        </div>

        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.45, marginBottom: 16 }}>
          Scores
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 48 }}>
          {sortedPlayers.map((p, i) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ background: i === 0 ? YELLOW : "rgba(255,255,255,0.12)", color: i === 0 ? "#000" : "white", fontSize: 24, fontWeight: 900, minWidth: 56, textAlign: "center", padding: "10px 0" }}>
                {p.score}
              </div>
              <span style={{ fontSize: 20, fontWeight: 700, color: p.id === myPlayerId ? YELLOW : "white" }}>{p.name}</span>
            </div>
          ))}
        </div>

        <button
          onClick={startNextRound}
          style={{ background: YELLOW, color: "#000", fontSize: 22, fontWeight: 900, padding: "22px", width: "100%", display: "block", marginTop: "auto" }}
        >
          Write Questions for Round {game.round_index + 1}
        </button>
      </div>
    )
  }

  // ── PLAY ──────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column" }}>

      {/* Top bar */}
      <div style={{ padding: "14px 20px", background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4 }}>
          Round {(game.round_index ?? 0) + 1} of {game.rounds_total ?? 3}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {sortedPlayers.map(p => (
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
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, opacity: 0.55, marginBottom: 20 }}>
                  This is your question — sit back while others answer.
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.4, marginBottom: 10 }}>
                  {submittedCount} / {eligibleAnswerers.length} answered
                </div>
                {eligibleAnswerers.map(p => {
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
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, opacity: 0.55, marginBottom: 4 }}>
                  Your answer: <span style={{ opacity: 1, color: "white" }}>{hasSkipped ? "(skipped)" : myAnswerRecord?.text}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.4, marginTop: 16 }}>
                  Waiting for {waitingOnCount} more {waitingOnCount === 1 ? "player" : "players"}…
                </div>
              </div>
            ) : (
              <div>
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
              {myVoteId ? "Vote cast — waiting for others…" : "Vote for your favorite:"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {answers.filter(a => !a.skipped).map(answer => {
                const isMine = answer.player_id === myPlayerId
                const isSelected = myVoteId === answer.id
                const canVote = !isMine && !myVoteId
                return (
                  <div key={answer.id}>
                    <button
                      onClick={() => {
                        if (isMine) {
                          setSelfFlash(true)
                          setTimeout(() => setSelfFlash(false), 500)
                          return
                        }
                        if (canVote) submitVote(answer.id)
                      }}
                      disabled={(!canVote && !isMine) || submittingVote}
                      style={{
                        background: isSelected ? YELLOW : isMine && selfFlash ? "rgba(255,80,80,0.25)" : CARD_BG,
                        color: isSelected ? "#000" : "white",
                        fontSize: 18,
                        fontWeight: 700,
                        padding: "18px 20px",
                        textAlign: "left",
                        width: "100%",
                        display: "block",
                        opacity: myVoteId && !isSelected ? 0.45 : 1,
                      }}
                    >
                      {answer.text}
                    </button>
                    {isMine && (
                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: selfFlash ? RED : "rgba(255,255,255,0.35)",
                        marginTop: 4,
                        marginLeft: 2,
                        transition: "color 150ms",
                      }}>
                        Your answer — you can't vote for yourself
                      </div>
                    )}
                  </div>
                )
              })}

              {/* None of the Above */}
              {!myVoteId && (
                <button
                  onClick={() => submitVote(null)}
                  disabled={submittingVote}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 15,
                    fontWeight: 700,
                    padding: "16px 20px",
                    textAlign: "left",
                    width: "100%",
                    display: "block",
                    marginTop: 4,
                  }}
                >
                  None of the above
                </button>
              )}
              {myVoteId === "nota" && (
                <div style={{ background: "rgba(255,255,255,0.04)", padding: "16px 20px", opacity: 0.5 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "white" }}>None of the above</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: YELLOW, marginLeft: 10 }}>✓ your vote</span>
                </div>
              )}
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
                const voters = votes
                  .filter(v => v.answer_id === answer.id)
                  .map(v => players.find(p => p.id === v.voter_id)?.name)
                  .filter(Boolean)
                return (
                  <div key={answer.id} style={{ background: CARD_BG, padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: voters.length ? 10 : 0 }}>
                      <div style={{
                        background: pts > 0 ? YELLOW : "rgba(255,255,255,0.12)",
                        color: pts > 0 ? "#000" : "rgba(255,255,255,0.5)",
                        fontSize: 20,
                        fontWeight: 900,
                        minWidth: 44,
                        textAlign: "center",
                        padding: "6px 0",
                        flexShrink: 0,
                      }}>
                        {pts > 0 ? `+${pts}` : "–"}
                      </div>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{answer.text}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.5, marginTop: 3 }}>{author?.name ?? "?"}</div>
                      </div>
                    </div>
                    {voters.length > 0 && (
                      <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.45, marginLeft: 58 }}>
                        Voted by: {voters.join(", ")}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* NOTA result */}
              {notaVoters.length > 0 && (
                <div style={{ background: CARD_BG, padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 10 }}>
                    <div style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", fontSize: 20, fontWeight: 900, minWidth: 44, textAlign: "center", padding: "6px 0", flexShrink: 0 }}>
                      –
                    </div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, opacity: 0.6 }}>None of the above</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.45, marginLeft: 58 }}>
                    Voted by: {notaVoters.join(", ")}
                  </div>
                </div>
              )}

              {/* Skippers */}
              {answers.filter(a => a.skipped).length > 0 && (
                <div style={{ fontSize: 13, opacity: 0.35, fontWeight: 600, marginTop: 4 }}>
                  Skipped: {answers.filter(a => a.skipped).map(a => players.find(p => p.id === a.player_id)?.name).filter(Boolean).join(", ")}
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

        {/* Scores — shown below during answering/voting */}
        {phase !== "results" && (
          <div style={{ marginTop: "auto", paddingTop: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.35, marginBottom: 12 }}>
              Scores
            </div>
            {sortedPlayers.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ background: "rgba(255,255,255,0.1)", fontSize: 18, fontWeight: 900, minWidth: 40, textAlign: "center", padding: "4px 0", color: "white" }}>
                  {p.score}
                </div>
                <span style={{ fontSize: 16, fontWeight: 700, color: p.id === myPlayerId ? YELLOW : "white" }}>{p.name}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

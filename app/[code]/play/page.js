"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase"
import PokeSystem, { FOOTER_H } from "../../../components/PokeSystem"
import GameModal from "../../../components/GameModal"
import { useSubmitNudge } from "../../../lib/useSubmitNudge"

const BG = "#6B1A44"
const YELLOW = "#FBDF54"
const GREEN = "#12BAAA"
const RED = "#F04F52"
const WARM_LIGHT = "#821F42"
const CARD_BG = WARM_LIGHT



const POKE_COLORS = { dark: "#4A123B", mid: "#5C1640", wl: "#821F42", yellow: "#FBDF54", notifBg: "#300A20" }
const BOTTOM_PAD = `calc(${FOOTER_H + 8}px + env(safe-area-inset-bottom))`

const BOT_WORDS = ["pizza","coffee","traffic","vacation","homework","laundry","dentist","parking","sunshine","deadline","wifi","elevator","printer","leftovers","voicemail"]
const Q_TEMPLATES = [
  w => `What would you do with ${w}?`,
  w => `What's the best thing about ${w}?`,
  w => `How would you explain ${w} to a five-year-old?`,
  w => `What's the worst way to handle ${w}?`,
  w => `What would ${w} say if it could talk?`,
]
function pickRandQuestion() {
  const w = BOT_WORDS[Math.floor(Math.random() * BOT_WORDS.length)]
  return Q_TEMPLATES[Math.floor(Math.random() * Q_TEMPLATES.length)](w)
}
function pickRandWord() {
  return BOT_WORDS[Math.floor(Math.random() * BOT_WORDS.length)]
}

const IDEAS_URL = "https://raw.githubusercontent.com/jackbrannen/JackGames/main/random_ideas.json"
let _ideasCache = null
async function fetchIdeas() {
  if (_ideasCache) return _ideasCache
  const res = await fetch(IDEAS_URL)
  _ideasCache = await res.json()
  return _ideasCache
}
function sampleIdeas(categories, excludeSet, count = 3) {
  const cats = Object.keys(categories).map(cat => ({
    cat,
    pool: categories[cat].filter(idea => !excludeSet.has(idea.toLowerCase()))
  })).filter(({ pool }) => pool.length > 0)
  for (let i = cats.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cats[i], cats[j]] = [cats[j], cats[i]]
  }
  return cats.slice(0, count).map(({ pool }) => pool[Math.floor(Math.random() * pool.length)])
}

function playChirp() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(523, ctx.currentTime)
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.25)
  } catch {}
}

export default function Play({ params }) {
  const router = useRouter()
  const code = useMemo(() => params.code.toUpperCase(), [params.code])

  const [myPlayerId, setMyPlayerId] = useState(null)
  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [answers, setAnswers] = useState([])
  const [votes, setVotes] = useState([])
  const [myAnswer, setMyAnswer] = useState("")
  const [submittingAnswer, setSubmittingAnswer] = useState(false)
  const [myVoteId, setMyVoteId] = useState(null)
  const [submittingVote, setSubmittingVote] = useState(false)
  const [selfFlash, setSelfFlash] = useState(false)
  const changingVoteRef = useRef(false)
  const botIdsRef = useRef([])
  const botActionsRef = useRef(new Set())
  const soundTriggerRef = useRef(null)
  const [resultSnapshot, setResultSnapshot] = useState(null)
  const [resultsAcknowledged, setResultsAcknowledged] = useState(null)
  const [roundQuestion, setRoundQuestion] = useState("")
  const [submittingRoundQuestion, setSubmittingRoundQuestion] = useState(false)
  const [shownPrompts, setShownPrompts] = useState([])
  const [promptsPhase, setPromptsPhase] = useState("none")
  const [gameOverPlayers, setGameOverPlayers] = useState(null)
  const [showGameModal, setShowGameModal] = useState(false)
  const [bonusMatchName, setBonusMatchName] = useState(null)
  const [instructions, setInstructions] = useState("")
  const [pokeCooldownActive, setPokeCooldownActive] = useState(false)
  const [pokeJustSent, setPokeJustSent] = useState(null)
  const channelRef = useRef(null)
  const typingTimerRef = useRef(null)
  const [presenceState, setPresenceState] = useState({})

  useEffect(() => {
    if (!game || !myPlayerId) return
    const prev = soundTriggerRef.current
    soundTriggerRef.current = game.phase
    if (!prev) return
    if (prev !== game.phase) playChirp()
  }, [game?.phase])

  useEffect(() => {
    if (!game?.next_game) return
    window.location.href = `https://${game.next_game}.jackbrannen.com/`
  }, [game?.next_game])

  useEffect(() => {
    const existing = localStorage.getItem(`gow:${code}:playerId`)
    if (existing) setMyPlayerId(existing)
    try {
      const bots = localStorage.getItem(`gow:${code}:botIds`)
      if (bots) botIdsRef.current = JSON.parse(bots)
    } catch {}
  }, [code])

  async function loadState() {
    const { data: gameData } = await supabase
      .from("gow_games")
      .select("code,phase,round_index,rounds_total,current_question_id,question_phase,used_prompts,next_game")
      .eq("code", code)
      .single()
    if (!gameData) return

    if (gameData.phase === "lobby") { router.replace(`/${code}`); return }

    const { data: playerData } = await supabase
      .from("gow_players")
      .select("id,name,first_name,score,question,created_at")
      .eq("game_code", code)
      .order("created_at", { ascending: true })

    setGame(gameData)
    setPlayers(playerData ?? [])
    if (gameData.phase === "finished") setGameOverPlayers(p => p ?? playerData ?? [])

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
        if (!changingVoteRef.current) {
          const myVote = (voteData ?? []).find(v => v.voter_id === myPlayerId)
          setMyVoteId(myVote ? (myVote.answer_id ?? "nota") : null)
        }

        if (gameData.question_phase === "results") {
          setResultSnapshot({
            questionId: gameData.current_question_id,
            question: qData,
            answers: answerData ?? [],
            votes: voteData ?? [],
          })
        }
      }
    } else {
      setCurrentQuestion(null)
      setAnswers([])
      setVotes([])
    }
  }

  useEffect(() => {
    loadState()
    let poll = setInterval(loadState, 1500)
    function handleVisibility() { clearInterval(poll); if (!document.hidden) { loadState(); poll = setInterval(loadState, 1500) } }
    document.addEventListener("visibilitychange", handleVisibility)
    const channel = supabase.channel(`gow-play-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "gow_games", filter: `code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "gow_players", filter: `game_code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "gow_answers" }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "gow_votes" }, loadState)
      .on("presence", { event: "sync" }, () => setPresenceState({ ...channel.presenceState() }))
      .subscribe(async status => {
        if (status === "SUBSCRIBED" && myPlayerId) {
          await channel.track({ playerId: myPlayerId, typing: false })
        }
      })
    channelRef.current = channel
    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", handleVisibility); supabase.removeChannel(channel) }
  }, [code, myPlayerId])

  const currentQuestionId = currentQuestion?.id
  useEffect(() => {
    setMyAnswer("")
    setSubmittingAnswer(false)
    setSubmittingVote(false)
    setMyVoteId(null)
    changingVoteRef.current = false
  }, [currentQuestionId])

  const roundIndex = game?.round_index
  useEffect(() => { setShownPrompts([]); setPromptsPhase("none") }, [roundIndex])

  useEffect(() => {
    supabase.from("game_instructions").select("body").eq("game_key", "gameofwhat").single()
      .then(({ data }) => { if (data) setInstructions(data.body) })
  }, [])

  const allNextQuestionsIn = game?.phase === "between_rounds" && players.length > 0 && players.every(p => p.question)

  // ── DUMMY GAME AUTOMATION ─────────────────────────────────

  // Pre-fill answer field
  useEffect(() => {
    if (!botIdsRef.current.length || game?.question_phase !== "answering" || !currentQuestion) return
    if (myPlayerId === currentQuestion.author_id) return
    if (answers.some(a => a.player_id === myPlayerId)) return
    setMyAnswer(prev => prev || pickRandWord())
  }, [currentQuestion?.id, game?.question_phase])

  // Pre-fill round question field
  useEffect(() => {
    if (!botIdsRef.current.length || game?.phase !== "between_rounds") return
    setRoundQuestion(prev => prev || pickRandQuestion())
  }, [roundIndex, game?.phase])

  // Auto-submit bot answers
  useEffect(() => {
    if (!botIdsRef.current.length || game?.question_phase !== "answering" || !currentQuestion) return
    botIdsRef.current.forEach(async botId => {
      if (botId === currentQuestion.author_id) return
      if (answers.find(a => a.player_id === botId)) return
      const key = `${currentQuestion.id}-ans-${botId}`
      if (botActionsRef.current.has(key)) return
      botActionsRef.current.add(key)
      await supabase.rpc("gow_submit_answer", {
        p_code: code, p_question_id: currentQuestion.id,
        p_player_id: botId, p_text: pickRandWord(), p_skipped: false,
      })
    })
  }, [currentQuestion?.id, game?.question_phase, answers.length])

  // Auto-vote for bots
  useEffect(() => {
    if (!botIdsRef.current.length || game?.question_phase !== "voting" || !currentQuestion) return
    botIdsRef.current.forEach(async botId => {
      if (votes.find(v => v.voter_id === botId)) return
      const key = `${currentQuestion.id}-vote-${botId}`
      if (botActionsRef.current.has(key)) return
      botActionsRef.current.add(key)
      const eligible = answers.filter(a => !a.skipped && a.player_id !== botId)
      const pick = eligible.length ? eligible[Math.floor(Math.random() * eligible.length)] : null
      await supabase.rpc("gow_submit_vote", {
        p_code: code, p_question_id: currentQuestion.id,
        p_voter_id: botId, p_answer_id: pick?.id ?? null,
      })
    })
  }, [currentQuestion?.id, game?.question_phase, answers.length, votes.length])

  // Auto-submit bot round questions
  useEffect(() => {
    if (!botIdsRef.current.length || game?.phase !== "between_rounds") return
    const round = game.round_index
    botIdsRef.current.forEach(async botId => {
      const player = players.find(p => p.id === botId)
      if (player?.question) return
      const key = `r${round}-q-${botId}`
      if (botActionsRef.current.has(key)) return
      botActionsRef.current.add(key)
      await supabase.from("gow_players").update({ question: pickRandQuestion() }).eq("id", botId)
    })
  }, [roundIndex, game?.phase, players.length])

  // ─────────────────────────────────────────────────────────

  async function submitAnswer(skip = false) {
    if (!currentQuestion || !myPlayerId) return
    setSubmittingAnswer(true)
    const { error } = await supabase.rpc("gow_submit_answer", {
      p_code: code,
      p_question_id: currentQuestion.id,
      p_player_id: myPlayerId,
      p_text: skip ? null : myAnswer.trim(),
      p_skipped: skip,
    })
    if (error) { setSubmittingAnswer(false); return }
    if (!skip && myAnswer.trim()) {
      const myText = myAnswer.trim().toLowerCase()
      const { data: freshAnswers } = await supabase
        .from("gow_answers").select("player_id,text")
        .eq("question_id", currentQuestion.id).eq("skipped", false)
      const match = freshAnswers?.find(a => a.player_id !== myPlayerId && a.text?.trim().toLowerCase() === myText)
      if (match) {
        const matchPlayer = players.find(p => p.id === match.player_id)
        setBonusMatchName(matchPlayer?.name || "someone")
        setTimeout(() => setBonusMatchName(null), 4000)
      }
    }
    await loadState()
  }

  async function handleDeselect() {
    changingVoteRef.current = true
    setMyVoteId(null)
    if (currentQuestion && myPlayerId) {
      await supabase.rpc("gow_retract_vote", {
        p_code: code,
        p_question_id: currentQuestion.id,
        p_voter_id: myPlayerId,
      })
    }
  }

  async function submitVote(answerId) {
    if (!currentQuestion || !myPlayerId || submittingVote) return
    changingVoteRef.current = true
    setSubmittingVote(true)
    setMyVoteId(answerId ?? "nota")
    const { error } = await supabase.rpc("gow_submit_vote", {
      p_code: code,
      p_question_id: currentQuestion.id,
      p_voter_id: myPlayerId,
      p_answer_id: answerId,
    })
    if (error) { setSubmittingVote(false); changingVoteRef.current = false; return }
    await loadState()
    changingVoteRef.current = false
  }

  async function handleAdvanceFromResults() {
    const snapId = resultSnapshot?.questionId
    setResultsAcknowledged(snapId)
    if (game?.question_phase === "results") {
      await supabase.rpc("gow_advance_question", { p_code: code })
    }
    await loadState()
  }

  async function submitRoundQuestion() {
    const trimmed = roundQuestion.trim()
    if (!trimmed || submittingRoundQuestion || !myPlayerId) return
    setSubmittingRoundQuestion(true)
    await supabase.from("gow_players").update({ question: trimmed }).eq("id", myPlayerId)
    setSubmittingRoundQuestion(false)
    setRoundQuestion("")
    setShownPrompts([])
    setPromptsPhase("none")
    await loadState()
  }

  async function handleDrawPrompts() {
    if (promptsPhase === "done") return
    const isFirst = promptsPhase === "none"

    const categories = await fetchIdeas()

    // Fresh fetch so we see words drawn by other players since last poll
    const { data: fresh } = await supabase
      .from("gow_games").select("used_prompts").eq("code", code).single()
    const globallyUsed = new Set((fresh?.used_prompts ?? []).map(s => s.toLowerCase()))

    const picked = sampleIdeas(categories, globallyUsed)
    const newTags = picked.map(word => ({ word, isName: false }))

    if (isFirst) {
      const others = players.filter(p => p.id !== myPlayerId && (p.first_name || p.name))
      if (others.length && newTags.length) {
        const pick = others[Math.floor(Math.random() * others.length)]
        const idx = Math.floor(Math.random() * newTags.length)
        newTags[idx] = { word: pick.first_name || pick.name, isName: true }
      }
    }

    if (picked.length) {
      await supabase.from("gow_games")
        .update({ used_prompts: [...(fresh?.used_prompts ?? []), ...picked] })
        .eq("code", code)
    }

    setShownPrompts(prev => [...prev, ...newTags])
    setPromptsPhase(isFirst ? "first" : promptsPhase === "first" ? "second" : "done")
  }

  async function startNextRound() {
    await supabase.rpc("gow_start_next_round", { p_code: code })
    await loadState()
  }

  function trackTyping() {
    if (!channelRef.current || !myPlayerId) return
    channelRef.current.track({ playerId: myPlayerId, typing: true })
    clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      if (channelRef.current) channelRef.current.track({ playerId: myPlayerId, typing: false })
    }, 3000)
  }

  const typingPlayerIds = new Set(
    Object.values(presenceState).flatMap(presences =>
      presences.filter(p => p.typing && p.playerId !== myPlayerId).map(p => p.playerId)
    )
  )

  // Must be before early return — Rules of Hooks
  const myAnswerRecordEarly = answers.find(a => a.player_id === myPlayerId)
  const nudgeAnswer = useSubmitNudge(myAnswer, !!myAnswerRecordEarly)

  if (!game) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  const me = players.find(p => p.id === myPlayerId)

  async function sendInlinePoke(targetName) {
    if (!me || pokeCooldownActive) return
    setPokeCooldownActive(true)
    setPokeJustSent(targetName)
    await supabase.from("pokes").insert({ room_code: code, from_player: me.name, to_player: targetName, message: "👉" })
    setTimeout(() => setPokeJustSent(null), 2000)
    setTimeout(() => setPokeCooldownActive(false), 10000)
  }

  // ── PokeSystem (always mounted for notifications) ──────────────────────────
  const pokeSystemNode = (footer = null) => me ? (
    <PokeSystem
      colors={POKE_COLORS}
      roomCode={code}
      currentPlayer={me.name}
      allPlayers={players.map(p => p.name)}
      playerDetails={players.map(p => ({ name: p.name, firstName: p.first_name, lastName: p.last_name }))}
      gamePhase={game?.phase}
      rules={instructions ? [["How to Play", instructions]] : null}
      onResetToLobby={async () => { await supabase.rpc("gow_reset_game", { p_code: code }) }}
    >{footer}</PokeSystem>
  ) : null

  const phase = game.question_phase
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score)

  // Show frozen results if player hasn't acknowledged the last results screen
  const showingResults = !!resultSnapshot && resultSnapshot.questionId !== resultsAcknowledged

  // ── FROZEN / LIVE RESULTS ────────────────────────────────────
  if (showingResults) {
    const snap = resultSnapshot
    const snapQuestion = snap.question
    const snapQuestionAuthor = players.find(p => p.id === snapQuestion?.author_id)
    const snapAnswerGroups = (snap.answers ?? [])
      .filter(a => !a.skipped)
      .reduce((groups, answer) => {
        const key = (answer.text || "").trim().toLowerCase()
        const existing = groups.find(g => g.key === key)
        if (existing) {
          existing.playerIds.push(answer.player_id)
          existing.answerIds.push(answer.id)
          existing.voteCount = Math.max(existing.voteCount, answer.vote_count)
        } else {
          groups.push({ key, primaryId: answer.id, answerIds: [answer.id], text: answer.text, playerIds: [answer.player_id], voteCount: answer.vote_count })
        }
        return groups
      }, [])
    const snapNotaVoters = (snap.votes ?? [])
      .filter(v => v.answer_id === null)
      .map(v => players.find(p => p.id === v.voter_id)?.name)
      .filter(Boolean)
    const snapSkipped = (snap.answers ?? []).filter(a => a.skipped)
    const stillInResults = game.question_phase === "results" && game.current_question_id === snap.questionId
    const btnLabel = game.phase === "finished" ? "Show Winner" : stillInResults ? "Next Question" : "Continue"

    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 20px", background: "#4A123B", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.75 }}>
            Round {(game.round_index ?? 0) + 1} of {game.rounds_total ?? 3}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 20px", paddingBottom: BOTTOM_PAD }}>
          {snapQuestion && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>
                {snapQuestionAuthor ? `${snapQuestionAuthor.name}'s question` : "Question"}
              </div>
              <div style={{ fontSize: "clamp(22px, 6vw, 32px)", fontWeight: 800, lineHeight: 1.25 }}>
                {snapQuestion.text}
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
            {[...snapAnswerGroups].sort((a, b) => b.voteCount - a.voteCount).map(group => {
              const authors = group.playerIds.map(id => players.find(p => p.id === id)?.name).filter(Boolean)
              const pts = group.voteCount
              const groupVoters = (snap.votes ?? [])
                .filter(v => group.answerIds.includes(v.answer_id))
                .map(v => players.find(p => p.id === v.voter_id)?.name)
                .filter(Boolean)
              return (
                <div key={group.primaryId} style={{ background: CARD_BG, padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: groupVoters.length ? 10 : 0 }}>
                    <div style={{ background: pts > 0 ? YELLOW : WARM_LIGHT, color: pts > 0 ? "#000" : "rgba(255,255,255,0.5)", fontSize: 20, fontWeight: 900, minWidth: 44, textAlign: "center", padding: "6px 0", flexShrink: 0 }}>
                      {pts > 0 ? `+${pts}` : "0"}
                    </div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{group.text}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65, marginTop: 3 }}>
                        {authors.join(" & ")}
                        {authors.length > 1 && <span style={{ marginLeft: 6, background: YELLOW, color: "#000", fontSize: 11, fontWeight: 900, padding: "1px 5px", verticalAlign: "middle" }}>matched +1</span>}
                      </div>
                    </div>
                  </div>
                  {groupVoters.length > 0 && (
                    <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65, marginLeft: 58 }}>
                      Voted by: {groupVoters.join(", ")}
                    </div>
                  )}
                </div>
              )
            })}
            {snapNotaVoters.length > 0 && (
              <div style={{ background: CARD_BG, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 10 }}>
                  <div style={{ background: WARM_LIGHT, color: "rgba(255,255,255,0.5)", fontSize: 20, fontWeight: 900, minWidth: 44, textAlign: "center", padding: "6px 0", flexShrink: 0 }}>{snapNotaVoters.length}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, opacity: 0.65 }}>None of the above</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65, marginLeft: 58 }}>
                  Voted by: {snapNotaVoters.join(", ")}
                </div>
              </div>
            )}
            {snapSkipped.length > 0 && (
              <div style={{ fontSize: 13, opacity: 0.65, fontWeight: 600, marginTop: 4 }}>
                Skipped: {snapSkipped.map(a => players.find(p => p.id === a.player_id)?.name).filter(Boolean).join(", ")}
              </div>
            )}
          </div>
        </div>
      </div>
        {pokeSystemNode(
          <button onClick={handleAdvanceFromResults} style={{ flex: 1, height: "100%", background: YELLOW, color: "#000", fontSize: 16, fontWeight: 900 }}>
            {btnLabel}
          </button>
        )}
      </>
    )
  }

  // ── GAME OVER ──────────────────────────────────────────────
  async function resetGame() {
    await supabase.rpc("gow_reset_game", { p_code: code })
  }

  async function pickNextGame(gameSub) {
    await supabase.from("gow_games").update({ next_game: gameSub }).eq("code", code)
  }

  if (game.phase === "finished") {
    const finalPlayers = [...(gameOverPlayers ?? players)].sort((a, b) => b.score - a.score)
    const topScore = finalPlayers[0]?.score ?? 0
    const isTie = finalPlayers.filter(p => p.score === topScore).length > 1
    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "40px 24px", paddingBottom: BOTTOM_PAD }}>
          <div style={{ fontSize: "clamp(56px, 16vw, 88px)", fontWeight: 900, lineHeight: 0.9, marginBottom: 32 }}>
            Game<br />Over
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 16 }}>
            Final Scores
          </div>
          {finalPlayers.map((p, i) => {
            const isWinner = p.score === topScore
            return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ background: isWinner ? YELLOW : WARM_LIGHT, color: isWinner ? "#000" : "white", fontSize: 22, fontWeight: 900, minWidth: 52, textAlign: "center", padding: "8px 0" }}>
                {p.score}
              </div>
              <div>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{p.name}</span>
                {isWinner && <span style={{ fontSize: 12, fontWeight: 800, color: YELLOW, marginLeft: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>{isTie ? "Tied!" : "Winner!"}</span>}
              </div>
            </div>
            )
          })}

          {/* Play again / another game */}
          <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={resetGame}
              style={{ background: YELLOW, color: "#000", fontSize: 16, fontWeight: 900, padding: "14px 24px", width: "100%" }}>
              Play Again
            </button>
            <button onClick={() => setShowGameModal(true)}
              style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 16, fontWeight: 700, padding: "14px 24px", width: "100%" }}>
              Play Another Game
            </button>
          </div>
        </div>
      </div>
        {pokeSystemNode()}
      {showGameModal && (
        <GameModal
          onClose={() => setShowGameModal(false)}
          onSelect={sub => pickNextGame(sub)}
          currentSub="gameofwhat"
        />
      )}
      </>
    )
  }

  // ── BETWEEN ROUNDS ────────────────────────────────────────
  if (game.phase === "between_rounds") {
    const myNextQuestion = me?.question

    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "40px 24px", paddingBottom: BOTTOM_PAD }}>
        {game.round_index > 0 && (
          <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.75, marginBottom: 12 }}>
            Round {game.round_index} complete
          </div>
        )}
        <div style={{ fontSize: "clamp(44px, 12vw, 72px)", fontWeight: 900, lineHeight: 1, marginBottom: 8, whiteSpace: "nowrap" }}>
          Round {game.round_index + 1}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.65, marginBottom: 40 }}>
          of {game.rounds_total}
        </div>

        {game.round_index > 0 && (
          <>
            <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 16 }}>
              Scores
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 40 }}>
              {sortedPlayers.map((p, i) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ background: i === 0 ? YELLOW : WARM_LIGHT, color: i === 0 ? "#000" : "white", fontSize: 24, fontWeight: 900, minWidth: 56, textAlign: "center", padding: "10px 0" }}>
                    {p.score}
                  </div>
                  <span style={{ fontSize: 20, fontWeight: 700, color: p.id === myPlayerId ? YELLOW : "white" }}>{p.name}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 14 }}>
          Round {game.round_index + 1} Questions
        </div>
        <div style={{ background: "#5C1640", padding: "4px 14px 10px", borderTop: "3px solid rgba(255,255,255,0.30)", marginBottom: 20 }}>
          {players.map(p => {
            const done = !!p.question
            const isMe = p.id === myPlayerId
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: done ? GREEN : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                <span style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>
                  {p.name}
                  {isMe && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.65, marginLeft: 6 }}>you</span>}
                </span>
                {!done && !isMe ? (
                  pokeJustSent === p.name ? (
                    <span style={{ fontSize: 18, color: GREEN, fontWeight: 700 }}>✓</span>
                  ) : !pokeCooldownActive ? (
                    <button onClick={() => sendInlinePoke(p.name)} style={{ background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>👉</button>
                  ) : null
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.65 }}>
                    {done ? "Ready" : typingPlayerIds.has(p.id) ? "💬" : "Writing…"}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {me && !myNextQuestion && (
          <div>
            <input
              value={roundQuestion}
              onChange={e => { setRoundQuestion(e.target.value); trackTyping() }}
              onKeyDown={e => e.key === "Enter" && submitRoundQuestion()}
              placeholder="Write a question for everyone…"
              maxLength={200}
              style={{ background: WARM_LIGHT, color: "white", fontSize: 20, padding: "16px 18px", width: "100%", display: "block", border: "none", outline: "none", boxSizing: "border-box" }}
            />
            {/* Ideas button */}
            <div style={{ marginTop: 16 }}>
              {promptsPhase !== "done" ? (  // "none" | "first" | "second" | "done"
                <button
                  onClick={handleDrawPrompts}
                  style={{ background: WARM_LIGHT, color: "white", fontSize: 15, fontWeight: 800, padding: "14px 18px", display: "block", width: "100%" }}
                >
                  {promptsPhase === "none" ? "✦ Random ideas" : "✦ 3 more ideas"}
                </button>
              ) : (
                <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.25)", padding: "12px 18px", background: WARM_LIGHT }}>
                  No more ideas for this question
                </div>
              )}
            </div>

            {/* Prompt tags */}
            {shownPrompts.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                {shownPrompts.map((p, i) => (
                  <div key={i} style={{
                    padding: "7px 14px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 700,
                    background: p.isName ? "rgba(251,223,84,0.12)" : WARM_LIGHT,
                    color: p.isName ? YELLOW : "white",
                    border: p.isName ? "1px solid rgba(251,223,84,0.3)" : "1px solid rgba(255,255,255,0.15)",
                  }}>
                    {p.word}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {me && myNextQuestion && !allNextQuestionsIn && (
          <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.65 }}>
            Your question is in. Waiting for others…
          </div>
        )}

        {allNextQuestionsIn && (
          <button
            onClick={startNextRound}
            style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "20px", width: "100%", marginTop: 8 }}
          >
            Start Round {game.round_index + 1} →
          </button>
        )}

        </div>
      </div>
        {pokeSystemNode(me && !myNextQuestion && !allNextQuestionsIn ? (
          <button
            onClick={submitRoundQuestion}
            disabled={!roundQuestion.trim() || submittingRoundQuestion}
            style={{ flex: 1, height: "100%", background: YELLOW, color: "#000", fontSize: 16, fontWeight: 900 }}
          >
            {submittingRoundQuestion ? "Submitting…" : "Submit Question"}
          </button>
        ) : null)}
      </>
    )
  }

  // ── PLAY ──────────────────────────────────────────────────
  const questionAuthor = players.find(p => p.id === currentQuestion?.author_id)
  const isQuestionAuthor = myPlayerId === currentQuestion?.author_id
  const myAnswerRecord = answers.find(a => a.player_id === myPlayerId)
  const hasSubmittedAnswer = !!myAnswerRecord
  const hasSkipped = myAnswerRecord?.skipped
  const eligibleAnswerers = players.filter(p => p.id !== currentQuestion?.author_id)
  const waitingOnPlayers = eligibleAnswerers.filter(p => !answers.some(a => a.player_id === p.id))

  const answerGroups = answers
    .filter(a => !a.skipped)
    .reduce((groups, answer) => {
      const key = (answer.text || "").trim().toLowerCase()
      const existing = groups.find(g => g.key === key)
      if (existing) {
        existing.playerIds.push(answer.player_id)
        existing.answerIds.push(answer.id)
        existing.voteCount = Math.max(existing.voteCount, answer.vote_count)
      } else {
        groups.push({ key, primaryId: answer.id, answerIds: [answer.id], text: answer.text, playerIds: [answer.player_id], voteCount: answer.vote_count })
      }
      return groups
    }, [])

  const eligibleVoterIds = Array.from(new Set(
    [currentQuestion?.author_id, ...answers.filter(a => !a.skipped).map(a => a.player_id)].filter(Boolean)
  ))
  const votedPlayerIds = new Set(votes.map(v => v.voter_id))
  const notaVoters = votes.filter(v => v.answer_id === null).map(v => players.find(p => p.id === v.voter_id)?.name).filter(Boolean)

  return (
    <>
    <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column" }}>

      {/* Top bar — round indicator only, no scores */}
      <div style={{ padding: "14px 20px", background: "#4A123B", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.75 }}>
          Round {(game.round_index ?? 0) + 1} of {game.rounds_total ?? 3}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: "28px 20px", paddingBottom: BOTTOM_PAD }}>

        {/* Question */}
        {currentQuestion && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>
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
                <div style={{ fontSize: 15, fontWeight: 700, opacity: 0.65, marginBottom: 20 }}>
                  This is your question — sit back while others answer.
                </div>
                {eligibleAnswerers.map(p => {
                  const submitted = answers.some(a => a.player_id === p.id)
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: submitted ? GREEN : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                      <span style={{ fontSize: 16, fontWeight: 700 }}>
                        {p.name}
                        {!submitted && typingPlayerIds.has(p.id) && <span style={{ fontSize: 14, marginLeft: 6 }}>💬</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : hasSubmittedAnswer ? (
              <div>
                {bonusMatchName && (
                  <div style={{ background: "#FBDF54", color: "#000", padding: "10px 16px", fontSize: 14, fontWeight: 800, marginBottom: 12 }}>
                    Same answer as {bonusMatchName}! +1 bonus
                  </div>
                )}
                <div style={{ fontSize: 15, fontWeight: 700, opacity: 0.65, marginBottom: 4 }}>
                  Your answer: <span style={{ opacity: 1, color: "white" }}>{hasSkipped ? "(skipped)" : myAnswerRecord?.text}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65, marginTop: 16 }}>
                  Waiting for: {waitingOnPlayers.map(p => p.name).join(", ")}
                </div>
              </div>
            ) : (
              <div>
                <textarea
                  value={myAnswer}
                  onChange={e => { setMyAnswer(e.target.value); trackTyping() }}
                  placeholder="Your answer…"
                  maxLength={300}
                  rows={3}
                  style={{ background: WARM_LIGHT, color: "white", fontSize: 20, padding: "16px 18px", width: "100%", border: "none", outline: "none", resize: "none", display: "block", boxSizing: "border-box", lineHeight: 1.4, marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => submitAnswer(false)}
                    disabled={!myAnswer.trim() || submittingAnswer}
                    style={{ background: YELLOW, color: "#000", fontSize: 18, fontWeight: 900, padding: "16px", flex: 1, display: "block", animation: nudgeAnswer ? "nudgePulse 1.0s ease-in-out infinite" : "none" }}
                  >
                    {submittingAnswer ? "Submitting…" : "Submit Answer"}
                  </button>
                  <button
                    onClick={() => submitAnswer(true)}
                    disabled={submittingAnswer}
                    style={{ background: WARM_LIGHT, color: "white", fontSize: 15, fontWeight: 700, padding: "16px 20px", flexShrink: 0 }}
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
            <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65, marginBottom: 16 }}>
              {myVoteId ? "Vote cast — tap ✕ to change:" : "Vote for your favorite:"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {answerGroups.map(group => {
                const isMine = group.playerIds.includes(myPlayerId)
                const isSelected = group.answerIds.includes(myVoteId)
                const canVote = !isMine && (!myVoteId || changingVoteRef.current)
                return (
                  <div key={group.primaryId}>
                    <div style={{ display: "flex", alignItems: "stretch" }}>
                      <button
                        onClick={() => {
                          if (isMine) { setSelfFlash(true); setTimeout(() => setSelfFlash(false), 500); return }
                          if (canVote) submitVote(group.primaryId)
                        }}
                        disabled={submittingVote || isSelected}
                        style={{
                          flex: 1,
                          background: isSelected ? YELLOW : isMine && selfFlash ? "rgba(255,80,80,0.25)" : CARD_BG,
                          color: isSelected ? "#000" : "white",
                          fontSize: 18,
                          fontWeight: 700,
                          padding: "18px 20px",
                          textAlign: "left",
                          display: "block",
                          opacity: myVoteId && !isSelected && !changingVoteRef.current ? 0.45 : 1,
                        }}
                      >
                        {group.text}
                      </button>
                      {isSelected && (
                        <button
                          onClick={handleDeselect}
                          style={{ background: "#4A123B", color: YELLOW, fontSize: 22, fontWeight: 900, padding: "18px 24px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {isMine && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: selfFlash ? RED : "rgba(255,255,255,0.65)", marginTop: 4, marginLeft: 2, transition: "color 150ms" }}>
                        Your answer — you can't vote for yourself
                      </div>
                    )}
                  </div>
                )
              })}

              {(() => {
                const isNota = myVoteId === "nota"
                const canVoteNota = !myVoteId || changingVoteRef.current
                return (
                  <div style={{ display: "flex", alignItems: "stretch", marginTop: 4 }}>
                    <button
                      onClick={() => { if (canVoteNota && !isNota) submitVote(null) }}
                      disabled={submittingVote || isNota}
                      style={{
                        flex: 1,
                        background: isNota ? YELLOW : WARM_LIGHT,
                        color: isNota ? "#000" : "rgba(255,255,255,0.5)",
                        fontSize: 15,
                        fontWeight: 700,
                        padding: "16px 20px",
                        textAlign: "left",
                        display: "block",
                        opacity: myVoteId && !isNota && !changingVoteRef.current ? 0.45 : 1,
                      }}
                    >
                      None of the above
                    </button>
                    {isNota && (
                      <button
                        onClick={handleDeselect}
                        style={{ background: "#4A123B", color: YELLOW, fontSize: 22, fontWeight: 900, padding: "16px 24px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Who has voted */}
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>
                Votes
              </div>
              {eligibleVoterIds.map(pid => {
                const p = players.find(x => x.id === pid)
                return (
                  <div key={pid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: votedPlayerIds.has(pid) ? GREEN : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{p?.name}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Scores — answering/voting only */}
        {(phase === "answering" || phase === "voting") && (
          <div style={{ marginTop: "auto", paddingTop: 32 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.85)", marginBottom: 12 }}>
              Scores
            </div>
            {sortedPlayers.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
                <div style={{ background: WARM_LIGHT, fontSize: 18, fontWeight: 900, minWidth: 40, textAlign: "center", padding: "4px 0", color: "white" }}>
                  {p.score}
                </div>
                <span style={{ fontSize: 16, fontWeight: 700, color: p.id === myPlayerId ? YELLOW : "white" }}>{p.name}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
      {pokeSystemNode()}
    </>
  )
}

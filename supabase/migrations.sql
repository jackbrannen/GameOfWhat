-- ============================================================
-- Migration: NOTA votes, between_rounds phase, start_next_round
-- Run this in the Supabase SQL editor after the initial schema.
-- ============================================================

-- Allow null answer_id in gow_votes (null = "None of the Above")
alter table public.gow_votes alter column answer_id drop not null;

-- ============================================================
-- Updated gow_submit_vote: handles NOTA (null answer_id)
-- ============================================================
create or replace function public.gow_submit_vote(
  p_code        text,
  p_question_id uuid,
  p_voter_id    uuid,
  p_answer_id   uuid   -- null means "None of the Above"
)
returns void language plpgsql security definer as $$
declare
  g            record;
  voter_count  int;
  vote_count   int;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'play' or g.question_phase <> 'voting' then return; end if;
  if g.current_question_id <> p_question_id then return; end if;

  insert into public.gow_votes (question_id, voter_id, answer_id)
  values (p_question_id, p_voter_id, p_answer_id)
  on conflict (question_id, voter_id) do update set answer_id = excluded.answer_id;

  -- Update vote_count on the answer (skip for NOTA)
  if p_answer_id is not null then
    update public.gow_answers
    set vote_count = (select count(*) from public.gow_votes where answer_id = p_answer_id)
    where id = p_answer_id;
  end if;

  -- Count eligible voters: question author + all non-skipped answerers
  select count(*) into voter_count
  from (
    select author_id as id from public.gow_questions where id = p_question_id
    union
    select player_id from public.gow_answers where question_id = p_question_id and not skipped
  ) voters;

  select count(*) into vote_count
  from public.gow_votes where question_id = p_question_id;

  if vote_count >= voter_count then
    -- Award points
    update public.gow_players pl
    set score = pl.score + a.vote_count
    from public.gow_answers a
    where a.question_id = p_question_id
      and a.player_id = pl.id
      and a.vote_count > 0
      and not a.skipped;

    update public.gow_games set question_phase = 'results' where code = p_code;
  end if;
end;
$$;

-- ============================================================
-- Updated gow_advance_question: uses between_rounds phase
-- ============================================================
create or replace function public.gow_advance_question(p_code text)
returns void language plpgsql security definer as $$
declare
  g          record;
  next_q     uuid;
  next_round int;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'play' or g.question_phase <> 'results' then return; end if;

  -- Next unplayed question in this round
  select id into next_q
  from public.gow_questions
  where game_code = p_code
    and round_index = g.round_index
    and not played
  order by play_order
  limit 1;

  if next_q is not null then
    update public.gow_questions set played = true where id = next_q;
    update public.gow_games
    set current_question_id = next_q,
        question_phase      = 'answering'
    where code = p_code;
    return;
  end if;

  -- Round complete
  next_round := g.round_index + 1;
  if next_round < g.rounds_total then
    -- Show between-rounds screen; questions cleared when next round starts
    update public.gow_games
    set phase               = 'between_rounds',
        question_phase      = null,
        current_question_id = null,
        round_index         = next_round
    where code = p_code;
    return;
  end if;

  -- Game over
  update public.gow_games
  set phase               = 'finished',
      question_phase      = null,
      current_question_id = null
  where code = p_code;
end;
$$;

-- ============================================================
-- New RPC: gow_start_next_round
-- Called from the between_rounds screen to begin question writing
-- ============================================================
create or replace function public.gow_start_next_round(p_code text)
returns void language plpgsql security definer as $$
begin
  -- Clear player questions so everyone writes new ones
  update public.gow_players set question = null where game_code = p_code;

  -- Return to lobby for question submission
  update public.gow_games
  set phase = 'lobby'
  where code = p_code and phase = 'between_rounds';
end;
$$;

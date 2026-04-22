-- ============================================================
-- Per-player advance confirmation (replaces single "Next Question")
-- ============================================================
create table if not exists public.gow_question_advances (
  question_id uuid not null references public.gow_questions(id) on delete cascade,
  player_id   uuid not null references public.gow_players(id) on delete cascade,
  primary key (question_id, player_id)
);
alter table public.gow_question_advances enable row level security;
create policy "anon all" on public.gow_question_advances for all using (true) with check (true);

create or replace function public.gow_player_advance(
  p_code        text,
  p_question_id uuid,
  p_player_id   uuid
)
returns void language plpgsql security definer as $$
declare
  g              record;
  eligible_count int;
  advance_count  int;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'play' or g.question_phase <> 'results' then return; end if;
  if g.current_question_id <> p_question_id then return; end if;

  insert into public.gow_question_advances (question_id, player_id)
  values (p_question_id, p_player_id)
  on conflict do nothing;

  select count(*) into eligible_count
  from (
    select author_id as id from public.gow_questions where id = p_question_id
    union
    select player_id from public.gow_answers where question_id = p_question_id and not skipped
  ) eligible;

  select count(*) into advance_count
  from public.gow_question_advances where question_id = p_question_id;

  if advance_count >= eligible_count then
    perform public.gow_advance_question(p_code);
  end if;
end;
$$;

-- ============================================================
-- Add real name columns to gow_players
-- ============================================================
alter table public.gow_players add column if not exists first_name text;
alter table public.gow_players add column if not exists last_name text;

-- ============================================================
-- Allow null answer_id in gow_votes (null = None of the Above)
-- ============================================================
alter table public.gow_votes alter column answer_id drop not null;

-- ============================================================
-- Updated gow_submit_vote: handles NOTA + propagates vote_count
-- to answers with identical text so both writers earn points
-- ============================================================
create or replace function public.gow_submit_vote(
  p_code        text,
  p_question_id uuid,
  p_voter_id    uuid,
  p_answer_id   uuid
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

  if p_answer_id is not null then
    update public.gow_answers
    set vote_count = (select count(*) from public.gow_votes where answer_id = p_answer_id)
    where id = p_answer_id;

    -- Propagate same vote_count to answers with identical text
    update public.gow_answers a_twin
    set vote_count = (select count(*) from public.gow_votes where answer_id = p_answer_id)
    from public.gow_answers a_primary
    where a_primary.id = p_answer_id
      and a_twin.question_id = p_question_id
      and a_twin.id <> p_answer_id
      and lower(trim(a_twin.text)) = lower(trim(a_primary.text))
      and not a_twin.skipped;
  end if;

  select count(*) into voter_count
  from (
    select author_id as id from public.gow_questions where id = p_question_id
    union
    select player_id from public.gow_answers where question_id = p_question_id and not skipped
  ) voters;

  select count(*) into vote_count
  from public.gow_votes where question_id = p_question_id;

  if vote_count >= voter_count then
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
-- Migration: collect questions per-round in between_rounds phase
-- Run this in the Supabase SQL editor.
-- ============================================================

-- Updated gow_start_game:
-- No longer collects questions upfront. Just moves to between_rounds
-- so round 1 question collection happens on the same screen as all rounds.
create or replace function public.gow_start_game(p_code text)
returns void language plpgsql security definer as $$
declare
  g record;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'lobby' then return; end if;

  update public.gow_players set question = null where game_code = p_code;

  update public.gow_games
  set phase          = 'between_rounds',
      question_phase = null,
      round_index    = 0
  where code = p_code;
end;
$$;

-- Updated gow_advance_question:
-- Clears player questions when entering between_rounds so players
-- can submit fresh questions for the next round inline.
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
    -- Clear player questions so everyone writes new ones for next round
    update public.gow_players set question = null where game_code = p_code;
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

-- Updated gow_start_next_round:
-- Copies submitted player questions into gow_questions for the current
-- round_index and starts the round (never goes back to lobby).
create or replace function public.gow_start_next_round(p_code text)
returns void language plpgsql security definer as $$
declare
  g       record;
  first_q uuid;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'between_rounds' then return; end if;

  insert into public.gow_questions (game_code, author_id, text, round_index, play_order)
  select p_code, id, question, g.round_index, row_number() over (order by random())
  from public.gow_players
  where game_code = p_code and question is not null;

  select id into first_q
  from public.gow_questions
  where game_code = p_code and round_index = g.round_index
  order by play_order
  limit 1;

  if first_q is null then return; end if;

  update public.gow_questions set played = true where id = first_q;

  update public.gow_games
  set phase               = 'play',
      question_phase      = 'answering',
      current_question_id = first_q
  where code = p_code;
end;
$$;

-- ============================================================
-- Reset game to lobby (clears all round data, scores, questions)
-- ============================================================
create or replace function public.gow_reset_game(p_code text)
returns void language plpgsql security definer as $$
begin
  delete from public.gow_votes
    where question_id in (select id from public.gow_questions where game_code = p_code);
  delete from public.gow_answers
    where question_id in (select id from public.gow_questions where game_code = p_code);
  delete from public.gow_questions where game_code = p_code;
  update public.gow_players set score = 0, question = null where game_code = p_code;
  update public.gow_games
    set phase               = 'lobby',
        question_phase      = null,
        current_question_id = null,
        round_index         = 0
  where code = p_code;
end;
$$;

-- ============================================================
-- Allow a player to retract their vote during voting phase
-- ============================================================
create or replace function public.gow_retract_vote(
  p_code        text,
  p_question_id uuid,
  p_voter_id    uuid
)
returns void language plpgsql security definer as $$
declare
  g record;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'play' or g.question_phase <> 'voting' then return; end if;
  if g.current_question_id <> p_question_id then return; end if;

  delete from public.gow_votes
  where question_id = p_question_id and voter_id = p_voter_id;
end;
$$;

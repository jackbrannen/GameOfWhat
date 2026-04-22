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

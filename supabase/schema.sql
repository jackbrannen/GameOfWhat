-- ============================================================
-- The Game of What — Supabase Schema
-- ============================================================
-- Run this in the Supabase SQL editor for a new project.
-- Tables use a "gow_" prefix to avoid collisions.
-- ============================================================

-- Games (current_question_id added as FK after gow_questions is created)
create table public.gow_games (
  code                text primary key,
  phase               text not null default 'lobby',   -- lobby | play | finished
  question_phase      text,                             -- answering | voting | results
  round_index         int not null default 0,
  rounds_total        int not null default 3,
  current_question_id uuid,
  created_at          timestamptz not null default now()
);

-- Players
create table public.gow_players (
  id          uuid primary key default gen_random_uuid(),
  game_code   text not null references public.gow_games(code) on delete cascade,
  name        text not null,
  score       int not null default 0,
  question    text,   -- their submitted question text for this round
  created_at  timestamptz not null default now()
);

-- Questions (one per player per round, randomised order assigned at game start)
create table public.gow_questions (
  id           uuid primary key default gen_random_uuid(),
  game_code    text not null references public.gow_games(code) on delete cascade,
  author_id    uuid not null references public.gow_players(id) on delete cascade,
  text         text not null,
  round_index  int not null default 0,
  play_order   int,   -- randomised order within the round
  played       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Add FK now that gow_questions exists
alter table public.gow_games
  add constraint gow_games_current_question_id_fkey
  foreign key (current_question_id) references public.gow_questions(id);

-- Answers (one per eligible player per question; skipped = true if player passed)
create table public.gow_answers (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.gow_questions(id) on delete cascade,
  player_id    uuid not null references public.gow_players(id) on delete cascade,
  text         text,
  skipped      boolean not null default false,
  vote_count   int not null default 0,
  random_order float not null default random(),  -- for anonymous shuffle display
  created_at   timestamptz not null default now(),
  unique (question_id, player_id)
);

-- Votes (one per voter per question)
create table public.gow_votes (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.gow_questions(id) on delete cascade,
  voter_id    uuid not null references public.gow_players(id) on delete cascade,
  answer_id   uuid not null references public.gow_answers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (question_id, voter_id)
);

-- ============================================================
-- RPC: gow_start_game
-- Copies player questions into gow_questions with random play_order,
-- sets first question, transitions to play.
-- ============================================================
create or replace function public.gow_start_game(p_code text)
returns void language plpgsql security definer as $$
declare
  g record;
  first_q uuid;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'lobby' then return; end if;

  -- Copy each player's question into gow_questions with a random play_order
  insert into public.gow_questions (game_code, author_id, text, round_index, play_order)
  select p_code, id, question, 0, row_number() over (order by random())
  from public.gow_players
  where game_code = p_code and question is not null;

  -- Pick the first question (lowest play_order)
  select id into first_q
  from public.gow_questions
  where game_code = p_code and round_index = 0
  order by play_order
  limit 1;

  update public.gow_questions set played = true where id = first_q;

  update public.gow_games
  set phase               = 'play',
      question_phase      = 'answering',
      round_index         = 0,
      current_question_id = first_q
  where code = p_code;
end;
$$;

-- ============================================================
-- RPC: gow_submit_answer
-- Records a player's answer (or skip). Auto-advances to voting
-- once all eligible players have submitted.
-- ============================================================
create or replace function public.gow_submit_answer(
  p_code        text,
  p_question_id uuid,
  p_player_id   uuid,
  p_text        text,
  p_skipped     boolean
)
returns void language plpgsql security definer as $$
declare
  g              record;
  eligible_count int;
  submitted_count int;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'play' or g.question_phase <> 'answering' then return; end if;
  if g.current_question_id <> p_question_id then return; end if;

  -- Upsert answer
  insert into public.gow_answers (question_id, player_id, text, skipped)
  values (p_question_id, p_player_id, p_text, p_skipped)
  on conflict (question_id, player_id) do update
    set text = excluded.text, skipped = excluded.skipped;

  -- Count eligible answerers (everyone except the question author)
  select count(*) into eligible_count
  from public.gow_players pl
  join public.gow_questions q on q.id = p_question_id
  where pl.game_code = p_code and pl.id <> q.author_id;

  select count(*) into submitted_count
  from public.gow_answers
  where question_id = p_question_id;

  -- If all eligible players have submitted, open voting
  if submitted_count >= eligible_count then
    update public.gow_games set question_phase = 'voting' where code = p_code;
  end if;
end;
$$;

-- ============================================================
-- RPC: gow_submit_vote
-- Records a vote. Auto-advances to results once all voters
-- have voted (voters = question author + everyone who answered).
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

  -- Upsert vote
  insert into public.gow_votes (question_id, voter_id, answer_id)
  values (p_question_id, p_voter_id, p_answer_id)
  on conflict (question_id, voter_id) do update set answer_id = excluded.answer_id;

  -- Update vote_count on the answer (merge identical texts handled in display layer)
  update public.gow_answers
  set vote_count = (
    select count(*) from public.gow_votes where answer_id = p_answer_id
  )
  where id = p_answer_id;

  -- Voters = question author + all non-skipped answerers
  select count(*) into voter_count
  from (
    select author_id as id from public.gow_questions where id = p_question_id
    union
    select player_id from public.gow_answers where question_id = p_question_id and not skipped
  ) voters;

  select count(*) into vote_count
  from public.gow_votes where question_id = p_question_id;

  if vote_count >= voter_count then
    -- Award points: each answer's writer gets vote_count points
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
-- RPC: gow_advance_question
-- Moves to the next question in the round, or next round,
-- or ends the game.
-- ============================================================
create or replace function public.gow_advance_question(p_code text)
returns void language plpgsql security definer as $$
declare
  g        record;
  next_q   uuid;
  next_round int;
begin
  select * into g from public.gow_games where code = p_code for update;
  if not found or g.phase <> 'play' or g.question_phase <> 'results' then return; end if;

  -- Find next unplayed question in this round
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

  -- Round complete. Are there more rounds?
  next_round := g.round_index + 1;
  if next_round < g.rounds_total then
    -- Reset player questions for the new round (players re-submit via lobby)
    -- For now, transition back to lobby so players can write new questions
    update public.gow_players set question = null where game_code = p_code;
    update public.gow_games
    set round_index         = next_round,
        phase               = 'lobby',
        question_phase      = null,
        current_question_id = null
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
-- RLS: enable row-level security, allow anon read/write
-- (tighten before production)
-- ============================================================
alter table public.gow_games   enable row level security;
alter table public.gow_players enable row level security;
alter table public.gow_questions enable row level security;
alter table public.gow_answers enable row level security;
alter table public.gow_votes   enable row level security;

create policy "anon all" on public.gow_games   for all using (true) with check (true);
create policy "anon all" on public.gow_players for all using (true) with check (true);
create policy "anon all" on public.gow_questions for all using (true) with check (true);
create policy "anon all" on public.gow_answers for all using (true) with check (true);
create policy "anon all" on public.gow_votes   for all using (true) with check (true);

-- Add a status column to edge_picks to distinguish live picks from ones
-- that were swapped off the daily card at refresh time. Two values today:
--
--   'active'      — on the card, live for grading/CLV/stats
--   'swapped_off' — dropped at refresh before game start; excluded from
--                   grading/CLV/stats. Retained for audit / email diff.
--
-- Existing rows default to 'active' so pre-migration picks remain live.

ALTER TABLE edge_picks
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE edge_picks
  ADD CONSTRAINT edge_picks_status_check
  CHECK (status IN ('active', 'swapped_off'));

CREATE INDEX IF NOT EXISTS idx_edge_picks_card_date_status
  ON edge_picks (card_date, status);

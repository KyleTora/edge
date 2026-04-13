-- Daily card ranker — add score and card_date to edge_picks.
-- Run manually in the Supabase SQL editor for project mlokvmawnzgtyuzpccjj.

ALTER TABLE edge_picks ADD COLUMN score NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE edge_picks ADD COLUMN card_date DATE NOT NULL DEFAULT '1970-01-01';

-- Backfill card_date from game_date for existing rows
UPDATE edge_picks SET card_date = game_date WHERE card_date = '1970-01-01';

CREATE INDEX IF NOT EXISTS idx_edge_picks_card_date ON edge_picks (card_date DESC);

-- ============================================================================
-- MIGRAÇÃO: Adicionar colunas de médias individuais por time
-- Execute este SQL no SQL Editor do Supabase Dashboard
-- ============================================================================

-- Média de escanteios individual de cada time (extraída da página "Média" do BCS)
ALTER TABLE public.bestcorner_prelive_stats 
ADD COLUMN IF NOT EXISTS home_team_avg_corners_ht NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS away_team_avg_corners_ht NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS home_team_avg_corners_ft NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS away_team_avg_corners_ft NUMERIC DEFAULT NULL;

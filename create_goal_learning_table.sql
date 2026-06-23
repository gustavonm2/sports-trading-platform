-- ============================================================================
-- SCRIPT DE CRIAÇÃO DA TABELA DE APRENDIZADO AUTOMÁTICO DE GOLS
-- Execute este script no SQL Editor do Supabase Dashboard
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.goal_learning_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Informações da partida
    fixture_id BIGINT NOT NULL,
    league VARCHAR NOT NULL,
    home_team VARCHAR NOT NULL,
    away_team VARCHAR NOT NULL,
    elapsed INTEGER NOT NULL,
    period VARCHAR NOT NULL,
    goals_home INTEGER NOT NULL,
    goals_away INTEGER NOT NULL,
    scoring_team VARCHAR NOT NULL, -- 'home' | 'away'
    source VARCHAR NOT NULL,
    league_tier INTEGER NOT NULL,
    
    -- Métricas APM/IPR — Mandante
    home_apm_global NUMERIC DEFAULT 0,
    home_apm_10 NUMERIC DEFAULT 0,
    home_apm_5 NUMERIC DEFAULT 0,
    home_apm_3 NUMERIC DEFAULT 0,
    home_ipr NUMERIC DEFAULT 0,
    
    -- Métricas APM/IPR — Visitante
    away_apm_global NUMERIC DEFAULT 0,
    away_apm_10 NUMERIC DEFAULT 0,
    away_apm_5 NUMERIC DEFAULT 0,
    away_apm_3 NUMERIC DEFAULT 0,
    away_ipr NUMERIC DEFAULT 0,
    
    -- Stats brutos — Mandante
    home_shots_on INTEGER DEFAULT 0,
    home_total_shots INTEGER DEFAULT 0,
    home_corners INTEGER DEFAULT 0,
    home_possession INTEGER DEFAULT 0,
    home_da INTEGER DEFAULT 0,
    home_yellow INTEGER DEFAULT 0,
    home_red INTEGER DEFAULT 0,
    
    -- Stats brutos — Visitante
    away_shots_on INTEGER DEFAULT 0,
    away_total_shots INTEGER DEFAULT 0,
    away_corners INTEGER DEFAULT 0,
    away_possession INTEGER DEFAULT 0,
    away_da INTEGER DEFAULT 0,
    away_yellow INTEGER DEFAULT 0,
    away_red INTEGER DEFAULT 0,
    
    -- Scores compostos
    home_score NUMERIC DEFAULT 0,
    away_score NUMERIC DEFAULT 0
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.goal_learning_entries ENABLE ROW LEVEL SECURITY;

-- Limpar política se já existir
DROP POLICY IF EXISTS "Permitir Leitura e Escrita Pública em goal_learning_entries" ON public.goal_learning_entries;

-- Criar política de acesso público total (compatível com a arquitetura anônima do app)
CREATE POLICY "Permitir Leitura e Escrita Pública em goal_learning_entries" 
ON public.goal_learning_entries 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Criar índices para performance de buscas por partida e minuto
CREATE INDEX IF NOT EXISTS idx_goal_learning_fixture_id ON public.goal_learning_entries(fixture_id);
CREATE INDEX IF NOT EXISTS idx_goal_learning_elapsed ON public.goal_learning_entries(elapsed);
CREATE INDEX IF NOT EXISTS idx_goal_learning_created_at ON public.goal_learning_entries(created_at DESC);

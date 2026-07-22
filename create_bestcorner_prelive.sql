-- ============================================================================
-- SCRIPT DE CRIAÇÃO DA TABELA DE ESTATÍSTICAS PRÉ-LIVE DO BESTCORNER (BCS)
-- Execute este script no SQL Editor do Supabase Dashboard
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bestcorner_prelive_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Identificação do Jogo
    date DATE NOT NULL,
    home_team VARCHAR NOT NULL,
    away_team VARCHAR NOT NULL,
    league VARCHAR,
    match_time VARCHAR,
    
    -- Métricas de Canto no HT (Half Time)
    ht_avg NUMERIC DEFAULT NULL,              -- Média geral de cantos no HT
    ht_limit_rate NUMERIC DEFAULT NULL,       -- Taxa de acerto combinada do limite HT (%)
    home_ht_limit_rate NUMERIC DEFAULT NULL,  -- Taxa do mandante jogando em casa (%)
    away_ht_limit_rate NUMERIC DEFAULT NULL,  -- Taxa do visitante jogando fora (%)
    ht_limit_avg NUMERIC DEFAULT NULL,        -- Média de cantos na janela limite HT
    
    -- Métricas de Canto no FT (Full Time)
    ft_avg NUMERIC DEFAULT NULL,              -- Média geral de cantos no FT
    ft_limit_rate NUMERIC DEFAULT NULL,       -- Taxa de acerto combinada do limite FT (%)
    home_ft_limit_rate NUMERIC DEFAULT NULL,  -- Taxa do mandante jogando em casa (%)
    away_ft_limit_rate NUMERIC DEFAULT NULL,  -- Taxa do visitante jogando fora (%)
    ft_limit_avg NUMERIC DEFAULT NULL,        -- Média de cantos na janela limite FT
    
    -- Flags e Taxas de Destaque (Highlights / Partidas Destaques)
    is_top_ht BOOLEAN DEFAULT FALSE,          -- Jogo listado no Destaques Limite HT?
    is_top_ft BOOLEAN DEFAULT FALSE,          -- Jogo listado no Destaques Limite FT?
    top_ht_rate NUMERIC DEFAULT NULL,         -- Taxa informada no destaque HT (%)
    top_ft_rate NUMERIC DEFAULT NULL,         -- Taxa informada no destaque FT (%)
    
    -- Restrição única para permitir mesclar dados de escaneamentos diferentes (UPSERT)
    CONSTRAINT unique_date_match UNIQUE (date, home_team, away_team)
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.bestcorner_prelive_stats ENABLE ROW LEVEL SECURITY;

-- Limpar política se já existir
DROP POLICY IF EXISTS "Permitir Leitura e Escrita Pública em bestcorner_prelive_stats" ON public.bestcorner_prelive_stats;

-- Criar política de acesso público total (para sincronização via extensão e leitura na plataforma)
CREATE POLICY "Permitir Leitura e Escrita Pública em bestcorner_prelive_stats" 
ON public.bestcorner_prelive_stats 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Criar índices para performance de buscas por data e por times (usados no fuzzy matching)
CREATE INDEX IF NOT EXISTS idx_bc_prelive_date ON public.bestcorner_prelive_stats(date);
CREATE INDEX IF NOT EXISTS idx_bc_prelive_home_team ON public.bestcorner_prelive_stats(home_team);
CREATE INDEX IF NOT EXISTS idx_bc_prelive_away_team ON public.bestcorner_prelive_stats(away_team);

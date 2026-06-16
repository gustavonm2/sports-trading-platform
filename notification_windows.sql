CREATE TABLE IF NOT EXISTS public.notification_windows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market TEXT NOT NULL,
    period TEXT NOT NULL,
    min_minute INTEGER NOT NULL,
    max_minute INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Permissões
ALTER TABLE public.notification_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users" ON public.notification_windows FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for anonymous users" ON public.notification_windows FOR ALL USING (auth.role() = 'anon');

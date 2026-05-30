import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://kpldcqujhpcihpdlzpeh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwbGRjcXVqaHBjaWhwZGx6cGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTIyMTAsImV4cCI6MjA5NTcyODIxMH0.zfpSeKGm-RF0bvbj-H-yVm4it9qZNzBOX7KjrjieGfs';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

UPDATE public.agents SET model = 'gemini-2.5-flash' WHERE model = 'gemini-3.5-flash';
UPDATE public.user_settings SET default_model = 'gemini-2.5-flash' WHERE default_model = 'gemini-3.5-flash';
UPDATE public.agents SET status = 'idle' WHERE status = 'error';
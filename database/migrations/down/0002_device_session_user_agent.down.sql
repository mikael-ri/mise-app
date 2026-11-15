-- Local/scratch rollback only; production is roll-forward (hard rule 6).
ALTER TABLE device_sessions DROP CONSTRAINT IF EXISTS device_sessions_user_agent_len_ck;
ALTER TABLE device_sessions DROP COLUMN IF EXISTS user_agent;

-- Answers from "Ask about this object", cached so a repeated question costs nothing.
CREATE TABLE ask_cache (
  key TEXT PRIMARY KEY,      -- hash of object id + normalised question
  answer TEXT NOT NULL,      -- JSON returned to the browser
  created_at TEXT NOT NULL
);

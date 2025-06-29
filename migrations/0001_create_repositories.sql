-- Create repositories table
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  language TEXT,
  description TEXT,
  url TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create indexes
CREATE INDEX repositories_name_idx ON repositories(name);
CREATE INDEX repositories_owner_idx ON repositories(owner);
CREATE INDEX repositories_language_idx ON repositories(language);
CREATE INDEX repositories_is_hidden_idx ON repositories(is_hidden);
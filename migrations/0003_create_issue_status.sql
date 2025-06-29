-- Create issue_status table
CREATE TABLE issue_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  github_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('interested', 'in_progress', 'unwanted')),
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create indexes
CREATE INDEX issue_status_github_id_idx ON issue_status(github_id);
CREATE INDEX issue_status_status_idx ON issue_status(status);

-- Create trigger to automatically update updated_at timestamp
CREATE TRIGGER issue_status_updated_at 
    AFTER UPDATE ON issue_status
BEGIN
    UPDATE issue_status SET updated_at = datetime('now') WHERE id = NEW.id;
END;
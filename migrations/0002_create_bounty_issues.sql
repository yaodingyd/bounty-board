-- Create bounty_issues table
CREATE TABLE bounty_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  html_url TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL,
  comments INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  has_bounty_label INTEGER NOT NULL DEFAULT 0,
  has_bounty_comment INTEGER NOT NULL DEFAULT 0,
  has_payout_comment INTEGER NOT NULL DEFAULT 0,
  has_assignment_comment INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  has_implementation_details INTEGER NOT NULL DEFAULT 0,
  bounty_value REAL NOT NULL DEFAULT 0,
  labels TEXT NOT NULL DEFAULT '[]',
  last_fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_local_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_local_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create indexes
CREATE INDEX bounty_issues_github_id_idx ON bounty_issues(github_id);
CREATE INDEX bounty_issues_score_idx ON bounty_issues(score);
CREATE INDEX bounty_issues_repository_id_idx ON bounty_issues(repository_id);
CREATE INDEX bounty_issues_state_idx ON bounty_issues(state);
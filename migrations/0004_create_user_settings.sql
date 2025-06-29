-- Create user_settings table
CREATE TABLE user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- Constraint for allowed setting keys (excluding hidden_repositories which is now in repositories table)
  CONSTRAINT check_setting_key CHECK (setting_key IN ('display_preferences', 'search_query'))
);

-- Create indexes
CREATE INDEX user_settings_setting_key_idx ON user_settings(setting_key);

-- Create trigger to automatically update updated_at timestamp
CREATE TRIGGER user_settings_updated_at 
    AFTER UPDATE ON user_settings
BEGIN
    UPDATE user_settings SET updated_at = datetime('now') WHERE id = NEW.id;
END;
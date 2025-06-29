import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';

// Repository table
export const repositories = sqliteTable('repositories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(), // e.g., "facebook/react"
  owner: text('owner').notNull(), // e.g., "facebook"
  repoName: text('repo_name').notNull(), // e.g., "react"
  language: text('language'), // Primary language
  description: text('description'),
  url: text('url').notNull(), // GitHub URL
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
  updatedAt: text('updated_at').notNull().default(sql`datetime('now')`)
}, (table) => ({
  nameIdx: index('repositories_name_idx').on(table.name),
  ownerIdx: index('repositories_owner_idx').on(table.owner),
  languageIdx: index('repositories_language_idx').on(table.language),
  isHiddenIdx: index('repositories_is_hidden_idx').on(table.isHidden)
}));

// Main bounty issues table
export const bountyIssues = sqliteTable('bounty_issues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  githubId: integer('github_id').notNull().unique(),
  repositoryId: integer('repository_id').notNull().references(() => repositories.id),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  htmlUrl: text('html_url').notNull(),
  body: text('body'),
  state: text('state').notNull(),
  comments: integer('comments').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  score: real('score').notNull().default(0),
  hasBountyLabel: integer('has_bounty_label', { mode: 'boolean' }).notNull().default(false),
  hasBountyComment: integer('has_bounty_comment', { mode: 'boolean' }).notNull().default(false),
  hasPayoutComment: integer('has_payout_comment', { mode: 'boolean' }).notNull().default(false),
  hasAssignmentComment: integer('has_assignment_comment', { mode: 'boolean' }).notNull().default(false),
  commentCount: integer('comment_count').notNull().default(0),
  hasImplementationDetails: integer('has_implementation_details', { mode: 'boolean' }).notNull().default(false),
  bountyValue: real('bounty_value').notNull().default(0),
  labels: text('labels').notNull().default('[]'),
  lastFetchedAt: text('last_fetched_at').notNull().default(sql`datetime('now')`),
  createdLocalAt: text('created_local_at').notNull().default(sql`datetime('now')`),
  updatedLocalAt: text('updated_local_at').notNull().default(sql`datetime('now')`)
}, (table) => ({
  githubIdIdx: index('bounty_issues_github_id_idx').on(table.githubId),
  scoreIdx: index('bounty_issues_score_idx').on(table.score),
  repositoryIdIdx: index('bounty_issues_repository_id_idx').on(table.repositoryId),
  stateIdx: index('bounty_issues_state_idx').on(table.state)
}));

// Issue status table
export const issueStatus = sqliteTable('issue_status', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  issueId: integer('issue_id').notNull(),
  githubId: integer('github_id').notNull().unique(),
  status: text('status', { enum: ['interested', 'in_progress', 'unwanted'] }).notNull(),
  userId: text('user_id'),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
  updatedAt: text('updated_at').notNull().default(sql`datetime('now')`)
}, (table) => ({
  githubIdIdx: index('issue_status_github_id_idx').on(table.githubId),
  statusIdx: index('issue_status_status_idx').on(table.status)
}));

// User settings table
export const userSettings = sqliteTable('user_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id'),
  settingKey: text('setting_key').notNull().unique(),
  settingValue: text('setting_value').notNull(),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
  updatedAt: text('updated_at').notNull().default(sql`datetime('now')`)
}, (table) => ({
  settingKeyIdx: index('user_settings_setting_key_idx').on(table.settingKey)
}));

// Export types inferred from schema
export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type BountyIssue = typeof bountyIssues.$inferSelect;
export type NewBountyIssue = typeof bountyIssues.$inferInsert;
export type IssueStatus = typeof issueStatus.$inferSelect;
export type NewIssueStatus = typeof issueStatus.$inferInsert;
export type UserSetting = typeof userSettings.$inferSelect;
export type NewUserSetting = typeof userSettings.$inferInsert;
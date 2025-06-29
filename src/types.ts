export interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_FETCH_PER_PAGE?: string;
  GITHUB_FETCH_MAX_PAGES?: string;
  ASSETS: Fetcher;
  DB: D1Database;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  body: string;
  state: string;
  comments: number;
  labels: { name: string }[];
  repository_url: string;
  created_at: string;
  updated_at: string;
  comments_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
}

export interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
  };
  created_at: string;
}

export interface RankedIssue extends GitHubIssue {
  score: number;
  repository: string;
  hasBountyLabel: boolean;
  hasBountyComment: boolean;
  hasPayoutComment: boolean;
  hasAssignmentComment: boolean;
  commentCount: number;
  hasImplementationDetails: boolean;
  bountyValue: number;
  language?: string;
  userStatus?: IssueStatus;
}

// Re-export Drizzle schema types
export type { BountyIssue as StoredIssue, IssueStatus as DbIssueStatus, UserSetting, Repository } from './schema';

export interface SearchResponse {
  issues: RankedIssue[];
  pagination: {
    currentPage: number;
    hasNext: boolean;
    hasPrev: boolean;
    perPage: number;
    actualResultCount: number;
    totalCount?: number;
    totalPages?: number;
  };
}

export interface SearchParams {
  query: string;
  sort: string;
  order: string;
  perPage: number;
  page: number;
  status?: string;
}

export type IssueStatusType = 'interested' | 'in_progress' | 'unwanted';

export interface IssueStatus {
  id: number;
  issue_id: number;
  github_id: number;
  status: IssueStatusType;
  user_id?: string;
  created_at: string;
  updated_at: string;
}

export interface UpdateStatusRequest {
  github_id: number;
  status: IssueStatusType | null; // null to remove status
}

export interface UpdateStatusResponse {
  success: boolean;
  message?: string;
}

// UserSettings interface is now re-exported from schema as UserSetting

export interface HiddenRepositoriesSettings {
  repositories: string[];
}

export interface SearchQuerySettings {
  query: string;
}

export interface UpdateSettingsRequest {
  setting_key: string;
  setting_value: any;
}

export interface UpdateSettingsResponse {
  success: boolean;
  message?: string;
}

export interface GetSettingsResponse {
  success: boolean;
  settings: Record<string, any>;
  message?: string;
}
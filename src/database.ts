import { and, asc, count, desc, eq, inArray, like, not, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { bountyIssues, issueStatus, repositories, userSettings, type IssueStatus as DbIssueStatus, type NewBountyIssue, type NewRepository, type Repository } from './schema';
import { Env, IssueStatusType, RankedIssue, SearchQuerySettings } from './types';

// Minimum score threshold for database insertion
// Issues below this score will be skipped/removed from the database
export const MIN_SCORE_THRESHOLD = 30;

/**
 * Get or create a repository record
 */
export async function getOrCreateRepository(repositoryName: string, repositoryUrl: string, language?: string, env?: Env): Promise<number> {
  if (!env) {
    throw new Error('Environment not provided');
  }

  const db = drizzle(env.DB);

  // Parse owner and repo name from repository string (e.g., "facebook/react")
  const parts = repositoryName.split('/');
  const owner = parts[0] || 'unknown';
  const repoName = parts[1] || repositoryName;

  // Check if repository already exists
  const existingRepo = await db.select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.name, repositoryName))
    .limit(1);

  if (existingRepo.length > 0) {
    // Update language if provided and different
    if (language) {
      await db.update(repositories)
        .set({
          language,
          updatedAt: new Date().toISOString()
        })
        .where(eq(repositories.id, existingRepo[0].id));
    }
    return existingRepo[0].id;
  }

  // Create new repository
  const result = await db.insert(repositories)
    .values({
      name: repositoryName,
      owner,
      repoName,
      language: language || null,
      url: repositoryUrl,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as NewRepository)
    .returning({ id: repositories.id });

  return result[0].id;
}

/**
 * Removes issues from the database that fall below the minimum score threshold
 */
export async function removeLowRankingIssues(env: Env): Promise<number> {
  try {
    const db = drizzle(env.DB);
    const result = await db.delete(bountyIssues)
      .where(sql`${bountyIssues.score} < ${MIN_SCORE_THRESHOLD}`);

    const deletedCount = (result as any).changes || 0;
    if (deletedCount > 0) {
      console.log(`Removed ${deletedCount} low-ranking issues from database (score < ${MIN_SCORE_THRESHOLD})`);
    }

    return deletedCount;
  } catch (error) {
    console.error('Error removing low-ranking issues:', error);
    return 0;
  }
}

// Parse GitHub-style search queries to extract repository filters
function parseSearchQuery(query: string): { repoFilters: string[] } {
  if (!query || query.trim() === '') {
    return { repoFilters: [] };
  }

  const repoFilters: string[] = [];

  // Split query by spaces but handle quoted strings
  const terms = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

  for (const term of terms) {
    if (term.startsWith('repo:')) {
      // Extract repository name from repo:owner/name
      const repoName = term.substring(5).replace(/^"(.*)"$/, '$1');
      if (repoName) {
        repoFilters.push(repoName);
      }
    }
  }

  return { repoFilters };
}

export async function storeIssuesInD1(issues: RankedIssue[], env: Env): Promise<void> {
  console.log(`💾 storeIssuesInD1 called with ${issues.length} issues`);

  // Filter out low-ranking issues before processing
  // This includes assigned issues, completed issues, or issues with very few positive criteria
  const filteredIssues = issues.filter(issue => issue.score >= MIN_SCORE_THRESHOLD);
  const skippedCount = issues.length - filteredIssues.length;

  console.log(`💾 Filtered ${issues.length} → ${filteredIssues.length} issues (min score: ${MIN_SCORE_THRESHOLD})`);

  if (skippedCount > 0) {
    console.log(`💾 Skipped ${skippedCount} low-ranking issues (score < ${MIN_SCORE_THRESHOLD}) - likely assigned or completed issues`);
  }

  const batchSize = 50; // Process in batches for better performance
  let processedCount = 0;
  let updatedCount = 0;
  let insertedCount = 0;
  let errorCount = 0;

  console.log(`💾 Starting to store ${filteredIssues.length} qualifying issues in D1...`);

  // Process issues in batches
  for (let i = 0; i < filteredIssues.length; i += batchSize) {
    const batch = filteredIssues.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(filteredIssues.length / batchSize);

    console.log(`💾 Processing batch ${batchNum}/${totalBatches} (${batch.length} issues)`);

    for (let j = 0; j < batch.length; j++) {
      const issue = batch[j];
      const issueProgress = `[Batch ${batchNum}/${totalBatches}, Issue ${j + 1}/${batch.length}]`;

      try {
        console.log(`💾 ${issueProgress} Storing issue ${issue.id}: "${issue.title?.substring(0, 40)}..." (score: ${issue.score}, lang: ${issue.language})`);

        const result = await upsertIssue(issue, env);
        if (result.isUpdate) {
          updatedCount++;
          console.log(`💾 ${issueProgress} Updated existing issue ${issue.id}`);
        } else {
          insertedCount++;
          console.log(`💾 ${issueProgress} Inserted new issue ${issue.id}`);
        }
        processedCount++;
      } catch (error) {
        errorCount++;
        console.error(`💾 ${issueProgress} Error storing issue ${issue.id}:`, error instanceof Error ? error.message : error);
        if (error instanceof Error && error.stack) {
          console.error(`💾 ${issueProgress} Stack trace:`, error.stack);
        }
      }
    }

    // Small delay between batches to avoid overwhelming D1
    if (i + batchSize < filteredIssues.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  console.log(`💾 Completed storing issues. Total: ${processedCount}, Inserted: ${insertedCount}, Updated: ${updatedCount}, Errors: ${errorCount}`);

  // Remove existing low-ranking issues from the database
  console.log(`💾 Removing low-ranking issues from database...`);
  const removedCount = await removeLowRankingIssues(env);
  console.log(`💾 Storage process complete! Removed ${removedCount} low-ranking issues from database`);
}

async function upsertIssue(issue: RankedIssue, env: Env): Promise<{ isUpdate: boolean }> {
  // Validate required fields
  if (!issue || !issue.id || !issue.title || !issue.html_url) {
    throw new Error(`Invalid issue data for issue ID: ${issue?.id || 'unknown'}`);
  }

  // Skip low-ranking issues
  if (issue.score < MIN_SCORE_THRESHOLD) {
    throw new Error(`Issue ${issue.id} has low score (${issue.score} < ${MIN_SCORE_THRESHOLD}), skipping insertion`);
  }

  const db = drizzle(env.DB);
  const labelsJson = JSON.stringify(issue.labels ? issue.labels.map(l => l.name) : []);

  // Get or create repository
  const repositoryId = await getOrCreateRepository(
    issue.repository || 'unknown/repository',
    issue.repository_url || '',
    issue.language,
    env
  );

  // First, check if the issue exists
  const existingIssue = await db.select({ githubId: bountyIssues.githubId, updatedAt: bountyIssues.updatedAt })
    .from(bountyIssues)
    .where(eq(bountyIssues.githubId, issue.id))
    .limit(1);

  const isUpdate = existingIssue.length > 0;

  const issueData: Partial<NewBountyIssue> = {
    githubId: issue.id,
    repositoryId,
    number: issue.number || 0,
    title: issue.title || 'Untitled Issue',
    htmlUrl: issue.html_url || '',
    body: issue.body || '',
    state: issue.state || 'open',
    comments: issue.comments || 0,
    createdAt: issue.created_at || new Date().toISOString(),
    updatedAt: issue.updated_at || new Date().toISOString(),
    score: issue.score || 0,
    hasBountyLabel: issue.hasBountyLabel || false,
    hasBountyComment: issue.hasBountyComment || false,
    hasPayoutComment: issue.hasPayoutComment || false,
    hasAssignmentComment: issue.hasAssignmentComment || false,
    commentCount: issue.commentCount || 0,
    hasImplementationDetails: issue.hasImplementationDetails || false,
    bountyValue: issue.bountyValue || 0,
    labels: labelsJson,
    lastFetchedAt: new Date().toISOString(),
    updatedLocalAt: new Date().toISOString()
  };

  if (isUpdate) {
    // Update existing issue
    await db.update(bountyIssues)
      .set(issueData)
      .where(eq(bountyIssues.githubId, issue.id));
  } else {
    // Insert new issue
    await db.insert(bountyIssues)
      .values({
        ...issueData,
        createdLocalAt: new Date().toISOString()
      } as NewBountyIssue);
  }

  return { isUpdate };
}

export async function searchIssuesInD1(query: string, env: Env, page: number = 1, perPage: number = 30, statusFilter?: string): Promise<{ issues: RankedIssue[], totalCount?: number }> {
  try {
    console.log('📦 [DB_SEARCH] Starting database search');
    console.log('📦 [DB_SEARCH] Parameters:', {
      query,
      page,
      perPage,
      statusFilter,
      hasEnv: !!env,
      hasDB: !!env?.DB
    });

    if (!env) {
      throw new Error('Environment is null or undefined');
    }

    if (!env.DB) {
      throw new Error('Database binding is null or undefined');
    }

    const db = drizzle(env.DB);
    console.log('📦 [DB_SEARCH] Drizzle instance created successfully');

    // Hidden repositories are now filtered at database level via JOIN condition
    console.log('📦 [DB_SEARCH] Hidden repo filtering happens at database level');

    // Parse the query to extract repository filters and other terms
    let repoFilters: string[] = [];
    try {
      console.log('📦 [DB_SEARCH] Parsing search query:', query);
      const parseResult = parseSearchQuery(query);
      repoFilters = parseResult.repoFilters;
      console.log('📦 [DB_SEARCH] Repository filters extracted:', repoFilters);
    } catch (parseError) {
      console.error('📦 [DB_SEARCH] ERROR: Failed to parse search query:', parseError);
      console.error('📦 [DB_SEARCH] Parse error stack:', parseError instanceof Error ? parseError.stack : 'No stack available');
      repoFilters = [];
    }

    // Build base conditions
    console.log('📦 [DB_SEARCH] Building search conditions...');
    const conditions = [
      eq(bountyIssues.state, 'open'),
      eq(repositories.isHidden, false) // Filter out hidden repositories at database level
    ];
    console.log('📦 [DB_SEARCH] Base conditions added: state = open, repository not hidden');

    // Add simple text search if query is provided
    if (query && query.trim() !== '' && !query.startsWith('repo:')) {
      try {
        const searchTerm = `%${query.trim()}%`;
        console.log('📦 [DB_SEARCH] Adding text search condition for term:', searchTerm);
        conditions.push(
          or(
            like(bountyIssues.title, searchTerm),
            like(bountyIssues.body, searchTerm),
            like(repositories.name, searchTerm),
            like(repositories.description, searchTerm)
          )!
        );
        console.log('📦 [DB_SEARCH] Text search condition added');
      } catch (textSearchError) {
        console.error('📦 [DB_SEARCH] ERROR: Failed to add text search condition:', textSearchError);
        console.error('📦 [DB_SEARCH] Text search error stack:', textSearchError instanceof Error ? textSearchError.stack : 'No stack available');
      }
    }

    // Handle explicit repository filters (repo:owner/name syntax)
    try {
      if (repoFilters.length > 0) {
        console.log('📦 [DB_SEARCH] Adding explicit repository filters:', repoFilters);
        conditions.push(inArray(repositories.name, repoFilters));
        console.log('📦 [DB_SEARCH] Repository filter condition added');
      }
      // Note: Hidden repo filtering is now done at database level via isHidden condition
    } catch (repoFilterError) {
      console.error('📦 [DB_SEARCH] ERROR: Failed to add repository filters:', repoFilterError);
      console.error('📦 [DB_SEARCH] Repo filter error stack:', repoFilterError instanceof Error ? repoFilterError.stack : 'No stack available');
      console.log('📦 [DB_SEARCH] Continuing without repository filters due to error');
    }

    console.log('📦 [DB_SEARCH] Total conditions built:', conditions.length);

    // Build status filter conditions
    let statusCondition = null;
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'interested' || statusFilter === 'in_progress') {
        statusCondition = eq(issueStatus.status, statusFilter as any);
      } else if (statusFilter === 'no_status') {
        statusCondition = sql`${issueStatus.status} IS NULL`;
      }
    } else {
      // By default, hide unwanted issues
      statusCondition = or(
        sql`${issueStatus.status} IS NULL`,
        not(eq(issueStatus.status, 'unwanted'))
      );
    }

    // Build the query using Drizzle ORM
    const baseQuery = db.select()
      .from(bountyIssues)
      .innerJoin(repositories, eq(bountyIssues.repositoryId, repositories.id))
      .leftJoin(issueStatus, eq(bountyIssues.githubId, issueStatus.githubId))
      .$dynamic();

    let finalQuery = baseQuery;

    if (conditions.length > 0 && statusCondition) {
      finalQuery = finalQuery.where(and(...conditions, statusCondition));
    } else if (conditions.length > 0) {
      finalQuery = finalQuery.where(and(...conditions));
    } else if (statusCondition) {
      finalQuery = finalQuery.where(statusCondition);
    }

    finalQuery = finalQuery.orderBy(desc(bountyIssues.score));

    // Execute count query for pagination
    console.log('📦 [DB_SEARCH] Executing count query...');
    let totalCount = 0;
    try {
      const countQuery = db.select({ count: count() })
        .from(bountyIssues)
        .innerJoin(repositories, eq(bountyIssues.repositoryId, repositories.id))
        .leftJoin(issueStatus, eq(bountyIssues.githubId, issueStatus.githubId));

      if (conditions.length > 0 && statusCondition) {
        countQuery.where(and(...conditions, statusCondition));
      } else if (conditions.length > 0) {
        countQuery.where(and(...conditions));
      } else if (statusCondition) {
        countQuery.where(statusCondition);
      }

      const countResult = await countQuery;
      totalCount = countResult[0]?.count || 0;
      console.log('📦 [DB_SEARCH] Total count:', totalCount);
    } catch (countError) {
      console.error('📦 [DB_SEARCH] Error getting count:', countError);
      totalCount = 0;
    }

    // Execute the main query
    console.log('📦 [DB_SEARCH] Executing main query...');
    const issues = await finalQuery.limit(perPage).offset((page - 1) * perPage);

    console.log('📦 [DB_SEARCH] ✅ Database search completed successfully, found', issues.length, 'issues');
    return { issues: convertToRankedIssues(issues as any), totalCount };
  } catch (error) {
    console.error('📦 [DB_SEARCH] ❌ FATAL ERROR in database search:', error);
    console.error('📦 [DB_SEARCH] Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('📦 [DB_SEARCH] Error message:', error instanceof Error ? error.message : String(error));
    console.error('📦 [DB_SEARCH] Error stack:', error instanceof Error ? error.stack : 'No stack available');
    console.error('📦 [DB_SEARCH] Error type:', typeof error);
    console.error('📦 [DB_SEARCH] Search parameters:', {
      query,
      page,
      perPage,
      statusFilter,
      hasEnv: !!env,
      hasDB: !!env?.DB
    });
    console.trace('📦 [DB_SEARCH] Full stack trace for database search error');
    return { issues: [], totalCount: 0 };
  }
}

// Helper function to convert database results to RankedIssue format
function convertToRankedIssues(storedIssues: any[]): RankedIssue[] {
  return storedIssues.map(result => {
    const stored = result.bounty_issues || result;
    const repo = result.repositories;
    const status = result.issue_status;

    return {
      id: stored.githubId,
      number: stored.number,
      title: stored.title,
      html_url: stored.htmlUrl,
      body: stored.body || '',
      state: stored.state,
      comments: stored.comments,
      labels: JSON.parse(stored.labels || '[]').map((name: string) => ({ name })),
      repository_url: repo?.url || '',
      created_at: stored.createdAt,
      updated_at: stored.updatedAt,
      comments_url: `${repo?.url || ''}/issues/${stored.number}/comments`,
      user: {
        login: 'user', // Placeholder for compatibility
        avatar_url: ''
      },
      score: stored.score,
      repository: repo?.name || 'unknown',
      hasBountyLabel: stored.hasBountyLabel,
      hasBountyComment: stored.hasBountyComment,
      hasPayoutComment: stored.hasPayoutComment,
      hasAssignmentComment: stored.hasAssignmentComment,
      commentCount: stored.commentCount,
      hasImplementationDetails: stored.hasImplementationDetails,
      bountyValue: stored.bountyValue || 0,
      language: repo?.language || 'Unknown',
      userStatus: status?.status
    };
  });
}

// Note: This function is no longer used in the main flow since we moved to cron-based refreshing
// Kept for reference and potential future use (e.g., manual refresh endpoints)
export async function shouldRefreshData(env: Env): Promise<boolean> {
  try {
    const db = drizzle(env.DB);
    const result = await db.select({
      lastFetch: sql`MAX(${bountyIssues.lastFetchedAt})`.as('last_fetch')
    })
      .from(bountyIssues)
      .limit(1);

    if (!result[0] || !result[0].lastFetch) {
      return true; // No data exists, should fetch
    }

    const lastFetch = new Date(result[0].lastFetch as string);
    const now = new Date();
    const hoursSinceLastFetch = (now.getTime() - lastFetch.getTime()) / (1000 * 60 * 60);

    // Check if it's been more than 1 hour since last fetch
    return hoursSinceLastFetch > 1;
  } catch (error) {
    console.error('Error checking refresh status:', error);
    return true; // If we can't check, assume we should refresh
  }
}

export async function getDataFreshness(env: Env): Promise<{ lastFetch: string | null, hoursAgo: number | null }> {
  try {
    const db = drizzle(env.DB);
    const result = await db.select({
      lastFetch: sql`MAX(${bountyIssues.lastFetchedAt})`.as('last_fetch')
    })
      .from(bountyIssues)
      .limit(1);

    if (!result[0] || !result[0].lastFetch) {
      return { lastFetch: null, hoursAgo: null };
    }

    const lastFetch = new Date(result[0].lastFetch as string);
    const now = new Date();
    const hoursAgo = (now.getTime() - lastFetch.getTime()) / (1000 * 60 * 60);

    return {
      lastFetch: result[0].lastFetch as string,
      hoursAgo: Math.round(hoursAgo * 100) / 100 // Round to 2 decimal places
    };
  } catch (error) {
    console.error('Error checking data freshness:', error);
    return { lastFetch: null, hoursAgo: null };
  }
}

// Issue status management functions
export async function updateIssueStatus(githubId: number, status: IssueStatusType | null, env: Env): Promise<{ success: boolean, message?: string }> {
  try {
    const db = drizzle(env.DB);

    // First, check if the issue exists
    const issue = await db.select({ id: bountyIssues.id })
      .from(bountyIssues)
      .where(eq(bountyIssues.githubId, githubId))
      .limit(1);

    if (issue.length === 0) {
      return { success: false, message: 'Issue not found' };
    }

    if (status === null) {
      // Remove status
      await db.delete(issueStatus)
        .where(eq(issueStatus.githubId, githubId));
    } else {
      // Upsert status
      await db.insert(issueStatus)
        .values({
          issueId: issue[0].id,
          githubId,
          status,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .onConflictDoUpdate({
          target: issueStatus.githubId,
          set: {
            status,
            updatedAt: new Date().toISOString()
          }
        });
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating issue status:', error);
    return { success: false, message: 'Database error' };
  }
}

export async function getIssueStatus(githubId: number, env: Env): Promise<DbIssueStatus | null> {
  try {
    const db = drizzle(env.DB);
    const result = await db.select()
      .from(issueStatus)
      .where(eq(issueStatus.githubId, githubId))
      .limit(1);

    return result[0] || null;
  } catch (error) {
    console.error('Error getting issue status:', error);
    return null;
  }
}

export async function getIssueStatusCounts(env: Env): Promise<{ interested: number, in_progress: number, unwanted: number }> {
  try {
    const db = drizzle(env.DB);
    const result = await db.select({
      status: issueStatus.status,
      count: count()
    })
      .from(issueStatus)
      .groupBy(issueStatus.status);

    const counts = { interested: 0, in_progress: 0, unwanted: 0 };
    result.forEach((row) => {
      if (row.status in counts) {
        counts[row.status as keyof typeof counts] = row.count;
      }
    });

    return counts;
  } catch (error) {
    console.error('Error getting status counts:', error);
    return { interested: 0, in_progress: 0, unwanted: 0 };
  }
}

// Settings management functions
export async function updateUserSetting(settingKey: string, settingValue: any, env: Env): Promise<{ success: boolean, message?: string }> {
  try {
    const db = drizzle(env.DB);
    const jsonValue = JSON.stringify(settingValue);

    await db.insert(userSettings)
      .values({
        settingKey,
        settingValue: jsonValue,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .onConflictDoUpdate({
        target: userSettings.settingKey,
        set: {
          settingValue: jsonValue,
          updatedAt: new Date().toISOString()
        }
      });

    return { success: true };
  } catch (error) {
    console.error('Error updating user setting:', error);
    return { success: false, message: 'Database error' };
  }
}

export async function getUserSetting(settingKey: string, env: Env): Promise<any> {
  try {
    const db = drizzle(env.DB);
    const result = await db.select({ settingValue: userSettings.settingValue })
      .from(userSettings)
      .where(eq(userSettings.settingKey, settingKey))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return JSON.parse(result[0].settingValue);
  } catch (error) {
    console.error('Error getting user setting:', error);
    return null;
  }
}

export async function getAllUserSettings(env: Env): Promise<Record<string, any>> {
  try {
    const db = drizzle(env.DB);
    const result = await db.select({
      settingKey: userSettings.settingKey,
      settingValue: userSettings.settingValue
    })
      .from(userSettings);

    const settings: Record<string, any> = {};
    result.forEach((row) => {
      try {
        settings[row.settingKey] = JSON.parse(row.settingValue);
      } catch (e) {
        console.error(`Error parsing setting ${row.settingKey}:`, e);
        settings[row.settingKey] = null;
      }
    });

    return settings;
  } catch (error) {
    console.error('Error getting all user settings:', error);
    return {};
  }
}

export async function getHiddenRepositories(env: Env): Promise<string[]> {
  try {
    console.log('📚 [HIDDEN_REPOS] Getting hidden repositories from database...');

    if (!env) {
      throw new Error('Environment is null or undefined');
    }

    const db = drizzle(env.DB);
    const result = await db.select({ name: repositories.name })
      .from(repositories)
      .where(eq(repositories.isHidden, true));

    const hiddenRepos = result.map(repo => repo.name);
    console.log('📚 [HIDDEN_REPOS] Hidden repositories found:', hiddenRepos);
    return hiddenRepos;
  } catch (error) {
    console.error('📚 [HIDDEN_REPOS] ERROR: Failed to get hidden repositories:', error);
    console.error('📚 [HIDDEN_REPOS] Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('📚 [HIDDEN_REPOS] Error message:', error instanceof Error ? error.message : String(error));
    console.error('📚 [HIDDEN_REPOS] Error stack:', error instanceof Error ? error.stack : 'No stack available');
    console.error('📚 [HIDDEN_REPOS] Environment check:', {
      hasEnv: !!env,
      hasDB: !!env?.DB
    });
    return [];
  }
}

export async function updateRepositoryHiddenStatus(repositoryName: string, isHidden: boolean, env: Env): Promise<{ success: boolean, message?: string }> {
  try {
    const db = drizzle(env.DB);

    // Update the repository's hidden status
    const result = await db.update(repositories)
      .set({
        isHidden,
        updatedAt: new Date().toISOString()
      })
      .where(eq(repositories.name, repositoryName));

    // Check if any rows were affected
    const affectedRows = (result as any).changes || 0;
    if (affectedRows === 0) {
      return { success: false, message: 'Repository not found' };
    }

    console.log(`📚 Repository ${repositoryName} hidden status set to: ${isHidden}`);
    return { success: true };
  } catch (error) {
    console.error('Error updating repository hidden status:', error);
    return { success: false, message: 'Database error' };
  }
}

export async function updateMultipleRepositoriesHiddenStatus(repoUpdates: { name: string, isHidden: boolean }[], env: Env): Promise<{ success: boolean, message?: string }> {
  try {
    const db = drizzle(env.DB);

    // Process each repository update
    for (const update of repoUpdates) {
      await db.update(repositories)
        .set({
          isHidden: update.isHidden,
          updatedAt: new Date().toISOString()
        })
        .where(eq(repositories.name, update.name));
    }

    console.log(`📚 Updated hidden status for ${repoUpdates.length} repositories`);
    return { success: true };
  } catch (error) {
    console.error('Error updating multiple repositories hidden status:', error);
    return { success: false, message: 'Database error' };
  }
}

export async function getAvailableRepositories(env: Env): Promise<string[]> {
  try {
    const db = drizzle(env.DB);
    const result = await db.selectDistinct({ name: repositories.name })
      .from(repositories)
      .where(eq(repositories.isActive, true))
      .orderBy(asc(repositories.name));

    return result.map((row) => row.name);
  } catch (error) {
    console.error('Error getting available repositories:', error);
    return [];
  }
}

export async function getSearchQuery(env: Env): Promise<string> {
  try {
    const setting = await getUserSetting('search_query', env);
    if (!setting || typeof setting.query !== 'string') {
      return 'is:issue is:open label:bounty'; // Default query
    }
    return setting.query;
  } catch (error) {
    console.error('Error getting search query:', error);
    return 'is:issue is:open label:bounty'; // Default query
  }
}

export async function updateSearchQuery(query: string, env: Env): Promise<{ success: boolean, message?: string }> {
  try {
    const settingValue: SearchQuerySettings = { query };
    return await updateUserSetting('search_query', settingValue, env);
  } catch (error) {
    console.error('Error updating search query:', error);
    return { success: false, message: 'Failed to update search query' };
  }
}

// Repository management functions
export async function getAllRepositories(env: Env): Promise<Repository[]> {
  try {
    const db = drizzle(env.DB);
    const result = await db.select()
      .from(repositories)
      .where(eq(repositories.isActive, true))
      .orderBy(asc(repositories.name));

    return result;
  } catch (error) {
    console.error('Error getting all repositories:', error);
    return [];
  }
}

export async function updateRepository(id: number, updates: Partial<NewRepository>, env: Env): Promise<{ success: boolean, message?: string }> {
  try {
    const db = drizzle(env.DB);
    await db.update(repositories)
      .set({
        ...updates,
        updatedAt: new Date().toISOString()
      })
      .where(eq(repositories.id, id));

    return { success: true };
  } catch (error) {
    console.error('Error updating repository:', error);
    return { success: false, message: 'Database error' };
  }
}
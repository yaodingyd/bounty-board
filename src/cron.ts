import { Env } from './types';
import { fetchAllGitHubIssues } from './github';
import { rankIssues } from './ranking';
import { storeIssuesInD1, getSearchQuery, removeLowRankingIssues } from './database';

export async function handleScheduledEvent(env: Env): Promise<void> {
  const startTime = Date.now();
  const TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes timeout for development
  
  console.log('🕐 Cron job started: Fetching GitHub bounty issues...');

  // Create a timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Cron job timed out')), TIMEOUT_MS);
  });

  try {
    // Race between the actual work and timeout
    await Promise.race([
      performCronWork(env, startTime),
      timeoutPromise
    ]);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Cron job failed after ${duration}ms:`, error);
    
    // Log additional error details for debugging
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }

    // Don't throw - we want the worker to continue functioning for HTTP requests
    // even if the cron job fails
  }
}

async function performCronWork(env: Env, startTime: number): Promise<void> {
  try {
    // Validate GitHub token
    if (!env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is not set');
    }
    
    // Get configured search query for GitHub API
    const query = await getSearchQuery(env);
    const sort = 'created';
    const order = 'desc';
    const maxPages = 2; // Further reduced for development testing

    console.log(`📡 Starting GitHub fetch: query="${query}", maxPages=${maxPages}`);

    // Fetch issues from GitHub
    const issues = await fetchAllGitHubIssues(
      query,
      sort,
      order,
      env.GITHUB_TOKEN,
      maxPages,
      env
    );

    if (!issues || issues.length === 0) {
      console.log('⚠️ No issues fetched from GitHub');
      return;
    }

    console.log(`✅ Fetched ${issues.length} issues from GitHub`);

    // Rank the issues
    console.log('🎯 Starting issue ranking process...');
    const rankedIssues = await rankIssues(issues, env.GITHUB_TOKEN);
    console.log(`✅ Ranking complete: ${rankedIssues.length} issues ranked`);

    // Store in D1 with upsert functionality
    console.log('💾 Starting D1 storage process...');
    await storeIssuesInD1(rankedIssues, env);

    const duration = Date.now() - startTime;
    console.log(`🎉 Cron job completed successfully in ${duration}ms`);
    console.log(`📊 Final stats: ${rankedIssues.length} issues processed and stored`);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Cron work failed after ${duration}ms:`, error);
    throw error; // Re-throw to be caught by the outer handler
  }
}

export async function handleCronTrigger(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  console.log(`🔔 Cron trigger received: ${event.cron} at ${new Date().toISOString()}`);
  
  // Use waitUntil to ensure the cron job completes even if it takes longer than the initial response
  ctx.waitUntil(handleScheduledEvent(env));
}
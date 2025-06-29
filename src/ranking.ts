import { fetchRepositoryLanguage } from './github';
import { GitHubComment, GitHubIssue, RankedIssue } from './types';

export async function rankIssues(issues: GitHubIssue[], token?: string): Promise<RankedIssue[]> {
  const rankedIssues: RankedIssue[] = [];
  const totalIssues = issues.length;

  console.log(`🎯 Starting to rank ${totalIssues} issues...`);

  // Pre-fetch languages for all unique repositories to optimize API calls
  console.log(`🎯 Pre-fetching repository languages for ${totalIssues} issues...`);
  const uniqueRepos = [...new Set(issues.map(issue => issue.repository_url))];
  console.log(`🎯 Found ${uniqueRepos.length} unique repositories to fetch languages for`);

  const languageCache = new Map<string, string>();

  // Fetch languages for all unique repositories in parallel (with rate limiting)
  const languagePromises = uniqueRepos.map(async (repoUrl, index) => {
    try {
      // Add delay between requests to respect rate limits
      await new Promise(resolve => setTimeout(resolve, index * 250)); // 250ms delay between each request
      const language = await fetchRepositoryLanguage(repoUrl, token);
      languageCache.set(repoUrl, language);
      console.log(`🎯 Fetched language for ${repoUrl}: ${language}`);
    } catch (error) {
      console.warn(`🎯 Failed to fetch language for ${repoUrl}:`, error);
      languageCache.set(repoUrl, 'Unknown');
    }
  });

  // Wait for all language fetches to complete
  await Promise.all(languagePromises);
  console.log(`🎯 Language pre-fetch complete: ${languageCache.size} repositories processed`);

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const progress = `[${i + 1}/${totalIssues}]`;
    console.log(`${progress} Processing issue ${issue.id}: "${issue.title?.substring(0, 60)}..."`);

    try {
      // Validate required issue fields
      if (!issue || !issue.id || !issue.repository_url || !issue.html_url) {
        console.warn('Skipping issue with missing required fields:', issue?.id || 'unknown');
        continue;
      }
      // Extract repository name from repository_url with error handling
      let repository = 'unknown/repository';
      try {
        const repoUrlParts = issue.repository_url.split('/');
        if (repoUrlParts.length >= 2) {
          repository = `${repoUrlParts[repoUrlParts.length - 2]}/${repoUrlParts[repoUrlParts.length - 1]}`;
        }
      } catch (error) {
        console.error('Error parsing repository URL:', issue.repository_url, error);
      }

      // Check for bounty label
      const hasBountyLabel = Array.isArray(issue.labels) && issue.labels.some(label =>
        label && label.name && label.name.toLowerCase().includes('bounty')
      );

      let hasBountyComment = false;
      let hasPayoutComment = false;
      let hasAssignmentComment = false;
      let comments: GitHubComment[] = [];

      // Temporarily disable comment fetching for development to avoid timeouts
      // TODO: Re-enable for production
      console.log(`${progress} Skipping comment fetch for development`);
      hasBountyComment = false;
      hasPayoutComment = false;
      hasAssignmentComment = false;

      // Check for implementation details in issue body
      const hasImplementationDetails = !!(
        (issue.body && issue.body.length > 200) ||
        issue.body?.toLowerCase().includes('implementation') ||
        issue.body?.toLowerCase().includes('steps to reproduce') ||
        issue.body?.toLowerCase().includes('expected behavior')
      );

      // Extract bounty value from various sources
      let bountyValue = 0;

      // Check labels for bounty values
      if (Array.isArray(issue.labels)) {
        for (const label of issue.labels) {
          if (label && label.name) {
            const labelValue = extractBountyValue(label.name);
            bountyValue = Math.max(bountyValue, labelValue);
          }
        }
      }

      // Check title for bounty values
      if (issue.title) {
        const titleValue = extractBountyValue(issue.title);
        bountyValue = Math.max(bountyValue, titleValue);
      }

      // Check body for bounty values
      if (issue.body) {
        const bodyValue = extractBountyValue(issue.body);
        bountyValue = Math.max(bountyValue, bodyValue);
      }

      // Skip comment processing for development
      console.log(`${progress} Skipping comment bounty value extraction for development`);

      // Get repository language from cache (populated during pre-fetch)
      const language = languageCache.get(issue.repository_url) || 'Unknown';
      console.log(`${progress} Language: ${language} (from cache)`)

      // Calculate score based on workability criteria
      console.log(`${progress} Calculating score...`);
      const score = calculateScore({
        hasBountyLabel,
        hasBountyComment,
        hasImplementationDetails,
        hasPayoutComment,
        hasAssignmentComment,
        commentCount: issue.comments
      });

      console.log(`${progress} Issue scored: ${score} (bounty: ${hasBountyLabel}, impl: ${hasImplementationDetails}, lang: ${language})`);

      rankedIssues.push({
        ...issue,
        repository,
        score,
        hasBountyLabel,
        hasBountyComment,
        hasPayoutComment,
        hasAssignmentComment,
        commentCount: issue.comments,
        hasImplementationDetails,
        bountyValue,
        language,
      });

      console.log(`${progress} Issue processed successfully`);

      // Add small delay to prevent overwhelming GitHub API
      if (i % 10 === 0 && i > 0) {
        console.log(`${progress} Processed ${i} issues, taking brief pause...`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      // Skip issues that can't be processed
      console.error(`${progress} Error processing issue ${issue.id}:`, error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) {
        console.error(`${progress} Stack trace:`, error.stack);
      }
    }
  }

  console.log(`🎯 Ranking complete! Processed ${rankedIssues.length}/${totalIssues} issues successfully`);
  console.log(`🔢 Sorting ${rankedIssues.length} issues by score...`);

  // Sort by score in descending order
  const sortedIssues = rankedIssues.sort((a, b) => b.score - a.score);

  if (sortedIssues.length > 0) {
    console.log(`📊 Top issue: "${sortedIssues[0].title?.substring(0, 60)}" (score: ${sortedIssues[0].score})`);
  }

  return sortedIssues;
}

interface ScoreFactors {
  hasBountyLabel: boolean;
  hasBountyComment: boolean;
  hasImplementationDetails: boolean;
  hasPayoutComment: boolean;
  hasAssignmentComment: boolean;
  commentCount: number;
}

function calculateScore(factors: ScoreFactors): number {
  let score = 0;

  // Criterion 1: Has bounty label or comment (30 points)
  if (factors.hasBountyLabel || factors.hasBountyComment) {
    score += 30;
  }

  // Criterion 2: Has clear implementation details (25 points)
  if (factors.hasImplementationDetails) {
    score += 25;
  }

  // Criterion 3: Not completed yet - no payout/rewarded comments (20 points)
  if (!factors.hasPayoutComment) {
    score += 20;
  }

  // Criterion 4: Less than 10 comments (25 points)
  if (factors.commentCount < 10) {
    score += 25;
  }

  // Criterion 5: Not assigned - lower score if assignment comments found (-30 points)
  if (factors.hasAssignmentComment) {
    score -= 30;
  }

  // Ensure score doesn't go negative
  return Math.max(score, 0);
}

export function extractBountyValue(text: string): number {
  if (!text) return 0;

  const normalizedText = text.toLowerCase();

  // Enhanced patterns for bounty values - more comprehensive
  const patterns = [
    // [Bounty $500], [bounty $1000], etc. - bracket format
    /\[bounty[:\s]*\$?(\d+(?:,\d{3})*(?:\.\d{2})?)\]/g,
    // (Bounty $500), (bounty $1000), etc. - parentheses format  
    /\(bounty[:\s]*\$?(\d+(?:,\d{3})*(?:\.\d{2})?)\)/g,
    // bounty: $500, bounty $1000, bounty 500, etc.
    /bounty[:\s]*\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
    // reward: $500, reward $1000, etc.
    /reward[:\s]*\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
    // prize: $500, prize $1000, etc.
    /prize[:\s]*\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
    // $500 bounty, $1000 reward, etc.
    /\$(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:bounty|reward|prize)/g,
    // General $500, $1000, $50.00, etc. (should be last as it's most general)
    /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
    // 500 USD, 1000 usd, etc.
    /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*usd/g,
    // 500$, 1000$, etc.
    /(\d+(?:,\d{3})*(?:\.\d{2})?)\$/g,
  ];

  const values: number[] = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const valueStr = match[1].replace(/,/g, '');
      const value = parseFloat(valueStr);
      if (!isNaN(value) && value > 0) {
        values.push(Math.floor(value));
      }
    }
  }

  // Return the highest value found, or 0 if none found
  return values.length > 0 ? Math.max(...values) : 0;
}

/**
 * Detects assignment statements in comment text
 * Looks for patterns indicating someone has been assigned or is working on the ticket
 */
export function hasAssignmentStatement(text: string): boolean {
  if (!text) return false;

  const normalizedText = text.toLowerCase();

  // Assignment patterns to detect
  const assignmentPatterns = [
    // Direct assignment statements
    /i\s+have\s+assigned\s+this\s+ticket/,
    /this\s+ticket\s+is\s+taken/,
    /this\s+ticket\s+has\s+been\s+taken/,
    /this\s+issue\s+is\s+taken/,
    /this\s+issue\s+has\s+been\s+taken/,
    /assigned\s+to\s+@?\w+/,
    /i\s+am\s+assigned\s+to\s+this/,
    /i\s+have\s+been\s+assigned/,

    // Working on statements
    /is\s+working\s+on\s+this\s+ticket/,
    /is\s+working\s+on\s+this\s+issue/,
    /working\s+on\s+this\s+now/,
    /i\s+am\s+working\s+on\s+this/,
    /i'm\s+working\s+on\s+this/,
    /currently\s+working\s+on\s+this/,
    /will\s+work\s+on\s+this/,
    /i\s+will\s+work\s+on\s+this/,
    /i'll\s+work\s+on\s+this/,
    /taking\s+this\s+one/,
    /i'll\s+take\s+this/,
    /i\s+will\s+take\s+this/,

    // Assignment requests/confirmations
    /can\s+i\s+be\s+assigned/,
    /please\s+assign\s+me/,
    /assign\s+me\s+to\s+this/,
    /i\s+would\s+like\s+to\s+work\s+on\s+this/,
    /i'd\s+like\s+to\s+work\s+on\s+this/,
    /interested\s+in\s+working\s+on\s+this/,
    /can\s+i\s+work\s+on\s+this/,

    // GitHub-style assignments
    /assigned\s+@?\w+/,
    /@\w+\s+assigned/,
    /assignee:\s*@?\w+/,

    // Progress indicators
    /started\s+working\s+on\s+this/,
    /began\s+working\s+on\s+this/,
    /in\s+progress/,
    /work\s+in\s+progress/,
    /wip/,

    // Claim statements
    /claiming\s+this\s+issue/,
    /claiming\s+this\s+ticket/,
    /i\s+claim\s+this/,
    /claimed\s+by/,
  ];

  // Check if any pattern matches
  return assignmentPatterns.some(pattern => pattern.test(normalizedText));
}
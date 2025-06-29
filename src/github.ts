import { GitHubIssue, GitHubComment } from './types';

export async function fetchAllGitHubIssues(
  query: string,
  sort: string,
  order: string,
  token?: string,
  maxPages: number = 20,
  env?: { GITHUB_FETCH_PER_PAGE?: string; GITHUB_FETCH_MAX_PAGES?: string }
): Promise<GitHubIssue[]> {
  const allIssues: GitHubIssue[] = [];
  const perPage = env?.GITHUB_FETCH_PER_PAGE ? parseInt(env.GITHUB_FETCH_PER_PAGE, 10) : 100;
  const actualMaxPages = env?.GITHUB_FETCH_MAX_PAGES ? parseInt(env.GITHUB_FETCH_MAX_PAGES, 10) : maxPages;

  console.log(`📡 Starting GitHub fetch: query="${query}", sort=${sort}, order=${order}, perPage=${perPage}, maxPages=${actualMaxPages}`);

  for (let page = 1; page <= actualMaxPages; page++) {
    try {
      console.log(`📡 Fetching page ${page}/${actualMaxPages}...`);
      
      const issues = await fetchGitHubIssues(
        query, sort, order, perPage, page, token
      );

      if (issues.length === 0) {
        console.log(`📡 No more issues found at page ${page}. Stopping fetch.`);
        break; // No more issues
      }

      allIssues.push(...issues);
      console.log(`📡 Page ${page}: Found ${issues.length} issues. Total so far: ${allIssues.length}`);

      // If we got fewer than perPage, we've reached the end
      if (issues.length < perPage) {
        console.log(`📡 Reached end of results at page ${page}`);
        break;
      }

      // Rate limiting: Add delay between requests to be respectful
      if (page < actualMaxPages) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }

    } catch (error) {
      console.error(`📡 Error fetching page ${page}:`, error instanceof Error ? error.message : error);
      // Continue with next page instead of stopping completely
      continue;
    }
  }

  console.log(`📡 GitHub fetch completed! Total issues fetched: ${allIssues.length}`);
  return allIssues;
}

export async function fetchGitHubIssues(
  query: string,
  sort: string,
  order: string,
  perPage: number,
  page: number,
  token?: string
): Promise<GitHubIssue[]> {
  const apiUrl = new URL('https://api.github.com/search/issues');
  apiUrl.searchParams.append('q', query);
  apiUrl.searchParams.append('sort', sort);
  apiUrl.searchParams.append('order', order);
  apiUrl.searchParams.append('per_page', perPage.toString());
  apiUrl.searchParams.append('page', page.toString());

  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare-Worker-Bounty-Board',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(apiUrl.toString(), { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { items: GitHubIssue[], total_count?: number };
    
    // Validate the response structure
    if (!data || !Array.isArray(data.items)) {
      console.error('Invalid GitHub API response structure:', data);
      return [];
    }
    
    // Handle rate limiting (GitHub returns X-RateLimit headers)
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining && parseInt(remaining) < 10) {
      console.warn(`GitHub API rate limit low: ${remaining} requests remaining`);
      // Add extra delay when rate limit is low
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return data.items || [];
  } catch (error) {
    console.error('Error fetching GitHub issues:', error);
    // Return empty array instead of throwing
    return [];
  }
}

export async function fetchComments(commentsUrl: string, token?: string): Promise<GitHubComment[]> {
  if (!commentsUrl) return [];

  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare-Worker-Bounty-Board',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(commentsUrl, { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${errorText}`);
    }

    return await response.json() as GitHubComment[];
  } catch (error) {
    console.error('Error fetching comments:', error);
    // Return empty array instead of throwing
    return [];
  }
}

// Cache for repository languages to avoid repeated API calls
const languageCache = new Map<string, string>();

export async function fetchRepositoryLanguage(repositoryUrl: string, token?: string): Promise<string> {
  // Extract owner/repo from repository URL
  const match = repositoryUrl.match(/github\.com\/repos\/([^\/]+\/[^\/]+)/);
  if (!match) {
    return 'Unknown';
  }
  
  const repoKey = match[1];
  
  // Check cache first
  if (languageCache.has(repoKey)) {
    return languageCache.get(repoKey)!;
  }

  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare-Worker-Bounty-Board',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repoKey}/languages`, { headers });
    
    if (!response.ok) {
      console.warn(`Failed to fetch languages for ${repoKey}: ${response.status}`);
      languageCache.set(repoKey, 'Unknown');
      return 'Unknown';
    }

    const languages = await response.json() as Record<string, number>;
    
    // Find the language with the most bytes of code
    const sortedLanguages = Object.entries(languages)
      .sort(([, a], [, b]) => b - a);
    
    const mainLanguage = sortedLanguages.length > 0 ? sortedLanguages[0][0] : 'Unknown';
    
    // Cache the result
    languageCache.set(repoKey, mainLanguage);
    
    return mainLanguage;
  } catch (error) {
    console.error(`Error fetching repository language for ${repoKey}:`, error);
    languageCache.set(repoKey, 'Unknown');
    return 'Unknown';
  }
}
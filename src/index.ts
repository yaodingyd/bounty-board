import { Env } from './types';
import { handleSearchAPI } from './search';
import { handleCronTrigger, handleScheduledEvent } from './cron';
import { handleStatusAPI } from './status';
import { handleSettingsAPI } from './settings';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle API routes
    if (url.pathname === '/search') {
      try {
        console.log('🌐 [MAIN] Search endpoint called, delegating to handleSearchAPI');
        console.log('🌐 [MAIN] Request details:', {
          url: request.url,
          method: request.method,
          pathname: url.pathname
        });
        return await handleSearchAPI(request, env);
      } catch (mainError) {
        console.error('🌐 [MAIN] ❌ FATAL ERROR in main search handler:', mainError);
        console.error('🌐 [MAIN] Error name:', mainError instanceof Error ? mainError.name : 'Unknown');
        console.error('🌐 [MAIN] Error message:', mainError instanceof Error ? mainError.message : String(mainError));
        console.error('🌐 [MAIN] Error stack:', mainError instanceof Error ? mainError.stack : 'No stack available');
        console.error('🌐 [MAIN] Request URL:', request.url);
        
        return new Response(
          JSON.stringify({
            error: 'Critical server error',
            message: mainError instanceof Error ? mainError.message : String(mainError),
            timestamp: new Date().toISOString(),
            endpoint: '/search'
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      }
    }
    
    if (url.pathname === '/status') {
      return handleStatusAPI(request, env);
    }
    
    if (url.pathname === '/settings' || url.pathname === '/settings/repositories') {
      return handleSettingsAPI(request, env);
    }
    
    // Manual cron trigger endpoint for development/testing
    if (url.pathname === '/refresh' && request.method === 'POST') {
      try {
        console.log('🚀 Manual refresh triggered');
        await handleScheduledEvent(env);
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Data refresh completed successfully' 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Manual refresh failed:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Data refresh failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Test endpoint for debugging
    if (url.pathname === '/test' && request.method === 'POST') {
      try {
        console.log('🧪 Test endpoint triggered');
        
        // Test GitHub token
        if (!env.GITHUB_TOKEN) {
          throw new Error('GITHUB_TOKEN not found');
        }
        console.log('✅ GitHub token found');
        
        // Test database connection
        const result = await env.DB.prepare('SELECT COUNT(*) as count FROM bounty_issues').first();
        console.log('✅ Database connected, issues count:', result?.count);
        
        // Test search query
        const { getSearchQuery } = await import('./database');
        const query = await getSearchQuery(env);
        console.log('✅ Search query:', query);
        
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'All tests passed',
          data: {
            hasToken: !!env.GITHUB_TOKEN,
            issueCount: result?.count,
            searchQuery: query
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Test failed:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Test failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Simple refresh endpoint for debugging
    if (url.pathname === '/refresh-simple' && request.method === 'POST') {
      try {
        console.log('🚀 Simple refresh triggered');
        
        const { fetchAllGitHubIssues } = await import('./github');
        const { getSearchQuery } = await import('./database');
        
        const query = await getSearchQuery(env);
        console.log('📡 Starting simple GitHub fetch with 1 page...');
        
        // Fetch just 1 page for testing
        const issues = await fetchAllGitHubIssues(
          query,
          'created',
          'desc',
          env.GITHUB_TOKEN,
          1, // Only 1 page for testing
          env
        );
        
        console.log(`📡 Fetched ${issues.length} issues successfully`);
        
        return new Response(JSON.stringify({ 
          success: true, 
          message: `Simple refresh completed successfully. Fetched ${issues.length} issues.`,
          data: {
            issueCount: issues.length,
            firstIssue: issues[0] ? {
              id: issues[0].id,
              title: issues[0].title?.substring(0, 60)
            } : null
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Simple refresh failed:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Simple refresh failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Test ranking process with just a few issues
    if (url.pathname === '/test-ranking' && request.method === 'POST') {
      try {
        console.log('🚀 Test ranking triggered');
        
        const { fetchAllGitHubIssues } = await import('./github');
        const { rankIssues } = await import('./ranking');
        const { getSearchQuery } = await import('./database');
        
        const query = await getSearchQuery(env);
        console.log('📡 Fetching 1 page of issues...');
        
        const issues = await fetchAllGitHubIssues(
          query,
          'created',
          'desc',
          env.GITHUB_TOKEN,
          1,
          env
        );
        
        console.log(`📡 Fetched ${issues.length} issues`);
        
        // Only rank first 3 issues for testing
        const testIssues = issues.slice(0, 3);
        console.log(`🎯 Testing ranking on ${testIssues.length} issues...`);
        
        const rankedIssues = await rankIssues(testIssues, env.GITHUB_TOKEN);
        
        console.log(`🎯 Ranking completed successfully`);
        
        return new Response(JSON.stringify({ 
          success: true, 
          message: `Test ranking completed successfully. Ranked ${rankedIssues.length} issues.`,
          data: {
            rankedCount: rankedIssues.length,
            rankings: rankedIssues.map(issue => ({
              id: issue.id,
              title: issue.title?.substring(0, 50),
              score: issue.score,
              language: issue.language,
              repository: issue.repository
            }))
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Test ranking failed:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Test ranking failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Serve static assets for all other routes
    return env.ASSETS.fetch(request);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Handle cron trigger for GitHub data refresh
    return handleCronTrigger(event, env, ctx);
  },
};
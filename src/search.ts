import { Env, SearchParams, SearchResponse } from './types';
import { searchIssuesInD1 } from './database';
import { RankedIssue } from './types';

export async function handleSearchAPI(request: Request, env: Env): Promise<Response> {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS request for CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  // Only allow GET requests
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  let searchParams;
  try {
    console.log('🔍 [SEARCH] Starting search request processing');
    console.log('🔍 [SEARCH] Request URL:', request.url);
    console.log('🔍 [SEARCH] Request method:', request.method);
    
    // Step 1: Parse search parameters
    try {
      searchParams = parseSearchParams(request);
      console.log('🔍 [SEARCH] Parsed search params:', JSON.stringify(searchParams, null, 2));
    } catch (parseError) {
      console.error('🔍 [SEARCH] ERROR: Failed to parse search params:', parseError);
      console.error('🔍 [SEARCH] Parse error stack:', parseError instanceof Error ? parseError.stack : 'No stack available');
      throw new Error(`Parameter parsing failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
    
    // Step 2: Search issues directly (hidden repos filtered at database level)
    let searchResult: { issues: RankedIssue[], totalCount?: number };
    try {
      console.log('🔍 [SEARCH] Starting database search...');
      searchResult = await searchIssuesInD1(
        searchParams.query,
        env,
        searchParams.page,
        searchParams.perPage,
        searchParams.status
      );
      
      console.log('🔍 [SEARCH] Database search result:', {
        issuesCount: searchResult.issues.length,
        totalCount: searchResult.totalCount
      });
    } catch (searchError) {
      console.error('🔍 [SEARCH] ERROR: Failed to search issues:', searchError);
      console.error('🔍 [SEARCH] Search error stack:', searchError instanceof Error ? searchError.stack : 'No stack available');
      throw new Error(`Database search failed: ${searchError instanceof Error ? searchError.message : String(searchError)}`);
    }
    
    // Step 3: Build pagination with total count
    let paginationData;
    try {
      console.log('🔍 [SEARCH] Building pagination...');
      
      const totalCount = searchResult.totalCount || 0;
      const totalPages = Math.ceil(totalCount / searchParams.perPage);
      const hasNext = searchParams.page < totalPages;
      const hasPrev = searchParams.page > 1;
      
      paginationData = {
        currentPage: searchParams.page,
        hasNext,
        hasPrev,
        perPage: searchParams.perPage,
        actualResultCount: searchResult.issues.length,
        totalCount,
        totalPages
      };
      
      console.log('🔍 [SEARCH] Pagination built:', JSON.stringify(paginationData));
    } catch (paginationError) {
      console.error('🔍 [SEARCH] ERROR: Failed to build pagination:', paginationError);
      console.error('🔍 [SEARCH] Pagination error stack:', paginationError instanceof Error ? paginationError.stack : 'No stack available');
      throw new Error(`Pagination building failed: ${paginationError instanceof Error ? paginationError.message : String(paginationError)}`);
    }
    
    // Step 4: Build response
    let response: SearchResponse;
    try {
      console.log('🔍 [SEARCH] Building response...');
      response = {
        issues: searchResult.issues,
        pagination: paginationData
      };
      console.log('🔍 [SEARCH] Response built successfully');
    } catch (responseError) {
      console.error('🔍 [SEARCH] ERROR: Failed to build response:', responseError);
      console.error('🔍 [SEARCH] Response error stack:', responseError instanceof Error ? responseError.stack : 'No stack available');
      throw new Error(`Response building failed: ${responseError instanceof Error ? responseError.message : String(responseError)}`);
    }
    
    console.log('🔍 [SEARCH] ✅ Search completed successfully');
    return new Response(JSON.stringify(response), { 
      headers: { ...headers, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('🔍 [SEARCH] ❌ FATAL ERROR in search endpoint:', error);
    console.error('🔍 [SEARCH] Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('🔍 [SEARCH] Error message:', error instanceof Error ? error.message : String(error));
    console.error('🔍 [SEARCH] Error stack:', error instanceof Error ? error.stack : 'No stack available');
    console.error('🔍 [SEARCH] Error type:', typeof error);
    console.error('🔍 [SEARCH] Request details:', {
      url: request.url,
      method: request.method,
      searchParams: searchParams || 'Not parsed'
    });
    console.error('🔍 [SEARCH] Environment check:', {
      hasDB: !!env.DB,
      hasGitHubToken: !!env.GITHUB_TOKEN,
      hasAssets: !!env.ASSETS
    });
    
    return new Response(
      JSON.stringify({ 
        error: 'An error occurred while processing your request',
        message: error instanceof Error ? error.message : String(error),
        details: {
          errorName: error instanceof Error ? error.name : 'Unknown',
          timestamp: new Date().toISOString(),
          requestUrl: request.url,
          searchParams: searchParams || null
        }
      }),
      { 
        status: 500, 
        headers: { ...headers, 'Content-Type': 'application/json' } 
      }
    );
  }
}


function parseSearchParams(request: Request): SearchParams {
  try {
    console.log('🔍 [PARSE] Parsing search params from URL:', request.url);
    const url = new URL(request.url);
    
    console.log('🔍 [PARSE] URL object created successfully');
    console.log('🔍 [PARSE] Search params entries:');
    for (const [key, value] of url.searchParams.entries()) {
      console.log(`🔍 [PARSE]   ${key}: ${value}`);
    }
    
    const query = url.searchParams.get('query') || '';
    const sort = url.searchParams.get('sort') || 'created';
    const order = url.searchParams.get('order') || 'desc';
    const perPageStr = url.searchParams.get('per_page') || '30';
    const pageStr = url.searchParams.get('page') || '1';
    const status = url.searchParams.get('status') || undefined;
    
    console.log('🔍 [PARSE] Raw parameter values:', {
      query,
      sort,
      order,
      perPageStr,
      pageStr,
      status
    });
    
    let perPage, page;
    try {
      perPage = parseInt(perPageStr, 10);
      if (isNaN(perPage) || perPage < 1 || perPage > 100) {
        console.log(`🔍 [PARSE] Invalid per_page value "${perPageStr}", using default 30`);
        perPage = 30;
      }
    } catch (perPageError) {
      console.error('🔍 [PARSE] Error parsing per_page:', perPageError);
      perPage = 30;
    }
    
    try {
      page = parseInt(pageStr, 10);
      if (isNaN(page) || page < 1) {
        console.log(`🔍 [PARSE] Invalid page value "${pageStr}", using default 1`);
        page = 1;
      }
    } catch (pageError) {
      console.error('🔍 [PARSE] Error parsing page:', pageError);
      page = 1;
    }
    
    const result = {
      query,
      sort,
      order,
      perPage,
      page,
      status
    };
    
    console.log('🔍 [PARSE] Final parsed params:', JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('🔍 [PARSE] ERROR: Failed to parse search params:', error);
    console.error('🔍 [PARSE] Request URL:', request.url);
    console.error('🔍 [PARSE] Error stack:', error instanceof Error ? error.stack : 'No stack available');
    throw new Error(`URL parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
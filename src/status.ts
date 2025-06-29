import { Env, UpdateStatusRequest, UpdateStatusResponse, IssueStatusType } from './types';
import { updateIssueStatus } from './database';

export async function handleStatusAPI(request: Request, env: Env): Promise<Response> {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS request for CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  // Only allow POST requests
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  try {
    const requestBody: UpdateStatusRequest = await request.json();
    
    // Validate request
    if (!requestBody.github_id || typeof requestBody.github_id !== 'number') {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Invalid github_id' 
      }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Validate status if provided
    if (requestBody.status !== null && 
        !['interested', 'in_progress', 'unwanted'].includes(requestBody.status)) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Invalid status. Must be interested, in_progress, unwanted, or null' 
      }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Update the status
    const result = await updateIssueStatus(requestBody.github_id, requestBody.status, env);
    
    const response: UpdateStatusResponse = {
      success: result.success,
      message: result.message
    };

    return new Response(JSON.stringify(response), {
      status: result.success ? 200 : 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error updating issue status:', error);
    const response: UpdateStatusResponse = {
      success: false,
      message: 'Internal server error'
    };
    
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}
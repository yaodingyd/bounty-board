import { getAllUserSettings, getAvailableRepositories, getHiddenRepositories, updateMultipleRepositoriesHiddenStatus, updateRepositoryHiddenStatus, updateUserSetting } from './database';
import { Env, GetSettingsResponse, UpdateSettingsRequest, UpdateSettingsResponse } from './types';

export async function handleSettingsAPI(request: Request, env: Env): Promise<Response> {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS request for CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  const url = new URL(request.url);

  if (request.method === 'GET') {
    // Handle GET requests for retrieving settings
    if (url.pathname === '/settings') {
      return handleGetSettings(env, headers);
    } else if (url.pathname === '/settings/repositories') {
      return handleGetRepositories(env, headers);
    }
  } else if (request.method === 'POST') {
    // Handle POST requests for updating settings
    return handleUpdateSettings(request, env, headers);
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

async function handleGetSettings(env: Env, headers: Record<string, string>): Promise<Response> {
  try {
    const settings = await getAllUserSettings(env);

    // Get hidden repositories from database instead of user settings
    const hiddenRepos = await getHiddenRepositories(env);

    // Override hidden_repositories setting with database data
    settings.hidden_repositories = { repositories: hiddenRepos };

    const response: GetSettingsResponse = {
      success: true,
      settings
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    const response: GetSettingsResponse = {
      success: false,
      settings: {},
      message: 'Internal server error'
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}

async function handleGetRepositories(env: Env, headers: Record<string, string>): Promise<Response> {
  try {
    const repositories = await getAvailableRepositories(env);

    return new Response(JSON.stringify({
      success: true,
      repositories
    }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting repositories:', error);

    return new Response(JSON.stringify({
      success: false,
      repositories: [],
      message: 'Internal server error'
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}

async function handleUpdateSettings(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  try {
    const requestBody: UpdateSettingsRequest = await request.json();

    // Validate request
    if (!requestBody.setting_key || typeof requestBody.setting_key !== 'string') {
      return new Response(JSON.stringify({
        success: false,
        message: 'Invalid setting_key'
      }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Handle repository hiding/showing with new system
    if (requestBody.setting_key === 'hidden_repositories') {
      if (!requestBody.setting_value ||
        !requestBody.setting_value.repositories ||
        !Array.isArray(requestBody.setting_value.repositories)) {
        return new Response(JSON.stringify({
          success: false,
          message: 'hidden_repositories must have a repositories array'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      // Handle single repository update optimization
      if (requestBody.setting_value.repository_name) {
        try {
          const repositoryName = requestBody.setting_value.repository_name;
          const hiddenRepos = requestBody.setting_value.repositories;
          const isHidden = hiddenRepos.includes(repositoryName);

          const result = await updateRepositoryHiddenStatus(repositoryName, isHidden, env);

          const response: UpdateSettingsResponse = {
            success: result.success,
            message: result.message
          };

          return new Response(JSON.stringify(response), {
            status: result.success ? 200 : 400,
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          console.error('Error updating single repository hidden status:', error);
          return new Response(JSON.stringify({
            success: false,
            message: 'Failed to update repository visibility'
          }), {
            status: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
      }

      // Fallback to bulk update for backwards compatibility
      try {
        const allRepos = await getAvailableRepositories(env);
        const hiddenRepos = requestBody.setting_value.repositories;

        const repoUpdates = allRepos.map(repoName => ({
          name: repoName,
          isHidden: hiddenRepos.includes(repoName)
        }));

        const result = await updateMultipleRepositoriesHiddenStatus(repoUpdates, env);

        const response: UpdateSettingsResponse = {
          success: result.success,
          message: result.message
        };

        return new Response(JSON.stringify(response), {
          status: result.success ? 200 : 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('Error updating repository hidden status:', error);
        return new Response(JSON.stringify({
          success: false,
          message: 'Failed to update repository visibility'
        }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    // Validate other setting keys
    const allowedKeys = ['display_preferences', 'search_query'];
    if (!allowedKeys.includes(requestBody.setting_key)) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Invalid setting key. Allowed keys: ' + allowedKeys.join(', ') + ', hidden_repositories'
      }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Validate search_query format
    if (requestBody.setting_key === 'search_query') {
      if (!requestBody.setting_value ||
        typeof requestBody.setting_value.query !== 'string') {
        return new Response(JSON.stringify({
          success: false,
          message: 'search_query must have a query string'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    // Update the setting
    const result = await updateUserSetting(requestBody.setting_key, requestBody.setting_value, env);

    const response: UpdateSettingsResponse = {
      success: result.success,
      message: result.message
    };

    return new Response(JSON.stringify(response), {
      status: result.success ? 200 : 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error updating settings:', error);
    const response: UpdateSettingsResponse = {
      success: false,
      message: 'Internal server error'
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}
# Bounty Board

Self-hosted bounty issue tracking system, powered by Cloudflare worker.

**note** 99.99% of the code are written by AI but it works perfectly, and free tier Cloudflare account make just suit personal usage.

## Features

- Searches GitHub issues with "bounty" labels or comments
- Ranks issues based on workability criteria:
  1. Has a bounty label or comment
  2. Contains clear implementation details
  3. Not yet completed (no payout/rewarded comments)
  4. Has fewer than 10 comments
- Returns a sorted list of issues with their workability scores

## Setup

### Prerequisites

- Node.js (v18+ recommended, v24 for best performance)
- pnpm package manager (`npm install -g pnpm`)
- Cloudflare account with Workers access
- Wrangler CLI (`npm install -g wrangler` or `pnpm add -g wrangler`)
- GitHub Personal Access Token (for API access)

### Technical Details

This project uses:

- TypeScript with native support from Cloudflare Workers
- No build step required - TypeScript is compiled at runtime
- Cloudflare Workers for serverless execution
- D1 Database for persistent storage with full-text search
- Modular architecture for maintainability

### Project Structure

```
├── src/
│   ├── index.ts       # Main entry point & routing (HTTP + cron)
│   ├── types.ts       # TypeScript interfaces
│   ├── github.ts      # GitHub API functions (single + multi-page)
│   ├── database.ts    # D1 database operations (search + upsert)
│   ├── ranking.ts     # Issue scoring logic
│   ├── search.ts      # Search API handler (D1-first)
│   └── cron.ts        # Scheduled GitHub data refresh
├── public/
│   └── index.html     # Frontend UI
├── migrations/
│   └── 0001_create_bounty_issues.sql
├── .vscode/           # VSCode configuration
├── wrangler.toml      # Cloudflare Worker config (with cron)
└── package.json       # Dependencies & scripts
```

### Installation

1. **Clone and setup**:

```bash
git clone <repository-url>
cd bounty-board
pnpm install
```

2. **Authenticate with Cloudflare**:

```bash
wrangler login
```

3. **Configure environment variables**:

   **Option A: Using wrangler.toml (for development)**

   ```toml
   [vars]
   GITHUB_TOKEN = "your_github_token_here"
   ```

   **Option B: Using wrangler secrets (recommended for production)**

   ```bash
   wrangler secret put GITHUB_TOKEN
   # Enter your token when prompted
   ```

> **Important**: A GitHub token is required for the application to function properly. Without a token, the GitHub API limits requests to 60 per hour, which is insufficient for this application. For production, use `wrangler secret` instead of storing tokens in `wrangler.toml`.

### Getting a GitHub Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token" (classic)
3. Give it a name like "Bounty Board"
4. Select the "public_repo" scope (or just "repo" if you want to include private repositories)
5. Click "Generate token"
6. Copy the token and add it to your wrangler.toml file

## Development

### Local Development

1. **Start local development server**:

```bash
pnpm start
# or
wrangler dev
```

2. **Local D1 database setup**:

```bash
# Create local database
wrangler d1 execute bounty-board-db --local --file=./migrations/0001_create_bounty_issues.sql

# Run with local database
wrangler dev --local
```

### Environment-specific Configuration

Create different configurations for development/staging/production:

```toml
# wrangler.toml
[env.staging]
name = "bounty-board-staging"
vars = { GITHUB_TOKEN = "staging_token" }

[env.production]
name = "bounty-board-prod"
# Use secrets for production: wrangler secret put GITHUB_TOKEN --env production
```

## Deployment

### Deploy to Production

```bash
# Deploy with environment-specific settings
wrangler deploy --env production

# Or use the npm script
pnpm deploy
```

### CI/CD Best Practices

1. **Use GitHub Actions**:

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
      - run: npm install -g wrangler
      - run: pnpm install
      - run: wrangler deploy --env production
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

2. **Set up secrets in GitHub**:
   - `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token
   - Use Wrangler secrets for sensitive data like `GITHUB_TOKEN`

## Cron Job Management

### Testing Cron Jobs Locally

```bash
# Test the scheduled function during development
pnpm run cron:trigger

# Monitor cron job logs
pnpm run logs:cron
```

### Production Monitoring

```bash
# View all worker logs
pnpm run logs

# Query data freshness
pnpm run db:query "SELECT MAX(last_fetched_at) as last_fetch, COUNT(*) as total_issues FROM bounty_issues"
```

### Cron Job Status

The cron job runs automatically every hour. You can verify it's working by:

1. Checking the worker logs for cron activity
2. Querying the `last_fetched_at` timestamp in D1
3. Monitoring issue counts in the database

## API Usage

### Endpoint

```
GET https://your-worker-subdomain.workers.dev/
```

### Query Parameters

- `query`: Search keywords (default: empty string - shows all issues)
- `sort`: Sort parameter (default: `created`)
- `order`: Sort order (default: `desc`)
- `per_page`: Number of results per page (default: `10`)
- `page`: Page number (default: `1`)

### Search Functionality

The application now provides a simple, user-friendly search interface:

- **Default View**: Shows all bounty issues sorted by workability score
- **Keyword Search**: Search across issue titles, descriptions, and repository names
- **No GitHub Syntax**: Users don't need to know GitHub query syntax
- **Instant Results**: All searches are performed against the local D1 database
- **Full-text Search**: Powered by SQLite FTS for fast, relevant results

**Example searches:**

- `react` - Find issues related to React
- `bug fix` - Find bug fixing opportunities
- `typescript` - Find TypeScript-related issues
- `ethereum` - Find blockchain/Ethereum issues

### Example Requests

```bash
# Get all issues (default view)
GET https://your-worker-subdomain.workers.dev/search

# Search for React-related issues
GET https://your-worker-subdomain.workers.dev/search?query=react

# Search with pagination
GET https://your-worker-subdomain.workers.dev/search?query=typescript&page=2&per_page=20
```

### Example Response

```json
[
  {
    "id": 123456789,
    "number": 42,
    "title": "Implement feature X",
    "html_url": "https://github.com/owner/repo/issues/42",
    "body": "Detailed description of the issue...",
    "state": "open",
    "comments": 5,
    "labels": [{ "name": "bounty" }],
    "repository_url": "https://api.github.com/repos/owner/repo",
    "created_at": "2023-01-01T00:00:00Z",
    "updated_at": "2023-01-02T00:00:00Z",
    "comments_url": "https://api.github.com/repos/owner/repo/issues/42/comments",
    "user": {
      "login": "username",
      "avatar_url": "https://avatars.githubusercontent.com/u/12345678"
    },
    "score": 100,
    "repository": "owner/repo",
    "hasBountyLabel": true,
    "hasBountyComment": false,
    "hasPayoutComment": false,
    "commentCount": 5,
    "hasImplementationDetails": true
  }
]
```

## Ranking Algorithm

Issues are ranked based on the following criteria:

1. **Bounty Presence** (30 points): Issue has a "bounty" label or a comment mentioning a bounty
2. **Implementation Details** (25 points): Issue has clear implementation details
3. **Not Completed** (20 points): Issue has no "payout" or "rewarded" comments
4. **Comment Count** (25 points): Issue has fewer than 10 comments

The maximum score is 100 points. Issues are sorted by score in descending order.

## Troubleshooting

### API Rate Limiting

If you encounter 403 errors or "API rate limit exceeded" messages, it's likely because you're hitting GitHub's API rate limits. Solutions:

1. Add a GitHub token to your wrangler.toml file
2. Reduce the number of requests by using smaller page sizes
3. Implement caching to reduce API calls

### 500 Internal Server Errors

If you're getting 500 errors:

1. Check the worker logs for detailed error messages
2. Verify your GitHub token is valid and has the correct permissions
3. Try reducing the complexity of your query or the number of results requested

### Slow Response Times

If the API is responding slowly:

1. Reduce the `per_page` parameter to fetch fewer issues at once
2. Consider implementing caching for frequently accessed data
3. Optimize the ranking algorithm to process fewer comments

# D1 Database Setup Instructions

## Prerequisites

- Cloudflare account with Workers/D1 access
- wrangler CLI installed and authenticated

## Setup Steps

### 1. Create D1 Database

```bash
# Create the D1 database
wrangler d1 create bounty-board-db
```

This will output something like:

```
✅ Successfully created DB 'bounty-board-db'

[[d1_databases]]
binding = "DB"
database_name = "bounty-board-db"
database_id = "your-database-id-here"
```

### 2. Update wrangler.toml

Copy the database_id from the output above and update the `database_id` field in your `wrangler.toml` file.

### 3. Run Migration

```bash
# Execute the migration to create tables
wrangler d1 execute bounty-board-db --file=./migrations/0001_create_bounty_issues.sql
```

### 4. Verify Setup

```bash
# Check if tables were created successfully
wrangler d1 execute bounty-board-db --command="SELECT name FROM sqlite_master WHERE type='table';"
```

You should see output showing the `bounty_issues` and `bounty_issues_fts` tables.

### 5. Deploy Worker

```bash
# Deploy the updated worker
wrangler deploy
```

## Local Development

For local development, you can create a local D1 database:

```bash
# Create local database
wrangler d1 execute bounty-board-db --local --file=./migrations/0001_create_bounty_issues.sql

# Run worker locally
wrangler dev
```

## Database Schema

The `bounty_issues` table stores:

- GitHub issue metadata (id, title, body, etc.)
- Repository information
- User information
- Scoring/ranking data
- Labels as JSON
- Timestamps for cache management

The `bounty_issues_fts` virtual table enables full-text search across:

- Issue titles
- Issue bodies
- Repository names
- User logins

## How It Works

1. **Cron-based Data Refresh**: A Cloudflare Workers cron job runs every hour to fetch up to 2000 GitHub issues
2. **Upsert Strategy**: New issues are inserted, existing issues are updated with latest data
3. **Fast Searches**: All user searches query the D1 database directly (no GitHub API delays)
4. **Simple Search Interface**: Users search with keywords instead of GitHub query syntax
5. **Full-text Search**: Searches across issue titles, descriptions, and repository names
6. **Default View**: Shows all issues sorted by workability score when no search query is provided
7. **Emergency Fallback**: If D1 is empty (first deploy), falls back to GitHub API temporarily

## Cron Architecture

- **Schedule**: `0 * * * *` (every hour at minute 0)
- **Process**: Fetch → Rank → Upsert to D1
- **Performance**: Up to 2000 issues processed per hour
- **Resilience**: Continues on individual page/issue failures
- **Monitoring**: Comprehensive logging for debugging

## User Settings & Configuration

### Configurable GitHub Search Query

The application now allows users to customize the GitHub search query used to fetch bounties through the settings interface.

**Features:**

- **Default Query**: `is:issue is:open label:bounty`
- **Custom Queries**: Users can modify the search query to find different types of issues
- **Real-time Updates**: Changes are applied immediately to both the cron job and search functionality
- **Persistent Storage**: Settings are stored in the D1 database and persist across sessions

**Examples of custom queries:**

- `is:issue is:open label:good-first-issue` - Find beginner-friendly issues
- `is:issue is:open label:help-wanted` - Find issues looking for contributors
- `is:issue is:open label:bug bounty` - Find bug bounties specifically
- `is:issue is:open label:enhancement bounty` - Find feature request bounties

**Accessing Settings:**

1. Open the bounty board application
2. Click the settings gear icon (⚙️) in the top-right corner
3. Modify the "GitHub Search Query" field
4. Click "Save Settings" to apply changes

**Technical Implementation:**

- Settings are stored in the `user_settings` table with key `search_query`
- Both the cron job (`cron.ts`) and fallback search (`search.ts`) use the configured query
- The default query is used if no custom query is set
- Settings are validated to ensure they contain a valid query string

### Other User Settings

The application also includes:

- **Hidden Repositories**: Hide specific repositories from search results
- **Issue Status Filter**: Control which issues are displayed based on status (interested, in progress, unwanted, etc.)

## License

ISC

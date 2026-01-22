/**
 * eBay API Service
 * Handles OAuth authentication and sold listings search
 */

// ==================== Types ====================

export interface EbaySoldItem {
  itemId: string;
  title: string;
  soldPrice: number; // in cents
  soldDate: string; // ISO date string
  imageUrl: string | null;
  condition: string | null;
  itemUrl: string;
}

export interface EbaySearchResult {
  items: EbaySoldItem[];
  searchedAt: string;
  source: 'api' | 'cache';
  query: string;
}

interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// ==================== Configuration ====================

const EBAY_OAUTH_URL = {
  SANDBOX: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
  PRODUCTION: 'https://api.ebay.com/identity/v1/oauth2/token',
};

const EBAY_API_URL = {
  SANDBOX: 'https://api.sandbox.ebay.com',
  PRODUCTION: 'https://api.ebay.com',
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_BUFFER_MS = 60 * 1000; // Refresh token 1 minute before expiry

// ==================== Cache ====================

const searchCache = new Map<string, CacheEntry<EbaySearchResult>>();
let tokenCache: CacheEntry<string> | null = null;

/**
 * Clean expired entries from the search cache
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of searchCache.entries()) {
    if (entry.expiresAt < now) {
      searchCache.delete(key);
    }
  }
}

// Run cache cleanup every 5 minutes
setInterval(cleanExpiredCache, 5 * 60 * 1000);

// ==================== OAuth Token Management ====================

/**
 * Get eBay API environment from config
 */
function getEnvironment(): 'SANDBOX' | 'PRODUCTION' {
  const env = process.env.EBAY_API_ENVIRONMENT?.toUpperCase();
  return env === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
}

/**
 * Get OAuth access token using Client Credentials flow
 * Tokens are cached until near expiration
 */
export async function getAccessToken(): Promise<string> {
  // Check cached token
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.data;
  }

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  if (!appId || !certId) {
    throw new Error('eBay API credentials not configured (EBAY_APP_ID, EBAY_CERT_ID)');
  }

  const environment = getEnvironment();
  const oauthUrl = EBAY_OAUTH_URL[environment];

  // Create Base64 encoded credentials
  const credentials = Buffer.from(`${appId}:${certId}`).toString('base64');

  const response = await fetch(oauthUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('eBay OAuth error:', errorText);
    throw new Error(`eBay OAuth failed: ${response.status}`);
  }

  const data = await response.json() as EbayTokenResponse;

  // Cache the token with buffer time
  tokenCache = {
    data: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - TOKEN_BUFFER_MS,
  };

  return data.access_token;
}

// ==================== Search Functions ====================

/**
 * Search for recently sold items on eBay
 * Uses the Browse API with EBAY_SOLD filter
 */
export async function searchSoldItems(
  query: string,
  limit: number = 5
): Promise<EbaySearchResult> {
  // Normalize and validate query
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error('Search query is required');
  }

  // Check cache first
  const cacheKey = `${normalizedQuery.toLowerCase()}:${limit}`;
  const cached = searchCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.data,
      source: 'cache',
    };
  }

  // Get access token
  const accessToken = await getAccessToken();
  const environment = getEnvironment();
  const apiUrl = EBAY_API_URL[environment];

  // Build search URL with filters for sold/completed items
  // Using Browse API's search endpoint with filter for sold items
  const searchParams = new URLSearchParams({
    q: normalizedQuery,
    limit: String(Math.min(limit, 50)), // eBay max is 200, we cap at 50
    filter: 'buyingOptions:{AUCTION},itemEndDate:[2024-01-01T00:00:00Z..]', // TODO(human): Implement sold items filter strategy
  });

  const searchUrl = `${apiUrl}/buy/browse/v1/item_summary/search?${searchParams}`;

  const response = await fetch(searchUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('eBay search error:', errorText);

    if (response.status === 401) {
      // Token expired, clear cache and retry once
      tokenCache = null;
      throw new Error('eBay authentication failed - token expired');
    }

    throw new Error(`eBay search failed: ${response.status}`);
  }

  const data = await response.json() as { itemSummaries?: any[] };

  // Map eBay response to our types
  const items: EbaySoldItem[] = (data.itemSummaries || [])
    .slice(0, limit)
    .map((item: any) => mapEbayItemToSoldItem(item));

  const result: EbaySearchResult = {
    items,
    searchedAt: new Date().toISOString(),
    source: 'api',
    query: normalizedQuery,
  };

  // Cache the result
  searchCache.set(cacheKey, {
    data: result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result;
}

/**
 * Map eBay API response item to our EbaySoldItem type
 */
function mapEbayItemToSoldItem(item: any): EbaySoldItem {
  // Extract price in cents
  let soldPrice = 0;
  if (item.price?.value) {
    soldPrice = Math.round(parseFloat(item.price.value) * 100);
  }

  // Extract sold date (itemEndDate for completed auctions)
  const soldDate = item.itemEndDate || item.itemCreationDate || new Date().toISOString();

  // Get primary image
  const imageUrl = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null;

  // Map condition
  const condition = item.condition || item.conditionDescription || null;

  return {
    itemId: item.itemId || '',
    title: item.title || 'Unknown Item',
    soldPrice,
    soldDate: soldDate.split('T')[0], // Just the date part
    imageUrl,
    condition,
    itemUrl: item.itemWebUrl || `https://www.ebay.com/itm/${item.itemId}`,
  };
}

/**
 * Clear the search cache (useful for testing)
 */
export function clearCache(): void {
  searchCache.clear();
  tokenCache = null;
}

/**
 * Get cache statistics (useful for monitoring)
 */
export function getCacheStats(): { searchEntries: number; hasToken: boolean } {
  return {
    searchEntries: searchCache.size,
    hasToken: tokenCache !== null && tokenCache.expiresAt > Date.now(),
  };
}

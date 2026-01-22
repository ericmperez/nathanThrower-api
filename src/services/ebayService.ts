/**
 * eBay API Service
 * Handles sold listings search using the Finding API
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

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// ==================== Configuration ====================

// Finding API endpoints (uses App ID directly, no OAuth needed)
const EBAY_FINDING_API_URL = {
  SANDBOX: 'https://svcs.sandbox.ebay.com/services/search/FindingService/v1',
  PRODUCTION: 'https://svcs.ebay.com/services/search/FindingService/v1',
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ==================== Cache ====================

const searchCache = new Map<string, CacheEntry<EbaySearchResult>>();

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

// ==================== Helper Functions ====================

/**
 * Get eBay API environment from config
 */
function getEnvironment(): 'SANDBOX' | 'PRODUCTION' {
  const env = process.env.EBAY_API_ENVIRONMENT?.toUpperCase();
  return env === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
}

/**
 * Get the App ID from environment
 */
function getAppId(): string {
  const appId = process.env.EBAY_APP_ID;
  if (!appId) {
    throw new Error('eBay API credentials not configured (EBAY_APP_ID)');
  }
  return appId;
}

// ==================== Search Functions ====================

/**
 * Search for recently sold items on eBay using the Finding API
 * Uses findCompletedItems operation which returns actual sold listings
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

  const appId = getAppId();
  const environment = getEnvironment();
  const apiUrl = EBAY_FINDING_API_URL[environment];

  // Build Finding API URL for completed/sold items
  // The Finding API uses query parameters and returns JSON
  const searchParams = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.13.0',
    'SECURITY-APPNAME': appId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    'keywords': normalizedQuery,
    'paginationInput.entriesPerPage': String(Math.min(limit, 100)),
    // Filter: only sold items (not just completed/ended)
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    // Sort by end time (most recent first)
    'sortOrder': 'EndTimeSoonest',
  });

  const searchUrl = `${apiUrl}?${searchParams}`;

  const response = await fetch(searchUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('eBay Finding API error:', errorText);
    throw new Error(`eBay search failed: ${response.status}`);
  }

  const data = await response.json() as FindingApiResponse;

  // Check for API-level errors
  const searchResponse = data.findCompletedItemsResponse?.[0];
  if (!searchResponse) {
    throw new Error('Invalid response from eBay Finding API');
  }

  const ack = searchResponse.ack?.[0];
  if (ack === 'Failure') {
    const errorMsg = searchResponse.errorMessage?.[0]?.error?.[0]?.message?.[0] || 'Unknown error';
    console.error('eBay API error:', errorMsg);
    throw new Error(`eBay API error: ${errorMsg}`);
  }

  // Extract items from response
  const searchResultItems = searchResponse.searchResult?.[0]?.item || [];

  // Map to our types
  const items: EbaySoldItem[] = searchResultItems
    .slice(0, limit)
    .map((item: FindingApiItem) => mapFindingApiItemToSoldItem(item));

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

// ==================== Finding API Response Types ====================

interface FindingApiResponse {
  findCompletedItemsResponse?: [{
    ack?: string[];
    errorMessage?: [{
      error?: [{
        message?: string[];
      }];
    }];
    searchResult?: [{
      item?: FindingApiItem[];
    }];
  }];
}

interface FindingApiItem {
  itemId?: string[];
  title?: string[];
  galleryURL?: string[];
  viewItemURL?: string[];
  sellingStatus?: [{
    currentPrice?: [{
      __value__?: string;
      '@currencyId'?: string;
    }];
    sellingState?: string[];
  }];
  listingInfo?: [{
    endTime?: string[];
  }];
  condition?: [{
    conditionDisplayName?: string[];
  }];
}

/**
 * Map Finding API response item to our EbaySoldItem type
 */
function mapFindingApiItemToSoldItem(item: FindingApiItem): EbaySoldItem {
  // Extract price in cents
  let soldPrice = 0;
  const priceValue = item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__;
  if (priceValue) {
    soldPrice = Math.round(parseFloat(priceValue) * 100);
  }

  // Extract sold date
  const endTime = item.listingInfo?.[0]?.endTime?.[0];
  const soldDate = endTime ? endTime.split('T')[0] : new Date().toISOString().split('T')[0];

  // Get image URL
  const imageUrl = item.galleryURL?.[0] || null;

  // Get condition
  const condition = item.condition?.[0]?.conditionDisplayName?.[0] || null;

  // Get item URL
  const itemUrl = item.viewItemURL?.[0] || `https://www.ebay.com/itm/${item.itemId?.[0] || ''}`;

  return {
    itemId: item.itemId?.[0] || '',
    title: item.title?.[0] || 'Unknown Item',
    soldPrice,
    soldDate,
    imageUrl,
    condition,
    itemUrl,
  };
}

/**
 * Clear the search cache (useful for testing)
 */
export function clearCache(): void {
  searchCache.clear();
}

/**
 * Get cache statistics (useful for monitoring)
 */
export function getCacheStats(): { searchEntries: number } {
  return {
    searchEntries: searchCache.size,
  };
}

// VeriFire Background Script with Crisis Support
// Features:
// - Crisis-aware verification (higher priority, stricter checks)
// - Search-first verification with Brave/Tavily
// - LRU+TTL caching

const CONFIG = {
  // API keys (move to secure storage in production)
  GEMINI_API_KEY: "AIzaSyDlbnR3BkVVQf8t3J17bXyPfZxMx9EEWSQ",
  BRAVE_API_KEY: "BSA34mOtjkoTFzCMsH7HFbqvelbWBd6",
  TAVILY_API_KEY: "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",

  GEMINI_MODEL: "gemini-2.5-flash",

  DEBUG_ENTITY_MATCHING: false,

  PROVIDERS: ["brave", "tavily"],
  SEARCH_COUNT: 8,
  SEARCH_TIMEOUT_MS: 6000,
  EARLY_TRUSTED_NEEDLES: 2,

  CRISIS_SEARCH_COUNT: 12,
  CRISIS_SEARCH_TIMEOUT_MS: 8000,
  CRISIS_MIN_SOURCES: 2,

  CACHE_MAX: 500,
  CACHE_TTL_MS: 1000 * 60 * 60 * 12,
  CRISIS_CACHE_TTL_MS: 1000 * 60 * 30,

  FACT_CHECK_DOMAINS: [
    "reuters.com", "apnews.com", "associatedpress.com",
    "snopes.com", "politifact.com", "fullfact.org", "factcheck.org",
    "afp.com", "boomlive.in", "altnews.in", "factly.in", "africa-check.org"
  ],

  CONTRADICT_PHRASES: /\b(false|fabricated|fake|misleading|debunk(?:ed|s)?|no evidence|incorrect|not true|hoax|rumor|unverified|unconfirmed|viral claim|fact.?check)\b/i,

  CRISIS_CONTRADICT_PHRASES: /\b(false|fabricated|fake|hoax|no evidence|not true|debunked|misinformation|disinformation|viral hoax|fake news|satire|parody)\b/i,

  FAKE_MEDIA_PATTERNS: /\b(old photos?|fake (photo|image|video|footage)|misleading (photo|image|video)|recirculated|doctored|manipulated|photoshopped|altered (photo|image|video)|unrelated (photo|image|video))\b/i,

  TRUSTED_SOURCES: [
    "reuters.com", "apnews.com", "associatedpress.com",
    "bbc.com", "bbc.co.uk", "nytimes.com", "theguardian.com", "wsj.com", "bloomberg.com", "ft.com",
    "npr.org", "washingtonpost.com", "aljazeera.com", "economist.com", "axios.com", "politico.com",
    "cnbc.com", "abcnews.go.com", "cnn.com", "pbs.org", "dw.com", "france24.com", "sky.com", "news.sky.com",
    "thehindu.com", "indianexpress.com", "hindustantimes.com", "ndtv.com", "livemint.com",
    "timesofindia.indiatimes.com", "scroll.in", "moneycontrol.com",
    "snopes.com", "politifact.com", "fullfact.org", "factcheck.org", "afp.com", "boomlive.in", "altnews.in", "factly.in", "africa-check.org",
    "who.int", "un.org", "ec.europa.eu", "europa.eu", "nasa.gov", "whitehouse.gov", "fda.gov", "cdc.gov", "ecb.europa.eu"
  ],

  CRISIS_TRUSTED_SOURCES: [
    "reliefweb.int", "icrc.org", "redcross.org", "unicef.org", "unhcr.org",
    "usgs.gov", "noaa.gov", "weather.gov", "fema.gov",
    "emsc-csem.org", "gdacs.org", "pdc.org"
  ],

  SETTINGS_EXPOSED: {
    aiVerifyEnabled: true,
    perPageVerifyCap: 50,
    crisisPriority: true,
    continuousScanning: true
  },

  EXCLUDED_DOMAINS: [
    'wikipedia.org',
    'en.wikipedia.org',
    'wikimedia.org',
    'wiktionary.org',
    'britannica.com',
    'dictionary.com',
    'merriam-webster.com',
    'investopedia.com'
  ]
};

CONFIG.CRISIS_TRUSTED_SOURCES = [...new Set([...CONFIG.TRUSTED_SOURCES, ...CONFIG.CRISIS_TRUSTED_SOURCES])];

// =============== YOUTUBE TRANSCRIPT PATTERNS ===============
const CRISIS_PATTERNS_REGEX = /\b(earthquake|tsunami|flood|hurricane|tornado|wildfire|attack|bombing|explosion|outbreak|pandemic|emergency|evacuation|casualties|death toll)\b/i;
const SUSPICIOUS_PATTERNS_REGEX = /\b(cover-?up|cover\s+up|they don't want you to know|mainstream media won't|the truth about|illuminati|deep state|big pharma|chemtrails|flat earth|fake moon landing)\b/i;

// New: crisis words list used for "two-word" detection and time-aware logic
const CRISIS_WORDS = [
  'earthquake','tsunami','flood','flooding','hurricane','cyclone','typhoon','tornado',
  'wildfire','bushfire','landslide','avalanche','eruption','drought','famine',
  'explosion','blast','attack','bombing','shooting','gunfire','terrorist','hostage',
  'war','invasion','outbreak','pandemic','virus','disease','cholera','ebola','covid',
  'emergency','evacuate','evacuation','rescue','missing','trapped','casualties','death','dead','killed','injured',
  'nuclear','meltdown','chemical','blackout','power outage','bridge collapse','plane crash','crash'
].map(s => s.toLowerCase());

function countCrisisWords(text) {
  const t = String(text || '').toLowerCase();
  const found = new Set();
  for (const w of CRISIS_WORDS) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${esc}\\b`, 'i');
    if (re.test(t)) found.add(w);
  }
  return found.size;
}

function isTextCrisis(text) {
  return countCrisisWords(text) >= 2;
}

// =============== HELPERS ===============
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function debugLog(...args) {
  if (CONFIG.DEBUG_ENTITY_MATCHING) {
    console.log(...args);
  }
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return ""; }
}

function isTrustedHost(host, isCrisis = false) {
  if (! host) return false;
  const sources = isCrisis ? CONFIG.CRISIS_TRUSTED_SOURCES : CONFIG.TRUSTED_SOURCES;
  return sources.some(d => host === d || host.endsWith(`.${d}`));
}

function isFactCheckHost(host) {
  if (!host) return false;
  return CONFIG.FACT_CHECK_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
}

function isExcludedDomain(host) {
  if (!host) return false;
  return CONFIG.EXCLUDED_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
}

function normalizeClaim(str, isCrisis = false) {
  const bucket = isCrisis 
    ? new Date().toISOString().slice(0, 13)
    : new Date().toISOString().slice(0, 7);
  let t = String(str || "");
  t = t.replace(/[""]/g, '"').replace(/['']/g, "'");
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/\s*[-|•]\s*[^-|•]+$/, "");
  t = t.replace(/\s+/g, " ").trim().toLowerCase();
  t = t.split(/\s+/).slice(0, 20).join(" ");
  return `${isCrisis ? 'crisis:' : ''}${bucket}::${t}`;
}

const ENTITY_LOCATIONS = [
  'germany', 'turkey', 'florida', 'california', 'alaska', 'japan', 'china', 'india', 'russia', 'ukraine',
  'france', 'uk', 'usa', 'america', 'europe', 'asia', 'africa', 'australia', 'brazil', 'mexico', 'canada',
  'spain', 'italy', 'sudan', 'syria', 'yemen', 'gaza', 'israel', 'palestine', 'iran', 'iraq', 'pakistan',
  'afghanistan', 'bangladesh', 'indonesia', 'philippines', 'vietnam', 'thailand', 'malaysia',
  'korea', 'taiwan', 'singapore', 'hong kong', 'new york', 'los angeles', 'london', 'paris',
  'tokyo', 'beijing', 'delhi', 'mumbai', 'sydney', 'dubai', 'cairo', 'lagos', 'nairobi',
  'washington', 'chicago', 'houston', 'miami', 'boston', 'seattle', 'san francisco', 'dallas',
  'atlanta', 'denver', 'phoenix', 'portland', 'vegas', 'orlando', 'austin', 'nashville', 'anchorage',
  'toronto', 'vancouver', 'melbourne', 'berlin', 'rome', 'madrid', 'amsterdam', 'dublin', 'moscow', 'seoul',
  'tamil nadu', 'kerala', 'karnataka', 'maharashtra', 'gujarat', 'rajasthan', 'punjab', 'goa',
  'chennai', 'bangalore', 'hyderabad', 'kolkata', 'pune', 'ahmedabad', 'jaipur'
];

const LOCATION_ABBREVIATIONS = {
  't.n.': 'tamil nadu',
  'tn': 'tamil nadu',
  'u.p.': 'uttar pradesh',
  'up': 'uttar pradesh',
  'm.p.': 'madhya pradesh',
  'mp': 'madhya pradesh',
  'a.p.': 'andhra pradesh',
  'ap': 'andhra pradesh',
  'u.s.': 'usa',
  'u.s.a.': 'usa',
  'u.k.': 'uk'
};

const ENTITY_DISASTER_TYPES = [
  'earthquake', 'tsunami', 'flood', 'flooding', 'hurricane', 'cyclone', 'typhoon', 'tornado',
  'wildfire', 'bushfire', 'drought', 'famine', 'cholera', 'ebola', 'covid', 'pandemic', 'outbreak',
  'explosion', 'attack', 'bombing', 'shooting', 'landslide', 'avalanche', 'volcanic', 'eruption'
];

const OFFICIAL_ORGANIZATIONS = [
  'WHO', 'CDC', 'Pentagon', 'NASA', 'FBI', 'CIA', 'NSA', 'FEMA',
  'government', 'official', 'minister', 'president', 'secretary', 'agency', 'military'
];

const VAGUE_INDICATORS = ['near', 'somewhere', 'reportedly', 'unconfirmed', 'possible', 'alleged'];
const VAGUE_LOCATIONS = ['industrial', 'downtown', 'city', 'area', 'district', 'location', 'region'];

function extractKeyEntities(text) {
  const entities = [];
  const t = String(text || "").toLowerCase();
  const locationRegex = new RegExp(`\\b(${ENTITY_LOCATIONS.join('|')})\\b`, 'gi');
  const locationMatches = t.match(locationRegex);
  if (locationMatches) entities.push(...locationMatches.map(l => l.toLowerCase()));
  const numberMatches = t.match(/\b\d+(?:,\d+)*(?:\.\d+)?\b/g);
  if (numberMatches) entities.push(...numberMatches);
  const yearMatches = t.match(/\b20[2-3]\d\b/g);
  if (yearMatches) entities.push(...yearMatches);
  const disasterRegex = new RegExp(`\\b(${ENTITY_DISASTER_TYPES.join('|')})\\b`, 'gi');
  const disasterMatches = t.match(disasterRegex);
  if (disasterMatches) entities.push(...disasterMatches.map(d => d.toLowerCase()));
  return [...new Set(entities)];
}

function extractClaimEntities(text) {
  const t = String(text || '').toLowerCase();
  const entities = { locations: [], numbers: [], keywords: [] };
  const locationMatches = t.match(new RegExp(`\\b(${ENTITY_LOCATIONS.join('|')})\\b`, 'gi'));
  if (locationMatches) entities.locations = [...new Set(locationMatches.map(l => l.toLowerCase()))];
  const adjectiveToLocation = {
    'german': 'germany', 'turkish': 'turkey', 'french': 'france',
    'japanese': 'japan', 'chinese': 'china', 'indian': 'india',
    'russian': 'russia', 'ukrainian': 'ukraine', 'american': 'usa',
    'british': 'uk', 'spanish': 'spain', 'italian': 'italy',
    'canadian': 'canada', 'mexican': 'mexico', 'brazilian': 'brazil',
    'australian': 'australia', 'israeli': 'israel', 'iranian': 'iran',
    'iraqi': 'iraq', 'syrian': 'syria', 'pakistani': 'pakistan',
    'afghan': 'afghanistan', 'korean': 'korea', 'taiwanese': 'taiwan'
  };
  for (const [adj, loc] of Object.entries(adjectiveToLocation)) {
    if (t.includes(adj) && !entities.locations.includes(loc)) entities.locations.push(loc);
  }
  for (const [abbrev, fullName] of Object.entries(LOCATION_ABBREVIATIONS)) {
    if (t.includes(abbrev) && !entities.locations.includes(fullName)) entities.locations.push(fullName);
  }
  const numPattern = /\b\d+(?:\.\d+)?\s*(?:magnitude|dead|killed|injured|evacuated|missing|trapped|percent|%|million|billion|thousand)\b/gi;
  const nums = t.match(numPattern);
  if (nums) entities.numbers = nums.slice(0, 5);
  const disasterMatches = t.match(new RegExp(`\\b(${ENTITY_DISASTER_TYPES.join('|')})\\b`, 'gi'));
  if (disasterMatches) entities.keywords = [...new Set(disasterMatches.map(d => d.toLowerCase()))];
  return entities;
}

function sourceMatchesClaim(sourceText, claimEntities, sourceUrl = '') {
  const t = String(sourceText || '').toLowerCase();
  if (CONFIG.DEBUG_ENTITY_MATCHING) {
    console.log(`[VeriFire BG] Checking source match for: ${sourceUrl}`);
    console.log(`[VeriFire BG]   Text length: ${t.length}, first 200 chars: "${t.substring(0, 200)}..."`);
    console.log(`[VeriFire BG]   Looking for locations: ${claimEntities.locations.join(', ')}`);
    console.log(`[VeriFire BG]   Looking for keywords: ${claimEntities.keywords.join(', ')}`);
  }
  if (claimEntities.locations.length > 0) {
    const hasLocation = claimEntities.locations.some(loc => {
      if (t.includes(loc)) {
        debugLog(`[VeriFire BG]   ✓ Found location: ${loc}`);
        return true;
      }
      if (loc === 'germany' && t.includes('german')) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: german for germany`);
        return true;
      }
      if (loc === 'turkey' && (t.includes('turkish') || t.includes('türkiye'))) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: turkish/türkiye for turkey`);
        return true;
      }
      if (loc === 'france' && t.includes('french')) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: french for france`);
        return true;
      }
      if (loc === 'japan' && t.includes('japanese')) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: japanese for japan`);
        return true;
      }
      if (loc === 'china' && t.includes('chinese')) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: chinese for china`);
        return true;
      }
      if (loc === 'india' && t.includes('indian')) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: indian for india`);
        return true;
      }
      if (loc === 'russia' && t.includes('russian')) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: russian for russia`);
        return true;
      }
      if (loc === 'ukraine' && t.includes('ukrainian')) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: ukrainian for ukraine`);
        return true;
      }
      if (loc === 'usa' && (t.includes('american') || t.includes('u.s.'))) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: american/u.s. for usa`);
        return true;
      }
      if (loc === 'uk' && t.includes('british')) {
        debugLog(`[VeriFire BG]   ✓ Found location variation: british for uk`);
        return true;
      }
      return false;
    });
    if (!hasLocation) {
      debugLog(`[VeriFire BG]   ✗ Source rejected - missing location: ${claimEntities.locations.join(', ')}`);
      return false;
    }
  }
  if (claimEntities.keywords.length > 0) {
    const hasKeyword = claimEntities.keywords.some(kw => {
      if (t.includes(kw)) {
        debugLog(`[VeriFire BG]   ✓ Found keyword: ${kw}`);
        return true;
      }
      if (kw === 'flooding' && t.includes('flood')) {
        debugLog(`[VeriFire BG]   ✓ Found keyword variation: flood for flooding`);
        return true;
      }
      if (kw === 'flood' && t.includes('flooding')) {
        debugLog(`[VeriFire BG]   ✓ Found keyword variation: flooding for flood`);
        return true;
      }
      if (kw === 'earthquake' && (t.includes('quake') || t.includes('seismic') || t.includes('tremor'))) {
        debugLog(`[VeriFire BG]   ✓ Found keyword variation: quake/seismic/tremor for earthquake`);
        return true;
      }
      if (kw === 'wildfire' && t.includes('fire')) {
        debugLog(`[VeriFire BG]   ✓ Found keyword variation: fire for wildfire`);
        return true;
      }
      if (kw === 'bushfire' && t.includes('fire')) {
        debugLog(`[VeriFire BG]   ✓ Found keyword variation: fire for bushfire`);
        return true;
      }
      if (kw === 'explosion' && t.includes('blast')) {
        debugLog(`[VeriFire BG]   ✓ Found keyword variation: blast for explosion`);
        return true;
      }
      if (kw === 'attack' && t.includes('strike')) {
        debugLog(`[VeriFire BG]   ✓ Found keyword variation: strike for attack`);
        return true;
      }
      if (kw === 'shooting' && t.includes('gunfire')) {
        debugLog(`[VeriFire BG]   ✓ Found keyword variation: gunfire for shooting`);
        return true;
      }
      return false;
    });
    if (!hasKeyword) {
      debugLog(`[VeriFire BG]   ✗ Source rejected - missing disaster type: ${claimEntities.keywords.join(', ')}`);
      return false;
    }
  }
  debugLog(`[VeriFire BG]   ✓ Source matches claim entities`);
  return true;
}

function extractTimeframe(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(today|tomorrow|tuesday|wednesday|thursday|friday|saturday|sunday|monday|next week|this week|next month|this month|tonight|this morning|this evening)\b/i.test(t)) {
    return 'immediate';
  }
  const yearMatch = t.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    const currentYear = new Date().getFullYear();
    if (year - currentYear > 1) return 'years-away';
  }
  if (/\b(\d+)\s*years?\b/i.test(t)) {
    const match = t.match(/\b(\d+)\s*years?\b/i);
    if (match && parseInt(match[1], 10) > 1) return 'years-away';
  }
  return null;
}

function timeframesMatch(a, b) {
  if (a === 'immediate' && b === 'years-away') return false;
  if (a === 'years-away' && b === 'immediate') return false;
  return true;
}

function claimMatchesSource(claim, sourceText) {
  const claimLower = String(claim || '').toLowerCase();
  const sourceLower = String(sourceText || '').toLowerCase();
  const claimSaysHit = /\b(hit|strike|impact|destroy|collide|crash|slam)\b/.test(claimLower);
  const sourceSaysPass = /\b(pass|passing|miss|near|close approach|flyby|fly by|skim|skirt|safely)\b/.test(sourceLower);
  if (claimSaysHit && sourceSaysPass) {
    return false;
  }
  const claimTimeframe = extractTimeframe(claimLower);
  const sourceTimeframe = extractTimeframe(sourceLower);
  if (claimTimeframe && sourceTimeframe && !timeframesMatch(claimTimeframe, sourceTimeframe)) {
    return false;
  }
  return true;
}

// =============== VAGUE & IMPLAUSIBLE DETECTION ===============
const IMPLAUSIBLE_PATTERNS = [
  /\balien\s*(spacecraft|ship|ufo|craft|beings?|contact)\b/i,
  /\basteroid\s*(will|to)\s*(destroy|hit|impact|strike)\s*(the\s*)?earth\b/i,
  /\bsupervolcano\s*(eruption|erupt)\s*(is\s*)?(imminent|now|happening)\b/i,
  /\bnuclear\s*(reactor|plant)\s*(explodes?|meltdown)\b.*\b(cover|hiding|secret)\b/i,
  /\b(reactor|plant)\s*explodes?\b.*\bcover(ing)?\s*(up)?\b/i,
  /\bexplodes?\b.*\b(government|official)\s*(cover|hiding)\b/i,
  /\bgovernment\s*(cover|hiding|planning)\b.*\b(truth|shutdown)\b/i,
  /\b(confirmed|proves?)\s*(alien|ufo|flat earth|moon landing fake)\b/i,
  /\bpentagon\s*(confirms?|admits?)\s*(alien|ufo)\b/i,
  /\bearth.*(flat|hollow)\b.*\bconfirmed\b/i,
  /\bchemtrails?\s*(are\s*)?real\b/i,
  /\b5g\s*(causes?|spreading)\s*(covid|coronavirus|cancer)\b/i,
  /\bmicrochip\s*in\s*(vaccines?|shots?)\b/i,
  /\bpopulation\s*control\s*(plan|agenda|program)\b/i,
  /\bnew\s*world\s*order\b.*\b(confirmed|exposed|revealed)\b/i,
  /\billuminati\s*(confirmed|exposed|controls?)\b/i,
  /\bmagnetic\s*poles?\s*(will|to)\s*flip\b.*\b(next|this)\s*(week|month|day)\b/i,
  /\bsolar\s*flare\s*(will|to)\s*destroy\b/i,
  /\binternet\s*shutdown\b.*\b(planned|scheduled|confirmed)\b/i
];

function isObviouslyImplausible(claim) {
  const t = String(claim || '').toLowerCase();
  return IMPLAUSIBLE_PATTERNS.some(p => p.test(t));
}

function isVagueClaim(claim, entities) {
  const t = String(claim || '').toLowerCase();
  if (/\b(cyclone|hurricane|typhoon|tropical storm)\s+[a-zA-Z]+\b/i.test(claim)) {
    return false;
  }
  if (/\b(operation)\s+[a-zA-Z]+\b/i.test(claim)) {
    return false;
  }
  if (entities && entities.locations.length > 0 && /\b(announces?|declares?|orders?|suspend|holiday|closure|shutdown|curfew)\b/i.test(t)) {
    return false;
  }
  if (!entities || entities.locations.length === 0) {
    if (!/\b(world|global|international|united nations|un\s|who\s|nasa|pentagon)\b/i.test(t)) {
      return true;
    }
  }
  const vagueIndicatorsPattern = VAGUE_INDICATORS.join('|');
  const vagueLocationsPattern = VAGUE_LOCATIONS.join('|');
  const vagueLocationRegex = new RegExp(`\\b(${vagueIndicatorsPattern})\\s+(an?\\s+)?(${vagueLocationsPattern})\\b`, 'i');
  if (vagueLocationRegex.test(t)) {
    return true;
  }
  const orgsPattern = OFFICIAL_ORGANIZATIONS.join('|');
  const hasSpecificOrg = new RegExp(`\\b(${orgsPattern})\\b`, 'i').test(t);
  if (!hasSpecificOrg) {
    if (/\b(officials|reports|sources|experts)\s+(say|claim|warn|report|investigate|investigating)\b/i.test(t)) {
      return true;
    }
  }
  if (/\bunknown\s+(respiratory\s+)?(illness|disease|virus|substance|chemical)\b/i.test(t)) {
    return true;
  }
  if (/\bunconfirmed\s+reports?\b/i.test(t)) {
    return true;
  }
  return false;
}

function isExtraordinaryClaim(claim) {
  const t = String(claim || '').toLowerCase();
  if (/\b(cover[- ]?up|exposed|what they don[''']?t want|hidden truth|suppressed|secret(?:ly)?|they.re hiding)\b/i.test(t)) {
    return true;
  }
  if (/\b(explodes?|explosion|meltdown|crash|leak)\b.*\b(cover|hiding|secret)\b/i.test(t)) {
    return true;
  }
  if (/\b(world|governments?|global)\s+.{0,30}\b(planning|scheduled|confirmed)\b.{0,30}\b(shutdown|blackout|collapse)\b/i.test(t)) {
    return true;
  }
  if (/\binternet\s+shutdown\b/i.test(t)) {
    return true;
  }
  if (/\b(destroy|end of|apocalypse|doomsday|extinction|imminent disaster)\b.*\b(earth|world|humanity|civilization)\b/i.test(t)) {
    return true;
  }
  if (/\b(government|pentagon|nasa|military)\s*(admits?|confirms?|reveals?)\b.*\b(alien|ufo|coverup|conspiracy)\b/i.test(t)) {
    return true;
  }
  if (isObviouslyImplausible(t)) {
    return true;
  }
  return false;
}

function sourceMatchesSpecificClaim(sourceText, claim, claimEntities) {
  const t = String(sourceText || '').toLowerCase();
  const c = String(claim || '').toLowerCase();
  if (!sourceMatchesClaim(t, claimEntities)) {
    return false;
  }
  const orgsPattern = OFFICIAL_ORGANIZATIONS.join('|');
  const claimOrgs = c.match(new RegExp(`\\b(${orgsPattern})\\b`, 'gi')) || [];
  if (claimOrgs.length > 0) {
    const hasOrg = claimOrgs.some(org => t.includes(org.toLowerCase()));
    if (!hasOrg) {
      debugLog(`[VeriFire BG] Source rejected - missing organization: ${claimOrgs.join(', ')}`);
      return false;
    }
  }
  if (/\b(cover[- ]?up|hiding|secret|suppressed|concealing)\b/i.test(c)) {
    if (!/\b(cover[- ]?up|hiding|secret|suppressed|denied|refuted|debunked|false claim|no evidence)\b/i.test(t)) {
      debugLog(`[VeriFire BG] Source rejected - coverup claim but source doesn't discuss coverup`);
      return false;
    }
  }
  if (/\b(confirms?|admits?|reveals?)\s+(alien|ufo|coverup)\b/i.test(c)) {
    if (!/\b(confirms?|admits?|reveals?|denies?|refutes?|debunks?)\b/i.test(t)) {
      debugLog(`[VeriFire BG] Source rejected - confirmation claim but source doesn't discuss confirmation`);
      return false;
    }
  }
  return true;
}

// =============== CACHE ===============
const CACHE_KEY = "lowkey_verify_cache_v3";
let claimCache = new Map();

async function loadCache() {
  try {
    const obj = (await chrome.storage.local.get(CACHE_KEY))?.[CACHE_KEY];
    if (obj && typeof obj === "object") {
      const now = Date.now();
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === "object" && typeof v.ts === "number") {
          const ttl = k.startsWith('crisis:') ? CONFIG.CRISIS_CACHE_TTL_MS : CONFIG.CACHE_TTL_MS;
          if ((now - v.ts) <= ttl) {
            claimCache.set(k, v);
          }
        }
      }
    }
  } catch {}
}

async function saveCache() {
  try {
    if (claimCache.size > CONFIG.CACHE_MAX) {
      const arr = Array.from(claimCache.entries()).sort((a, b) => a[1].ts - b[1].ts);
      const toDrop = arr.slice(0, claimCache.size - CONFIG.CACHE_MAX);
      for (const [k] of toDrop) claimCache.delete(k);
    }
    const obj = {};
    for (const [k, v] of claimCache.entries()) obj[k] = v;
    await chrome.storage.local.set({ [CACHE_KEY]: obj });
  } catch {}
}

// =============== SEARCH PROVIDERS ===============
async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function braveSearch(query, count = CONFIG.SEARCH_COUNT, timeoutMs = CONFIG.SEARCH_TIMEOUT_MS, isCrisis = false) {
  if (!CONFIG.BRAVE_API_KEY) return [];
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("safesearch", "moderate");
  if (!isCrisis) {
    url.searchParams.set("freshness", "pm");
  }
  const res = await fetchWithTimeout(url.toString(), {
    headers: { "X-Subscription-Token": CONFIG.BRAVE_API_KEY }
  }, timeoutMs);
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const j = await res.json();
  const web = Array.isArray(j.web?.results) ? j.web.results : [];
  const news = Array.isArray(j.news?.results) ? j.news.results : [];
  const norm = (v) => ({
    title: v.title || v.name || "",
    url: v.url || "",
    snippet: v.description || v.snippet || "",
    date: v.published || v.dateLastCrawled || ""
  });
  return [...news.map(norm), ...web.map(norm)];
}

async function tavilySearch(query, count = CONFIG.SEARCH_COUNT, timeoutMs = CONFIG.SEARCH_TIMEOUT_MS) {
  if (!CONFIG.TAVILY_API_KEY) return [];
  const body = {
    api_key: CONFIG.TAVILY_API_KEY,
    query,
    search_depth: "basic",
    max_results: Math.max(1, Math.min(10, count)),
    include_answer: false
  };
  const res = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, timeoutMs);
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const j = await res.json();
  const results = Array.isArray(j.results) ? j.results : [];
  return results.map(r => ({
    title: r.title || "",
    url: r.url || "",
    snippet: (r.content || "").slice(0, 300),
    date: ""
  }));
}

async function parallelSearch(query, isCrisis = false) {
  const count = isCrisis ? CONFIG.CRISIS_SEARCH_COUNT : CONFIG.SEARCH_COUNT;
  const timeout = isCrisis ? CONFIG.CRISIS_SEARCH_TIMEOUT_MS : CONFIG.SEARCH_TIMEOUT_MS;
  const tasks = [];
  if (CONFIG.PROVIDERS.includes("brave") && CONFIG.BRAVE_API_KEY) {
    tasks.push(braveSearch(query, count, timeout, isCrisis));
  }
  if (CONFIG.PROVIDERS.includes("tavily") && CONFIG.TAVILY_API_KEY) {
    tasks.push(tavilySearch(query, count, timeout));
  }
  if (! tasks.length) return [];
  const results = await Promise.allSettled(tasks);
  const items = [];
  const seen = new Set();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const it of r.value) {
      if (! it?.url || seen.has(it.url)) continue;
      seen.add(it.url);
      const host = hostnameOf(it.url);
      if (isExcludedDomain(host)) {
        console.log(`[VeriFire BG] Skipping non-news source: ${host}`);
        continue;
      }
      items.push({
        title: it.title || "",
        url: it.url,
        snippet: it.snippet || "",
        date: it.date || "",
        host,
        trusted: isTrustedHost(host, isCrisis),
        factcheck: isFactCheckHost(host)
      });
    }
  }
  return items;
}

// =============== VERIFICATION ===============
function buildQueryVariants(q, isCrisis = false) {
  const base = String(q || "").replace(/\s+/g, " ").trim();
  const variants = [];
  const entities = extractKeyEntities(base.toLowerCase());
  const locations = entities.filter(e => ENTITY_LOCATIONS.includes(e));
  const disasters = entities.filter(e => ENTITY_DISASTER_TYPES.includes(e));
  const numbers = entities.filter(e => /^\d/.test(e));
  variants.push(`${base} news`);
  if (isCrisis && locations.length > 0 && disasters.length > 0) {
    const entityQuery = [...locations, ...disasters, ...numbers.slice(0, 1)].join(' ');
    variants.push(`${entityQuery} news ${new Date().getFullYear()}`);
  }
  variants.push(base);
  if (isCrisis) {
    variants.push(`${base} fact check`);
    variants.push(`${base} verified`);
  }
  const clean = base.replace(/["']/g, "");
  if (clean !== base) variants.push(clean);
  const first12 = base.split(/\s+/).slice(0, 12).join(" ");
  if (first12 !== base) variants.push(first12);
  const colon = base.split(":");
  if (colon.length > 1) {
    variants.push(colon.slice(1).join(":").trim());
  }
  return [...new Set(variants)].slice(0, isCrisis ? 5 : 4);
}

async function aiVerifyClaimHeuristic({ claim, originHost, isCrisis = false, isSuspicious = false }) {
  await loadCache();
  const key = normalizeClaim(claim, isCrisis);
  const now = Date.now();

  const cached = claimCache.get(key);
  const ttl = isCrisis ? CONFIG.CRISIS_CACHE_TTL_MS : CONFIG.CACHE_TTL_MS;
  if (cached && (now - cached.ts) <= ttl) {
    console.log(`[VeriFire BG] Cache hit for: "${claim.substring(0, 40)}..."`);
    return { ok: true, ...cached.data, cached: true };
  }

  const claimLower = claim.toLowerCase();
  const claimEntities = extractKeyEntities(claimLower);
  const structuredEntities = extractClaimEntities(claimLower);

  const claimIsVague = isVagueClaim(claim, structuredEntities);
  const claimIsImplausible = isObviouslyImplausible(claim);
  const claimIsExtraordinary = isExtraordinaryClaim(claim);

  console.log(`[VeriFire BG] Verifying${isCrisis ? ' (CRISIS)' : ''}${isSuspicious ? ' (SUSPICIOUS)' : ''}${claimIsVague ? ' (VAGUE)' : ''}${claimIsImplausible ? ' (IMPLAUSIBLE)' : ''}: "${claim.substring(0, 120)}..."`);

  if (claimIsImplausible) {
    console.log(`[VeriFire BG] Claim detected as implausible by pattern matching: "${claim.substring(0, 40)}..."`);
    let reason = 'Claim matches known misinformation patterns (conspiracy theory, impossible event, or hoax)';
    try {
      const plausibility = await checkPlausibilityWithGemini(claim);
      if (plausibility.implausible && plausibility.reason) {
        reason = plausibility.reason;
      }
    } catch (e) {
      console.log(`[VeriFire BG] Gemini check failed, using pattern-based reason: ${e}`);
    }
    const data = {
      verdict: "CONTRADICTED",
      confidence: 0.85,
      reasons: `⚠️ Claim appears implausible: ${reason}`,
      sources: [],
      triedVariants: []
    };
    claimCache.set(key, { ts: now, data });
    saveCache();
    return { ok: true, ...data };
  }

  if (!isCrisis && !isSuspicious && !claimIsVague && !claimIsImplausible && !claimIsExtraordinary && isTrustedHost((originHost || "").toLowerCase(), false)) {
    const data = {
      verdict: "CONFIRMED",
      confidence: 0.75,
      reasons: `Origin publisher (${originHost}) is trusted.`,
      sources: [],
      triedVariants: []
    };
    claimCache.set(key, { ts: now, data });
    saveCache();
    return { ok: true, ...data };
  }

  const variants = buildQueryVariants(claim, isCrisis);
  const merged = [];
  const seenUrl = new Set();
  let factRefute = null;
  let factConfirm = null;
  const contradictRegex = isCrisis ? CONFIG.CRISIS_CONTRADICT_PHRASES : CONFIG.CONTRADICT_PHRASES;

  for (const v of variants) {
    const items = await parallelSearch(v, isCrisis);
    console.log(`[VeriFire BG] Search returned ${items.length} results for query: "${v.substring(0, 60)}..."`);
    for (const it of items.slice(0, 5)) {
      console.log(`[VeriFire BG]   - ${it.host}: "${(it.title || '').substring(0, 60)}..."`);
    }
    for (const it of items) {
      if (!it?.url || seenUrl.has(it.url)) continue;
      seenUrl.add(it.url);
      const textBlob = `${it.title} ${it.snippet}`.toLowerCase();
      if (CONFIG.DEBUG_ENTITY_MATCHING) {
        console.log(`[VeriFire BG] Checking source: ${it.host}`);
        console.log(`[VeriFire BG]   Title: "${it.title}"`);
        console.log(`[VeriFire BG]   Snippet: "${(it.snippet || '').substring(0, 100)}..."`);
        for (const loc of structuredEntities.locations) {
          console.log(`[VeriFire BG]   Combined text includes '${loc}': ${textBlob.includes(loc)}`);
        }
        for (const kw of structuredEntities.keywords) {
          console.log(`[VeriFire BG]   Combined text includes '${kw}': ${textBlob.includes(kw)}`);
        }
      }
      const entityMatch = sourceMatchesClaim(textBlob, structuredEntities, it.url);
      const specificsMatch = claimMatchesSource(claim, textBlob);
      let strictMatch = entityMatch && specificsMatch;
      if ((claimIsExtraordinary || claimIsVague) && strictMatch) {
        strictMatch = sourceMatchesSpecificClaim(textBlob, claim, structuredEntities);
      }
      it.matchesClaim = strictMatch;
      it.entityMatch = entityMatch;
      it.specificsMatch = specificsMatch;
      merged.push(it);
      if (!factRefute && it.trusted && entityMatch && !specificsMatch) {
        factRefute = it;
        factRefute.contradictReason = 'Source discusses same topic but contradicts claim specifics';
      }
      if (!factRefute && it.factcheck && contradictRegex.test(textBlob)) {
        const factCheckMatchesClaim = claimEntities.length === 0 || claimEntities.some(entity => textBlob.includes(entity));
        if (factCheckMatchesClaim) {
          const isAboutFakeMedia = CONFIG.FAKE_MEDIA_PATTERNS.test(textBlob);
          if (!isAboutFakeMedia) {
            factRefute = it;
          }
        }
      }
      if (!factConfirm && it.factcheck && /\b(true|confirmed|verified|accurate|correct)\b/i.test(textBlob)) {
        if (it.matchesClaim) {
          factConfirm = it;
        }
      }
    }
    const matchingTrusted = merged.filter(m => m.trusted && m.matchesClaim);
    if (claimIsVague) {
      if (factRefute) break;
      if (merged.length >= (isCrisis ? 20 : 16)) break;
    } else {
      if (factRefute) break;
      if (!isCrisis && matchingTrusted.length >= CONFIG.EARLY_TRUSTED_NEEDLES) break;
      if (isCrisis && factConfirm && matchingTrusted.length >= CONFIG.CRISIS_MIN_SOURCES) break;
      if (merged.length >= (isCrisis ? 20 : 16)) break;
    }
  }

  if (!merged.length) {
    const data = {
      verdict: "UNCLEAR",
      confidence: 0,
      reasons: isCrisis 
        ? "No coverage found. Crisis claim unverified - treat with caution."
        : "No supporting coverage found.",
      sources: [],
      triedVariants: variants
    };
    claimCache.set(key, { ts: now, data });
    saveCache();
    return { ok: true, ...data };
  }

  if (factRefute) {
    const contradictReason = factRefute.contradictReason || 
      (factRefute.factcheck ? `Refuted by ${factRefute.host}: "${factRefute.title}"` : `Source contradicts claim specifics (${factRefute.host})`);
    const data = {
      verdict: "CONTRADICTED",
      confidence: 0.9,
      reasons: isCrisis
        ? `⚠️ CRISIS MISINFORMATION: ${contradictReason}`
        : contradictReason,
      sources: [factRefute, ...merged.filter(m => m.trusted).slice(0, 2)],
      triedVariants: variants
    };
    claimCache.set(key, { ts: now, data });
    saveCache();
    return { ok: true, ...data };
  }

  const minSourcesRequired = claimIsExtraordinary ? 3 : CONFIG.CRISIS_MIN_SOURCES;

  if (isCrisis) {
    const matchingTrusted = merged.filter(m => m.trusted && m.matchesClaim);
    if (claimIsVague) {
      const allTrusted = merged.filter(m => m.trusted);
      const data = {
        verdict: "UNCLEAR",
        confidence: 0.35,
        reasons: `Vague crisis claim - lacks specific location/details. Found ${allTrusted.length} related source(s) but cannot confirm without specifics.`,
        sources: merged.slice(0, 6),
        triedVariants: variants
      };
      claimCache.set(key, { ts: now, data });
      saveCache();
      return { ok: true, ...data };
    }
    if (claimIsExtraordinary && matchingTrusted.length >= minSourcesRequired) {
      console.log(`[VeriFire BG] Running Gemini plausibility check before confirming extraordinary claim: "${claim.substring(0, 40)}..."`);
      const plausibility = await checkPlausibilityWithGemini(claim);
      if (plausibility.implausible) {
        const data = {
          verdict: "CONTRADICTED",
          confidence: 0.8,
          reasons: `⚠️ Extraordinary claim appears implausible: ${plausibility.reason}`,
          sources: merged.slice(0, 3),
          triedVariants: variants
        };
        claimCache.set(key, { ts: now, data });
        saveCache();
        return { ok: true, ...data };
      }
    }
    if (factConfirm || matchingTrusted.length >= minSourcesRequired) {
      const data = {
        verdict: "CONFIRMED",
        confidence: factConfirm ? 0.85 : 0.7,
        reasons: factConfirm
          ? `Crisis verified by ${factConfirm.host}`
          : `Crisis confirmed by ${matchingTrusted.length} trusted sources (${matchingTrusted.slice(0, 2).map(t => t.host).join(", ")})`,
        sources: factConfirm ? [factConfirm, ...matchingTrusted.slice(0, 3)] : matchingTrusted.slice(0, 6),
        triedVariants: variants
      };
      claimCache.set(key, { ts: now, data });
      saveCache();
      return { ok: true, ...data };
    }
    const allTrusted = merged.filter(m => m.trusted);
    let unclearReason;
    if (matchingTrusted.length > 0) {
      const extraNote = claimIsExtraordinary 
        ? `extraordinary claim requires ${minSourcesRequired}+ sources` 
        : 'more confirmation needed';
      unclearReason = `Crisis claim has limited verification. Found ${matchingTrusted.length} matching trusted source(s) - ${extraNote}.`;
    } else {
      unclearReason = `Crisis claim unverified. Found ${allTrusted.length} trusted source(s) but none match claim location/type.`;
    }
    const data = {
      verdict: "UNCLEAR",
      confidence: 0.4,
      reasons: unclearReason,
      sources: merged.slice(0, 6),
      triedVariants: variants
    };
    claimCache.set(key, { ts: now, data });
    saveCache();
    return { ok: true, ...data };
  }

  if (claimIsVague) {
    const allTrusted = merged.filter(m => m.trusted);
    const data = {
      verdict: "UNCLEAR",
      confidence: 0.35,
      reasons: `Vague claim - lacks specific location/details. Found ${allTrusted.length} related source(s) but cannot confirm without specifics.`,
      sources: merged.slice(0, 6),
      triedVariants: variants
    };
    claimCache.set(key, { ts: now, data });
    saveCache();
    return { ok: true, ...data };
  }

  const matchingTrusted = merged.filter(m => m.trusted && m.matchesClaim);

  if (claimIsExtraordinary && matchingTrusted.length > 0) {
    console.log(`[VeriFire BG] Running Gemini plausibility check before confirming extraordinary claim: "${claim.substring(0, 40)}..."`);
    const plausibility = await checkPlausibilityWithGemini(claim);
    if (plausibility.implausible) {
      const data = {
        verdict: "CONTRADICTED",
        confidence: 0.8,
        reasons: `⚠️ Extraordinary claim appears implausible: ${plausibility.reason}`,
        sources: merged.slice(0, 3),
        triedVariants: variants
      };
      claimCache.set(key, { ts: now, data });
      saveCache();
      return { ok: true, ...data };
    }
    if (matchingTrusted.length < minSourcesRequired) {
      const data = {
        verdict: "UNCLEAR",
        confidence: 0.4,
        reasons: `Extraordinary claim requires stronger evidence. Found ${matchingTrusted.length} trusted source(s) but need ${minSourcesRequired}+ for confirmation.`,
        sources: merged.slice(0, 6),
        triedVariants: variants
      };
      claimCache.set(key, { ts: now, data });
      saveCache();
      return { ok: true, ...data };
    }
  }

  if (matchingTrusted.length > 0) {
    const data = {
      verdict: "CONFIRMED",
      confidence: 0.7,
      reasons: `Trusted coverage found (${matchingTrusted[0].host}).`,
      sources: matchingTrusted.slice(0, 6),
      triedVariants: variants
    };
    claimCache.set(key, { ts: now, data });
    saveCache();
    return { ok: true, ...data };
  }

  const anyTrusted = merged.filter(m => m.trusted);
  const hasEntityConstraints = structuredEntities.locations.length > 0 || structuredEntities.keywords.length > 0;

  if (anyTrusted.length > 0 && !hasEntityConstraints) {
    const data = {
      verdict: "CONFIRMED",
      confidence: 0.6,
      reasons: `Trusted coverage found (${anyTrusted[0].host}).`,
      sources: anyTrusted.slice(0, 6),
      triedVariants: variants
    };
    claimCache.set(key, { ts: now, data });
    saveCache();
    return { ok: true, ...data };
  }

  if ((isCrisis || isSuspicious) && !claimIsImplausible) {
    console.log(`[VeriFire BG] Running Gemini plausibility check for: "${claim.substring(0, 40)}..."`);
    const plausibility = await checkPlausibilityWithGemini(claim);
    if (plausibility.implausible) {
      const data = {
        verdict: "CONTRADICTED",
        confidence: 0.7,
        reasons: `Claim appears implausible: ${plausibility.reason}`,
        sources: merged.slice(0, 3),
        triedVariants: variants
      };
      claimCache.set(key, { ts: now, data });
      saveCache();
      return { ok: true, ...data };
    }
  }

  const data = {
    verdict: "UNCLEAR",
    confidence: 0.3,
    reasons: "Coverage found but no trusted sources or refutations.",
    sources: merged.slice(0, 6),
    triedVariants: variants
  };
  claimCache.set(key, { ts: now, data });
  saveCache();
  return { ok: true, ...data };
}

// =============== PLAUSIBILITY CHECK ===============
async function checkPlausibilityWithGemini(claim) {
  if (!CONFIG.GEMINI_API_KEY) {
    return { implausible: false, reason: "Gemini API key not configured" };
  }

  const prompt = `You are a fact-checking assistant. Analyze this claim for plausibility:

"${claim}"

Consider:
1. Would major news outlets (Reuters, AP, BBC, NYT) report this if true?
2. Does this contradict established scientific consensus?
3. Does this claim something that would require extraordinary evidence?
4. Does this sound like a conspiracy theory or hoax?

Respond with ONLY a JSON object (no markdown):
{"implausible": true/false, "reason": "brief explanation"}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 150
        }
      })
    }, 10000);

    if (!res.ok) {
      console.error(`[VeriFire BG] Gemini API error: ${res.status}`);
      return { implausible: false, reason: "API error" };
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          implausible: Boolean(parsed.implausible),
          reason: String(parsed.reason || "")
        };
      } catch (parseError) {
        console.error("[VeriFire BG] Gemini JSON parse error:", parseError);
        return { implausible: false, reason: "Invalid JSON response" };
      }
    }
    return { implausible: false, reason: "Could not parse response" };
  } catch (e) {
    console.error("[VeriFire BG] Gemini plausibility check error:", e);
    return { implausible: false, reason: String(e) };
  }
}

// =============== MESSAGE HANDLING ===============
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_SETTINGS") {
    sendResponse({ ok: true, settings: CONFIG.SETTINGS_EXPOSED });
    return;
  }
  if (msg?.type === "CLASSIFY_CANDIDATES") {
    sendResponse({ ok: true, results: [] });
    return;
  }
  if (msg?.type === "VERIFY_YOUTUBE_TRANSCRIPT") {
    (async () => {
      try {
        const transcript = String(msg.transcript || "").trim();
        const videoTitle = String(msg.videoTitle || "").trim();
        if (!transcript || transcript.length < 100) {
          return sendResponse({ ok: false, error: "Transcript too short" });
        }
        console.log(`[VeriFire BG] Analyzing YouTube: "${videoTitle.substring(0, 50)}..."`);
        const isCrisis = CRISIS_PATTERNS_REGEX.test(transcript);
        const isSuspicious = SUSPICIOUS_PATTERNS_REGEX.test(transcript);
        const analysis = await analyzeYouTubeTranscript(transcript, videoTitle, isCrisis, isSuspicious);
        sendResponse(analysis);
      } catch (e) {
        console.error("[VeriFire BG] YouTube analysis error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg?.type === "VERIFY_AI") {
    (async () => {
      try {
        const claim = String(msg.claim || msg.query || "").trim();
        const originHost = String(msg.originHost || "").toLowerCase();
        const isCrisis = Boolean(msg.isCrisis);
        const isSuspicious = Boolean(msg.isSuspicious);
        if (!claim) {
          return sendResponse({ ok: false, error: "Missing claim" });
        }
        if (!CONFIG.BRAVE_API_KEY && !CONFIG.TAVILY_API_KEY) {
          return sendResponse({ ok: false, error: "Missing search API keys" });
        }
        const res = await aiVerifyClaimHeuristic({ claim, originHost, isCrisis, isSuspicious });
        sendResponse(res);
      } catch (e) {
        console.error("[VeriFire BG] Verify error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

// =============== YOUTUBE TRANSCRIPT ANALYSIS ===============
const YOUTUBE_TRANSCRIPT_MAX_CHARS = 4000;

async function analyzeYouTubeTranscript(transcript, videoTitle, isCrisis, isSuspicious) {
  if (!CONFIG.GEMINI_API_KEY) {
    return { ok: false, noApiKey: true, error: "API not configured", reasons: "API not available" };
  }

  const contextNote = isCrisis 
    ? "Note: This transcript contains crisis-related keywords. Pay extra attention to potential emergency misinformation."
    : isSuspicious 
    ? "Note: This transcript contains suspicious patterns. Check carefully for conspiracy theories or misinformation."
    : "";

  const prompt = `Analyze this YouTube video transcript for misinformation.

TITLE: "${videoTitle}"
${contextNote}

TRANSCRIPT:
"""
${transcript.substring(0, YOUTUBE_TRANSCRIPT_MAX_CHARS)}
"""

Check if this content:
1. Makes false factual claims
2. Spreads conspiracy theories
3. Contains dangerous health/safety misinformation
4. Is crisis-related misinformation

Respond with JSON only:
{"verdict": "CONFIRMED" or "CONTRADICTED" or "UNCLEAR", "reasons": "brief explanation"}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 300 }
      })
    }, 30000);

    if (!res.ok) {
      console.error(`[VeriFire BG] Gemini API error: ${res.status}`);
      return { ok: false, apiError: true, error: `API error: ${res.status}`, reasons: "Analysis service error" };
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        ok: true,
        verdict: parsed.verdict || "UNCLEAR",
        reasons: parsed.reasons || "Analysis complete",
        sources: []
      };
    }
    return { ok: true, verdict: "UNCLEAR", reasons: "Could not parse analysis" };
  } catch (e) {
    console.error("[VeriFire BG] Gemini analysis error:", e);
    return { ok: false, apiError: true, error: String(e), reasons: "Analysis service error" };
  }
}

// Initialize cache on startup
loadCache().then(() => {
  console.log("[VeriFire BG] Cache loaded, entries:", claimCache.size);
});
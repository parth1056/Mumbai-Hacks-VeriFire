(() => {
  const WRAP_ATTR = "data-lowkey-fc-id";
  const ICON_ID_ATTR = "data-lowkey-ic-id";
  const MAX_ITEMS = 160;
  
  // Extraction constants
  const MIN_TEXT_LENGTH = 30;
  const MAX_TEXT_LENGTH = 300;
  const MIN_WORDS = 3;
  const MAX_WORDS = 50;
  const MAX_DEDUP_KEY_LENGTH = 60;

  let SETTINGS = { aiVerifyEnabled: true, perPageVerifyCap: 20, crisisPriority: true, continuousScanning: true };

  // =============== SKIP TEXT FILTERS ===============
  const SKIP_PREFIXES = /^(recipe:|guide:|how to make|tutorial:|step \d|ingredients:|directions:)/i;
  const SKIP_EXACT = new Set([
    'home', 'about', 'contact', 'search', 'menu', 'login', 'sign up', 'subscribe',
    'more', 'read more', 'see all', 'view all', 'load more', 'show more',
    'previous', 'next', 'back', 'close', 'cancel', 'ok', 'yes', 'no',
    'share', 'tweet', 'email', 'print', 'comments', 'reply'
  ]);

  const SKIP_UI_PATTERNS = [
    /^[🔥✅❌❓🎨💉📋🚨⚠️]/,
    /should verify as/i,
    /should be (green|red|gray|confirmed|contradicted)/i,
    /^(real|fake|uncertain) (crisis|news)/i,
    /verification (demo|legend|test)/i,
    /^(inject|clear|debug)/i,
    /use the buttons/i,
    /waiting for/i,
    /expected:/i,
    /real crisis event/i,
    /fake crisis/i,
    /uncertain crisis/i,
    /^(openai|credits|submission|form|mentor|template|rules|faqs|contact|help|resources|partner)/i,
    /^(register|sign up|apply|submit|deadline|schedule|prizes?|sponsors?|judges?)/i,
    /^(team|project|challenge|track|category|eligibility|requirements)/i
  ];

  const SHORT_TEXT_CRISIS_RE = /\b(dead|killed|attack|flood|earthquake|fire|crash|explosion|emergency|crisis|disaster)\b/i;
  
  function isUIElement(text) {
    return SKIP_UI_PATTERNS.some(pattern => pattern.test(text));
  }

  function shouldSkipText(text) {
    const t = (text || '').toLowerCase().trim();
    if (t.length < MIN_TEXT_LENGTH) return true;
    if (SKIP_EXACT.has(t)) return true;
    if (SKIP_PREFIXES.test(t)) return true;
    if (isUIElement(t)) return true;
    const wordCount = t.split(/\s+/).length;
    if (wordCount <= 3 && !SHORT_TEXT_CRISIS_RE.test(t)) return true;
    return false;
  }

  function couldBeNews(text) {
    const t = (text || '').toLowerCase();
    if (/^(recipe|guide|tutorial|how to make|step \d|ingredients)/i.test(t)) return false;
    if (/^(top \d+|best \d+|\d+ ways to|\d+ tips|\d+ things)/i.test(t)) return false;
    return true;
  }

  // =============== BLOCKED DOMAINS ===============
  const BLOCKED_DOMAINS = [
    'github.com', 'github.dev', 'github.io', 'gitlab.com',
    'stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com',
    'docs.google.com', 'drive.google.com', 'mail.google.com', 'calendar.google.com', 'sheets.google.com',
    'chat.openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com',
    'bard.google.com', 'gemini.google.com',
    'aistudio.google.com', 'ai.google.dev', 'makersuite.google.com',
    'colab.research.google.com', 'console.cloud.google.com',
    'twitter.com', 'x.com', 'facebook.com', 'fb.com', 'instagram.com', 'tiktok.com',
    'linkedin.com', 'reddit.com',
    'amazon.com', 'amazon.in', 'amazon.co.uk', 'ebay.com', 'etsy.com',
    'netflix.com', 'hulu.com', 'disneyplus.com', 'primevideo.com',
    'spotify.com', 'music.youtube.com', 'twitch.tv',
    'discord.com', 'discord.gg', 'slack.com', 'outlook.com', 'outlook.live.com',
    'notion.so', 'notion.com', 'figma.com', 'canva.com',
    'medium.com', 'substack.com',
    'wikipedia.org', 'devpost.com', 'hackerearth.com', 'mlh.io', 'hackathon.com',
    'eventbrite.com', 'meetup.com', 'lu.ma', 'hopin.com'
  ];
  const NON_NEWS_SITE_PATTERNS = [
    /hackathon/i
  ];

  function isBlockedDomain() {
    const host = location.hostname.toLowerCase();
    if (BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return true;
    if (NON_NEWS_SITE_PATTERNS.some(pattern => pattern.test(host))) return true;
    return false;
  }

  // =============== PRE-SCREENING ===============
  function shouldProcessContent(text, context = 'headline') {
    const t = String(text || '').toLowerCase();
    if (t.length < 20) return false;
    if ((context === 'headline' || context === 'youtube_title') && t.length > 500) return false;
    const hasNewsStructure = (
      /\b(killed|injured|dead|dies|died|attacks?|strikes?|hits?|destroys?|collapses?|explodes?|erupts?|floods?|burns?|crashes?|confirms?|announces?|declares?|warns?|reports?|investigat(?:es?|ing)|evac(?:uat|uation|uating))\b/i.test(t) ||
      /\b(says?|said|according to|reports?|officials?|government|minister|president|police|military)\b/i.test(t) ||
      /\b(breaking|urgent|alert|live|update|developing)\b/i.test(t)
    );
    const hasCrisisKeywords = /\b(earthquake|tsunami|flood|flooding|hurricane|cyclone|typhoon|tornado|wildfire|fire|drought|famine|attack|bombing|explosion|shooting|terrorist|war|invasion|outbreak|pandemic|evacuation|casualties|death toll|dead|killed|injured|missing|trapped)\b/i;
    const hasSuspiciousKeywords = /\b(cover[-\s]?up|hiding|secret|conspiracy|they don't want|truth about|exposed|shocking|won't believe|mainstream media|deep state|big pharma|hoax|fake|scam|fraud|alien|ufo)\b/i;

    if (context === 'headline') {
      return hasNewsStructure && (hasCrisisKeywords || hasSuspiciousKeywords);
    }
    if (context === 'youtube_title') {
      return hasNewsStructure && (hasCrisisKeywords || hasSuspiciousKeywords);
    }
    if (context === 'youtube') {
      return hasCrisisKeywords || hasSuspiciousKeywords;
    }
    return false;
  }

  // =============== YOUTUBE ENTERTAINMENT DETECTION ===============
  function isEntertainmentVideo(title) {
    const t = String(title || '').toLowerCase();
    const entertainmentPatterns = [
      /\b(music video|official video|lyrics|ft\.|feat\.)\b/i,
      /\b(trailer|movie clip|scene|episode|full movie)\b/i,
      /\b(gameplay|walkthrough|let's play|gaming|playthrough)\b/i,
      /\b(tutorial|how to|diy|recipe|review|unboxing)\b/i,
      /\b(funny|comedy|prank|fail|meme|vine|tiktok)\b/i,
      /\b(vlog|day in|routine|haul|q&a|ama)\b/i,
      /\b(asmr|relaxing|meditation|sleep|ambient)\b/i,
      /\b(podcast|interview|talk show|discussion)\b/i,
      /\b(reaction|reacts to|watching)\b/i,
      /\b(cover|remix|acoustic|live performance)\b/i,
      /\|\s*[A-Z][a-z]+(\s+[A-Z][a-z]+)*\s*$/i
    ];
    if (entertainmentPatterns.some(p => p.test(t))) return true;
    const newsPatterns = /\b(breaking|news|report|update|crisis|emergency|attack|killed|dead|earthquake|flood|outbreak|pandemic|war|conflict)\b/i;
    if (newsPatterns.test(t)) return false;
    return false;
  }

  // =============== STATUS TRACKING ===============
  const ICON_STATE = new Map();
  const ICON_ELEMS = new Map();
  const TARGET_MAP = new Map();
  const VISIBLE_IDS = new Set();
  const PROCESSED_TEXTS = new Set();

  const STATUS_META = {
    confirmed:           { color: "green",  label: "Verified" },
    contradicted:        { color: "red",    label: "Fake/Debunked" },
    unclear:             { color: "gray",   label: "Uncertain" },
    pending:             { color: "yellow", label: "Verifying..." },
    "crisis-pending":    { color: "yellow", label: "Crisis - Verifying" },
    "crisis-confirmed":  { color: "green",  label: "Crisis - Verified" },
    "crisis-contradicted": { color: "red",  label: "Crisis - FAKE" },
    "crisis-unclear":    { color: "gray",   label: "Crisis - Uncertain" }
  };

  // =============== CRISIS DETECTION ===============
  const NON_CRISIS_PATTERNS = [
    /\b(unveils?|inaugurates?|launches?|celebrates?|ceremony|festival|anniversary|dedication)\b/i,
    /\b(statue|monument|memorial|museum|temple|shrine|building\s*inaugurat)\b/i,
    /\b(election|vote|votes?|voting|campaign|rally|speech|address|summit|meeting|conference)\b/i,
    /\b(award|prize|honor|tribute|recognition|achievement)\b/i,
    /\b(game|match|tournament|championship|concert|performance|movie|film|premiere)\b/i
  ];

  const CRISIS_KEYWORDS = {
    disasters: /\b(earthquake|quake|tsunami|flood(?:ing|s)?|hurricane|cyclone|typhoon|tornado|wildfire|bushfire|landslide|avalanche|volcanic|eruption|drought|famine)\b/i,
    emergencies: /\b(emergency|evacuati(?:on|ng|ed)|rescue|missing|trapped|stranded|casualties|death\s*toll|victims|survivors|injured|wounded|fatalities)\b/i,
    conflict: /\b(attack|bombing|explosion|blast|shooting|gunfire|terrorist|hostage|war|conflict|airstrike|missile|shelling|invasion)\b/i,
    health: /\b(outbreak|epidemic|pandemic|virus|disease|infection|quarantine|lockdown|health\s*emergency|WHO|CDC)\b/i,
    infrastructure: /\b(nuclear|meltdown|chemical\s*spill|oil\s*spill|dam\s*break|blackout|power\s*outage|bridge\s*collapse|building\s*collapse|derailment|plane\s*crash|crash\s*landing)\b/i,
    urgency: /\b(breaking|urgent|alert|warning|emergency|immediate|developing|just\s*in|live\s*update)\b/i,
    scale: /\b(mass(?:ive)?|hundreds|thousands|millions|widespread|catastroph(?:e|ic)|devastat(?:ed|ing)|crisis|disaster|calamity)\b/i
  };

  // New: list of crisis words for "two-word" detection.
  const CRISIS_WORDS = [
    'earthquake','tsunami','flood','flooding','hurricane','cyclone','typhoon','tornado',
    'wildfire','bushfire','landslide','avalanche','eruption','drought','famine',
    'explosion','blast','attack','bombing','shooting','gunfire','terrorist','hostage',
    'war','invasion','outbreak','pandemic','virus','disease','cholera','ebola','covid',
    'emergency','evacuate','evacuation','rescue','missing','trapped','casualties','death','dead','killed','injured',
    'nuclear','meltdown','chemical','blackout','power outage','bridge collapse','plane crash','crash'
  ].map(s => s.toLowerCase());

  // Time-aware crisis detection:
  // - present indicators lower threshold
  // - past indicators raise threshold
  function detectCrisis(text) {
    const t = String(text || "").toLowerCase();

    // Early reject: clearly non-crisis scaffolding
    if (NON_CRISIS_PATTERNS.some(p => p.test(t))) {
      return { isCrisis: false, score: 0, signals: [], category: null };
    }

    // Count distinct crisis words
    const matched = new Set();
    for (const w of CRISIS_WORDS) {
      // escape possible regex meta in words (e.g., spaces)
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${esc}\\b`, 'i');
      if (re.test(t)) matched.add(w);
    }
    const count = matched.size;

    // Temporal cues
    const presentIndicators = /\b(breaking|urgent|alert|now|currently|ongoing|continues|continuing|still|immediate|evacuating|evacuation in progress|rescue in progress|just now|today|this (morning|evening|week|month))\b/i;
    const pastIndicators = /\b(was|were|had been|previous(?:ly)?|earlier|yesterday|last (night|week|month|year)|in \d{4}|on [A-Za-z]{3,9} \d{1,2}|reported earlier)\b/i;

    const hasPresent = presentIndicators.test(t) || CRISIS_KEYWORDS.urgency.test(t) || CRISIS_KEYWORDS.scale.test(t);
    const hasPast = pastIndicators.test(t);

    // Decision thresholds:
    // - present: >=1
    // - neutral: >=2
    // - past only: >=3
    let isCrisis = false;
    if (hasPresent) {
      isCrisis = count >= 1;
    } else if (hasPast && !hasPresent) {
      isCrisis = count >= 3;
    } else {
      isCrisis = count >= 2;
    }

    const signals = Array.from(matched);
    let category = null;
    for (const [cat, regex] of Object.entries(CRISIS_KEYWORDS)) {
      if (regex.test(t)) { category = cat; break; }
    }
    if (!category && signals.length) category = signals[0];

    let score = count;
    if (hasPresent) score += 2;
    if (hasPast && !hasPresent) score = Math.max(0, score - 1);

    return { isCrisis, score, signals, category };
  }

  // =============== SUSPICIOUS DETECTION ===============
  const SUSPICIOUS_PATTERNS = {
    coverup: /\b(cover[- ]?up|exposed|what they don[''']?t want you to know|mainstream media won[''']?t|the truth about|hidden|secret(?:ly)?|suppressed)\b/i,
    conspiracy: /\b(illuminati|new world order|deep state|big pharma|chemtrails|5g|microchip|mind control|population control)\b/i,
    implausible: /\b(alien|ufo|extraterrestrial|time travel|teleport|immortal|cure[sd]? (?:all |every )?(?:cancer|disease)|free energy|perpetual motion)\b/i,
    sensational: /\b(shocking|you won[''']?t believe|they don[''']?t want)\b/i
  };

  function detectSuspicious(text) {
    const t = String(text || "").toLowerCase();
    const signals = [];
    for (const [category, regex] of Object.entries(SUSPICIOUS_PATTERNS)) {
      if (regex.test(t)) signals.push(category);
    }
    return { isSuspicious: signals.length > 0, signals };
  }

  // =============== CONTINUOUS SCANNING ===============
  let mutationObserver = null;
  let scanDebounceTimer = null;
  const SCAN_DEBOUNCE_MS = 500;

  function startContinuousScanning() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
      let hasNewContent = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              const hasLinks = node.querySelectorAll?.('a[href]')?.length > 0 || node.tagName === 'A';
              const hasHeadings = node.querySelectorAll?.('h1,h2,h3,h4')?.length > 0 || /^H[1-4]$/.test(node.tagName);
              if (hasLinks || hasHeadings) {
                hasNewContent = true;
                break;
              }
            }
          }
        }
        if (hasNewContent) break;
      }

      if (hasNewContent) {
        clearTimeout(scanDebounceTimer);
        scanDebounceTimer = setTimeout(() => {
          console.log('[VeriFire] New content detected, rescanning...');
          scanNewContent();
        }, SCAN_DEBOUNCE_MS);
      }
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });
    console.log('[VeriFire] Continuous scanning started');
  }

  function stopContinuousScanning() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    clearTimeout(scanDebounceTimer);
    console.log('[VeriFire] Continuous scanning stopped');
  }

  async function scanNewContent() {
    const { items, map } = extractHeadlines();
    const newItems = items.filter(it => ! PROCESSED_TEXTS.has(normalizeForDedup(it.text)));
    if (newItems.length === 0) {
      console.log('[VeriFire] No new headlines found');
      return;
    }
    console.log(`[VeriFire] Found ${newItems.length} new headlines`);
    await processHeadlines(newItems, map);
  }

  function normalizeForDedup(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 100);
  }

  // =============== HELPERS ===============
  let idCounter = 0;
  const nextId = () => `lfc_${Date.now().toString(36)}_${++idCounter}`;
  const escapeHtml = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const getLang = () => (document.documentElement?.getAttribute?.("lang") || navigator.language || "en").split(",")[0].slice(0,2).toLowerCase();

  function ensureStyles() {
    if (document.querySelector('link[data-lowkey-style="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("src/panel.css");
    link.setAttribute("data-lowkey-style", "1");
    document.documentElement.appendChild(link);
    const style = document.createElement("style");
    style.textContent = `
      .lk-ic-crisis { animation: crisis-pulse 1s infinite; }
      @keyframes crisis-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(156, 163, 175, 0.4); }
        50% { box-shadow: 0 0 0 4px rgba(156, 163, 175, 0); }
      }
    `;
    document.head.appendChild(style);
  }

  function isVisible(el) {
    if(! el || el.nodeType !== 1 || ! el.isConnected) return false;
    let cs;
    try { cs = getComputedStyle(el); } catch { return false; }
    if(! cs) return false;
    if(cs.display === "none" || cs.visibility === "hidden") return false;
    if(parseFloat(cs.opacity || "1") < 0.05) return false;
    return true;
  }

  function isInViewportRect(r) {
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }

  function computeSafeInsets() {
    const topCandidates = Array.from(document.querySelectorAll("header, [role='banner'], nav, #top_nav, .top-nav, .header, .navbar"));
    let safeTop = 0, safeBottom = 0;
    const isFixedOrSticky = (el) => {
      const cs = getComputedStyle(el);
      return (cs.position === "fixed" || cs.position === "sticky");
    };
    for (const el of topCandidates) {
      if (! isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (isFixedOrSticky(el) && r.top <= 0 && r.bottom > 0) {
        safeTop = Math.max(safeTop, Math.min(160, Math.ceil(r.bottom)));
      }
    }
    return { safeTop, safeBottom };
  }

  // =============== NEWS DETECTION ===============
  const BAN_PATTERNS = [
    /^headlines?$/i, /^top stories$/i, /^search results$/i,
    /^page navigation$/i, /^footer links$/i
  ];
  const NON_NEWS_PATTERNS = [
    /^opinion\s*[:：]/i, /^review\s*[:：]/i, /^how\s*to\b/i,
    /\bguide\b/i, /\brecipe\b/i, /\btips?\b.*\bfor\b/i,
    /\bbest\s+\d+\b/i, /\btop\s+\d+\b/i
  ];
  function isBannedScaffold(text) {
    const t = (text || "").trim();
    if (! t) return true;
    if (BAN_PATTERNS.some(re => re.test(t))) return true;
    return false;
  }
  function isNonNewsContent(text) {
    const t = (text || "").trim();
    return NON_NEWS_PATTERNS.some(re => re.test(t));
  }

  const ACTION_RE = /\b(threatens?|warns?|revokes?|suspends?|bans?|sanctions?|arrests?|launches?|announces?|passes?|approves?|blocks?|strikes?|attacks?|kills?|dies?|explodes?)\b/i;
  const SPEECH_RE = /\b(says?|said|announces?|claims?|warns?|confirms?|denies?|reports?)\b/i;
  function wc(s) { return (String(s || "").match(/\S+/g) || []).length; }

  function hostnameOf(url) {
    try { return new URL(url, location.href).hostname.toLowerCase(); }
    catch { return ""; }
  }

  function isArticleLikeHref(href) {
    if (!href) return false;
    try {
      const u = new URL(href, location.href);
      if (/(^|\.)google\./.test(u.hostname) && !/^news\.google\./.test(u.hostname)) return false;
      const path = u.pathname.replace(/\/+$/, "");
      const excluded = new Set(["", "/", "/news", "/latest", "/headlines", "/home"]);
      if (excluded.has(path)) return false;
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs.length >= 2) return true;
      if (/-/.test(u.pathname)) return true;
      return false;
    } catch { return false; }
  }

  // Claim signals detection
  function claimSignals(text) {
    const feats = [];
    const t = String(text || "");
    if (/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/.test(t) || /\b\d+(?:\.\d+)?%/.test(t) || /[$₹£€]\s?\d/.test(t)) feats.push("metric");
    if (/\b(20\d{2}|19\d{2})\b/.test(t) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(t) || /\b(today|yesterday|tomorrow|this week|last week|this month|last month)\b/i.test(t)) feats.push("date");
    if (/\b(video|footage|clip|livestream|viral)\b/i.test(t)) feats.push("media");
    if (/["“”‘’'].+["“”‘’']/.test(t)) feats.push("quote");
    if (/\b(says?|said|announces?|announced|threatens?|warns?|revokes?|suspends?|bans?|sanctions?|rules?|orders?|stays?|allows?|rejects?|approves?|moves?|relocates?)\b/i.test(t)) feats.push("action");
    const families = new Set(feats);
    return { score: families.size, features: Array.from(families) };
  }

  // =============== DOT ELEMENTS ===============
  function makeDot(id, status, isCrisis = false) {
    let dot = ICON_ELEMS.get(id);
    const meta = STATUS_META[status] || STATUS_META.unclear;
    if (! dot) {
      dot = document.createElement("span");
      dot.setAttribute(ICON_ID_ATTR, id);
      dot.style.position = "fixed";
      dot.style.zIndex = "2147483646";
      dot.style.display = "none";
      dot.style.cursor = "pointer";
      dot.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showPopoverForId(id, dot);
      }, true);
      document.body.appendChild(dot);
      ICON_ELEMS.set(id, dot);
    }
    dot.className = `lk-ic lk-ic-floating lk-ic-${meta.color}`;
    if (isCrisis && (status.includes('pending') || status.includes('unclear'))) {
      dot.classList.add('lk-ic-crisis');
    }
    dot.title = meta.label;
    return dot;
  }

  function placeDot(id) {
    const el = TARGET_MAP.get(id);
    const dot = ICON_ELEMS.get(id);
    if (!el || !dot || ! isVisible(el)) {
      if (dot) dot.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    if (! isInViewportRect(r)) {
      dot.style.display = "none";
      return;
    }
    const { safeTop } = computeSafeInsets();
    const desiredTop = Math.max(6, r.top + 2);
    const desiredLeft = Math.max(6, r.right + 6);
    if (desiredTop < safeTop + 6 || desiredTop > (window.innerHeight - 16)) {
      dot.style.display = "none";
      return;
    }
    dot.style.top = `${Math.min(window.innerHeight - 16, desiredTop)}px`;
    dot.style.left = `${Math.min(window.innerWidth - 16, desiredLeft)}px`;
    dot.style.display = "inline-block";
  }

  function placeAllDots() {
    for (const id of ICON_ELEMS.keys()) {
      if (VISIBLE_IDS.has(id)) placeDot(id);
      else {
        const dot = ICON_ELEMS.get(id);
        if (dot) dot.style.display = "none";
      }
    }
  }

  window.addEventListener("scroll", placeAllDots, { passive: true });
  window.addEventListener("resize", placeAllDots, { passive: true });

  // =============== POPOVER ===============
  let POP;
  function createPopover() {
    if (POP && document.body.contains(POP)) return POP;
    POP = document.createElement("div");
    POP.className = "lk-pop";
    document.body.appendChild(POP);
    document.addEventListener("click", (e) => {
      if (! POP) return;
      if (! POP.contains(e.target)) POP.style.display = "none";
    }, true);
    return POP;
  }

  function positionPopover(anchor) {
    const el = createPopover();
    const r = anchor.getBoundingClientRect();
    el.style.display = "block";
    el.style.position = "fixed";
    el.style.top = Math.min(window.innerHeight - el.offsetHeight - 10, r.bottom + 6) + "px";
    el.style.left = Math.min(window.innerWidth - 10 - 320, Math.max(10, r.left)) + "px";
    el.style.maxWidth = "320px";
  }

  function sourcesHtml(srcs) {
    if (!Array.isArray(srcs) || ! srcs.length) return "<div class='lkp-none'>No sources yet.</div>";
    return srcs.slice(0, 3).map(s => `
      <div class="lkp-review">
        <div class="lkp-pub">${escapeHtml(s.host || "")}${s.trusted ? " • trusted" : ""}</div>
        <a class="lkp-link" href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url || "")}</a>
        <div class="lkp-rating">${escapeHtml(s.snippet || "")}</div>
      </div>`).join("");
  }

  function showPopoverForId(id, anchor) {
    const st = ICON_STATE.get(id);
    if (! st) return;
    const meta = STATUS_META[st.status] || STATUS_META.unclear;
    const crisisHtml = st.isCrisis ? 
      `<div style="background:#fef2f2;color:#dc2626;padding:6px 8px;border-radius:4px;margin-bottom:8px;font-size:12px;">
        🚨 <strong>CRISIS CONTENT</strong> - ${st.crisisCategory || 'Emergency'}
      </div>` : '';
    const pop = createPopover();
    pop.innerHTML = `
      ${crisisHtml}
      <div class="lk-pop-title">${escapeHtml(st.text || "")}</div>
      <div class="lk-pop-row"><b>Status:</b> ${escapeHtml(meta.label)}</div>
      ${st.reasons ?  `<div class="lk-pop-reasons">${escapeHtml(st.reasons)}</div>` : ""}
      ${st.sources?.length ? `<div class="lk-pop-sources">${sourcesHtml(st.sources)}</div>` : ""}
      <div class="lk-pop-hint">Verified automatically by VeriFire.</div>
    `;
    positionPopover(anchor);
  }

  // =============== MESSAGING ===============
  function sendMessage(payload, timeoutMs = 30000) {
    return new Promise((resolve) => {
      let done = false;
      const to = setTimeout(() => {
        if (! done) { done = true; resolve({ ok: false, error: "timeout" }); }
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          clearTimeout(to);
          if (done) return;
          done = true;
          if (chrome.runtime.lastError) {
            return resolve({ ok: false, error: chrome.runtime.lastError.message });
          }
          resolve(resp || { ok: false, error: "no response" });
        });
      } catch (e) {
        clearTimeout(to);
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  // =============== VERIFY QUEUE ===============
  const verifyQueue = [];
  let queueRunning = false;
  let verifiedCount = 0;
  const PROCESSED_CLAIMS = new Set();

  function findVerifiedIdWithClaim(claimKey) {
    for (const [id, st] of ICON_STATE.entries()) {
      if (st.verified && (st.claim || st.text || "").toLowerCase().trim() === claimKey) {
        return id;
      }
    }
    return null;
  }

  function maybeQueueForVerify(id, visibleBoost = false) {
    if (! SETTINGS.aiVerifyEnabled) return;
    const st = ICON_STATE.get(id);
    if (!st || st.verified || st.queued) return;
    if (verifiedCount >= (SETTINGS.perPageVerifyCap || 20)) return;

    st.queued = true;
    ICON_STATE.set(id, st);
    if (st.isCrisis && SETTINGS.crisisPriority) {
      verifyQueue.unshift(id);
    } else if (visibleBoost) {
      const crisisCount = verifyQueue.filter(qid => ICON_STATE.get(qid)?.isCrisis).length;
      verifyQueue.splice(crisisCount, 0, id);
    } else {
      verifyQueue.push(id);
    }
    runQueue();
  }

  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      while (verifyQueue.length && verifiedCount < (SETTINGS.perPageVerifyCap || 20)) {
        const id = verifyQueue.shift();
        const st = ICON_STATE.get(id);
        if (!st || st.verified) continue;
        const claimKey = (st.claim || st.text || "").toLowerCase().trim();
        if (PROCESSED_CLAIMS.has(claimKey)) {
          const existingId = findVerifiedIdWithClaim(claimKey);
          if (existingId) {
            const existingSt = ICON_STATE.get(existingId);
            st.status = existingSt.status;
            st.reasons = existingSt.reasons;
            st.sources = existingSt.sources;
            st.verified = true;
            st.queued = false;
            ICON_STATE.set(id, st);
            makeDot(id, st.status, st.isCrisis);
            if (VISIBLE_IDS.has(id)) placeDot(id);
            console.log(`[VeriFire] Dedup: copied result for "${st.text.substring(0, 40)}..."`);
          }
          continue;
        }
        PROCESSED_CLAIMS.add(claimKey);
        const statusPrefix = st.isCrisis ? "crisis-" : "";
        st.status = statusPrefix + "pending";
        st.reasons = "Verifying…";
        ICON_STATE.set(id, st);
        makeDot(id, st.status, st.isCrisis);
        if (VISIBLE_IDS.has(id)) placeDot(id);
        console.log(`[VeriFire] Verifying${st.isCrisis ? ' (CRISIS)' : ''}${st.isSuspicious ? ' (SUSPICIOUS)' : ''}: "${st.text.substring(0, 50)}..."`);
        const resp = await sendMessage({
          type: "VERIFY_AI",
          claim: st.claim || st.text,
          originHost: st.originHost || "",
          lang: getLang(),
          isCrisis: st.isCrisis,
          isSuspicious: st.isSuspicious
        }, 45000);

        let verdict = "unclear";
        if (resp?.ok) {
          const v = String(resp.verdict || "").toUpperCase();
          if (v === "CONFIRMED") verdict = "confirmed";
          else if (v === "CONTRADICTED") verdict = "contradicted";
          else verdict = "unclear";
        }

        st.status = st.isCrisis ? `crisis-${verdict}` : verdict;
        st.reasons = resp?.reasons || (resp?.error ?  String(resp.error) : "");
        st.sources = Array.isArray(resp?.sources) ? resp.sources : [];
        st.verifying = false;
        st.queued = false;
        st.verified = true;
        ICON_STATE.set(id, st);
        makeDot(id, st.status, st.isCrisis);
        if (VISIBLE_IDS.has(id)) placeDot(id);
        verifiedCount++;
        console.log(`[VeriFire] Result: ${st.status} - "${st.text.substring(0, 40)}..."`);
      }
    } finally {
      queueRunning = false;
    }
  }

  // =============== INTERSECTION OBSERVER ===============
  let headlineObserver = null;
  function ensureObserver() {
    if (headlineObserver) return;
    if (! ("IntersectionObserver" in window)) {
      headlineObserver = { observe: () => {}, unobserve: () => {} };
      return;
    }
    headlineObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = e.target.getAttribute(WRAP_ATTR);
        if (! id) continue;
        if (e.isIntersecting) {
          VISIBLE_IDS.add(id);
          if (ICON_ELEMS.has(id)) placeDot(id);
          maybeQueueForVerify(id, true);
        } else {
          VISIBLE_IDS.delete(id);
          const dot = ICON_ELEMS.get(id);
          if (dot) dot.style.display = "none";
        }
      }
    }, { root: null, threshold: 0.01 });
  }

  function observeTarget(el) {
    ensureObserver();
    try { headlineObserver.observe(el); } catch {}
  }

  // =============== EXTRACTION ===============
  function mark(el, map) {
    if (! el.hasAttribute(WRAP_ATTR)) {
      const id = nextId();
      try { el.setAttribute(WRAP_ATTR, id); } catch {}
      map.set(id, el);
      return id;
    }
    const id = el.getAttribute(WRAP_ATTR);
    map.set(id, el);
    return id;
  }

  function processElement(el, link, map, seen, seenElements, items, kind) {
    if (!isVisible(el)) return;
    if (seenElements.has(el)) return;
    let text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) return;
    const wordCount = text.split(/\s+/).length;
    if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) return;
    if (shouldSkipText(text)) return;
    const textKey = text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, MAX_DEDUP_KEY_LENGTH);
    if (seen.has(textKey)) return;
    seen.add(textKey);
    seenElements.add(el);
    const parentLink = el.closest('a[href]');
    if (parentLink) seenElements.add(parentLink);
    el.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').forEach(h => seenElements.add(h));
    el.querySelectorAll('a[href]').forEach(a => seenElements.add(a));
    const href = link ? (link.getAttribute('href') || link.href || '') : '';
    const originHost = href ? hostnameOf(href) : location.hostname;
    const id = mark(el, map);
    const crisisInfo = detectCrisis(text);
    const suspiciousInfo = detectSuspicious(text);
    items.push({
      id,
      text: text.slice(0, 250),
      kind,
      originHost,
      href,
      isCrisis: crisisInfo.isCrisis,
      crisisScore: crisisInfo.score || 0,
      crisisCategory: crisisInfo.category || null,
      isSuspicious: suspiciousInfo.isSuspicious,
      suspiciousSignals: suspiciousInfo.signals || []
    });
  }

  function extractAllHeadlines() {
    const map = new Map();
    const seen = new Set();
    const seenElements = new Set();
    const items = [];

    document.querySelectorAll('[data-verifire-headline]').forEach(el => {
      const parentLink = el.closest('a[href]');
      const childLink = el.querySelector('a[href]');
      processElement(el, parentLink || childLink, map, seen, seenElements, items, 'marked');
    });

    if (items.length > 0) {
      console.log(`[VeriFire] Extracted ${items.length} marked headlines`);
      return { items, map };
    }

    document.querySelectorAll('a[href] h1, a[href] h2, a[href] h3, a[href] h4, a[href] h5, a[href] h6, a[href] [role="heading"]').forEach(h => {
      processElement(h, h.closest('a[href]'), map, seen, seenElements, items, 'link-heading');
    });

    document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').forEach(h => {
      if (seenElements.has(h)) return;
      const parentLink = h.closest('a[href]');
      const childLink = h.querySelector('a[href]');
      processElement(h, parentLink || childLink, map, seen, seenElements, items, 'heading');
    });

    document.querySelectorAll('a[href]').forEach(a => {
      if (seenElements.has(a)) return;
      if (a.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')) return;
      processElement(a, a, map, seen, seenElements, items, 'link');
    });

    document.querySelectorAll('[class*="headline"], [class*="title"]').forEach(el => {
      if (seenElements.has(el)) return;
      if (el.tagName === 'A' || /^H[1-6]$/.test(el.tagName)) return;
      if (el.closest('a.headline-link')) return;
      const parentLink = el.closest('a[href]');
      processElement(el, parentLink, map, seen, seenElements, items, 'class');
    });

    console.log(`[VeriFire] Extracted ${items.length} unique headlines`);
    return { items, map };
  }

  function extractGoogleSERP(map) {
    const scope = document.getElementById("search") || document.body;
    const nodes = new Set();
    scope.querySelectorAll("a[href] h3, a[href] div[role='heading']").forEach(n => nodes.add(n));
    const out = [];
    const lang = getLang();
    for (const h of nodes) {
      const a = h.closest("a[href]");
      if (!a) continue;
      if (!isVisible(h) || !isVisible(a)) continue;
      const href = a.getAttribute("href") || a.href;
      if (!isArticleLikeHref(href)) continue;
      let text = (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || isBannedScaffold(text)) continue;
      if (wc(text) < MIN_WORDS || wc(text) > MAX_WORDS) continue;
      const dedupKey = normalizeForDedup(text);
      if (PROCESSED_TEXTS.has(dedupKey)) continue;
      const id = mark(h, map);
      const originHost = hostnameOf(href);
      const crisisInfo = detectCrisis(text);
      const suspiciousInfo = detectSuspicious(text);
      const isNews = !isNonNewsContent(text) && (ACTION_RE.test(text) || SPEECH_RE.test(text) || crisisInfo.isCrisis || suspiciousInfo.isSuspicious);
      out.push({ id, text: text.slice(0, 220), kind: "serp", originHost, langHint: lang, isCrisis: crisisInfo.isCrisis, crisisScore: crisisInfo.score, crisisCategory: crisisInfo.category, isSuspicious: suspiciousInfo.isSuspicious, suspiciousSignals: suspiciousInfo.signals });
    }
    return out.slice(0, MAX_ITEMS);
  }

  function extractGoogleNews(map) {
    const scope = document.querySelector("main") || document.body;
    const nodes = new Set();
    scope.querySelectorAll("article a[href] h3, a[href] h3[role='heading'], a[href] div[role='heading'][aria-level='2'], a[href] div[role='heading'][aria-level='3']").forEach(n => nodes.add(n));
    const out = [];
    const lang = getLang();
    for (const h of nodes) {
      const a = h.closest("a[href]");
      if (!a) continue;
      if (!isVisible(h) || !isVisible(a)) continue;
      const href = a.getAttribute("href") || a.href;
      if (!isArticleLikeHref(href)) continue;
      let text = (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || isBannedScaffold(text)) continue;
      if (wc(text) < MIN_WORDS || wc(text) > MAX_WORDS) continue;
      const dedupKey = normalizeForDedup(text);
      if (PROCESSED_TEXTS.has(dedupKey)) continue;
      const id = mark(h, map);
      const originHost = hostnameOf(href);
      const crisisInfo = detectCrisis(text);
      const suspiciousInfo = detectSuspicious(text);
      const isNews = !isNonNewsContent(text) && (ACTION_RE.test(text) || SPEECH_RE.test(text) || crisisInfo.isCrisis || suspiciousInfo.isSuspicious);
      out.push({ id, text: text.slice(0, 220), kind: "news_serp", originHost, langHint: lang, isCrisis: crisisInfo.isCrisis, crisisScore: crisisInfo.score, crisisCategory: crisisInfo.category, isSuspicious: suspiciousInfo.isSuspicious, suspiciousSignals: suspiciousInfo.signals });
    }
    return out.slice(0, MAX_ITEMS);
  }

  function extractArticleMain(map) {
    const lang = getLang();
    let h = document.querySelector("main article h1, article h1, main h1") || document.querySelector("h1");
    if (h && isVisible(h)) {
      let text = (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim();
      if (text && !isBannedScaffold(text)) {
        if (wc(text) >= MIN_WORDS && wc(text) <= MAX_WORDS) {
          const dedupKey = normalizeForDedup(text);
          if (!PROCESSED_TEXTS.has(dedupKey)) {
            const id = mark(h, map);
            const crisisInfo = detectCrisis(text);
            const suspiciousInfo = detectSuspicious(text);
            const isNews = !isNonNewsContent(text) && (ACTION_RE.test(text) || SPEECH_RE.test(text) || crisisInfo.isCrisis || suspiciousInfo.isSuspicious);
            return [{ id, text: text.slice(0, 220), kind: "article_main", originHost: location.hostname.toLowerCase(), langHint: lang, isCrisis: crisisInfo.isCrisis, crisisScore: crisisInfo.score, crisisCategory: crisisInfo.category, isSuspicious: suspiciousInfo.isSuspicious, suspiciousSignals: suspiciousInfo.signals }];
          }
        }
      }
    }
    const og = document.querySelector("meta[property='og:title']")?.getAttribute("content") || "";
    if (og) {
      const t = og.replace(/\s+/g, " ").trim();
      if (t && !isBannedScaffold(t) && wc(t) <= MAX_WORDS) {
        const dedupKey = normalizeForDedup(t);
        if (!PROCESSED_TEXTS.has(dedupKey)) {
          const crisisInfo = detectCrisis(t);
          const suspiciousInfo = detectSuspicious(t);
          const isNews = !isNonNewsContent(t) && (ACTION_RE.test(t) || SPEECH_RE.test(t) || crisisInfo.isCrisis || suspiciousInfo.isSuspicious);
          return [{ id: nextId(), text: t.slice(0, 220), kind: "article_main", originHost: location.hostname.toLowerCase(), langHint: lang, isCrisis: crisisInfo.isCrisis, crisisScore: crisisInfo.score, crisisCategory: crisisInfo.category, isSuspicious: suspiciousInfo.isSuspicious, suspiciousSignals: suspiciousInfo.signals }];
        }
      }
    }
    return [];
  }

  function extractArticleRelated(map) {
    const scope = document.querySelector("main") || document.body;
    const selectors = [
      "article a h2", "article a h3", "section[class*='related'] a h2, section[class*='related'] a h3",
      "div[class*='related'] a h2, div[class*='related'] a h3", "aside a h2, aside a h3", "a h4",
      "a.headline-link h3", "a.headline-link[data-type]"
    ];
    const nodes = new Set();
    selectors.forEach(sel => { try { scope.querySelectorAll(sel).forEach(n => nodes.add(n)); } catch {} });
    const out = [];
    const lang = getLang();
    for (const h of nodes) {
      const a = h.closest?.("a[href]") || (h.tagName === 'A' ? h : null);
      if (!a) continue;
      if (!isVisible(h) || !isVisible(a)) continue;
      const href = a.getAttribute("href") || a.href;
      if (!isArticleLikeHref(href)) continue;
      let text = (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || isBannedScaffold(text)) continue;
      if (wc(text) < MIN_WORDS || wc(text) > MAX_WORDS) continue;
      const dedupKey = normalizeForDedup(text);
      if (PROCESSED_TEXTS.has(dedupKey)) continue;
      const id = mark(h, map);
      const originHost = hostnameOf(href);
      const crisisInfo = detectCrisis(text);
      const suspiciousInfo = detectSuspicious(text);
      const isNews = !isNonNewsContent(text) && (ACTION_RE.test(text) || SPEECH_RE.test(text) || crisisInfo.isCrisis || suspiciousInfo.isSuspicious);
      out.push({ id, text: text.slice(0, 220), kind: "article_related", originHost, langHint: lang, isCrisis: crisisInfo.isCrisis, crisisScore: crisisInfo.score, crisisCategory: crisisInfo.category, isSuspicious: suspiciousInfo.isSuspicious, suspiciousSignals: suspiciousInfo.signals });
      if (out.length >= 40) break;
    }
    return out;
  }

  function extractHeadlines() {
    const isNewsSite = /^news\.google\./.test(location.hostname);
    const isGoogle = /(^|\.)google\./.test(location.hostname);
    const isSearch = isGoogle && !isNewsSite && location.pathname === "/search";
    if (isNewsSite) {
      const map = new Map();
      let items = extractGoogleNews(map);
      items.sort((a, b) => {
        if (a.isCrisis !== b.isCrisis) return a.isCrisis ? -1 : 1;
        return (b.crisisScore || 0) - (a.crisisScore || 0);
      });
      return { items: items.slice(0, MAX_ITEMS), map };
    } else if (isSearch) {
      const map = new Map();
      let items = extractGoogleSERP(map);
      items.sort((a, b) => {
        if (a.isCrisis !== b.isCrisis) return a.isCrisis ? -1 : 1;
        return (b.crisisScore || 0) - (a.crisisScore || 0);
      });
      return { items: items.slice(0, MAX_ITEMS), map };
    } else {
      const { items, map } = extractAllHeadlines();
      items.sort((a, b) => {
        if (a.isCrisis !== b.isCrisis) return a.isCrisis ? -1 : 1;
        if (a.isSuspicious !== b.isSuspicious) return a.isSuspicious ? -1 : 1;
        return (b.crisisScore || 0) - (a.crisisScore || 0);
      });
      return { items: items.slice(0, MAX_ITEMS), map };
    }
  }

  // =============== PROCESS HEADLINES ===============
  async function processHeadlines(items, map) {
    let crisisCount = 0;
    let suspiciousCount = 0;
    let newsCount = 0;
    let skippedCount = 0;
    let alreadyVerifiedCount = 0;
    
    for (const it of items) {
      const el = map.get(it.id);
      if (!el || ! document.contains(el)) continue;
      if (ICON_STATE.has(it.id)) {
        const existing = ICON_STATE.get(it.id);
        if (existing.verified) {
          alreadyVerifiedCount++;
          console.log(`[VeriFire] Skipping already verified: "${it.text.slice(0, 40)}..."`);
          continue;
        }
      }
      if (!it.isCrisis && !it.isSuspicious && !couldBeNews(it.text)) {
        skippedCount++;
        console.log(`[VeriFire] Skipped (obvious non-news): "${it.text.substring(0, 40)}..."`);
        continue;
      }
      PROCESSED_TEXTS.add(normalizeForDedup(it.text));
      TARGET_MAP.set(it.id, el);
      observeTarget(el);
      const statusPrefix = it.isCrisis ? "crisis-" : "";
      ICON_STATE.set(it.id, {
        status: statusPrefix + "pending",
        reasons: "Queued for verification…",
        sources: [],
        verifying: false,
        queued: false,
        verified: false,
        text: it.text,
        claim: it.text,
        originHost: it.originHost || "",
        isCrisis: it.isCrisis,
        crisisCategory: it.crisisCategory,
        isSuspicious: it.isSuspicious,
        suspiciousSignals: it.suspiciousSignals
      });
      if (it.isCrisis) {
        crisisCount++;
        console.log(`[VeriFire] 🚨 CRISIS detected: "${it.text.substring(0, 50)}..." [${it.crisisCategory}]`);
      } else if (it.isSuspicious) {
        suspiciousCount++;
        console.log(`[VeriFire] ⚠️ SUSPICIOUS detected: "${it.text.substring(0, 50)}..." [${it.suspiciousSignals?.join(', ')}]`);
      } else {
        newsCount++;
        console.log(`[VeriFire] 📰 News detected: "${it.text.substring(0, 50)}..."`);
      }
    }
    
    console.log(`[VeriFire] Summary: ${crisisCount} crisis, ${suspiciousCount} suspicious, ${newsCount} news, ${skippedCount} skipped, ${alreadyVerifiedCount} already verified`);
    
    const visibleFirst = items
      .filter(it => VISIBLE_IDS.has(it.id) || it.isCrisis)
      .concat(items.filter(it => !VISIBLE_IDS.has(it.id) && !it.isCrisis));
    
    for (const it of visibleFirst) {
      if (verifiedCount >= (SETTINGS.perPageVerifyCap || 20)) break;
      if (!it.isCrisis && !it.isSuspicious && !couldBeNews(it.text)) continue;
      maybeQueueForVerify(it.id, VISIBLE_IDS.has(it.id));
    }
    
    setTimeout(placeAllDots, 100);
  }

  // =============== MAIN ===============
  async function runOnce() {
    if (isBlockedDomain()) {
      console.log('[VeriFire] Skipping blocked domain:', location.hostname);
      return;
    }
    ensureStyles();
    try {
      const s = await sendMessage({ type: "GET_SETTINGS" }, 4000);
      if (s?.ok && s.settings) SETTINGS = { ...SETTINGS, ...s.settings };
    } catch {}
    console.log('[VeriFire] Starting initial scan...');
    const { items, map } = extractHeadlines();
    if (! items.length) {
      console.log('[VeriFire] No headlines found on page');
      return;
    }
    console.log(`[VeriFire] Found ${items.length} headlines`);
    await processHeadlines(items, map);
    if (SETTINGS.continuousScanning) {
      startContinuousScanning();
    }
    window.addEventListener('verifire-new-content', () => {
      console.log('[VeriFire] Custom event received, triggering rescan...');
      setTimeout(scanNewContent, 200);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(runOnce, 200));
  } else {
    setTimeout(runOnce, 200);
  }

  // =============== YOUTUBE TRANSCRIPT FACT-CHECKING ===============
  let currentYouTubeUrl = '';
  let hasExtractedTranscript = false;

  function isYouTubeDomain() {
    const host = location.hostname.toLowerCase();
    return host === 'youtube.com' || host === 'www.youtube.com' || host.endsWith('.youtube.com');
  }

  function isYouTubeVideoPage() {
    return isYouTubeDomain() && location.href.includes('watch?v=');
  }

  if (isYouTubeDomain()) {
    setInterval(() => {
      if (location.href !== currentYouTubeUrl) {
        currentYouTubeUrl = location.href;
        hasExtractedTranscript = false;
      }
      if (isYouTubeVideoPage() && !hasExtractedTranscript) {
        if (document.getElementById('movie_player')) {
          hasExtractedTranscript = true;
          console.log('[VeriFire] Starting YouTube transcript analysis...');
          extractAndVerifyYouTubeTranscript();
        }
      }
    }, 1500);
  }

  async function extractAndVerifyYouTubeTranscript() {
    try {
      await sleep(2000);
      const videoTitle = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string')?.textContent 
        || document.querySelector('#title h1 yt-formatted-string')?.textContent
        || document.querySelector('h1.title')?.textContent
        || 'YouTube Video';

      if (isEntertainmentVideo(videoTitle)) {
        console.log('[VeriFire] Skipping entertainment video:', videoTitle.substring(0, 50));
        return;
      }

      const titleContainer = document.querySelector('#title.ytd-video-primary-info-renderer') 
        || document.querySelector('#above-the-fold #title')
        || document.querySelector('h1.ytd-video-primary-info-renderer');

      let transcript;
      try {
        transcript = await extractYouTubeTranscript();
      } catch (err) {
        if (!shouldProcessContent(videoTitle, 'youtube_title')) {
          console.log('[VeriFire] Video has no transcript and title is not news-related, skipping');
          return;
        }
        if (titleContainer && !document.getElementById('verifire-yt-dot')) {
          createYouTubeDot(titleContainer, videoTitle);
        }
        updateYouTubeDotStatus('unclear', 'No transcript available for this video', []);
        return;
      }
      
      if (!transcript || transcript.length < 100) {
        if (!shouldProcessContent(videoTitle, 'youtube_title')) {
          console.log('[VeriFire] Video transcript too short and title is not news-related, skipping');
          return;
        }
        if (titleContainer && !document.getElementById('verifire-yt-dot')) {
          createYouTubeDot(titleContainer, videoTitle);
        }
        updateYouTubeDotStatus('unclear', 'No transcript available for this video', []);
        return;
      }

      const normalizedText = normalizeTranscript(transcript);
      if (!shouldProcessContent(normalizedText, 'youtube')) {
        console.log('[VeriFire] Video transcript not crisis-related, skipping');
        return;
      }

      if (titleContainer && !document.getElementById('verifire-yt-dot')) {
        createYouTubeDot(titleContainer, videoTitle);
      }
      
      console.log('[VeriFire] Transcript extracted, sending for analysis...');
      const result = await sendMessage({
        type: 'VERIFY_YOUTUBE_TRANSCRIPT',
        transcript: normalizedText,
        videoTitle: videoTitle,
        videoUrl: location.href
      }, 60000);

      if (!result?.ok || result?.apiError || result?.noApiKey || 
          result?.error?.includes('API') || result?.reasons?.includes('service error') ||
          result?.reasons?.includes('API not available')) {
        console.log('[VeriFire] YouTube analysis unavailable, not showing dot');
        const existingDot = document.getElementById('verifire-yt-dot');
        if (existingDot) existingDot.remove();
        return;
      }

      if (result?.ok) {
        const verdict = String(result.verdict || 'unclear').toLowerCase();
        updateYouTubeDotStatus(verdict, result.reasons || '', result.sources || []);
      } else {
        console.log('[VeriFire] YouTube analysis failed, not showing dot');
        const existingDot = document.getElementById('verifire-yt-dot');
        if (existingDot) existingDot.remove();
      }
    } catch (err) {
      console.error('[VeriFire] YouTube analysis failed:', err);
    }
  }

  async function extractYouTubeTranscript() {
    if (!document.querySelector('ytd-transcript-segment-renderer')) {
      const expandButton = document.querySelector('#expand');
      if (expandButton && !expandButton.hidden) {
        expandButton.click();
        await sleep(800);
      }
      let transcriptBtn = null;
      for (let i = 0; i < 15; i++) {
        const section = document.querySelector('ytd-video-description-transcript-section-renderer');
        if (section) {
          transcriptBtn = section.querySelector('button');
          if (transcriptBtn) break;
        }
        const ariaBtn = document.querySelector('button[aria-label="Show transcript"]');
        if (ariaBtn) { transcriptBtn = ariaBtn; break; }
        await sleep(300);
      }
      if (!transcriptBtn) {
        throw new Error('No transcript available');
      }
      transcriptBtn.click();
      for (let i = 0; i < 30; i++) {
        if (document.querySelector('ytd-transcript-segment-renderer')) break;
        await sleep(300);
      }
    }

    const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (!segments || segments.length === 0) {
      throw new Error('No transcript segments found');
    }

    let fullText = '';
    segments.forEach(segment => {
      const text = segment.querySelector('.segment-text')?.innerText?.trim() || '';
      if (text) fullText += text + ' ';
    });

    const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
    if (panel) {
      const closeBtn = panel.querySelector('#visibility-button button') || panel.querySelector('button[aria-label="Close"]');
      if (closeBtn) closeBtn.click();
    }

    return fullText.trim();
  }

  function normalizeTranscript(text) {
    return text
      .replace(/\[\d+:\d+\]/g, '')
      .replace(/\b(um|uh|like|you know|basically|actually|literally)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 5000);
  }

  function createYouTubeDot(container, videoTitle) {
    const dot = document.createElement('span');
    dot.id = 'verifire-yt-dot';
    dot.className = 'lk-ic lk-ic-yellow';
    dot.style.cssText = 'display: inline-block; margin-left: 12px; cursor: pointer; vertical-align: middle;';
    dot.title = 'VeriFire: Analyzing transcript...';
    dot.dataset.videoTitle = videoTitle;
    dot.dataset.status = 'pending';
    dot.dataset.reasons = 'Analyzing video transcript...';
    dot.dataset.sources = '[]';
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      showYouTubePopover(dot);
    });
    container.appendChild(dot);
  }

  function updateYouTubeDotStatus(verdict, reasons, sources) {
    const dot = document.getElementById('verifire-yt-dot');
    if (!dot) return;
    let color = 'gray';
    let label = 'Uncertain';
    if (verdict.includes('confirmed')) {
      color = 'green';
      label = 'Content Verified';
    } else if (verdict.includes('contradicted')) {
      color = 'red';
      label = 'Contains Misinformation';
    }
    dot.className = `lk-ic lk-ic-${color}`;
    dot.title = `VeriFire: ${label}`;
    dot.dataset.status = verdict;
    dot.dataset.reasons = reasons;
    dot.dataset.sources = JSON.stringify(sources);
  }

  function showYouTubePopover(dot) {
    const pop = createPopover();
    const status = dot.dataset.status || 'unclear';
    const sources = JSON.parse(dot.dataset.sources || '[]');
    let statusLabel = 'Uncertain';
    if (status.includes('confirmed')) statusLabel = 'Content Verified';
    else if (status.includes('contradicted')) statusLabel = 'Contains Misinformation';
    pop.innerHTML = `
      <div class="lk-pop-title">${escapeHtml(dot.dataset.videoTitle || 'Video')}</div>
      <div class="lk-pop-row"><b>Transcript Analysis:</b> ${escapeHtml(statusLabel)}</div>
      ${dot.dataset.reasons ? `<div class="lk-pop-reasons">${escapeHtml(dot.dataset.reasons)}</div>` : ''}
      ${sources.length ? `<div class="lk-pop-sources">${sourcesHtml(sources)}</div>` : ''}
      <div class="lk-pop-hint">Video transcript analyzed by VeriFire.</div>
    `;
    positionPopover(dot);
  }

  function sleep(ms) { 
    return new Promise(r => setTimeout(r, ms)); 
  }
})();
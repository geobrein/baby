/** Minimale robots.txt-parser (User-agent, Allow, Disallow, Crawl-delay). */

export function parseRobots(text = '') {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (!current) continue;
    lastWasAgent = false;
    if (field === 'allow' || field === 'disallow') {
      if (value === '' && field === 'disallow') continue; // "Disallow:" = alles toegestaan
      current.rules.push({ allow: field === 'allow', path: value });
    } else if (field === 'crawl-delay') {
      const n = Number.parseFloat(value.replace(',', '.'));
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }
  return groups;
}

function pickGroup(groups, userAgent) {
  const ua = userAgent.toLowerCase();
  let specific = null;
  let wildcard = null;
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === '*') wildcard = mergeGroup(wildcard, group);
      else if (ua.includes(agent)) specific = mergeGroup(specific, group);
    }
  }
  return specific ?? wildcard ?? null;
}

function mergeGroup(a, b) {
  if (!a) return { agents: b.agents, rules: [...b.rules], crawlDelay: b.crawlDelay };
  return { agents: a.agents, rules: [...a.rules, ...b.rules], crawlDelay: a.crawlDelay ?? b.crawlDelay };
}

function ruleMatches(pattern, path) {
  const anchoredEnd = pattern.endsWith('$');
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .split('*')
    .join('[^]*');
  const re = new RegExp(`^${escaped}${anchoredEnd ? '$' : ''}`);
  return re.test(path);
}

/** Mag `path` opgehaald worden volgens deze robots.txt? */
export function isAllowed(robotsText, path, userAgent) {
  const group = pickGroup(parseRobots(robotsText), userAgent);
  if (!group) return true;
  let best = null;
  for (const rule of group.rules) {
    if (!ruleMatches(rule.path, path)) continue;
    const length = rule.path.replace(/\$$/, '').length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

export function crawlDelay(robotsText, userAgent) {
  const group = pickGroup(parseRobots(robotsText), userAgent);
  return group?.crawlDelay ?? null;
}

const fs = require('fs');
const https = require('https');

const DELAY_MS = 400;
const MIN_MEMBERS = 500;
const MAX_PAGE = 40;
const TYPES = ['tv', 'movie', 'ova', 'special', 'ona'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'anime-vf-fr/1.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

function getBaseTitle(title) {
  if (!title) return '';
  let t = title.toLowerCase().trim();
  const suffixes = [
    /\s+season\s+\d+.*$/i, /\s+\d+(st|nd|rd|th)\s+season.*$/i,
    /\s+part\s+\d+.*$/i, /\s+cour\s+\d+.*$/i,
    /\s+final\s+season.*$/i, /\s+the\s+final.*$/i,
    /\s+[ivxlcdm]+$/i, /\s+\d+$/, /:\s*.*$/,
    /\s+ova$/i, /\s+ona$/i, /\s+special.*$/i,
  ];
  let prev = '';
  while (prev !== t) { prev = t; for (const s of suffixes) t = t.replace(s, '').trim(); }
  return t;
}

const ALIAS = {
  'attack on titan': 'shingeki no kyojin',
  'fullmetal alchemist brotherhood': 'fullmetal alchemist',
  'my hero academia': 'boku no hero academia',
  'demon slayer': 'kimetsu no yaiba',
  'that time i got reincarnated as a slime': 'tensura',
};

function getCanonicalKey(title) {
  const base = getBaseTitle(title);
  return ALIAS[base] || base;
}

function normEntry(a) {
  return {
    id: a.mal_id,
    title: a.title || '',
    titleEn: a.title_english || '',
    baseKey: getCanonicalKey(a.title || ''),
    image: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || '',
    score: a.score || 0,
    members: a.members || 0,
    episodes: a.episodes || null,
    year: a.year || (a.aired?.from ? new Date(a.aired.from).getFullYear() : null),
    airedFrom: a.aired?.from || null,
    airedTo: a.aired?.to || null,
    genres: (a.genres || []).map(g => g.name),
    themes: [...(a.genres||[]),...(a.themes||[]),...(a.demographics||[])].map(g=>g.name),
    synopsis: a.synopsis || '',
    status: a.status || '',
    type: a.type || '',
    url: a.url || `https://myanimelist.net/anime/${a.mal_id}`,
    seasons: [{
      id: a.mal_id, titleOrig: a.title || '',
      airedFrom: a.aired?.from || null, airedTo: a.aired?.to || null,
      status: a.status || '', episodes: a.episodes || null,
    }],
  };
}

async function main() {
  const allAnime = [];
  const seenMalId = new Set();
  const seenSeries = new Map();

  for (const type of TYPES) {
    console.log(`\n📺 Type: ${type}`);
    let page = 1, hasNext = true;
    while (hasNext) {
      const url = `https://api.jikan.moe/v4/anime?type=${type}&order_by=members&sort=desc&limit=25&page=${page}`;
      console.log(`  Page ${page}...`);
      let data = null;
      for (let r = 0; r < 4; r++) {
        try { data = await fetchJson(url); if (data) break; }
        catch { await sleep(1000 * (r+1)); }
      }
      if (!data || !data.data) { hasNext = false; break; }
      for (const a of data.data) {
        if (seenMalId.has(a.mal_id) || (a.members||0) < MIN_MEMBERS) continue;
        seenMalId.add(a.mal_id);
        const entry = normEntry(a);
        const key = entry.baseKey;
        if (!seenSeries.has(key)) {
          seenSeries.set(key, entry); allAnime.push(entry);
        } else {
          const ex = seenSeries.get(key);
          if (!ex.seasons.find(s => s.id === entry.id)) ex.seasons.push(entry.seasons[0]);
          const ey = entry.year || 0;
          const ely = ex.seasons.reduce((m,s) => Math.max(m, s.airedFrom?new Date(s.airedFrom).getFullYear():0), 0);
          if (ey >= ely) { ex.image=entry.image||ex.image; ex.score=entry.score||ex.score; ex.status=entry.status; ex.year=entry.year||ex.year; }
          if (entry.members > ex.members) ex.members = entry.members;
        }
      }
      const lastMembers = data.data[data.data.length-1]?.members || 0;
      hasNext = data.pagination?.has_next_page===true && lastMembers>=MIN_MEMBERS && page<MAX_PAGE;
      page++;
      await sleep(DELAY_MS);
    }
  }

  allAnime.sort((a,b) => b.members - a.members);
  const now = new Date().toISOString();
  fs.writeFileSync('data.json', JSON.stringify({ generatedAt: now, count: allAnime.length, anime: allAnime }));
  // Fichier partagé de cooldown — lu par tous les visiteurs du site
  fs.writeFileSync('last_update.json', JSON.stringify({ ts: now, count: allAnime.length }));
  console.log(`\n✅ ${allAnime.length} séries — data.json + last_update.json générés`);
}

main().catch(err => { console.error(err); process.exit(1); });

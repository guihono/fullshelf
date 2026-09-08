import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

// Load server/.env regardless of what directory the process was started from.
dotenv.config({ path: new URL('.env', import.meta.url) });

const RAWG_KEY = process.env.RAWG_API_KEY;
const COMICVINE_KEY = process.env.COMICVINE_API_KEY;
const TMDB_KEY = process.env.TMDB_API_KEY;
const PORT = process.env.PORT || 3001;

const TMDB_GENRES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export const app = express();
app.use(cors());

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    keys: { rawg: !!RAWG_KEY, comicvine: !!COMICVINE_KEY, tmdb: !!TMDB_KEY },
  });
});

app.get('/api/games', async (req, res) => {
  if (!RAWG_KEY) return res.status(501).json({ error: 'no-key' });
  const q = String(req.query.q || '');
  try {
    const searchRes = await fetch(`https://api.rawg.io/api/games?key=${RAWG_KEY}&search=${encodeURIComponent(q)}&page_size=5`);
    if (!searchRes.ok) return res.status(502).json({ error: 'upstream-failed' });
    const searchData = await searchRes.json();
    const basics = (searchData.results || []).slice(0, 5);

    // The search endpoint doesn't include a description, so fetch each
    // game's detail page in parallel to get one.
    const details = await Promise.all(basics.map(async (g) => {
      try {
        const dRes = await fetch(`https://api.rawg.io/api/games/${g.id}?key=${RAWG_KEY}`);
        if (!dRes.ok) return null;
        return await dRes.json();
      } catch {
        return null;
      }
    }));

    const results = basics.map((g, i) => {
      const d = details[i];
      return {
        title: g.name,
        year: g.released ? Number(String(g.released).slice(0, 4)) : null,
        synopsis: stripHtml(d && d.description_raw ? d.description_raw : '').slice(0, 400),
        genres: (g.genres || []).map(x => x.name),
        totalUnits: null,
        coverImageUrl: g.background_image || null,
      };
    });
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: 'upstream-failed' });
  }
});

app.get('/api/comics', async (req, res) => {
  if (!COMICVINE_KEY) return res.status(501).json({ error: 'no-key' });
  const q = String(req.query.q || '');
  try {
    const url = `https://comicvine.gamespot.com/api/search/?api_key=${COMICVINE_KEY}&format=json&query=${encodeURIComponent(q)}&resources=volume&limit=5`;
    const cvRes = await fetch(url, {
      headers: { 'User-Agent': 'TheReadingRoom/1.0 (personal media tracker, non-commercial)' },
    });
    if (!cvRes.ok) return res.status(502).json({ error: 'upstream-failed' });
    const data = await cvRes.json();
    const results = (data.results || []).slice(0, 5).map(v => ({
      title: v.name,
      year: v.start_year ? Number(v.start_year) : null,
      synopsis: stripHtml(v.deck || v.description || '').slice(0, 400),
      genres: [],
      totalUnits: v.count_of_issues || null,
      coverImageUrl: (v.image && (v.image.medium_url || v.image.original_url)) || null,
    }));
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: 'upstream-failed' });
  }
});

app.get('/api/movies', async (req, res) => {
  if (!TMDB_KEY) return res.status(501).json({ error: 'no-key' });
  const q = String(req.query.q || '');
  try {
    const tRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}`);
    if (!tRes.ok) return res.status(502).json({ error: 'upstream-failed' });
    const data = await tRes.json();
    const results = (data.results || []).slice(0, 5).map(m => ({
      title: m.title,
      year: m.release_date ? Number(String(m.release_date).slice(0, 4)) : null,
      synopsis: (m.overview || '').slice(0, 400),
      genres: (m.genre_ids || []).map(id => TMDB_GENRES[id]).filter(Boolean),
      totalUnits: null,
      coverImageUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    }));
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: 'upstream-failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Games (RAWG): ${RAWG_KEY ? 'key configured' : 'no key — /api/games will return 501'}`);
  console.log(`Comics (Comic Vine): ${COMICVINE_KEY ? 'key configured' : 'no key — /api/comics will return 501'}`);
  console.log(`Movies (TMDB): ${TMDB_KEY ? 'key configured' : 'no key — /api/movies will return 501'}`);
});

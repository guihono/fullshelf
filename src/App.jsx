import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Film, Tv, Book, BookOpen, Plus, X, Trash2, Pencil,
  LayoutGrid, Clock, BarChart3, Repeat, Search, ChevronLeft, Gamepad2, Clapperboard
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';

const CATEGORIES = [
  { id: 'anime', label: 'Anime', unit: 'Episode', unitPlural: 'Episodes', icon: Film, color: '#E8963E' },
  { id: 'manga', label: 'Manga', unit: 'Chapter', unitPlural: 'Chapters', icon: Book, color: '#7FA65C' },
  { id: 'comic', label: 'Comics', unit: 'Issue', unitPlural: 'Issues', icon: BookOpen, color: '#D6614C' },
  { id: 'tv', label: 'TV Shows', unit: 'Episode', unitPlural: 'Episodes', icon: Tv, color: '#5C8FD6' },
  { id: 'game', label: 'Video Games', unit: 'Session', unitPlural: 'Sessions', icon: Gamepad2, color: '#9B6BD6' },
  { id: 'movie', label: 'Movies', unit: 'Watch', unitPlural: 'Watches', icon: Clapperboard, color: '#4CB8A6' },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const PROXIED_CATEGORY_LABEL = { movie: 'movies', game: 'video games', comic: 'comics' };

const STATUSES = [
  { id: 'plan', label: 'Plan to watch/read', color: '#8B8F94' },
  { id: 'active', label: 'Watching / Reading', color: '#E8963E' },
  { id: 'hold', label: 'On hold', color: '#D6B85C' },
  { id: 'dropped', label: 'Dropped', color: '#D6614C' },
  { id: 'completed', label: 'Completed', color: '#7FA65C' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s.label]));
const STATUS_COLOR = Object.fromEntries(STATUSES.map(s => [s.id, s.color]));

function progressLabel(entry, c, logCount) {
  const total = entry.totalUnits;
  const plural = c.unitPlural.toLowerCase();
  if (entry.status === 'plan') return `Not started${total ? ` · ${total} ${plural}` : ''}`;
  if (entry.status === 'completed') {
    const count = total || logCount;
    return `Completed${count ? ` · ${count} ${plural}` : ''}`;
  }
  if (logCount === 0) return `${c.unit} 0${total ? ` / ${total}` : ''}`;
  const prefix = entry.status === 'dropped' ? 'Dropped at' : entry.status === 'hold' ? 'Paused at' : 'On';
  return `${prefix} ${c.unit} ${logCount}${total ? ` / ${total}` : ''}`;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const monthKey = (d) => d.slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

const STORAGE_KEY = 'mediaJournalEntries';

const emptyForm = () => ({
  id: null, title: '', category: 'anime', status: 'plan',
  totalUnits: '', genres: '', notes: '', rewatchCount: 0, rating: null,
  synopsis: '', coverImageUrl: '', year: '',
});

function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchAniList(category, term) {
  const gql = `query ($search: String, $type: MediaType) {
    Page(page: 1, perPage: 5) {
      media(search: $search, type: $type, sort: SEARCH_MATCH) {
        title { romaji english }
        startDate { year }
        description(asHtml: false)
        genres
        episodes
        chapters
        coverImage { large }
      }
    }
  }`;
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: gql,
      variables: { search: term, type: category === 'anime' ? 'ANIME' : 'MANGA' },
    }),
  });
  if (!response.ok) throw new Error('search-request-failed');
  const data = await response.json();
  const list = (data.data && data.data.Page && data.data.Page.media) || [];
  return list.map(m => ({
    title: (m.title && (m.title.english || m.title.romaji)) || 'Untitled',
    year: (m.startDate && m.startDate.year) || null,
    synopsis: stripHtml(m.description).slice(0, 400),
    genres: m.genres || [],
    totalUnits: category === 'anime' ? (m.episodes || null) : (m.chapters || null),
    coverImageUrl: (m.coverImage && m.coverImage.large) || null,
  }));
}

async function searchTVMaze(term) {
  const response = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('search-request-failed');
  const data = await response.json();
  return data.slice(0, 5).map(({ show }) => ({
    title: show.name,
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    synopsis: stripHtml(show.summary).slice(0, 400),
    genres: show.genres || [],
    totalUnits: null,
    coverImageUrl: (show.image && (show.image.original || show.image.medium)) || null,
  }));
}

// Games, comics, and movies go through the local proxy server (server/index.js)
// since their upstream APIs (RAWG, Comic Vine, TMDB) don't allow direct
// browser requests. Anime/manga/TV don't need this — AniList and TVmaze
// are called directly above.
async function fetchViaProxy(path, term) {
  let response;
  try {
    response = await fetch(`/api/${path}?q=${encodeURIComponent(term)}`);
  } catch (e) {
    const err = new Error('no-server');
    err.code = 'no-server';
    throw err;
  }
  if (response.status === 501) {
    const err = new Error('missing-key');
    err.code = 'missing-key';
    throw err;
  }
  if (!response.ok) throw new Error('search-request-failed');
  const data = await response.json();
  return data.results || [];
}

async function searchMedia(category, term) {
  if (category === 'anime' || category === 'manga') return searchAniList(category, term);
  if (category === 'tv') return searchTVMaze(term);
  if (category === 'movie') return fetchViaProxy('movies', term);
  if (category === 'game') return fetchViaProxy('games', term);
  if (category === 'comic') return fetchViaProxy('comics', term);
  const err = new Error('not-supported');
  err.code = 'not-supported';
  throw err;
}


export default function App() {
  const [entries, setEntries] = useState(null);
  const [view, setView] = useState('grid');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState(emptyForm());
  const [detailId, setDetailId] = useState(null);
  const [logDraft, setLogDraft] = useState({ number: '', date: today(), note: '' });
  const [error, setError] = useState('');
  const loadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        setEntries(res && res.value ? JSON.parse(res.value) : []);
      } catch (e) {
        setEntries([]);
      }
      loadedRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loadedRef.current || entries === null) return;
    (async () => {
      try {
        await window.storage.set(STORAGE_KEY, JSON.stringify(entries), false);
      } catch (e) {
        setError('Could not save — your changes may not persist.');
      }
    })();
  }, [entries]);

  const detailEntry = useMemo(
    () => (entries || []).find(e => e.id === detailId) || null,
    [entries, detailId]
  );

  const catFilteredEntries = useMemo(() => {
    if (!entries) return [];
    return entries.filter(e => catFilter === 'all' || e.category === catFilter);
  }, [entries, catFilter]);

  const filtered = useMemo(() => {
    return catFilteredEntries
      .filter(e => statusFilter === 'all' || e.status === statusFilter)
      .filter(e => !query.trim() || e.title.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [catFilteredEntries, statusFilter, query]);

  function openCreate() {
    setFormData(emptyForm());
    setFormOpen(true);
  }
  function openEdit(entry) {
    setFormData({
      id: entry.id, title: entry.title, category: entry.category, status: entry.status,
      totalUnits: entry.totalUnits || '', genres: (entry.genres || []).join(', '),
      notes: entry.notes || '', rewatchCount: entry.rewatchCount || 0, rating: entry.rating,
      synopsis: entry.synopsis || '', coverImageUrl: entry.coverImageUrl || '', year: entry.year || '',
    });
    setFormOpen(true);
  }

  function saveForm(ev) {
    ev.preventDefault();
    if (!formData.title.trim()) return;
    const genres = formData.genres.split(',').map(g => g.trim()).filter(Boolean);
    const now = today();
    setEntries(prev => {
      const list = prev || [];
      if (formData.id) {
        return list.map(e => e.id === formData.id ? {
          ...e,
          title: formData.title.trim(), category: formData.category, status: formData.status,
          totalUnits: formData.totalUnits ? Number(formData.totalUnits) : null,
          year: formData.year ? Number(formData.year) : null,
          synopsis: formData.synopsis.trim(), coverImageUrl: formData.coverImageUrl.trim(),
          genres, notes: formData.notes, rewatchCount: Number(formData.rewatchCount) || 0,
          rating: formData.rating,
          completedDate: formData.status === 'completed' ? (e.completedDate || now) : e.completedDate,
          updatedAt: now,
        } : e);
      }
      const newEntry = {
        id: uid(), title: formData.title.trim(), category: formData.category, status: formData.status,
        totalUnits: formData.totalUnits ? Number(formData.totalUnits) : null,
        year: formData.year ? Number(formData.year) : null,
        synopsis: formData.synopsis.trim(), coverImageUrl: formData.coverImageUrl.trim(),
        genres, notes: formData.notes, rewatchCount: Number(formData.rewatchCount) || 0,
        rating: formData.rating, logs: [], createdAt: now, updatedAt: now,
        completedDate: formData.status === 'completed' ? now : null,
      };
      return [...list, newEntry];
    });
    setFormOpen(false);
  }

  function deleteEntry(id) {
    setEntries(prev => (prev || []).filter(e => e.id !== id));
    setDetailId(null);
  }

  function setRating(id, rating) {
    setEntries(prev => (prev || []).map(e => e.id === id ? { ...e, rating, updatedAt: today() } : e));
  }

  function setStatus(id, status) {
    setEntries(prev => (prev || []).map(e => {
      if (e.id !== id) return e;
      return {
        ...e, status, updatedAt: today(),
        completedDate: status === 'completed' ? (e.completedDate || today()) : e.completedDate,
      };
    }));
  }

  function addLog(id) {
    const num = Number(logDraft.number);
    if (!num || !logDraft.date) return;
    setEntries(prev => (prev || []).map(e => {
      if (e.id !== id) return e;
      const logs = [...(e.logs || []), { id: uid(), number: num, date: logDraft.date, note: logDraft.note.trim() }]
        .sort((a, b) => a.number - b.number);
      return { ...e, logs, updatedAt: today() };
    }));
    const nextNum = num + 1;
    setLogDraft({ number: String(nextNum), date: today(), note: '' });
  }

  function removeLog(id, logId) {
    setEntries(prev => (prev || []).map(e => e.id === id
      ? { ...e, logs: (e.logs || []).filter(l => l.id !== logId) }
      : e));
  }

  function quickLog(entry) {
    const nextNum = (entry.logs && entry.logs.length) ? Math.max(...entry.logs.map(l => l.number)) + 1 : 1;
    setEntries(prev => (prev || []).map(e => e.id === entry.id
      ? { ...e, logs: [...(e.logs || []), { id: uid(), number: nextNum, date: today(), note: '' }], updatedAt: today() }
      : e));
  }

  useEffect(() => {
    if (detailEntry) {
      const nextNum = (detailEntry.logs && detailEntry.logs.length)
        ? Math.max(...detailEntry.logs.map(l => l.number)) + 1 : 1;
      setLogDraft({ number: String(nextNum), date: today(), note: '' });
    }
  }, [detailId]);

  if (entries === null) {
    return (
      <div className="mj-root mj-loading">
        <Style />
        <div className="mj-loading-mark">binding the ledger…</div>
      </div>
    );
  }

  return (
    <div className="mj-root">
      <Style />
      <header className="mj-header">
        <div className="mj-brand">
          <span className="mj-brand-mark">棚</span>
          <div>
            <h1>The Full Shelf</h1>
            <p>a running ledger of everything watched &amp; read</p>
          </div>
        </div>
        <button className="mj-btn mj-btn-primary" onClick={openCreate}>
          <Plus size={16} /> New entry
        </button>
      </header>

      <nav className="mj-tabs">
        <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
          <LayoutGrid size={15} /> Shelf
        </button>
        <button className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}>
          <Clock size={15} /> Timeline
        </button>
        <button className={view === 'stats' ? 'active' : ''} onClick={() => setView('stats')}>
          <BarChart3 size={15} /> Ledger totals
        </button>
      </nav>

      {error && <div className="mj-error">{error}</div>}

      {view === 'grid' && (
        <GridView
          entries={filtered}
          allCount={entries.length}
          catFilter={catFilter} setCatFilter={setCatFilter}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          statusCounts={catFilteredEntries}
          query={query} setQuery={setQuery}
          onOpen={(id) => setDetailId(id)}
          onQuickLog={quickLog}
          onCreate={openCreate}
        />
      )}
      {view === 'timeline' && <TimelineView entries={entries} onOpen={(id) => setDetailId(id)} />}
      {view === 'stats' && <StatsView entries={entries} />}

      {formOpen && (
        <FormModal
          formData={formData} setFormData={setFormData}
          onSave={saveForm} onClose={() => setFormOpen(false)}
        />
      )}

      {detailEntry && (
        <DetailModal
          entry={detailEntry}
          onClose={() => setDetailId(null)}
          onEdit={() => { openEdit(detailEntry); }}
          onDelete={() => deleteEntry(detailEntry.id)}
          onRate={(r) => setRating(detailEntry.id, r)}
          onStatus={(s) => setStatus(detailEntry.id, s)}
          logDraft={logDraft} setLogDraft={setLogDraft}
          onAddLog={() => addLog(detailEntry.id)}
          onRemoveLog={(logId) => removeLog(detailEntry.id, logId)}
        />
      )}
    </div>
  );
}

function CategoryTag({ category, small }) {
  const c = CAT_MAP[category];
  const Icon = c.icon;
  return (
    <span className={'mj-cat-tag' + (small ? ' mj-cat-tag-sm' : '')} style={{ '--cat-color': c.color }}>
      <Icon size={small ? 11 : 13} /> {c.label}
    </span>
  );
}

function StatusPill({ status }) {
  return <span className={'mj-status-pill mj-status-' + status}>{STATUS_MAP[status]}</span>;
}

function GridView({ entries, allCount, catFilter, setCatFilter, statusFilter, setStatusFilter, statusCounts, query, setQuery, onOpen, onQuickLog, onCreate }) {
  return (
    <div>
      <div className="mj-filters">
        <div className="mj-chip-row">
          <button className={catFilter === 'all' ? 'mj-chip active' : 'mj-chip'} onClick={() => setCatFilter('all')}>All</button>
          {CATEGORIES.map(c => {
            const Icon = c.icon;
            return (
              <button key={c.id} className={catFilter === c.id ? 'mj-chip active' : 'mj-chip'}
                style={{ '--chip-color': c.color }} onClick={() => setCatFilter(c.id)}>
                <Icon size={13} /> {c.label}
              </button>
            );
          })}
        </div>
        <div className="mj-chip-row mj-status-tabs">
          <button className={statusFilter === 'all' ? 'mj-chip active' : 'mj-chip'} onClick={() => setStatusFilter('all')}>
            All <span className="mj-chip-count">{statusCounts.length}</span>
          </button>
          {STATUSES.map(s => {
            const count = statusCounts.filter(e => e.status === s.id).length;
            return (
              <button key={s.id} className={statusFilter === s.id ? 'mj-chip active' : 'mj-chip'}
                style={{ '--chip-color': s.color }} onClick={() => setStatusFilter(s.id)}>
                {s.label} <span className="mj-chip-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="mj-filters-row2">
          <div className="mj-search">
            <Search size={14} />
            <input placeholder="Search titles…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="mj-empty">
          {allCount === 0 ? (
            <>
              <p className="mj-empty-title">The shelf is empty.</p>
              <p>Log the first anime, manga, comic, or show you're into.</p>
              <button className="mj-btn mj-btn-primary" onClick={onCreate}><Plus size={16} /> Add your first entry</button>
            </>
          ) : (
            <p>Nothing matches these filters.</p>
          )}
        </div>
      ) : (
        <div className="mj-grid">
          {entries.map(entry => (
            <EntryCard key={entry.id} entry={entry} onOpen={() => onOpen(entry.id)} onQuickLog={() => onQuickLog(entry)} />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({ entry, onOpen, onQuickLog }) {
  const c = CAT_MAP[entry.category];
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!entry.coverImageUrl && !imgFailed;
  const logCount = (entry.logs || []).length;
  const last = logCount ? entry.logs[entry.logs.length - 1] : null;
  const openProps = {
    onClick: onOpen, role: 'button', tabIndex: 0,
    onKeyDown: (e) => { if (e.key === 'Enter') onOpen(); },
  };

  if (hasImage) {
    return (
      <div className="mj-card has-image" style={{ '--cat-color': c.color }}>
        <div className="mj-card-poster" {...openProps}>
          <img className="mj-card-img" src={entry.coverImageUrl} alt="" onError={() => setImgFailed(true)} />
          <div className="mj-card-poster-overlay">
            <CategoryTag category={entry.category} small />
            {entry.rating != null && (
              <span className="mj-stamp mj-stamp-float" title={`Rated ${entry.rating}/10`}>{entry.rating}</span>
            )}
          </div>
          <div className="mj-card-poster-foot">
            <h3 className="mj-card-title">{entry.title}</h3>
            <div className="mj-card-meta">
              <StatusPill status={entry.status} />
              {entry.rewatchCount > 0 && (
                <span className="mj-rewatch"><Repeat size={11} /> {entry.rewatchCount}</span>
              )}
            </div>
            <div className="mj-card-progress">
              {progressLabel(entry, c, logCount)}
            </div>
          </div>
        </div>
        <button className="mj-card-quicklog" onClick={onQuickLog} title={`Log next ${c.unit.toLowerCase()}`}>
          <Plus size={13} /> {c.unit}
        </button>
      </div>
    );
  }

  return (
    <div className="mj-card" style={{ '--cat-color': c.color }}>
      <div className="mj-card-spine" />
      <div className="mj-card-body" {...openProps}>
        <div className="mj-card-top">
          <CategoryTag category={entry.category} small />
          {entry.rating != null && (
            <span className="mj-stamp" title={`Rated ${entry.rating}/10`}>{entry.rating}</span>
          )}
        </div>
        <h3 className="mj-card-title">{entry.title}</h3>
        <div className="mj-card-meta">
          <StatusPill status={entry.status} />
          {entry.rewatchCount > 0 && (
            <span className="mj-rewatch"><Repeat size={11} /> {entry.rewatchCount}</span>
          )}
        </div>
        <div className="mj-card-progress">
          {progressLabel(entry, c, logCount)}
          {last && <span className="mj-card-last"> · last logged {fmtDate(last.date)}</span>}
        </div>
      </div>
      <button className="mj-card-quicklog" onClick={onQuickLog} title={`Log next ${c.unit.toLowerCase()}`}>
        <Plus size={13} /> {c.unit}
      </button>
    </div>
  );
}

function TimelineView({ entries, onOpen }) {
  const groups = useMemo(() => {
    const evs = [];
    entries.forEach(e => {
      (e.logs || []).forEach(l => evs.push({ date: l.date, type: 'log', entry: e, log: l }));
      if (e.status === 'completed' && e.completedDate) {
        evs.push({ date: e.completedDate, type: 'completed', entry: e });
      }
    });
    evs.sort((a, b) => b.date.localeCompare(a.date) || (b.log?.number || 0) - (a.log?.number || 0));
    const byMonth = {};
    evs.forEach(ev => {
      const k = monthKey(ev.date);
      if (!byMonth[k]) byMonth[k] = [];
      byMonth[k].push(ev);
    });
    return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  if (groups.length === 0) {
    return <div className="mj-empty"><p>No episodes or chapters logged yet — your timeline fills in as you log.</p></div>;
  }

  return (
    <div className="mj-timeline">
      {groups.map(([month, evs]) => (
        <div key={month} className="mj-timeline-month">
          <h2>{monthLabel(month)}</h2>
          <div className="mj-timeline-line">
            {evs.map((ev, i) => <TimelineRow key={i} ev={ev} onOpen={() => onOpen(ev.entry.id)} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineRow({ ev, onOpen }) {
  const c = CAT_MAP[ev.entry.category];
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!ev.entry.coverImageUrl && !imgFailed;
  return (
    <button className="mj-timeline-item" style={{ '--cat-color': c.color }} onClick={onOpen}>
      <span className="mj-timeline-date">{fmtDate(ev.date)}</span>
      {hasImage
        ? <img className="mj-timeline-thumb" src={ev.entry.coverImageUrl} alt="" onError={() => setImgFailed(true)} />
        : <span className="mj-timeline-dot" />}
      <span className="mj-timeline-text">
        {ev.type === 'completed'
          ? <>Finished <strong>{ev.entry.title}</strong></>
          : <><strong>{c.unit} {ev.log.number}</strong> of {ev.entry.title}{ev.log.note ? ` — ${ev.log.note}` : ''}</>}
      </span>
    </button>
  );
}

const PIE_COLORS = ['#E8963E', '#7FA65C', '#D6614C', '#5C8FD6', '#A6845C', '#8B8F94'];

function StatsView({ entries }) {
  const byCategory = CATEGORIES.map(c => ({ name: c.label, value: entries.filter(e => e.category === c.id).length, color: c.color }));
  const byStatus = STATUSES.map(s => ({ name: s.label, value: entries.filter(e => e.status === s.id).length }));
  const ratingDist = Array.from({ length: 10 }, (_, i) => ({
    name: String(i + 1), value: entries.filter(e => e.rating === i + 1).length,
  }));
  const genreCounts = {};
  entries.forEach(e => (e.genres || []).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  const monthly = {};
  entries.forEach(e => (e.logs || []).forEach(l => {
    const k = monthKey(l.date);
    monthly[k] = (monthly[k] || 0) + 1;
  }));
  const monthlySorted = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
    .map(([k, v]) => ({ name: k.slice(2), value: v }));

  const rated = entries.filter(e => e.rating != null);
  const avgRating = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1) : '—';
  const totalLogs = entries.reduce((s, e) => s + (e.logs || []).length, 0);

  if (entries.length === 0) {
    return <div className="mj-empty"><p>Add entries to see totals build up here.</p></div>;
  }

  return (
    <div className="mj-stats">
      <div className="mj-stat-tiles">
        <div className="mj-tile"><span className="mj-tile-num">{entries.length}</span><span>Entries</span></div>
        <div className="mj-tile"><span className="mj-tile-num">{totalLogs}</span><span>Episodes / chapters logged</span></div>
        <div className="mj-tile"><span className="mj-tile-num">{entries.filter(e => e.status === 'completed').length}</span><span>Completed</span></div>
        <div className="mj-tile"><span className="mj-tile-num">{avgRating}</span><span>Average rating</span></div>
      </div>

      <div className="mj-stat-grid">
        <div className="mj-panel">
          <h3>By category</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3}>
                {byCategory.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mj-legend">
            {byCategory.map(d => (
              <span key={d.name}><i style={{ background: d.color }} /> {d.name} ({d.value})</span>
            ))}
          </div>
        </div>

        <div className="mj-panel">
          <h3>By status</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byStatus} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid stroke="rgba(237,230,214,0.08)" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#B9B2A0', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(237,230,214,0.05)' }} />
              <Bar dataKey="value" fill="#E8963E" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mj-panel">
          <h3>Ratings given</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ratingDist}>
              <CartesianGrid stroke="rgba(237,230,214,0.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#B9B2A0', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(237,230,214,0.05)' }} />
              <Bar dataKey="value" fill="#A67FD6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mj-panel">
          <h3>Top genres</h3>
          {topGenres.length === 0 ? <p className="mj-panel-empty">Add genres to your entries to see this fill in.</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topGenres} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid stroke="rgba(237,230,214,0.08)" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={90} tick={{ fill: '#B9B2A0', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(237,230,214,0.05)' }} />
                <Bar dataKey="value" fill="#7FA65C" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="mj-panel mj-panel-wide">
          <h3>Logging activity, last 12 months</h3>
          {monthlySorted.length === 0 ? <p className="mj-panel-empty">Log an episode or chapter to start this chart.</p> : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={monthlySorted}>
                <CartesianGrid stroke="rgba(237,230,214,0.08)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#B9B2A0', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" stroke="#E8963E" strokeWidth={2} dot={{ r: 3, fill: '#E8963E' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = { background: '#262B33', border: '1px solid rgba(237,230,214,0.15)', borderRadius: 8, color: '#EDE6D6', fontSize: 12 };

function FormModal({ formData, setFormData, onSave, onClose }) {
  const [step, setStep] = useState(formData.id ? 'form' : 'search');
  const set = (k, v) => setFormData(f => ({ ...f, [k]: v }));

  function applyResult(r) {
    setFormData(f => ({
      ...f,
      title: r.title || f.title,
      year: r.year || f.year,
      synopsis: r.synopsis || f.synopsis,
      genres: (r.genres && r.genres.length) ? r.genres.join(', ') : f.genres,
      totalUnits: r.totalUnits || f.totalUnits,
      coverImageUrl: r.coverImageUrl || f.coverImageUrl,
    }));
    setStep('form');
  }

  return (
    <div className="mj-overlay" onClick={onClose}>
      <div className="mj-modal mj-modal-medium" onClick={e => e.stopPropagation()}>
        {step === 'search' ? (
          <SearchStep
            category={formData.category}
            initialQuery={formData.title}
            onCategoryChange={(cat) => set('category', cat)}
            onPick={applyResult}
            onSkip={() => setStep('form')}
            onClose={onClose}
          />
        ) : (
          <form onSubmit={onSave}>
            <div className="mj-modal-head">
              <h2>{formData.id ? 'Edit entry' : 'New entry'}</h2>
              <button type="button" className="mj-icon-btn" onClick={onClose}><X size={18} /></button>
            </div>
            <label className="mj-field">
              <span>Title</span>
              <input autoFocus required value={formData.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Made in Abyss" />
            </label>
            <button type="button" className="mj-lookup-btn" onClick={() => setStep('search')}>
              <Search size={13} /> Look up cover, synopsis &amp; genres
            </button>
            <div className="mj-field-row">
              <label className="mj-field">
                <span>Category</span>
                <select value={formData.category} onChange={e => set('category', e.target.value)}>
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="mj-field">
                <span>Status</span>
                <select value={formData.status} onChange={e => set('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
            </div>
            <div className="mj-field-row">
              <label className="mj-field">
                <span>Year</span>
                <input type="number" value={formData.year} onChange={e => set('year', e.target.value)} placeholder="e.g. 2017" />
              </label>
              <label className="mj-field">
                <span>Total {CAT_MAP[formData.category].unitPlural.toLowerCase()}</span>
                <input type="number" min="0" value={formData.totalUnits} onChange={e => set('totalUnits', e.target.value)} placeholder="e.g. 24" />
              </label>
              <label className="mj-field">
                <span>Rewatch / reread count</span>
                <input type="number" min="0" value={formData.rewatchCount} onChange={e => set('rewatchCount', e.target.value)} />
              </label>
            </div>
            <label className="mj-field">
              <span>Cover image URL (optional)</span>
              <input value={formData.coverImageUrl} onChange={e => set('coverImageUrl', e.target.value)} placeholder="https://…" />
            </label>
            {formData.coverImageUrl && (
              <div className="mj-cover-preview">
                <img src={formData.coverImageUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </div>
            )}
            <label className="mj-field">
              <span>Synopsis</span>
              <textarea rows={3} value={formData.synopsis} onChange={e => set('synopsis', e.target.value)} placeholder="Pulled from search, or write your own…" />
            </label>
            <label className="mj-field">
              <span>Genres (comma separated)</span>
              <input value={formData.genres} onChange={e => set('genres', e.target.value)} placeholder="Adventure, Horror, Slice of life" />
            </label>
            <label className="mj-field">
              <span>Your notes</span>
              <textarea rows={3} value={formData.notes} onChange={e => set('notes', e.target.value)} placeholder="Overall thoughts…" />
            </label>
            <div className="mj-modal-actions">
              <button type="button" className="mj-btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="mj-btn mj-btn-primary">{formData.id ? 'Save changes' : 'Add to shelf'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SearchStep({ category, initialQuery, onCategoryChange, onPick, onSkip, onClose }) {
  const [query, setQuery] = useState(initialQuery || '');
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState([]);

  useEffect(() => {
    setStatus('idle');
    setResults([]);
  }, [category]);

  async function runSearch(e) {
    e.preventDefault();
    if (!query.trim() || status === 'loading') return;
    setStatus('loading');
    try {
      const items = await searchMedia(category, query.trim());
      setResults(items);
      setStatus('done');
    } catch (err) {
      setResults([]);
      if (err && err.code === 'not-supported') setStatus('not-supported');
      else if (err && err.code === 'missing-key') setStatus('no-key');
      else if (err && err.code === 'no-server') setStatus('no-server');
      else setStatus('error');
    }
  }

  return (
    <div>
      <div className="mj-modal-head">
        <h2>Find something</h2>
        <button type="button" className="mj-icon-btn" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="mj-chip-row mj-search-chips">
        {CATEGORIES.map(c => {
          const Icon = c.icon;
          return (
            <button key={c.id} type="button" className={category === c.id ? 'mj-chip active' : 'mj-chip'}
              style={{ '--chip-color': c.color }} onClick={() => onCategoryChange(c.id)}>
              <Icon size={13} /> {c.label}
            </button>
          );
        })}
      </div>
      <form className="mj-search-form" onSubmit={runSearch}>
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${CAT_MAP[category].label.toLowerCase()}…`} />
        <button className="mj-btn mj-btn-primary" type="submit" disabled={status === 'loading'}>
          <Search size={14} /> {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      {status === 'error' && (
        <p className="mj-search-error">Couldn't complete that search — try again, rephrase it, or add the entry manually.</p>
      )}
      {status === 'not-supported' && (
        <p className="mj-search-error">Live search isn't available for {PROXIED_CATEGORY_LABEL[category] || 'this category'} yet — add this one manually below.</p>
      )}
      {status === 'no-key' && (
        <p className="mj-search-error">No API key is configured on the proxy server for {PROXIED_CATEGORY_LABEL[category] || 'this category'}. Add one to server/.env (see the README) and restart the proxy — or skip below and add this entry manually.</p>
      )}
      {status === 'no-server' && (
        <p className="mj-search-error">Couldn't reach the local proxy server. Make sure it's running (npm run server, or npm run dev:all to start both at once) — or skip below and add this entry manually.</p>
      )}
      {status === 'done' && results.length === 0 && (
        <p className="mj-search-error">No matches found. You can add it manually instead.</p>
      )}
      {results.length > 0 && (
        <div className="mj-result-list">
          {results.map((r, i) => <ResultCard key={i} result={r} onPick={() => onPick(r)} />)}
        </div>
      )}

      <button type="button" className="mj-skip-link" onClick={onSkip}>Skip — add manually instead</button>
    </div>
  );
}

function ResultCard({ result, onPick }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!result.coverImageUrl && !imgFailed;
  return (
    <button type="button" className="mj-result-card" onClick={onPick}>
      <div className="mj-result-thumb">
        {hasImage
          ? <img src={result.coverImageUrl} alt="" onError={() => setImgFailed(true)} />
          : <span>{(result.title || '?').slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className="mj-result-info">
        <h4>{result.title}{result.year ? ` (${result.year})` : ''}</h4>
        {result.genres && result.genres.length > 0 && (
          <div className="mj-result-genres">{result.genres.slice(0, 4).join(' · ')}</div>
        )}
        {result.synopsis && <p>{result.synopsis}</p>}
      </div>
    </button>
  );
}

function DetailModal({ entry, onClose, onEdit, onDelete, onRate, onStatus, logDraft, setLogDraft, onAddLog, onRemoveLog }) {
  const c = CAT_MAP[entry.category];
  const logs = [...(entry.logs || [])].sort((a, b) => b.number - a.number);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!entry.coverImageUrl && !imgFailed;

  return (
    <div className="mj-overlay" onClick={onClose}>
      <div className="mj-modal mj-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="mj-modal-head">
          <button className="mj-icon-btn mj-back" onClick={onClose}><ChevronLeft size={18} /></button>
          <div className="mj-modal-head-title">
            <CategoryTag category={entry.category} small />
            <h2>{entry.title}{entry.year ? <span className="mj-year"> · {entry.year}</span> : null}</h2>
          </div>
          <div className="mj-modal-head-actions">
            <button className="mj-icon-btn" onClick={onEdit} title="Edit"><Pencil size={16} /></button>
            <button className="mj-icon-btn" onClick={onClose} title="Close"><X size={18} /></button>
          </div>
        </div>

        <div className="mj-detail-grid">
          <div>
            {hasImage && (
              <div className="mj-detail-cover">
                <img src={entry.coverImageUrl} alt="" onError={() => setImgFailed(true)} />
              </div>
            )}
            {entry.synopsis && (
              <div className="mj-detail-block">
                <span className="mj-detail-label">Synopsis</span>
                <p className="mj-notes">{entry.synopsis}</p>
              </div>
            )}
            <div className="mj-detail-block">
              <span className="mj-detail-label">Status</span>
              <div className="mj-status-row">
                {STATUSES.map(s => (
                  <button key={s.id} className={'mj-status-btn' + (entry.status === s.id ? ' active' : '')}
                    onClick={() => onStatus(s.id)}>{s.label}</button>
                ))}
              </div>
            </div>

            <div className="mj-detail-block">
              <span className="mj-detail-label">Rating</span>
              <div className="mj-rating-row">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <button key={n} className={'mj-rate-btn' + (entry.rating === n ? ' active' : '')}
                    onClick={() => onRate(entry.rating === n ? null : n)}>{n}</button>
                ))}
              </div>
            </div>

            {entry.genres && entry.genres.length > 0 && (
              <div className="mj-detail-block">
                <span className="mj-detail-label">Genres</span>
                <div className="mj-genre-row">{entry.genres.map(g => <span key={g} className="mj-genre-pill">{g}</span>)}</div>
              </div>
            )}

            {entry.notes && (
              <div className="mj-detail-block">
                <span className="mj-detail-label">Your notes</span>
                <p className="mj-notes">{entry.notes}</p>
              </div>
            )}

            {entry.rewatchCount > 0 && (
              <div className="mj-detail-block">
                <span className="mj-detail-label"><Repeat size={12} /> Revisits</span>
                <p>{entry.rewatchCount}</p>
              </div>
            )}

            <div className="mj-detail-block">
              {!confirmingDelete ? (
                <button className="mj-btn mj-btn-danger-ghost" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 size={14} /> Delete entry
                </button>
              ) : (
                <div className="mj-confirm-delete">
                  <span>Delete “{entry.title}” and its whole log? This can't be undone.</span>
                  <div>
                    <button className="mj-btn" onClick={() => setConfirmingDelete(false)}>Cancel</button>
                    <button className="mj-btn mj-btn-danger" onClick={onDelete}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mj-log-col">
            <span className="mj-detail-label">{c.unit} log</span>
            <div className="mj-log-add">
              <input type="number" min="1" placeholder="#" value={logDraft.number}
                onChange={e => setLogDraft(d => ({ ...d, number: e.target.value }))} />
              <input type="date" value={logDraft.date}
                onChange={e => setLogDraft(d => ({ ...d, date: e.target.value }))} />
              <input placeholder="note (optional)" value={logDraft.note}
                onChange={e => setLogDraft(d => ({ ...d, note: e.target.value }))} />
              <button className="mj-btn mj-btn-primary mj-btn-sm" onClick={onAddLog} type="button">
                <Plus size={14} /> Log
              </button>
            </div>
            {logs.length === 0 ? (
              <p className="mj-panel-empty">No {c.unitPlural.toLowerCase()} logged yet.</p>
            ) : (
              <ul className="mj-log-list">
                {logs.map(l => (
                  <li key={l.id}>
                    <span className="mj-log-stamp">{c.unit} {l.number}</span>
                    <span className="mj-log-date">{fmtDate(l.date)}</span>
                    {l.note && <span className="mj-log-note">{l.note}</span>}
                    <button className="mj-log-remove" onClick={() => onRemoveLog(l.id)} title="Remove"><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Style() {
  return (
    <style>{`
      .mj-root {
        --ink: #14171C;
        --panel: #1E2229;
        --panel-raised: #262B33;
        --cream: #EDE6D6;
        --cream-dim: #B9B2A0;
        --line: rgba(237,230,214,0.12);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
        background: var(--ink);
        color: var(--cream);
        border-radius: 14px;
        padding: 28px;
        min-height: 100%;
        box-sizing: border-box;
      }
      .mj-root * { box-sizing: border-box; }
      .mj-loading { display: flex; align-items: center; justify-content: center; min-height: 300px; }
      .mj-loading-mark { font-family: Georgia, serif; color: var(--cream-dim); font-style: italic; }

      .mj-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
      .mj-brand { display: flex; align-items: center; gap: 14px; }
      .mj-brand-mark {
        font-size: 28px; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;
        border: 1px solid var(--line); border-radius: 50%; color: #E8963E; flex-shrink: 0;
      }
      .mj-brand h1 { font-family: Georgia, 'Iowan Old Style', serif; font-size: 22px; margin: 0; letter-spacing: 0.3px; }
      .mj-brand p { margin: 2px 0 0; font-size: 12.5px; color: var(--cream-dim); }

      .mj-btn {
        display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 8px;
        border: 1px solid var(--line); background: var(--panel-raised); color: var(--cream);
        font-size: 13.5px; cursor: pointer; font-family: inherit;
      }
      .mj-btn:hover { border-color: rgba(237,230,214,0.3); }
      .mj-btn:focus-visible { outline: 2px solid #E8963E; outline-offset: 2px; }
      .mj-btn-primary { background: #E8963E; border-color: #E8963E; color: #1A1300; font-weight: 600; }
      .mj-btn-primary:hover { background: #f0a352; }
      .mj-btn-sm { padding: 7px 12px; font-size: 12.5px; }
      .mj-btn-danger-ghost { color: #E27C6B; border-color: rgba(226,124,107,0.3); background: transparent; }
      .mj-btn-danger { background: #C24B3A; border-color: #C24B3A; color: #fff; }

      .mj-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 20px; }
      .mj-tabs button {
        display: flex; align-items: center; gap: 6px; padding: 10px 14px; background: none; border: none;
        color: var(--cream-dim); font-size: 13.5px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
        font-family: inherit;
      }
      .mj-tabs button.active { color: var(--cream); border-bottom-color: #E8963E; }
      .mj-tabs button:focus-visible { outline: 2px solid #E8963E; outline-offset: -2px; }

      .mj-error { background: rgba(194,75,58,0.15); border: 1px solid rgba(194,75,58,0.4); color: #E27C6B; padding: 8px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }

      .mj-filters { display: flex; flex-direction: column; gap: 12px; margin-bottom: 22px; }
      .mj-chip-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .mj-chip {
        display: flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 999px;
        border: 1px solid var(--line); background: transparent; color: var(--cream-dim); font-size: 12.5px; cursor: pointer; font-family: inherit;
      }
      .mj-chip.active { background: var(--chip-color, #E8963E); border-color: var(--chip-color, #E8963E); color: #14171C; font-weight: 600; }
      .mj-chip-count { font-family: 'SF Mono', 'Courier New', monospace; font-size: 10.5px; opacity: 0.75; }
      .mj-status-tabs { padding-top: 10px; border-top: 1px dashed var(--line); }
      .mj-filters-row2 { display: flex; gap: 10px; flex-wrap: wrap; }
      .mj-search { display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; flex: 1; min-width: 160px; color: var(--cream-dim); }
      .mj-search input { background: none; border: none; color: var(--cream); outline: none; font-size: 13px; width: 100%; font-family: inherit; }

      .mj-empty { text-align: center; padding: 60px 20px; color: var(--cream-dim); }
      .mj-empty-title { font-family: Georgia, serif; font-size: 18px; color: var(--cream); margin-bottom: 4px; }
      .mj-empty .mj-btn { margin-top: 16px; }

      .mj-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }

      .mj-card {
        position: relative; display: flex; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
      }
      .mj-card-spine { width: 5px; background: var(--cat-color); flex-shrink: 0; }
      .mj-card-body { flex: 1; padding: 14px 14px 10px; cursor: pointer; min-width: 0; }
      .mj-card-body:focus-visible { outline: 2px solid #E8963E; outline-offset: -2px; }
      .mj-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
      .mj-cat-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--cat-color); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
      .mj-stamp {
        border: 1.5px solid #E8963E; color: #E8963E; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
        font-family: Georgia, serif; font-weight: 700; font-size: 12px; transform: rotate(-8deg); flex-shrink: 0;
      }
      .mj-card-title { font-family: Georgia, serif; font-size: 15.5px; margin: 0 0 8px; line-height: 1.3; color: var(--cream); }
      .mj-card-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
      .mj-rewatch { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--cream-dim); }
      .mj-card-progress { font-family: 'SF Mono', 'Courier New', monospace; font-size: 11px; color: var(--cream-dim); }
      .mj-card-last { opacity: 0.8; }
      .mj-card-quicklog {
        writing-mode: vertical-rl; text-orientation: mixed; border: none; border-left: 1px dashed var(--line); background: var(--panel-raised);
        color: var(--cream-dim); font-size: 10.5px; padding: 10px 6px; cursor: pointer; display: flex; align-items: center; gap: 4px; font-family: inherit;
      }
      .mj-card-quicklog:hover { color: var(--cream); background: rgba(232,150,62,0.15); }

      .mj-card.has-image { flex-direction: column; }
      .mj-card-poster { position: relative; cursor: pointer; overflow: hidden; }
      .mj-card-poster:focus-visible { outline: 2px solid #E8963E; outline-offset: -2px; }
      .mj-card-img { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; display: block; background: var(--panel-raised); }
      .mj-card-poster-overlay { position: absolute; top: 8px; left: 8px; right: 8px; display: flex; justify-content: space-between; align-items: flex-start; }
      .mj-card-poster-overlay .mj-cat-tag { background: rgba(20,23,28,0.72); padding: 3px 7px; border-radius: 5px; backdrop-filter: blur(2px); }
      .mj-stamp-float { background: rgba(20,23,28,0.85); }
      .mj-card-poster-foot { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 10px 9px; background: linear-gradient(to top, rgba(8,9,11,0.95), rgba(8,9,11,0.55) 65%, rgba(8,9,11,0)); }
      .mj-card-poster-foot .mj-card-title { margin-bottom: 6px; }
      .mj-card-poster-foot .mj-card-meta { margin-bottom: 4px; }
      .mj-card.has-image .mj-card-quicklog { writing-mode: horizontal-tb; text-orientation: initial; border-left: none; border-top: 1px dashed var(--line); width: 100%; padding: 7px; }

      .mj-modal-medium { max-width: 560px; }
      .mj-lookup-btn { display: inline-flex; align-items: center; gap: 5px; background: none; border: none; color: #E8963E; font-size: 12px; padding: 0 0 14px; cursor: pointer; font-family: inherit; }
      .mj-lookup-btn:hover { text-decoration: underline; }
      .mj-cover-preview { margin: -8px 0 14px; }
      .mj-cover-preview img { max-width: 140px; border-radius: 8px; display: block; border: 1px solid var(--line); }

      .mj-search-chips { margin-bottom: 14px; }
      .mj-search-form { display: flex; gap: 8px; margin-bottom: 14px; }
      .mj-search-form input { flex: 1; min-width: 0; background: var(--panel-raised); border: 1px solid var(--line); color: var(--cream); border-radius: 8px; padding: 9px 12px; font-size: 13.5px; font-family: inherit; }
      .mj-search-form input:focus { outline: 2px solid #E8963E; outline-offset: 1px; }
      .mj-search-error { font-size: 12.5px; color: var(--cream-dim); margin: 4px 0 14px; }
      .mj-result-list { display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto; margin-bottom: 14px; }
      .mj-result-card { display: flex; gap: 12px; text-align: left; background: var(--panel-raised); border: 1px solid var(--line); border-radius: 10px; padding: 10px; cursor: pointer; font-family: inherit; color: inherit; }
      .mj-result-card:hover { border-color: rgba(232,150,62,0.5); }
      .mj-result-card:focus-visible { outline: 2px solid #E8963E; }
      .mj-result-thumb { width: 50px; height: 70px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: var(--panel); display: flex; align-items: center; justify-content: center; font-family: Georgia, serif; color: var(--cream-dim); font-size: 20px; }
      .mj-result-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .mj-result-info h4 { margin: 0 0 4px; font-size: 13.5px; font-family: Georgia, serif; color: var(--cream); }
      .mj-result-genres { font-size: 10.5px; color: #E8963E; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
      .mj-result-info p { margin: 0; font-size: 12px; color: var(--cream-dim); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .mj-skip-link { display: block; margin: 0 auto; background: none; border: none; color: var(--cream-dim); font-size: 12.5px; cursor: pointer; text-decoration: underline; font-family: inherit; }

      .mj-year { font-weight: 400; color: var(--cream-dim); font-size: 0.7em; }
      .mj-detail-cover img { width: 100%; max-width: 200px; border-radius: 8px; display: block; margin-bottom: 16px; border: 1px solid var(--line); }

      .mj-status-pill { font-size: 10.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--cream-dim); }
      .mj-status-completed { color: #7FA65C; border-color: rgba(127,166,92,0.4); }
      .mj-status-active { color: #E8963E; border-color: rgba(232,150,62,0.4); }
      .mj-status-dropped { color: #D6614C; border-color: rgba(214,97,76,0.4); }

      .mj-timeline-month { margin-bottom: 28px; }
      .mj-timeline-month h2 { font-family: Georgia, serif; font-size: 16px; color: var(--cream-dim); margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px dashed var(--line); }
      .mj-timeline-line { display: flex; flex-direction: column; }
      .mj-timeline-item {
        display: grid; grid-template-columns: 90px 26px 1fr; align-items: start; gap: 12px; padding: 7px 4px; background: none; border: none; text-align: left; cursor: pointer; font-family: inherit; color: inherit; border-radius: 6px;
      }
      .mj-timeline-item:hover { background: rgba(237,230,214,0.05); }
      .mj-timeline-item:focus-visible { outline: 2px solid #E8963E; }
      .mj-timeline-date { font-family: 'SF Mono', 'Courier New', monospace; font-size: 11px; color: var(--cream-dim); padding-top: 2px; }
      .mj-timeline-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cat-color); margin-top: 7px; justify-self: center; }
      .mj-timeline-thumb { width: 26px; height: 26px; border-radius: 5px; object-fit: cover; justify-self: center; }
      .mj-timeline-text { font-size: 13.5px; line-height: 1.4; padding-top: 3px; }

      .mj-stats { display: flex; flex-direction: column; gap: 20px; }
      .mj-stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
      .mj-tile { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 4px; }
      .mj-tile-num { font-family: Georgia, serif; font-size: 26px; color: #E8963E; }
      .mj-tile span:last-child { font-size: 11.5px; color: var(--cream-dim); }
      .mj-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
      .mj-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
      .mj-panel-wide { grid-column: 1 / -1; }
      .mj-panel h3 { font-family: Georgia, serif; font-size: 14px; margin: 0 0 10px; color: var(--cream-dim); font-weight: 400; }
      .mj-panel-empty { font-size: 12.5px; color: var(--cream-dim); }
      .mj-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 11.5px; color: var(--cream-dim); }
      .mj-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }

      .mj-overlay { position: fixed; inset: 0; background: rgba(10,12,15,0.7); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50; }
      .mj-modal { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px; width: 100%; max-width: 420px; max-height: 88vh; overflow-y: auto; overflow-x: hidden; }
      .mj-field input, .mj-field select { width: 100%; }
      .mj-modal-wide { max-width: 720px; }
      .mj-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 18px; }
      .mj-modal-head h2 { font-family: Georgia, serif; font-size: 18px; margin: 0; }
      .mj-modal-head-title { display: flex; flex-direction: column; gap: 4px; flex: 1; }
      .mj-modal-head-actions { display: flex; gap: 6px; }
      .mj-icon-btn { background: none; border: 1px solid var(--line); color: var(--cream-dim); border-radius: 8px; padding: 7px; cursor: pointer; display: flex; }
      .mj-icon-btn:hover { color: var(--cream); }
      .mj-icon-btn:focus-visible { outline: 2px solid #E8963E; }

      .mj-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; flex: 1; min-width: 0; }
      .mj-field span { font-size: 11.5px; color: var(--cream-dim); text-transform: uppercase; letter-spacing: 0.3px; }
      .mj-field input, .mj-field select, .mj-field textarea {
        background: var(--panel-raised); border: 1px solid var(--line); color: var(--cream); border-radius: 8px; padding: 9px 11px; font-size: 13.5px; font-family: inherit; resize: vertical;
      }
      .mj-field input:focus, .mj-field select:focus, .mj-field textarea:focus { outline: 2px solid #E8963E; outline-offset: 1px; }
      .mj-field-row { display: flex; gap: 12px; }
      .mj-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }

      .mj-detail-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
      @media (min-width: 620px) { .mj-detail-grid { grid-template-columns: 1fr 1fr; } }
      .mj-detail-block { margin-bottom: 18px; }
      .mj-detail-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--cream-dim); display: flex; align-items: center; gap: 5px; margin-bottom: 8px; }
      .mj-status-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .mj-status-btn { background: var(--panel-raised); border: 1px solid var(--line); color: var(--cream-dim); border-radius: 999px; padding: 6px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
      .mj-status-btn.active { background: #E8963E; border-color: #E8963E; color: #1A1300; font-weight: 600; }
      .mj-rating-row { display: flex; flex-wrap: wrap; gap: 5px; }
      .mj-rate-btn { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel-raised); color: var(--cream-dim); font-size: 12.5px; cursor: pointer; font-family: 'SF Mono', monospace; }
      .mj-rate-btn.active { background: #A67FD6; border-color: #A67FD6; color: #1A1300; font-weight: 700; }
      .mj-genre-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .mj-genre-pill { font-size: 11.5px; padding: 4px 10px; border-radius: 999px; background: var(--panel-raised); color: var(--cream-dim); }
      .mj-notes { font-size: 13.5px; line-height: 1.6; color: var(--cream); white-space: pre-wrap; }
      .mj-confirm-delete { background: rgba(194,75,58,0.1); border: 1px solid rgba(194,75,58,0.3); border-radius: 8px; padding: 12px; font-size: 12.5px; }
      .mj-confirm-delete div { display: flex; gap: 8px; margin-top: 10px; }

      .mj-log-col { display: flex; flex-direction: column; }
      .mj-log-add { display: grid; grid-template-columns: 55px 130px 1fr auto; gap: 6px; margin-bottom: 14px; }
      .mj-log-add input { background: var(--panel-raised); border: 1px solid var(--line); color: var(--cream); border-radius: 7px; padding: 7px 8px; font-size: 12.5px; font-family: inherit; min-width: 0; }
      .mj-log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow-y: auto; }
      .mj-log-list li { display: flex; align-items: center; gap: 10px; background: var(--panel-raised); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; }
      .mj-log-stamp { font-family: 'SF Mono', 'Courier New', monospace; color: #E8963E; font-weight: 600; flex-shrink: 0; }
      .mj-log-date { color: var(--cream-dim); flex-shrink: 0; }
      .mj-log-note { color: var(--cream); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mj-log-remove { margin-left: auto; background: none; border: none; color: var(--cream-dim); cursor: pointer; flex-shrink: 0; display: flex; }
      .mj-log-remove:hover { color: #E27C6B; }

      @media (prefers-reduced-motion: reduce) { .mj-root * { transition: none !important; animation: none !important; } }
      @media (max-width: 480px) {
        .mj-log-add { grid-template-columns: 1fr 1fr; }
        .mj-root { padding: 18px; }
      }
    `}</style>
  );
}

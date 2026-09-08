// The app was originally built as a Claude.ai artifact, which provides a
// built-in window.storage API. Outside claude.ai that API doesn't exist,
// so this shim recreates the same interface on top of localStorage.
// If window.storage already exists (e.g. running inside claude.ai), this
// does nothing and the real one is used instead.
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return { key, value: raw, shared: false };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value, shared: false };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key, deleted: true, shared: false };
    },
    async list(prefix) {
      const keys = Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix));
      return { keys, prefix, shared: false };
    },
  };
}

// Who is using this browser. Progress lives in this browser and on the server per person; the
// browser remembers whose copy it holds (a short id from /api/me, never the email), so when
// someone else signs in on the same device, the old copy is cleared before anything syncs.

// stored: the id this browser's copy belongs to; current: who /api/me says is signed in now.
// -> 'adopt' (no owner yet: claim it), 'same', or 'switch' (clear the copy, then sync)
export function handover(stored, current) {
  if (!current) return 'same';
  if (!stored) return 'adopt';
  return stored === current ? 'same' : 'switch';
}

export const greeting = (name, site = 'Study') => (name ? `Welcome to ${site}, ${name}` : `Welcome to ${site}`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The deployed version: the id `wrangler deploy` prints, and the day it went live.
export function versionText(v) {
  if (!v) return 'Version: local copy';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.date || '');
  return m ? `Version ${v.id} · ${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : `Version ${v.id}`;
}

// The avatar's letter: the first letter of your name, capitalised; '' without a name.
export const initial = (name) => ([...String(name || '').trim()][0] || '').toLocaleUpperCase();

// The public copy (GitHub Pages) has no server: its page carries <meta name="study-mode" content="local">,
// so there is no sign-in and progress stays in this browser.
export function isLocalCopy(doc) {
  return doc?.querySelector?.('meta[name="study-mode"]')?.content === 'local';
}

// The public copy's "Reset all progress": the first tap asks, the second erases everything this app
// saved in this browser and reloads, so the visitor starts fresh. (The signed-in site has Sign out.)
export function resetAllProgress({ storage, reload }) {
  let armed = false;
  return {
    label: 'Reset all progress',
    async tap() {
      if (!armed) { armed = true; return { armed, label: 'Tap again to erase all progress' }; }
      armed = false;
      await storage.clear();
      reload();
      return { armed, label: 'Erasing…' };
    },
  };
}

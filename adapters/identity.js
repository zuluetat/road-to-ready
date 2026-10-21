// Identity adapter: who is signed in, from /api/me. Cloudflare Access does the signing in; this
// only asks the server who that is (a short id, never the email), the deployed version, and where
// signing out goes.
//   -> { status: 'ok', you, version, signOutUrl } | { status: 'not-listed', signOutUrl }
//      | { status: 'offline' | 'signed-out' | 'unavailable' }

export async function currentUser({ fetchImpl = (...a) => fetch(...a) } = {}) {
  let res;
  try {
    res = await fetchImpl('/api/me', { cache: 'no-cache', redirect: 'manual' });
  } catch {
    return { status: 'offline' };
  }
  if (res.type === 'opaqueredirect') return { status: 'signed-out' };
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    return { status: 'not-listed', signOutUrl: body.signOutUrl || '/cdn-cgi/access/logout' };
  }
  if (!res.ok) return { status: 'unavailable' };
  const { you, version, signOutUrl } = await res.json();
  return { status: 'ok', you, version, signOutUrl };
}

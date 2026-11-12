import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setCsrf } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ready: false, admin: false, configured: true });

  useEffect(() => {
    let alive = true;
    api('/api/session')
      .then((s) => {
        if (!alive) return;
        setCsrf(s.csrf);
        setState({ ready: true, admin: !!s.admin, configured: s.configured !== false });
      })
      .catch(() => alive && setState({ ready: true, admin: false, configured: true }));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const r = await api('/api/login', { method: 'POST', body: { username, password } });
    setCsrf(r.csrf);
    setState((s) => ({ ...s, admin: true }));
  }, []);

  const logout = useCallback(async () => {
    const r = await api('/api/logout', { method: 'POST' });
    setCsrf(r.csrf);
    setState((s) => ({ ...s, admin: false }));
  }, []);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

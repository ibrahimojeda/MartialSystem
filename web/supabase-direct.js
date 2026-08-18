// ─── Supabase Direct Client ──────────────────────────────────────────
// Cliente de Supabase embebido directamente en la APK.
// No depende de ningún servidor intermedio (localhost/Express).
// Usa la ANON KEY pública de Supabase para autenticación y consultas.

(function () {
  'use strict';

  const SUPABASE_URL = 'https://obwtpmzgwepqyawfvkjn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9id3RwbXpnd2VwcXlhd2Z2a2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNzA3OTcsImV4cCI6MjA5Mzk0Njc5N30.lFHz0duREEzjnGVgbmC3xar30OzUCTg7OZrqALXjGpw';

  // ─── Load Supabase from CDN if not already present ──────────────────
  function loadSupabaseSDK() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) {
        return resolve();
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Supabase SDK'));
      document.head.appendChild(script);
    });
  }

  // ─── Initialize Supabase Client ─────────────────────────────────────
  async function initSupabase() {
    await loadSupabaseSDK();
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    });
    window.MartialSupabase = sb;
    console.log('[SupabaseDirect] Cliente Supabase inicializado directamente');
    return sb;
  }

  // ─── Auth helpers ───────────────────────────────────────────────────
  async function loginWithSupabase(username, password) {
    const sb = window.MartialSupabase || await initSupabase();
    const normalizedUsername = String(username || '').trim().toLowerCase();

    let authEmail = null;
    let lastRpcError = null;

    // Estrategia 1: Usar RPC (función SQL con SECURITY DEFINER) para obtener el email interno
    // Esto bypassea RLS durante el login
    try {
      const { data, error } = await sb
        .rpc('get_auth_email_for_login', { username_param: normalizedUsername });
      if (!error && data) {
        authEmail = data;
      } else if (error) {
        lastRpcError = error.message;
      }
    } catch (e) {
      lastRpcError = e && e.message ? e.message : String(e);
    }

    // Estrategia 2: Consultar profiles directamente por username
    // (usa la política pública creada en 013_login_fix.sql)
    if (!authEmail) {
      try {
        const { data, error } = await sb
          .from('profiles')
          .select('auth_email')
          .eq('username', normalizedUsername)
          .maybeSingle();
        if (!error && data && data.auth_email) {
          authEmail = data.auth_email;
        }
      } catch (e) {
        /* ignorar */
      }
    }

    // Estrategia 3: Intentar con el username como email (algunos setups lo usan como auth email)
    if (!authEmail) {
      authEmail = normalizedUsername;
    }

    console.log('[SupabaseDirect] Resolviendo login para usuario:', normalizedUsername, '| email:', authEmail, lastRpcError ? '| RPC: ' + lastRpcError : '');

    // Login con Supabase Auth usando el email
    const { data, error } = await sb.auth.signInWithPassword({
      email: authEmail,
      password: password
    });

    if (error || !data?.session?.access_token) {
      // Si la estrategia 3 falló y llegamos aquí, lanzar el error real de Supabase
      throw new Error(error?.message || 'Credenciales inválidas');
    }

    // Obtener perfil después del login
    const { data: profile } = await sb
      .from('profiles')
      .select('id, username, full_name, role, is_active')
      .eq('id', data.user.id)
      .single();

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        username: profile?.username || normalizedUsername,
        role: profile?.role || '',
        full_name: profile?.full_name || ''
      }
    };
  }

  async function getCurrentUser() {
    const sb = window.MartialSupabase;
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    if (!data?.session?.user) return null;
    
    const { data: profile } = await sb
      .from('profiles')
      .select('id, full_name, role, is_active, username')
      .eq('id', data.session.user.id)
      .single();

    return profile;
  }

  async function logoutSupabase() {
    const sb = window.MartialSupabase;
    if (sb) await sb.auth.signOut();
    localStorage.removeItem('ms_access_token');
    localStorage.removeItem('ms_user');
  }

  // ─── API call helper (usa fetch con token de Supabase) ──────────────
  async function supabaseApi(path, options = {}) {
    const sb = window.MartialSupabase;
    const { data: sessionData } = sb ? await sb.auth.getSession() : { data: { session: null } };
    const token = sessionData?.session?.access_token || localStorage.getItem('ms_access_token') || '';

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Si hay un servidor configurado (modo híbrido), usarlo
    const serverUrl = window.MartialMobile?.getServerUrl?.();
    const baseUrl = serverUrl || '';

    const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'API Error');
    return json;
  }

  // ─── Expose API ─────────────────────────────────────────────────────
  window.MartialSupabaseAPI = {
    init: initSupabase,
    login: loginWithSupabase,
    getCurrentUser,
    logout: logoutSupabase,
    api: supabaseApi,
    getClient: () => window.MartialSupabase
  };

  // ─── Auto-init ──────────────────────────────────────────────────────
  initSupabase().catch(err => {
    console.warn('[SupabaseDirect] No se pudo inicializar Supabase:', err.message);
  });
})();
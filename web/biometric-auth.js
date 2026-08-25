/**
 * BiometricAuth - Remember Me con Face ID / Huella / PIN
 * Usa @capgo/capacitor-native-biometric para guardar credenciales
 * de forma segura y autenticar con biometria del dispositivo.
 */
(function () {
  'use strict';

  const SERVER_KEY = 'com.martialsystem.app';
  let isNative = false;
  let plugin = null;

  function detectNative() {
    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        isNative = true;
        plugin = window.Capacitor.Plugins.NativeBiometric;
        return true;
      }
    } catch (_) { }
    return false;
  }

  async function isAvailable() {
    if (!isNative) return { available: false, biometryType: 'none' };
    try {
      const result = await plugin.isAvailable();
      const types = ['NONE','TOUCH_ID','FACE_ID','FINGERPRINT','FACE_AUTHENTICATION','IRIS_AUTHENTICATION','MULTIPLE','DEVICE_CREDENTIAL'];
      return { available: result.isAvailable, biometryType: types[result.biometryType] || 'unknown', strong: result.authenticationStrength === 1, deviceSecure: result.deviceIsSecure };
    } catch (e) { console.warn('[BiometricAuth] isAvailable error:', e.message); return { available: false, biometryType: 'none' }; }
  }

  async function verifyIdentity(reason) {
    if (!isNative) { console.log('[BiometricAuth] Web: simulando autenticacion biometrica'); return true; }
    try { await plugin.verifyIdentity({ reason: reason || 'Autenticate para acceder' }); return true; }
    catch (e) { console.warn('[BiometricAuth] verifyIdentity error:', e.message); return false; }
  }

  async function saveCredentials(username, password) {
    if (!isNative) { try { localStorage.setItem('ms_remember_username', username); localStorage.setItem('ms_remember_password', btoa(password)); } catch (_) {} return; }
    try { await plugin.setCredentials({ server: SERVER_KEY, username: username, password: password }); }
    catch (e) { console.warn('[BiometricAuth] saveCredentials error:', e.message); }
  }

  async function getCredentials() {
    if (!isNative) { try { const u = localStorage.getItem('ms_remember_username'); const p = localStorage.getItem('ms_remember_password'); if (u && p) return { username: u, password: atob(p) }; } catch (_) {} return null; }
    try { return await plugin.getCredentials({ server: SERVER_KEY }); }
    catch (e) { return null; }
  }

  async function deleteCredentials() {
    if (!isNative) { try { localStorage.removeItem('ms_remember_username'); localStorage.removeItem('ms_remember_password'); } catch (_) {} return; }
    try { await plugin.deleteCredentials({ server: SERVER_KEY }); } catch (e) { console.warn('[BiometricAuth] deleteCredentials error:', e.message); }
  }

  async function isCredentialsSaved() {
    if (!isNative) { try { return !!(localStorage.getItem('ms_remember_username') && localStorage.getItem('ms_remember_password')); } catch (_) { return false; } }
    try { const r = await plugin.isCredentialsSaved({ server: SERVER_KEY }); return r.isSaved; }
    catch (e) { return false; }
  }

  async function getBiometryLabel() {
    const info = await isAvailable();
    const labels = { 'NONE': 'PIN/Patron', 'TOUCH_ID': 'Touch ID', 'FACE_ID': 'Face ID', 'FINGERPRINT': 'Huella digital', 'FACE_AUTHENTICATION': 'Reconocimiento facial', 'IRIS_AUTHENTICATION': 'Iris', 'MULTIPLE': 'Biometria', 'DEVICE_CREDENTIAL': 'PIN/Patron' };
    return labels[info.biometryType] || 'Biometria';
  }

  async function doBiometricLogin() {
    if (!isNative) {
      const creds = await getCredentials();
      if (creds && creds.username) {
        document.getElementById('login-username').value = creds.username;
        document.getElementById('login-password').value = creds.password;
        document.getElementById('login-form').dispatchEvent(new Event('submit'));
        return true;
      }
      return false;
    }
    const saved = await isCredentialsSaved();
    if (!saved) return false;
    const label = await getBiometryLabel();
    const ok = await verifyIdentity('Usa ' + label + ' para iniciar sesion en MartialSystem');
    if (!ok) return false;
    const creds = await getCredentials();
    if (creds && creds.username) {
      document.getElementById('login-username').value = creds.username;
      document.getElementById('login-password').value = creds.password;
      document.getElementById('login-form').dispatchEvent(new Event('submit'));
      return true;
    }
    return false;
  }

  window.MartialBiometric = {
    isAvailable, verifyIdentity, saveCredentials, getCredentials,
    deleteCredentials, isCredentialsSaved, getBiometryLabel,
    doBiometricLogin, detect: detectNative
  };
  detectNative();
})();

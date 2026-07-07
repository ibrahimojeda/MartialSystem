require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { supabaseAdmin, supabasePublic } = require('./supabaseClient');

const app = express();
const PORT = Number(process.env.PORT || 8010);
const MEDIA_BUCKET = String(process.env.SUPABASE_MEDIA_BUCKET || 'martial-media').trim();

// Theory loader function
const loadTheoryFromFile = (discipline, style) => {
  try {
    const filePath = path.join(__dirname, '..', 'theory-data', discipline, `${style}.json`);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error loading theory file for ${discipline}/${style}:`, error.message);
  }
  return null;
};

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'web')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));

const ROLE_OWNER = 'owner';
const ROLE_SENSEI = 'sensei';
const ROLE_ADMIN = 'admin';
const ROLE_INSTRUCTOR = 'instructor';
const ROLE_STUDENT = 'student';
const ROLE_GUARDIAN = 'guardian';
const ROLE_SUPERADMIN = 'superadmin';
const MANAGEABLE_ROLES = [ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN, ROLE_INSTRUCTOR, ROLE_GUARDIAN, ROLE_STUDENT];

const ROLE_HIERARCHY = {
  [ROLE_SUPERADMIN]: 5,
  [ROLE_OWNER]: 4,
  [ROLE_SENSEI]: 4,
  [ROLE_ADMIN]: 3,
  [ROLE_INSTRUCTOR]: 2,
  [ROLE_GUARDIAN]: 1,
  [ROLE_STUDENT]: 1
};

const MODULE_KEYS = [
  'operacion',
  'calendario',
  'academico',
  'administracion',
  'torneos',
  'comunidad',
  'marketplace',
  'finanzas',
  'configuracion',
  'debug'
];

const DEFAULT_ROLE_MODULES = {
  [ROLE_SUPERADMIN]: [...MODULE_KEYS],
  [ROLE_OWNER]: ['operacion', 'calendario', 'academico', 'administracion', 'torneos', 'comunidad', 'marketplace', 'finanzas', 'configuracion'],
  [ROLE_SENSEI]: ['operacion', 'calendario', 'academico', 'torneos', 'comunidad', 'finanzas'],
  [ROLE_ADMIN]: ['operacion', 'calendario', 'academico', 'comunidad', 'marketplace', 'finanzas'],
  [ROLE_INSTRUCTOR]: ['operacion', 'calendario', 'academico', 'comunidad'],
  [ROLE_GUARDIAN]: ['academico', 'finanzas', 'comunidad'],
  [ROLE_STUDENT]: ['academico', 'comunidad']
};

const modulePermissionsPath = path.join(__dirname, '..', 'data', 'module-permissions.json');
const senseiInstructorPath = path.join(__dirname, '..', 'data', 'sensei-instructors.json');
const studentInstructorPath = path.join(__dirname, '..', 'data', 'student-instructors.json');
const studentPhotosPath = path.join(__dirname, '..', 'data', 'student-photos.json');
const organizationsPath = path.join(__dirname, '..', 'data', 'organizations.json');
const financeTargetsPath = path.join(__dirname, '..', 'data', 'finance-targets.json');
const absencesPath = path.join(__dirname, '..', 'data', 'absences.json');
const appSettingsPath = path.join(__dirname, '..', 'data', 'app-settings.json');
const marketplaceImagesPath = path.join(__dirname, '..', 'data', 'marketplace-images.json');

const SUPERADMIN_USERNAME = String(process.env.SUPERADMIN_USERNAME || 'venta').trim().toLowerCase();
const SUPERADMIN_PASSWORD = String(process.env.SUPERADMIN_PASSWORD || 'Venta@Dojo2026!');
const superadminSessions = new Set();

const defaultTreeForDiscipline = (disciplineName) => ({
  modules: [
    { id: 'students', label: `Alumnos ${disciplineName}` },
    { id: 'attendance', label: `Asistencia ${disciplineName}` },
    { id: 'theory', label: `Teoria ${disciplineName}` },
    { id: 'exams', label: `Examenes ${disciplineName}` },
    { id: 'payments', label: 'Pagos' },
    { id: 'reports', label: 'Reportes' },
    { id: 'notifications', label: 'Notificaciones' },
    { id: 'marketplace', label: 'Marketplace' },
    { id: 'portal', label: 'Portal Alumno/Guardian' }
  ]
});

const readJsonStore = (filePath, fallbackValue) => {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : fallbackValue;
  } catch (_) {
    return fallbackValue;
  }
};

const writeJsonStore = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

const sanitizeModuleList = (modules) => {
  const unique = [...new Set((Array.isArray(modules) ? modules : []).map(v => String(v || '').trim()))];
  return unique.filter(key => MODULE_KEYS.includes(key));
};

const getRoleModulesByEstablishment = (establishmentId, role) => {
  const store = readJsonStore(modulePermissionsPath, {});
  const est = store[String(establishmentId)] || {};
  const saved = sanitizeModuleList(est[String(role || '').toLowerCase()] || []);
  if (saved.length > 0) return saved;
  return [...(DEFAULT_ROLE_MODULES[role] || DEFAULT_ROLE_MODULES[ROLE_STUDENT])];
};

const updateRoleModulesByEstablishment = (establishmentId, role, modules) => {
  const store = readJsonStore(modulePermissionsPath, {});
  const estKey = String(establishmentId);
  store[estKey] = store[estKey] || {};
  store[estKey][String(role || '').toLowerCase()] = sanitizeModuleList(modules);
  writeJsonStore(modulePermissionsPath, store);
  return store[estKey][String(role || '').toLowerCase()];
};

const setSenseiForInstructor = (establishmentId, instructorProfileId, senseiProfileId) => {
  const store = readJsonStore(senseiInstructorPath, {});
  const estKey = String(establishmentId);
  store[estKey] = store[estKey] || {};
  store[estKey][String(instructorProfileId)] = String(senseiProfileId || '');
  writeJsonStore(senseiInstructorPath, store);
};

const getSenseiForInstructor = (establishmentId, instructorProfileId) => {
  const store = readJsonStore(senseiInstructorPath, {});
  const est = store[String(establishmentId)] || {};
  return est[String(instructorProfileId)] || null;
};

const upsertStudentInstructorLinks = (establishmentId, studentId, instructorIds) => {
  const store = readJsonStore(studentInstructorPath, {});
  const estKey = String(establishmentId);
  store[estKey] = store[estKey] || {};
  store[estKey][String(studentId)] = [...new Set((instructorIds || []).map(String).filter(Boolean))];
  writeJsonStore(studentInstructorPath, store);
};

const getStudentInstructorLinks = (establishmentId, studentId) => {
  const store = readJsonStore(studentInstructorPath, {});
  const est = store[String(establishmentId)] || {};
  const links = est[String(studentId)] || [];
  return Array.isArray(links) ? links.map(String) : [];
};

const setStudentPhoto = (establishmentId, studentId, photoUrl) => {
  const store = readJsonStore(studentPhotosPath, {});
  const estKey = String(establishmentId);
  store[estKey] = store[estKey] || {};
  store[estKey][String(studentId)] = String(photoUrl || '').trim();
  writeJsonStore(studentPhotosPath, store);
};

const getStudentPhoto = (establishmentId, studentId) => {
  const store = readJsonStore(studentPhotosPath, {});
  return store[String(establishmentId)]?.[String(studentId)] || '';
};

const DEFAULT_EXPECTED_FEE = 50;

const getExpectedFeeForDiscipline = (establishmentId, disciplineCode) => {
  const store = readJsonStore(financeTargetsPath, {});
  const est = store[String(establishmentId)] || {};
  const code = String(disciplineCode || '').toLowerCase();
  const value = Number(est[code]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_EXPECTED_FEE;
};

const setExpectedFeeForDiscipline = (establishmentId, disciplineCode, expectedFee) => {
  const store = readJsonStore(financeTargetsPath, {});
  const estKey = String(establishmentId);
  store[estKey] = store[estKey] || {};
  store[estKey][String(disciplineCode || '').toLowerCase()] = Number(expectedFee);
  writeJsonStore(financeTargetsPath, store);
  return store[estKey][String(disciplineCode || '').toLowerCase()];
};

const getOrganizationsStore = () => {
  const data = readJsonStore(organizationsPath, {});
  return {
    orgs: data.orgs && typeof data.orgs === 'object' ? data.orgs : {},
    establishments: data.establishments && typeof data.establishments === 'object' ? data.establishments : {}
  };
};

const saveOrganizationsStore = (store) => {
  writeJsonStore(organizationsPath, {
    orgs: store.orgs || {},
    establishments: store.establishments || {}
  });
};

const getAppSettings = () => {
  const data = readJsonStore(appSettingsPath, {});
  return data && typeof data === 'object' ? data : {};
};

const saveAppSettings = (store) => {
  writeJsonStore(appSettingsPath, store || {});
};

const getAbsenceStore = () => {
  const data = readJsonStore(absencesPath, {});
  return data && typeof data === 'object' ? data : {};
};

const saveAbsenceStore = (store) => {
  writeJsonStore(absencesPath, store || {});
};

const getMarketplaceImageStore = () => {
  const data = readJsonStore(marketplaceImagesPath, {});
  return data && typeof data === 'object' ? data : {};
};

const saveMarketplaceImageStore = (store) => {
  writeJsonStore(marketplaceImagesPath, store || {});
};

const setMarketplaceImage = (itemId, imageUrl) => {
  const store = getMarketplaceImageStore();
  store[String(itemId)] = String(imageUrl || '').trim();
  saveMarketplaceImageStore(store);
};

const getMarketplaceImage = (itemId) => {
  const store = getMarketplaceImageStore();
  return store[String(itemId)] || '';
};

const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
const uploadStorage = multer.memoryStorage();

const imageUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

const uploadImageToStorage = async (file, folder = 'general') => {
  const mime = String(file?.mimetype || '').toLowerCase();
  const ext = path.extname(file?.originalname || '').toLowerCase() || (mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg');
  const safeFolder = String(folder || 'general').replace(/[^a-z0-9/_-]/gi, '_');
  const fileName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
  const objectPath = `${safeFolder}/${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(MEDIA_BUCKET)
    .upload(objectPath, file.buffer, {
      contentType: mime || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false
    });

  if (uploadError) throw new Error(uploadError.message || 'Storage upload failed');

  const { data } = supabaseAdmin.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
  return {
    url: data?.publicUrl || '',
    path: objectPath,
    bucket: MEDIA_BUCKET
  };
};

const saveImageLocally = (file) => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const ext = path.extname(file?.originalname || '').toLowerCase() || '.bin';
  const fileName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, file.buffer);
  return {
    url: `/uploads/${fileName}`,
    path: `uploads/${fileName}`,
    bucket: 'local-fallback'
  };
};

const sanitizeBeltColors = (input) => {
  const result = {};
  if (!input || typeof input !== 'object') return result;
  Object.entries(input).forEach(([disciplineCode, byBelt]) => {
    if (!disciplineCode || !byBelt || typeof byBelt !== 'object') return;
    const cleanByBelt = {};
    Object.entries(byBelt).forEach(([beltName, colorHex]) => {
      const hex = String(colorHex || '').trim();
      if (!beltName) return;
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        cleanByBelt[String(beltName)] = hex.toUpperCase();
      }
    });
    if (Object.keys(cleanByBelt).length > 0) {
      result[String(disciplineCode)] = cleanByBelt;
    }
  });
  return result;
};

const sanitizeMonthlyFees = (input) => {
  const result = {};
  if (!input || typeof input !== 'object') return result;
  Object.entries(input).forEach(([disciplineCode, byLevel]) => {
    if (!disciplineCode || !byLevel || typeof byLevel !== 'object') return;
    const cleanByLevel = {};
    Object.entries(byLevel).forEach(([level, amount]) => {
      const parsed = Number(amount);
      if (!level || !Number.isFinite(parsed) || parsed < 0) return;
      cleanByLevel[String(level)] = Number(parsed.toFixed(2));
    });
    if (Object.keys(cleanByLevel).length > 0) {
      result[String(disciplineCode)] = cleanByLevel;
    }
  });
  return result;
};

const getAccessToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
};

const normalizeUsername = (value) => String(value || '').trim().toLowerCase();
const buildInternalEmail = (username) => `${username}@users.martialsystem.local`;

const createSuperadminToken = () => `sa_${crypto.randomBytes(24).toString('hex')}`;

const requireAuth = async (req, res, next) => {
  const accessToken = getAccessToken(req);
  if (!accessToken) return res.status(401).json({ ok: false, error: 'Missing access token' });

  if (accessToken.startsWith('sa_')) {
    if (!superadminSessions.has(accessToken)) {
      return res.status(401).json({ ok: false, error: 'Invalid access token' });
    }
    req.authUser = {
      id: 'superadmin',
      email: null,
      role: ROLE_SUPERADMIN,
      user_metadata: { full_name: 'Superadmin' }
    };
    req.isSuperadmin = true;
    return next();
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) return res.status(401).json({ ok: false, error: 'Invalid access token' });

  req.authUser = data.user;
  return next();
};

const getMembership = async (profileId, establishmentId) => {
  if (profileId === 'superadmin') {
    return { role: ROLE_SUPERADMIN };
  }

  const { data, error } = await supabaseAdmin
    .from('establishment_members')
    .select('role')
    .eq('establishment_id', establishmentId)
    .eq('profile_id', profileId)
    .single();

  if (error || !data?.role) return null;
  return data;
};

const getAllowedDisciplineIds = async (role, profileId, establishmentId) => {
  if (role === ROLE_SUPERADMIN) {
    const { data, error } = await supabaseAdmin
      .from('establishment_disciplines')
      .select('discipline_id')
      .eq('establishment_id', establishmentId)
      .eq('is_active', true);
    if (error) throw new Error(error.message);
    return (data || []).map(r => r.discipline_id);
  }

  if (role === ROLE_INSTRUCTOR) {
    const { data, error } = await supabaseAdmin
      .from('instructor_disciplines')
      .select('discipline_id')
      .eq('establishment_id', establishmentId)
      .eq('instructor_profile_id', profileId);
    if (error) throw new Error(error.message);
    return (data || []).map(r => r.discipline_id);
  }

  const { data, error } = await supabaseAdmin
    .from('establishment_disciplines')
    .select('discipline_id')
    .eq('establishment_id', establishmentId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return (data || []).map(r => r.discipline_id);
};

const normalizeDisciplineToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const DISCIPLINE_CODE_ALIASES = {
  karate: 'karate',
  judo: 'judo',
  bjj: 'bjj',
  brazilian_jiu_jitsu: 'bjj',
  jiu_jitsu: 'bjj',
  jiujitsu: 'bjj',
  taekwondo: 'taekwondo',
  kickboxing: 'kickboxing',
  muay_thai: 'muay_thai',
  muaythai: 'muay_thai',
  boxing: 'boxing',
  boxeo: 'boxing',
  mma: 'mma',
  mixed_martial_arts: 'mma',
  artes_marciales_mixtas: 'mma',
  aikido: 'aikido',
  kendo: 'kendo'
};

const resolveCanonicalDisciplineCode = (value) => {
  const normalized = normalizeDisciplineToken(value);
  return DISCIPLINE_CODE_ALIASES[normalized] || normalized;
};

const resolveDisciplineByCode = async (establishmentId, disciplineCode) => {
  const requestedCode = resolveCanonicalDisciplineCode(disciplineCode);
  const { data, error } = await supabaseAdmin
    .from('establishment_disciplines')
    .select('discipline:disciplines(id, code, name), is_active')
    .eq('establishment_id', establishmentId)
    .eq('is_active', true);

  if (error) throw new Error(error.message);

  return (data || [])
    .map(row => row.discipline)
    .filter(Boolean)
    .find((d) => {
      const code = resolveCanonicalDisciplineCode(d.code);
      const name = resolveCanonicalDisciplineCode(d.name);
      return requestedCode === code || requestedCode === name;
    }) || null;
};

const isManagerRole = (role) => [ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN, ROLE_SUPERADMIN].includes(role);
const canCreateNotifications = (role) => [ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN, ROLE_INSTRUCTOR, ROLE_SUPERADMIN].includes(role);

const canAccessAdminPanel = (role) => [ROLE_OWNER, ROLE_SENSEI, ROLE_SUPERADMIN].includes(role);

const canCreateRole = (actorRole, targetRole) => {
  if (!targetRole || !MANAGEABLE_ROLES.includes(targetRole)) return false;
  if (actorRole === ROLE_SUPERADMIN) return [ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN, ROLE_INSTRUCTOR, ROLE_GUARDIAN, ROLE_STUDENT].includes(targetRole);
  if (actorRole === ROLE_OWNER || actorRole === ROLE_SENSEI) return [ROLE_INSTRUCTOR, ROLE_GUARDIAN, ROLE_STUDENT].includes(targetRole);
  return false;
};

const canManageRoleByHierarchy = (actorRole, targetRole) => {
  if (!targetRole || !MANAGEABLE_ROLES.includes(targetRole)) return false;
  if (actorRole === ROLE_SUPERADMIN) return true;
  if (actorRole === ROLE_OWNER || actorRole === ROLE_SENSEI) return [ROLE_INSTRUCTOR, ROLE_GUARDIAN, ROLE_STUDENT].includes(targetRole);
  return false;
};

const canModifyMemberRole = (actorRole, currentTargetRole, nextTargetRole) => {
  if (!canManageRoleByHierarchy(actorRole, currentTargetRole)) return false;
  if (!canManageRoleByHierarchy(actorRole, nextTargetRole)) return false;

  const actorRank = ROLE_HIERARCHY[actorRole] || 0;
  const currentRank = ROLE_HIERARCHY[currentTargetRole] || 0;
  const nextRank = ROLE_HIERARCHY[nextTargetRole] || 0;
  return actorRank > currentRank && actorRank > nextRank;
};

const resolveDisciplineFilter = async (establishmentId, disciplineCode, allowedDisciplineIds) => {
  if (!disciplineCode) return null;
  const discipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
  if (!discipline) throw new Error('Invalid disciplineCode');
  if (!allowedDisciplineIds.includes(discipline.id)) throw new Error('Discipline is not allowed for this user');
  return discipline;
};

const mapUsernameSchemaError = (message) => {
  const text = String(message || '');
  if (text.includes('profiles.username') || text.includes('auth_email')) {
    return 'Database is missing username auth columns. Run supabase/006_usernames_superadmin.sql';
  }
  return text;
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'MartialSystem', ts: new Date().toISOString() });
});

app.post('/api/upload/public', imageUpload.single('image'), (req, res) => {
  (async () => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: 'image file is required' });

      let uploaded;
      try {
        uploaded = await uploadImageToStorage(req.file, 'public');
      } catch (_) {
        uploaded = saveImageLocally(req.file);
      }

      return res.json({
        ok: true,
        data: {
          url: uploaded.url,
          bucket: uploaded.bucket,
          path: uploaded.path,
          size: req.file.size
        }
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'Could not upload image' });
    }
  })();
});

app.post('/api/upload', requireAuth, imageUpload.single('image'), (req, res) => {
  (async () => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: 'image file is required' });

      const folder = req.body?.folder ? String(req.body.folder) : 'private';
      let uploaded;
      try {
        uploaded = await uploadImageToStorage(req.file, folder);
      } catch (_) {
        uploaded = saveImageLocally(req.file);
      }

      return res.json({
        ok: true,
        data: {
          url: uploaded.url,
          bucket: uploaded.bucket,
          path: uploaded.path,
          size: req.file.size
        }
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'Could not upload image' });
    }
  })();
});

app.post('/api/onboarding', async (req, res) => {
  const {
    establishmentName,
    city,
    country,
    logoUrl,
    ownerFullName,
    ownerUsername,
    ownerPassword,
    disciplineCodes
  } = req.body || {};

  const normalizedOwnerUsername = normalizeUsername(ownerUsername);
  if (!establishmentName || !normalizedOwnerUsername || !ownerPassword || !ownerFullName) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const { data: existingOwnerProfile, error: ownerLookupError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', normalizedOwnerUsername)
    .maybeSingle();
  if (ownerLookupError) {
    return res.status(500).json({ ok: false, error: mapUsernameSchemaError(ownerLookupError.message) });
  }
  if (existingOwnerProfile?.id) {
    return res.status(400).json({ ok: false, error: 'ownerUsername is already in use' });
  }

  const ownerEmail = buildInternalEmail(normalizedOwnerUsername);

  const selectedCodes = Array.isArray(disciplineCodes) ? disciplineCodes.filter(Boolean) : [];
  if (selectedCodes.length === 0) {
    return res.status(400).json({ ok: false, error: 'Select at least one discipline' });
  }

  const created = { authUserId: null, establishmentId: null };

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { full_name: ownerFullName, username: normalizedOwnerUsername }
    });

    if (authError || !authData?.user?.id) {
      return res.status(500).json({ ok: false, error: authError?.message || 'Could not create auth user' });
    }
    created.authUserId = authData.user.id;

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: created.authUserId,
      full_name: ownerFullName,
      role: ROLE_OWNER,
      username: normalizedOwnerUsername,
      auth_email: ownerEmail,
      is_active: true
    });
    if (profileError) throw new Error(profileError.message);

    const { data: estData, error: estError } = await supabaseAdmin
      .from('establishments')
      .insert({ name: establishmentName, city: city || null, country: country || null, logo_url: logoUrl || null, is_active: true })
      .select('id')
      .single();

    if (estError || !estData?.id) throw new Error(estError?.message || 'Could not create establishment');
    created.establishmentId = estData.id;

    const { error: memberError } = await supabaseAdmin.from('establishment_members').insert({
      establishment_id: created.establishmentId,
      profile_id: created.authUserId,
      role: ROLE_OWNER
    });
    if (memberError) throw new Error(memberError.message);

    const { data: disciplines, error: discError } = await supabaseAdmin
      .from('disciplines')
      .select('id, code, name')
      .in('code', selectedCodes);
    if (discError) throw new Error(discError.message);

    if (!disciplines || disciplines.length === 0) {
      throw new Error('No discipline codes matched existing disciplines');
    }

    const edRows = disciplines.map((d) => ({
      establishment_id: created.establishmentId,
      discipline_id: d.id,
      is_active: true
    }));
    const { error: edError } = await supabaseAdmin.from('establishment_disciplines').insert(edRows);
    if (edError) throw new Error(edError.message);

    const configRows = disciplines.map((d) => ({
      establishment_id: created.establishmentId,
      discipline_id: d.id,
      config: defaultTreeForDiscipline(d.name)
    }));
    const { error: cfgError } = await supabaseAdmin.from('discipline_configs').upsert(configRows, {
      onConflict: 'establishment_id,discipline_id'
    });
    if (cfgError) throw new Error(cfgError.message);

    return res.json({
      ok: true,
      data: {
        establishmentId: created.establishmentId,
        ownerUserId: created.authUserId,
        disciplines: disciplines.map(d => ({ code: d.code, name: d.name }))
      }
    });
  } catch (err) {
    if (created.establishmentId) {
      await supabaseAdmin.from('establishments').delete().eq('id', created.establishmentId);
    }
    if (created.authUserId) {
      await supabaseAdmin.auth.admin.deleteUser(created.authUserId);
    }
    return res.status(500).json({ ok: false, error: mapUsernameSchemaError(err.message) || 'Onboarding failed' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required' });
  }

  if (normalizedUsername === SUPERADMIN_USERNAME && password === SUPERADMIN_PASSWORD) {
    const accessToken = createSuperadminToken();
    superadminSessions.add(accessToken);
    return res.json({
      ok: true,
      data: {
        access_token: accessToken,
        refresh_token: null,
        user: {
          id: 'superadmin',
          username: SUPERADMIN_USERNAME,
          role: ROLE_SUPERADMIN,
          full_name: 'Superadmin'
        }
      }
    });
  }

  const { data: profileByUsername, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, username, auth_email')
    .eq('username', normalizedUsername)
    .maybeSingle();
  if (profileError) return res.status(500).json({ ok: false, error: mapUsernameSchemaError(profileError.message) });
  if (!profileByUsername?.auth_email) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

  const { data, error } = await supabasePublic.auth.signInWithPassword({ email: profileByUsername.auth_email, password });
  if (error || !data?.session?.access_token || !data?.user?.id) {
    return res.status(401).json({ ok: false, error: error?.message || 'Invalid credentials' });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, is_active, username')
    .eq('id', data.user.id)
    .single();

  return res.json({
    ok: true,
    data: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        username: profile?.username || normalizedUsername,
        role: profile?.role || null,
        full_name: profile?.full_name || data.user.user_metadata?.full_name || ''
      }
    }
  });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;

  if (req.isSuperadmin) {
    const { data: establishments, error } = await supabaseAdmin
      .from('establishments')
      .select('id, name, city, country, is_active')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ ok: false, error: error.message });

    const memberships = (establishments || []).map(est => ({
      id: `sa-${est.id}`,
      role: ROLE_SUPERADMIN,
      establishment: est
    }));

    return res.json({
      ok: true,
      data: {
        profile: {
          id: 'superadmin',
          full_name: 'Superadmin',
          role: ROLE_SUPERADMIN,
          username: SUPERADMIN_USERNAME,
          is_active: true
        },
        memberships,
        modulePermissions: (memberships || []).reduce((acc, m) => {
          const estId = m?.establishment?.id;
          if (!estId) return acc;
          acc[estId] = getRoleModulesByEstablishment(estId, ROLE_SUPERADMIN);
          return acc;
        }, {})
      }
    });
  }

  const [{ data: profile }, { data: memberships, error: membershipsError }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, full_name, role, is_active, username').eq('id', profileId).single(),
    supabaseAdmin
      .from('establishment_members')
      .select('id, role, establishment:establishments(id, name, city, country, is_active)')
      .eq('profile_id', profileId)
  ]);

  if (membershipsError) {
    return res.status(500).json({ ok: false, error: membershipsError.message });
  }

  const modulePermissions = (memberships || []).reduce((acc, m) => {
    const estId = m?.establishment?.id;
    if (!estId || !m?.role) return acc;
    acc[estId] = getRoleModulesByEstablishment(estId, m.role);
    return acc;
  }, {});

  return res.json({ ok: true, data: { profile, memberships: memberships || [], modulePermissions } });
});

app.get('/api/tree', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  const membership = await getMembership(profileId, establishmentId);
  if (!membership?.role) {
    return res.status(403).json({ ok: false, error: 'No access to this establishment' });
  }

  let allowedDisciplineIds = [];
  try {
    allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }

  if (allowedDisciplineIds.length === 0) {
    return res.json({ ok: true, data: { role: membership.role, disciplines: [] } });
  }

  const [{ data: disciplines, error: disciplinesError }, { data: configs, error: configsError }] = await Promise.all([
    supabaseAdmin
      .from('disciplines')
      .select('id, code, name')
      .in('id', allowedDisciplineIds)
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('discipline_configs')
      .select('discipline_id, config')
      .eq('establishment_id', establishmentId)
      .in('discipline_id', allowedDisciplineIds)
  ]);

  if (disciplinesError) return res.status(500).json({ ok: false, error: disciplinesError.message });
  if (configsError) return res.status(500).json({ ok: false, error: configsError.message });

  const configMap = new Map((configs || []).map(c => [c.discipline_id, c.config || {}]));

  return res.json({
    ok: true,
    data: {
      role: membership.role,
      disciplines: (disciplines || []).map(d => ({
        id: d.id,
        code: d.code,
        name: d.name,
        tree: configMap.get(d.id)?.modules ? configMap.get(d.id) : defaultTreeForDiscipline(d.name)
      }))
    }
  });
});

app.post('/api/instructors', requireAuth, async (req, res) => {
  const requesterId = req.authUser.id;
  const {
    establishmentId,
    fullName,
    username,
    password,
    disciplineCodes,
    senseiProfileId
  } = req.body || {};

  const normalizedUsername = normalizeUsername(username);

  if (!establishmentId || !fullName || !normalizedUsername || !password) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const requesterMembership = await getMembership(requesterId, establishmentId);
  if (!requesterMembership?.role) {
    return res.status(403).json({ ok: false, error: 'No access to this establishment' });
  }

  if (![ROLE_SUPERADMIN, ROLE_OWNER, ROLE_SENSEI].includes(requesterMembership.role)) {
    return res.status(403).json({ ok: false, error: 'Only superadmin/owner/sensei can create instructors' });
  }

  const { data: existingInstructorProfile, error: instructorLookupError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', normalizedUsername)
    .maybeSingle();
  if (instructorLookupError) {
    return res.status(500).json({ ok: false, error: mapUsernameSchemaError(instructorLookupError.message) });
  }
  if (existingInstructorProfile?.id) {
    return res.status(400).json({ ok: false, error: 'username is already in use' });
  }

  const email = buildInternalEmail(normalizedUsername);

  const codes = Array.isArray(disciplineCodes) ? disciplineCodes.filter(Boolean) : [];
  if (codes.length === 0) {
    return res.status(400).json({ ok: false, error: 'Select at least one discipline code' });
  }

  const created = { authUserId: null };
  let assignedSensei = null;

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, username: normalizedUsername }
    });
    if (authError || !authData?.user?.id) {
      return res.status(500).json({ ok: false, error: authError?.message || 'Could not create instructor user' });
    }

    created.authUserId = authData.user.id;

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: created.authUserId,
      full_name: fullName,
      role: ROLE_INSTRUCTOR,
      username: normalizedUsername,
      auth_email: email,
      is_active: true
    });
    if (profileError) throw new Error(profileError.message);

    const { error: memberError } = await supabaseAdmin.from('establishment_members').insert({
      establishment_id: establishmentId,
      profile_id: created.authUserId,
      role: ROLE_INSTRUCTOR
    });
    if (memberError) throw new Error(memberError.message);

    const { data: eligibleDisciplines, error: eligibleError } = await supabaseAdmin
      .from('establishment_disciplines')
      .select('discipline:disciplines(id, code, name)')
      .eq('establishment_id', establishmentId)
      .eq('is_active', true);
    if (eligibleError) throw new Error(eligibleError.message);

    const eligibleByCode = new Map(
      (eligibleDisciplines || [])
        .map(row => row.discipline)
        .filter(Boolean)
        .map(d => [d.code, d])
    );

    const selectedDisciplines = codes.map(code => eligibleByCode.get(code)).filter(Boolean);
    if (selectedDisciplines.length === 0) {
      throw new Error('None of the requested discipline codes are active in this establishment');
    }

    const instructorRows = selectedDisciplines.map(d => ({
      establishment_id: establishmentId,
      discipline_id: d.id,
      instructor_profile_id: created.authUserId
    }));
    const { error: instructorDiscError } = await supabaseAdmin.from('instructor_disciplines').insert(instructorRows);
    if (instructorDiscError) throw new Error(instructorDiscError.message);

    if (requesterMembership.role === ROLE_SENSEI) {
      assignedSensei = requesterId;
    } else {
      if (!senseiProfileId) throw new Error('senseiProfileId is required');
      const { data: senseiMember, error: senseiErr } = await supabaseAdmin
        .from('establishment_members')
        .select('profile_id, role')
        .eq('establishment_id', establishmentId)
        .eq('profile_id', senseiProfileId)
        .single();
      if (senseiErr || !senseiMember?.profile_id || senseiMember.role !== ROLE_SENSEI) {
        throw new Error('senseiProfileId must belong to a sensei in this establishment');
      }
      assignedSensei = senseiMember.profile_id;
    }
    setSenseiForInstructor(establishmentId, created.authUserId, assignedSensei);

    return res.json({
      ok: true,
      data: {
        instructorId: created.authUserId,
        username: normalizedUsername,
        senseiProfileId: assignedSensei,
        disciplines: selectedDisciplines.map(d => ({ code: d.code, name: d.name }))
      }
    });
  } catch (err) {
    if (created.authUserId) {
      await supabaseAdmin.auth.admin.deleteUser(created.authUserId);
    }
    return res.status(500).json({ ok: false, error: mapUsernameSchemaError(err.message) || 'Could not create instructor' });
  }
});

app.get('/api/admin/members', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;

  if (!establishmentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  }

  try {
    const requesterMembership = await getMembership(profileId, establishmentId);
    if (!requesterMembership?.role) {
      return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    }
    if (!canAccessAdminPanel(requesterMembership.role)) {
      return res.status(403).json({ ok: false, error: 'No permission for administrative module' });
    }

    const { data: members, error: membersError } = await supabaseAdmin
      .from('establishment_members')
      .select('id, role, profile_id, profile:profiles(id, full_name, username, role, is_active)')
      .eq('establishment_id', establishmentId)
      .order('created_at', { ascending: false });
    if (membersError) throw new Error(membersError.message);

    const { data: instructorRows, error: instructorRowsError } = await supabaseAdmin
      .from('instructor_disciplines')
      .select('instructor_profile_id, discipline:disciplines(code, name)')
      .eq('establishment_id', establishmentId);
    if (instructorRowsError) throw new Error(instructorRowsError.message);

    const disciplinesByInstructor = new Map();
    (instructorRows || []).forEach((row) => {
      const d = row.discipline;
      if (!d?.code) return;
      const list = disciplinesByInstructor.get(row.instructor_profile_id) || [];
      list.push({ code: d.code, name: d.name || d.code });
      disciplinesByInstructor.set(row.instructor_profile_id, list);
    });

    let scopedMembers = members || [];
    if (requesterMembership.role === ROLE_SENSEI) {
      scopedMembers = scopedMembers.filter((m) => {
        if (m.profile_id === profileId) return true;
        if (m.role === ROLE_INSTRUCTOR) {
          return getSenseiForInstructor(establishmentId, m.profile_id) === profileId;
        }
        return false;
      });
    }

    const data = scopedMembers.map((m) => ({
      membershipId: m.id,
      profileId: m.profile_id,
      membershipRole: m.role,
      profile: m.profile || null,
      disciplines: m.role === ROLE_INSTRUCTOR ? (disciplinesByInstructor.get(m.profile_id) || []) : [],
      senseiProfileId: m.role === ROLE_INSTRUCTOR ? getSenseiForInstructor(establishmentId, m.profile_id) : null
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load admin members' });
  }
});

app.post('/api/admin/users', requireAuth, async (req, res) => {
  const requesterId = req.authUser.id;
  const {
    establishmentId,
    fullName,
    username,
    password,
    role,
    disciplineCodes,
    senseiProfileId
  } = req.body || {};

  const normalizedUsername = normalizeUsername(username);
  const targetRole = String(role || '').trim();

  if (!establishmentId || !fullName || !normalizedUsername || !password || !targetRole) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  try {
    const requesterMembership = await getMembership(requesterId, establishmentId);
    if (!requesterMembership?.role) {
      return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    }
    if (!canAccessAdminPanel(requesterMembership.role)) {
      return res.status(403).json({ ok: false, error: 'No permission for administrative module' });
    }
    if (!canCreateRole(requesterMembership.role, targetRole)) {
      return res.status(403).json({ ok: false, error: `Role ${requesterMembership.role} cannot create users with role ${targetRole}` });
    }

    const { data: existingProfile, error: lookupError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('username', normalizedUsername)
      .maybeSingle();
    if (lookupError) {
      return res.status(500).json({ ok: false, error: mapUsernameSchemaError(lookupError.message) });
    }
    if (existingProfile?.id) {
      return res.status(400).json({ ok: false, error: 'username is already in use' });
    }

    const email = buildInternalEmail(normalizedUsername);
    const created = { authUserId: null };

    try {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, username: normalizedUsername }
      });
      if (authError || !authData?.user?.id) {
        return res.status(500).json({ ok: false, error: authError?.message || 'Could not create user' });
      }

      created.authUserId = authData.user.id;

      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: created.authUserId,
        full_name: fullName,
        role: targetRole,
        username: normalizedUsername,
        auth_email: email,
        is_active: true
      });
      if (profileError) throw new Error(profileError.message);

      const { error: memberError } = await supabaseAdmin.from('establishment_members').insert({
        establishment_id: establishmentId,
        profile_id: created.authUserId,
        role: targetRole
      });
      if (memberError) throw new Error(memberError.message);

      let assignedDisciplines = [];
      let assignedSensei = null;
      if (targetRole === ROLE_INSTRUCTOR) {
        const codes = Array.isArray(disciplineCodes) ? disciplineCodes.filter(Boolean) : [];
        if (codes.length === 0) throw new Error('disciplineCodes are required for instructor role');

        if (requesterMembership.role === ROLE_SENSEI) {
          assignedSensei = requesterId;
        } else if (requesterMembership.role === ROLE_SUPERADMIN || requesterMembership.role === ROLE_OWNER) {
          if (!senseiProfileId) throw new Error('senseiProfileId is required when creating instructor from superadmin/owner');
          const { data: senseiMember, error: senseiErr } = await supabaseAdmin
            .from('establishment_members')
            .select('profile_id, role')
            .eq('establishment_id', establishmentId)
            .eq('profile_id', senseiProfileId)
            .single();
          if (senseiErr || !senseiMember?.profile_id || senseiMember.role !== ROLE_SENSEI) {
            throw new Error('senseiProfileId must belong to a sensei in this establishment');
          }
          assignedSensei = senseiMember.profile_id;
        }

        const { data: eligibleDisciplines, error: eligibleError } = await supabaseAdmin
          .from('establishment_disciplines')
          .select('discipline:disciplines(id, code, name)')
          .eq('establishment_id', establishmentId)
          .eq('is_active', true);
        if (eligibleError) throw new Error(eligibleError.message);

        const byCode = new Map(
          (eligibleDisciplines || [])
            .map(row => row.discipline)
            .filter(Boolean)
            .map(d => [d.code, d])
        );
        assignedDisciplines = codes.map(code => byCode.get(code)).filter(Boolean);
        if (assignedDisciplines.length === 0) {
          throw new Error('None of the requested discipline codes are active in this establishment');
        }

        const instructorRows = assignedDisciplines.map(d => ({
          establishment_id: establishmentId,
          discipline_id: d.id,
          instructor_profile_id: created.authUserId
        }));
        const { error: instructorDiscError } = await supabaseAdmin.from('instructor_disciplines').insert(instructorRows);
        if (instructorDiscError) throw new Error(instructorDiscError.message);

        if (assignedSensei) {
          setSenseiForInstructor(establishmentId, created.authUserId, assignedSensei);
        }
      }

      return res.status(201).json({
        ok: true,
        data: {
          profileId: created.authUserId,
          username: normalizedUsername,
          role: targetRole,
          senseiProfileId: assignedSensei,
          disciplines: assignedDisciplines.map(d => ({ code: d.code, name: d.name }))
        }
      });
    } catch (innerErr) {
      if (created.authUserId) {
        await supabaseAdmin.auth.admin.deleteUser(created.authUserId);
      }
      throw innerErr;
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: mapUsernameSchemaError(err.message) || 'Could not create user' });
  }
});

app.patch('/api/admin/members/:membershipId', requireAuth, async (req, res) => {
  const requesterId = req.authUser.id;
  const { membershipId } = req.params;
  const {
    establishmentId,
    newRole,
    isActive,
    disciplineCodes
  } = req.body || {};

  if (!establishmentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  }

  try {
    const requesterMembership = await getMembership(requesterId, establishmentId);
    if (!requesterMembership?.role) {
      return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    }
    if (!canAccessAdminPanel(requesterMembership.role)) {
      return res.status(403).json({ ok: false, error: 'No permission for administrative module' });
    }

    const { data: targetMembership, error: targetMembershipError } = await supabaseAdmin
      .from('establishment_members')
      .select('id, profile_id, role')
      .eq('id', membershipId)
      .eq('establishment_id', establishmentId)
      .single();
    if (targetMembershipError || !targetMembership?.id) {
      return res.status(404).json({ ok: false, error: 'Membership not found' });
    }

    if (targetMembership.profile_id === requesterId && newRole && newRole !== targetMembership.role) {
      return res.status(400).json({ ok: false, error: 'Cannot change your own role' });
    }

    let finalRole = targetMembership.role;
    if (newRole && newRole !== targetMembership.role) {
      if (!canModifyMemberRole(requesterMembership.role, targetMembership.role, newRole)) {
        return res.status(403).json({ ok: false, error: 'Role hierarchy prevents this role change' });
      }

      const { error: memberRoleError } = await supabaseAdmin
        .from('establishment_members')
        .update({ role: newRole })
        .eq('id', membershipId)
        .eq('establishment_id', establishmentId);
      if (memberRoleError) throw new Error(memberRoleError.message);

      const { error: profileRoleError } = await supabaseAdmin
        .from('profiles')
        .update({ role: newRole })
        .eq('id', targetMembership.profile_id);
      if (profileRoleError) throw new Error(profileRoleError.message);

      finalRole = newRole;
    }

    if (typeof isActive === 'boolean') {
      if (!canManageRoleByHierarchy(requesterMembership.role, finalRole)) {
        return res.status(403).json({ ok: false, error: 'Role hierarchy prevents status update for this user' });
      }
      const { error: statusError } = await supabaseAdmin
        .from('profiles')
        .update({ is_active: isActive })
        .eq('id', targetMembership.profile_id);
      if (statusError) throw new Error(statusError.message);
    }

    if (finalRole === ROLE_INSTRUCTOR && Array.isArray(disciplineCodes)) {
      const codes = disciplineCodes.filter(Boolean);

      const { data: eligibleDisciplines, error: eligibleError } = await supabaseAdmin
        .from('establishment_disciplines')
        .select('discipline:disciplines(id, code, name)')
        .eq('establishment_id', establishmentId)
        .eq('is_active', true);
      if (eligibleError) throw new Error(eligibleError.message);

      const byCode = new Map(
        (eligibleDisciplines || [])
          .map(row => row.discipline)
          .filter(Boolean)
          .map(d => [d.code, d])
      );
      const selected = codes.map(code => byCode.get(code)).filter(Boolean);

      await supabaseAdmin
        .from('instructor_disciplines')
        .delete()
        .eq('establishment_id', establishmentId)
        .eq('instructor_profile_id', targetMembership.profile_id);

      if (selected.length > 0) {
        const rows = selected.map(d => ({
          establishment_id: establishmentId,
          discipline_id: d.id,
          instructor_profile_id: targetMembership.profile_id
        }));
        const { error: insError } = await supabaseAdmin.from('instructor_disciplines').insert(rows);
        if (insError) throw new Error(insError.message);
      }
    }

    return res.json({ ok: true, data: { membershipId, role: finalRole } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not update admin member' });
  }
});

app.get('/api/students', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;

  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    let targetDiscipline = null;
    if (disciplineCode) {
      targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
      if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });
    }

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const filteredDisciplineIds = targetDiscipline
      ? allowedDisciplineIds.filter(id => id === targetDiscipline.id)
      : allowedDisciplineIds;

    const { data: students, error: studentsError } = await supabaseAdmin
      .from('students')
      .select('id, full_name, email, phone, birth_date, profile_id, establishment_id, created_at')
      .eq('establishment_id', establishmentId)
      .order('full_name', { ascending: true });
    if (studentsError) throw new Error(studentsError.message);

    const studentIds = [...new Set((students || []).map(s => s.id).filter(Boolean))];

    const { data: enrollments, error: enrollmentsError } = studentIds.length > 0
      ? await supabaseAdmin
          .from('student_enrollments')
          .select('id, student_id, discipline_id, instructor_profile_id, current_rank, joined_at, status')
          .in('student_id', studentIds)
          .order('joined_at', { ascending: false })
      : { data: [], error: null };
    if (enrollmentsError) throw new Error(enrollmentsError.message);

    const scopedEnrollments = (enrollments || []).filter((e) => {
      if (!filteredDisciplineIds.length) return !targetDiscipline;
      return filteredDisciplineIds.includes(e.discipline_id);
    });

    const disciplineIds = [...new Set(scopedEnrollments.map(e => e.discipline_id).filter(Boolean))];
    const instructorIds = [...new Set(scopedEnrollments.map(e => e.instructor_profile_id).filter(Boolean))];

    const [{ data: disciplines }, { data: instructors }] = await Promise.all([
      disciplineIds.length > 0
        ? supabaseAdmin.from('disciplines').select('id, code, name').in('id', disciplineIds)
        : Promise.resolve({ data: [] }),
      instructorIds.length > 0
        ? supabaseAdmin.from('profiles').select('id, full_name').in('id', instructorIds)
        : Promise.resolve({ data: [] })
    ]);

    const studentMap = new Map((students || []).map(s => [s.id, s]));
    const disciplineMap = new Map((disciplines || []).map(d => [d.id, d]));
    const instructorMap = new Map((instructors || []).map(i => [i.id, i]));
    const enrollmentByStudent = new Map();
    scopedEnrollments.forEach((e) => {
      if (!e?.student_id || enrollmentByStudent.has(e.student_id)) return;
      enrollmentByStudent.set(e.student_id, e);
    });

    let allowedStudentIds = null;
    if (membership.role === ROLE_INSTRUCTOR) {
      allowedStudentIds = new Set(
        (scopedEnrollments || [])
          .filter(e => {
            if (e.instructor_profile_id === profileId) return true;
            const links = getStudentInstructorLinks(establishmentId, e.student_id);
            return links.includes(profileId);
          })
          .map(e => e.student_id)
      );
      (students || []).forEach((s) => {
        const links = getStudentInstructorLinks(establishmentId, s.id);
        if (links.includes(profileId)) allowedStudentIds.add(s.id);
      });
    } else if (membership.role === ROLE_GUARDIAN) {
      const { data: links, error: linksError } = await supabaseAdmin
        .from('guardian_students')
        .select('student_id')
        .eq('establishment_id', establishmentId)
        .eq('guardian_profile_id', profileId);
      if (linksError) throw new Error(linksError.message);
      allowedStudentIds = new Set((links || []).map(l => l.student_id));
    } else if (membership.role === ROLE_STUDENT) {
      const ownStudent = (students || []).find((s) => s.profile_id === profileId);
      if (!ownStudent?.id) return res.json({ ok: true, data: [] });
      allowedStudentIds = new Set([ownStudent.id]);
    }

    const data = (students || []).map((student) => {
      const e = enrollmentByStudent.get(student.id) || null;
      return {
        enrollmentId: e?.id || null,
        student,
        discipline: e?.discipline_id ? (disciplineMap.get(e.discipline_id) || null) : null,
        instructor: e?.instructor_profile_id ? (instructorMap.get(e.instructor_profile_id) || null) : null,
        instructorProfileIds: getStudentInstructorLinks(establishmentId, student.id),
        photo_url: getStudentPhoto(establishmentId, student.id) || null,
        current_rank: e?.current_rank || null,
        joined_at: e?.joined_at || null,
        status: e?.status || 'active'
      };
    }).filter((r) => {
      if (!r.student) return false;
      if (targetDiscipline) {
        const code = String(r?.discipline?.code || '').toLowerCase();
        if (!code || code !== String(targetDiscipline.code || '').toLowerCase()) return false;
      }
      if (allowedStudentIds && !allowedStudentIds.has(r.student.id)) return false;
      return true;
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load students' });
  }
});

app.post('/api/students', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const {
    establishmentId,
    dojoId,
    disciplineCode,
    fullName,
    email,
    phone,
    birthDate,
    photoUrl,
    currentRank,
    instructorProfileId,
    instructorProfileIds,
    tutorProfileId
  } = req.body || {};

  if (!establishmentId || !disciplineCode || !fullName) {
    return res.status(400).json({ ok: false, error: 'establishmentId, disciplineCode and fullName are required' });
  }

  if (dojoId && dojoId !== establishmentId) {
    return res.status(400).json({ ok: false, error: 'dojoId must match establishmentId in this version' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
    if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    if (!allowedDisciplineIds.includes(targetDiscipline.id)) {
      return res.status(403).json({ ok: false, error: 'Discipline is not allowed for this user' });
    }

    let assignedInstructorIds = [];
    if (membership.role === ROLE_INSTRUCTOR) {
      assignedInstructorIds = [profileId];
    } else {
      assignedInstructorIds = [
        ...(Array.isArray(instructorProfileIds) ? instructorProfileIds : []),
        ...(instructorProfileId ? [instructorProfileId] : [])
      ].map(String).filter(Boolean);
    }

    if (assignedInstructorIds.length > 0) {
      const { data: instructorMembers, error: instructorsError } = await supabaseAdmin
        .from('establishment_members')
        .select('profile_id, role')
        .eq('establishment_id', establishmentId)
        .in('profile_id', assignedInstructorIds);
      if (instructorsError) throw new Error(instructorsError.message);
      const validInstructorIds = (instructorMembers || []).filter(m => m.role === ROLE_INSTRUCTOR).map(m => m.profile_id);
      assignedInstructorIds = assignedInstructorIds.filter(id => validInstructorIds.includes(id));
    }

    if (assignedInstructorIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'At least one valid instructor is required for the student' });
    }

    const { data: student, error: studentError } = await supabaseAdmin
      .from('students')
      .insert({
        establishment_id: establishmentId,
        full_name: fullName,
        email: email || null,
        phone: phone || null,
        birth_date: birthDate || null
      })
      .select('id, full_name, email, phone, birth_date')
      .single();
    if (studentError) throw new Error(studentError.message);

    const { data: enrollment, error: enrollmentError } = await supabaseAdmin
      .from('student_enrollments')
      .insert({
        student_id: student.id,
        discipline_id: targetDiscipline.id,
        instructor_profile_id: assignedInstructorIds[0] || null,
        current_rank: currentRank || null,
        status: 'active'
      })
      .select('id, current_rank, status, joined_at')
      .single();
    if (enrollmentError) throw new Error(enrollmentError.message);

    if (assignedInstructorIds.length > 0) {
      upsertStudentInstructorLinks(establishmentId, student.id, assignedInstructorIds);
    }

    if (photoUrl && !student?.photo_url) {
      setStudentPhoto(establishmentId, student.id, photoUrl);
    }

    if (tutorProfileId) {
      const { data: tutorMember, error: tutorMemberError } = await supabaseAdmin
        .from('establishment_members')
        .select('profile_id, role')
        .eq('establishment_id', establishmentId)
        .eq('profile_id', tutorProfileId)
        .single();
      if (tutorMemberError || tutorMember?.role !== ROLE_GUARDIAN) {
        return res.status(400).json({ ok: false, error: 'tutorProfileId must belong to a guardian in this establishment' });
      }

      const { data: existingTutor, error: existingTutorError } = await supabaseAdmin
        .from('guardian_students')
        .select('guardian_profile_id')
        .eq('establishment_id', establishmentId)
        .eq('student_id', student.id)
        .maybeSingle();
      if (existingTutorError) throw new Error(existingTutorError.message);
      if (existingTutor?.guardian_profile_id && existingTutor.guardian_profile_id !== tutorProfileId) {
        return res.status(400).json({ ok: false, error: 'This student already has a tutor linked' });
      }

      const { error: tutorLinkError } = await supabaseAdmin
        .from('guardian_students')
        .upsert({
          establishment_id: establishmentId,
          guardian_profile_id: tutorProfileId,
          student_id: student.id,
          relationship: 'tutor'
        }, {
          onConflict: 'establishment_id,guardian_profile_id,student_id'
        });
      if (tutorLinkError) throw new Error(tutorLinkError.message);
    }

    return res.json({
      ok: true,
      data: {
        enrollmentId: enrollment.id,
        student,
        discipline: targetDiscipline,
        dojoId: establishmentId,
        instructorProfileIds: assignedInstructorIds,
        tutorProfileId: tutorProfileId || null,
        photo_url: photoUrl || null,
        current_rank: enrollment.current_rank,
        status: enrollment.status,
        joined_at: enrollment.joined_at
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create student' });
  }
});

// GET /api/instructors - List all instructors in establishment with their disciplines
app.get('/api/instructors', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;

  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    // Get all instructor members
    const { data: members, error: membersError } = await supabaseAdmin
      .from('establishment_members')
      .select('id, profile_id, role, created_at')
      .eq('establishment_id', establishmentId)
      .eq('role', ROLE_INSTRUCTOR)
      .order('created_at', { ascending: false });
    if (membersError) throw new Error(membersError.message);

    const instructorIds = (members || []).map(m => m.profile_id).filter(Boolean);

    // Get profile info for all instructors
    const { data: profiles, error: profilesError } = instructorIds.length > 0
      ? await supabaseAdmin.from('profiles').select('id, full_name, is_active').in('id', instructorIds)
      : { data: [], error: null };
    if (profilesError) throw new Error(profilesError.message);

    // Get disciplines for all instructors
    const { data: instructorDisciplines, error: discError } = await supabaseAdmin
      .from('instructor_disciplines')
      .select('instructor_profile_id, discipline:disciplines(id, code, name)')
      .eq('establishment_id', establishmentId)
      .in('instructor_profile_id', instructorIds);
    if (discError) throw new Error(discError.message);

    // Get establishment disciplines to find academies
    const { data: establDisciplines, error: establDiscError } = await supabaseAdmin
      .from('establishment_disciplines')
      .select('discipline_id, establishment:establishments(id, name)')
      .eq('establishment_id', establishmentId);
    if (establDiscError) throw new Error(establDiscError.message);

    const disciplinesByInstructor = new Map();
    const academiesByInstructor = new Map();
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    const establByDiscId = new Map((establDisciplines || []).map(ed => [ed.discipline_id, ed.establishment]));

    (instructorDisciplines || []).forEach((row) => {
      const d = row.discipline;
      if (!d?.code) return;
      const list = disciplinesByInstructor.get(row.instructor_profile_id) || [];
      list.push({ code: d.code, name: d.name || d.code });
      disciplinesByInstructor.set(row.instructor_profile_id, list);

      // Track academies
      const acadList = academiesByInstructor.get(row.instructor_profile_id) || new Set();
      const acad = establByDiscId.get(d.id);
      if (acad?.name) acadList.add(acad.name);
      academiesByInstructor.set(row.instructor_profile_id, acadList);
    });

    // Filter by role (sensei sees only their instructors, others see all)
    let scopedInstructorIds = instructorIds;
    if (membership.role === ROLE_SENSEI) {
      scopedInstructorIds = instructorIds.filter(iId => getSenseiForInstructor(establishmentId, iId) === profileId || iId === profileId);
    } else if (membership.role === ROLE_INSTRUCTOR) {
      scopedInstructorIds = [profileId];
    }

    const data = scopedInstructorIds.map((instId) => {
      const profile = profileMap.get(instId);
      if (!profile) return null;
      return {
        profileId: instId,
        name: profile.full_name || '-',
        email: profile.email || '-',
        phone: '-', // TODO: Add phone field to profiles if needed
        disciplines: disciplinesByInstructor.get(instId) || [],
        academies: Array.from(academiesByInstructor.get(instId) || []),
        status: profile.is_active ? 'Activo' : 'Inactivo',
        role_level: 'Instructor',
        created_at: members.find(m => m.profile_id === instId)?.created_at || null,
        photo_url: null // TODO: Add photo support if needed
      };
    }).filter(Boolean);

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load instructors' });
  }
});

// GET /api/guardians - List all guardians in establishment with linked students
app.get('/api/guardians', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;

  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    // Get all guardian members
    const { data: members, error: membersError } = await supabaseAdmin
      .from('establishment_members')
      .select('id, profile_id, role, created_at')
      .eq('establishment_id', establishmentId)
      .eq('role', ROLE_GUARDIAN)
      .order('created_at', { ascending: false });
    if (membersError) throw new Error(membersError.message);

    const guardianIds = (members || []).map(m => m.profile_id).filter(Boolean);

    // Get profile info for all guardians
    const { data: profiles, error: profilesError } = guardianIds.length > 0
      ? await supabaseAdmin.from('profiles').select('id, full_name, is_active').in('id', guardianIds)
      : { data: [], error: null };
    if (profilesError) throw new Error(profilesError.message);

    // Get linked students for each guardian
    const { data: guardianLinks, error: linksError } = guardianIds.length > 0
      ? await supabaseAdmin
          .from('guardian_students')
          .select('guardian_profile_id, student_id, relationship, student:students(id, full_name, establishment_id)')
          .eq('establishment_id', establishmentId)
          .in('guardian_profile_id', guardianIds)
      : { data: [], error: null };
    if (linksError) throw new Error(linksError.message);

    // Get academies for students
    const studentIds = (guardianLinks || []).map(l => l.student_id).filter(Boolean);
    const { data: studentEstabs, error: studentEstabsError } = studentIds.length > 0
      ? await supabaseAdmin.from('students').select('id, establishment_id').in('id', studentIds)
      : { data: [], error: null };
    if (studentEstabsError) throw new Error(studentEstabsError.message);

    const { data: establs, error: establsError } = await supabaseAdmin.from('establishments').select('id, name');
    if (establsError) throw new Error(establsError.message);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    const establMap = new Map((establs || []).map(e => [e.id, e.name]));
    const linkedByGuardian = new Map();
    const acadsByGuardian = new Map();
    const relationshipByGuardian = new Map();

    (guardianLinks || []).forEach((link) => {
      const gId = link.guardian_profile_id;
      const list = linkedByGuardian.get(gId) || [];
      list.push({ id: link.student_id, name: link.student?.full_name || '-' });
      linkedByGuardian.set(gId, list);

      // Track academies
      const acadList = acadsByGuardian.get(gId) || new Set();
      const estabId = link.student?.establishment_id;
      const estabName = estabId ? establMap.get(estabId) : null;
      if (estabName) acadList.add(estabName);
      acadsByGuardian.set(gId, acadList);

      // Track relationship
      if (link.relationship && !relationshipByGuardian.has(gId)) {
        relationshipByGuardian.set(gId, link.relationship);
      }
    });

    // Filter by role (guardian sees only self)
    let scopedGuardianIds = guardianIds;
    if (membership.role === ROLE_GUARDIAN) {
      scopedGuardianIds = [profileId];
    }

    const data = scopedGuardianIds.map((guardId) => {
      const profile = profileMap.get(guardId);
      if (!profile) return null;
      const linkedStudents = linkedByGuardian.get(guardId) || [];
      return {
        profileId: guardId,
        name: profile.full_name || '-',
        email: profile.email || '-',
        phone: '-', // TODO: Add phone field to profiles if needed
        linkedStudents: linkedStudents,
        linkedStudentCount: linkedStudents.length,
        academies: Array.from(acadsByGuardian.get(guardId) || []),
        status: profile.is_active ? 'Activo' : 'Inactivo',
        relationship: relationshipByGuardian.get(guardId) || '-',
        created_at: members.find(m => m.profile_id === guardId)?.created_at || null,
        notes: '-', // TODO: Add notes field if needed
        photo_url: null // TODO: Add photo support if needed
      };
    }).filter(Boolean);

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load guardians' });
  }
});

app.get('/api/evaluations', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode, studentId } = req.query;

  if (!establishmentId || !disciplineCode) {
    return res.status(400).json({ ok: false, error: 'establishmentId and disciplineCode are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
    if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    if (!allowedDisciplineIds.includes(targetDiscipline.id)) {
      return res.status(403).json({ ok: false, error: 'Discipline is not allowed for this user' });
    }

    let query = supabaseAdmin
      .from('student_evaluations')
      .select('id, student_id, discipline_id, template_id, score, passed, notes, next_rank, evaluated_at, evaluator_profile_id')
      .eq('establishment_id', establishmentId)
      .eq('discipline_id', targetDiscipline.id)
      .order('evaluated_at', { ascending: false })
      .limit(200);

    if (studentId) query = query.eq('student_id', studentId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return res.json({ ok: true, data: data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load evaluations' });
  }
});

app.get('/api/students/curriculum', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, studentId } = req.query;

  if (!establishmentId || !studentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId and studentId are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const studentRows = await supabaseAdmin
      .from('students')
      .select('id, profile_id, full_name, email, phone, birth_date, establishment_id')
      .eq('id', studentId)
      .eq('establishment_id', establishmentId)
      .single();
    if (studentRows.error || !studentRows.data) return res.status(404).json({ ok: false, error: 'Student not found' });
    const student = studentRows.data;

    if (membership.role === ROLE_STUDENT && student.profile_id !== profileId) {
      return res.status(403).json({ ok: false, error: 'Student can only access own curriculum' });
    }

    if (membership.role === ROLE_GUARDIAN) {
      const { data: link } = await supabaseAdmin
        .from('guardian_students')
        .select('id')
        .eq('establishment_id', establishmentId)
        .eq('guardian_profile_id', profileId)
        .eq('student_id', studentId)
        .single();
      if (!link?.id) return res.status(403).json({ ok: false, error: 'Guardian has no link to this student' });
    }

    const [{ data: enrollments }, { data: evaluations }, { data: attendance }, { data: payments }] = await Promise.all([
      supabaseAdmin
        .from('student_enrollments')
        .select('id, discipline_id, instructor_profile_id, current_rank, joined_at, status')
        .eq('student_id', studentId)
        .limit(300),
      supabaseAdmin
        .from('student_evaluations')
        .select('id, discipline_id, score, passed, notes, next_rank, evaluated_at')
        .eq('student_id', studentId)
        .eq('establishment_id', establishmentId)
        .order('evaluated_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('class_attendance_records')
        .select('id, status, notes, marked_at, class_session:class_sessions(title, scheduled_date)')
        .eq('student_id', studentId)
        .order('marked_at', { ascending: false })
        .limit(300),
      supabaseAdmin
        .from('payments')
        .select('id, amount, currency, method, concept, paid_at')
        .eq('establishment_id', establishmentId)
        .eq('student_id', studentId)
        .order('paid_at', { ascending: false })
        .limit(200)
    ]);

    const disciplineIds = [...new Set([...(enrollments || []).map(e => e.discipline_id), ...(evaluations || []).map(e => e.discipline_id)].filter(Boolean))];
    const { data: disciplines } = disciplineIds.length > 0
      ? await supabaseAdmin.from('disciplines').select('id, code, name').in('id', disciplineIds)
      : { data: [] };
    const discMap = new Map((disciplines || []).map(d => [d.id, d]));

    const curriculum = {
      student: {
        ...student,
        photo_url: getStudentPhoto(establishmentId, studentId) || null,
        dojo_id: establishmentId
      },
      enrollments: (enrollments || []).map(e => ({ ...e, discipline: discMap.get(e.discipline_id) || null, instructorProfileIds: getStudentInstructorLinks(establishmentId, studentId) })),
      evaluations: (evaluations || []).map(e => ({ ...e, discipline: discMap.get(e.discipline_id) || null })),
      attendance: attendance || [],
      payments: payments || []
    };

    return res.json({ ok: true, data: curriculum });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load student curriculum' });
  }
});

app.post('/api/evaluations', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const {
    establishmentId,
    disciplineCode,
    studentId,
    templateId,
    score,
    passed,
    notes,
    nextRank
  } = req.body || {};

  if (!establishmentId || !disciplineCode || !studentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId, disciplineCode and studentId are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
    if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    if (!allowedDisciplineIds.includes(targetDiscipline.id)) {
      return res.status(403).json({ ok: false, error: 'Discipline is not allowed for this user' });
    }

    const { data: enrollment, error: enrollmentError } = await supabaseAdmin
      .from('student_enrollments')
      .select('id')
      .eq('student_id', studentId)
      .eq('discipline_id', targetDiscipline.id)
      .single();
    if (enrollmentError || !enrollment?.id) return res.status(400).json({ ok: false, error: 'Student is not enrolled in this discipline' });

    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('student_evaluations')
      .insert({
        establishment_id: establishmentId,
        discipline_id: targetDiscipline.id,
        student_id: studentId,
        template_id: templateId || null,
        evaluator_profile_id: profileId,
        score: Number.isFinite(Number(score)) ? Number(score) : null,
        passed: Boolean(passed),
        notes: notes || null,
        next_rank: nextRank || null
      })
      .select('id, score, passed, notes, next_rank, evaluated_at')
      .single();
    if (evalError) throw new Error(evalError.message);

    if (Boolean(passed) && nextRank) {
      const { error: rankError } = await supabaseAdmin
        .from('student_enrollments')
        .update({ current_rank: nextRank })
        .eq('id', enrollment.id);
      if (rankError) throw new Error(rankError.message);
    }

    return res.json({ ok: true, data: evaluation });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create evaluation' });
  }
});

app.get('/api/discipline-config', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;

  if (!establishmentId || !disciplineCode) {
    return res.status(400).json({ ok: false, error: 'establishmentId and disciplineCode are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
    if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    if (!allowedDisciplineIds.includes(targetDiscipline.id)) {
      return res.status(403).json({ ok: false, error: 'Discipline is not allowed for this user' });
    }

    const { data, error } = await supabaseAdmin
      .from('discipline_configs')
      .select('id, config, updated_at')
      .eq('establishment_id', establishmentId)
      .eq('discipline_id', targetDiscipline.id)
      .single();
    if (error) throw new Error(error.message);

    return res.json({ ok: true, data: { ...data, discipline: targetDiscipline } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load discipline config' });
  }
});

app.put('/api/discipline-config', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode, modules } = req.body || {};

  if (!establishmentId || !disciplineCode || !Array.isArray(modules)) {
    return res.status(400).json({ ok: false, error: 'establishmentId, disciplineCode and modules[] are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (!isManagerRole(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can update tree config' });
    }

    const targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
    if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

    const sanitizedModules = modules
      .map(m => ({ id: String(m.id || '').trim(), label: String(m.label || '').trim() }))
      .filter(m => m.id && m.label);

    const { data, error } = await supabaseAdmin
      .from('discipline_configs')
      .upsert({
        establishment_id: establishmentId,
        discipline_id: targetDiscipline.id,
        config: { modules: sanitizedModules }
      }, {
        onConflict: 'establishment_id,discipline_id'
      })
      .select('id, config, updated_at')
      .single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not update discipline config' });
  }
});

// ─── Dashboard Stats (superadmin) ───────────────────────────────────────────
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: establs },
      { data: members },
      { data: disciplines },
      { data: students },
      { data: newMembers },
      { data: estDisciplines },
      { data: attendanceSessions },
      { data: attendancePresent }
    ] = await Promise.all([
      supabaseAdmin.from('establishments').select('id, name, is_active, created_at').limit(500),
      supabaseAdmin.from('establishment_members').select('role, establishment_id, created_at').limit(5000),
      supabaseAdmin.from('disciplines').select('id, name, is_active').limit(200),
      supabaseAdmin.from('students').select('id, establishment_id').limit(10000),
      supabaseAdmin.from('establishment_members').select('id').gte('created_at', weekAgo).limit(500),
      supabaseAdmin.from('establishment_disciplines').select('establishment_id, discipline_id').limit(2000),
      supabaseAdmin.from('class_attendance_records').select('id').limit(10000),
      supabaseAdmin.from('class_attendance_records').select('id').eq('status', 'present').limit(10000)
    ]);

    // Payments table may not exist in every environment.
    let payments = [];
    try {
      const { data: paymentsData, error: paymentsError } = await supabaseAdmin
        .from('payments')
        .select('amount, paid_at, establishment_id, discipline_id')
        .order('paid_at', { ascending: false })
        .limit(20);
      if (!paymentsError) payments = paymentsData || [];
    } catch (_) {
      payments = [];
    }

    // Establishments
    const totalEstabs = (establs || []).length;
    const activeEstabs = (establs || []).filter(e => e.is_active).length;
    const inactiveEstabs = totalEstabs - activeEstabs;

    // Members by role
    const membersByRole = (members || []).reduce((acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    }, {});
    const totalUsers = (members || []).length;

    // Disciplines
    const totalDisciplines = (disciplines || []).filter(d => d.is_active).length;

    // Students per establishment (top 5)
    const studPerEstab = (students || []).reduce((acc, s) => {
      acc[s.establishment_id] = (acc[s.establishment_id] || 0) + 1;
      return acc;
    }, {});
    const topEstabs = (establs || [])
      .map(e => ({ id: e.id, name: e.name, students: studPerEstab[e.id] || 0 }))
      .sort((a, b) => b.students - a.students)
      .slice(0, 5);

    // Disciplines per establishment (for organigram later)
    const discPerEstab = (estDisciplines || []).reduce((acc, ed) => {
      if (!acc[ed.establishment_id]) acc[ed.establishment_id] = [];
      acc[ed.establishment_id].push(ed.discipline_id);
      return acc;
    }, {});

    // Disciplines popularity (count how many establishments use each discipline)
    const discUsage = (estDisciplines || []).reduce((acc, ed) => {
      acc[ed.discipline_id] = (acc[ed.discipline_id] || 0) + 1;
      return acc;
    }, {});
    const discMap = (disciplines || []).reduce((acc, d) => { acc[d.id] = d.name; return acc; }, {});
    const topDisciplines = Object.entries(discUsage)
      .map(([id, count]) => ({ name: discMap[id] || id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Attendance rate
    const totalAttendance = (attendanceSessions || []).length;
    const presentCount = (attendancePresent || []).length;
    const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : null;

    // Payments (may be null if table doesn't exist)
    const paymentRows = payments || [];
    const weekPayments = paymentRows.filter(p => p.paid_at && p.paid_at >= weekAgo);
    const ingresosSemana = weekPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const lastTransactions = paymentRows.slice(0, 10).map(p => ({
      paid_at: p.paid_at,
      establishment: (establs || []).find(e => e.id === p.establishment_id)?.name || '-',
      amount: p.amount
    }));

    return res.json({
      ok: true,
      data: {
        establishments: { total: totalEstabs, active: activeEstabs, inactive: inactiveEstabs },
        users: { total: totalUsers, byRole: membersByRole },
        students: { total: (students || []).length },
        disciplines: { total: totalDisciplines },
        newThisWeek: (newMembers || []).length,
        attendance: { rate: attendanceRate, total: totalAttendance, present: presentCount },
        payments: { ingresosSemana: paymentRows.length > 0 ? ingresosSemana : null, hasData: paymentRows.length > 0 },
        topEstabs,
        topDisciplines,
        lastTransactions: lastTransactions.length > 0 ? lastTransactions : null
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/module-permissions', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    if (membership.role !== ROLE_SUPERADMIN) {
      return res.json({ ok: true, data: { role: membership.role, modules: getRoleModulesByEstablishment(establishmentId, membership.role) } });
    }

    const data = {
      superadmin: getRoleModulesByEstablishment(establishmentId, ROLE_SUPERADMIN),
      owner: getRoleModulesByEstablishment(establishmentId, ROLE_OWNER),
      sensei: getRoleModulesByEstablishment(establishmentId, ROLE_SENSEI),
      admin: getRoleModulesByEstablishment(establishmentId, ROLE_ADMIN),
      instructor: getRoleModulesByEstablishment(establishmentId, ROLE_INSTRUCTOR),
      guardian: getRoleModulesByEstablishment(establishmentId, ROLE_GUARDIAN),
      student: getRoleModulesByEstablishment(establishmentId, ROLE_STUDENT)
    };
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load module permissions' });
  }
});

app.put('/api/module-permissions', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, role, modules } = req.body || {};
  if (!establishmentId || !role || !Array.isArray(modules)) {
    return res.status(400).json({ ok: false, error: 'establishmentId, role and modules[] are required' });
  }

  const normalizedRole = String(role || '').trim().toLowerCase();
  if (![ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN, ROLE_INSTRUCTOR, ROLE_GUARDIAN, ROLE_STUDENT].includes(normalizedRole)) {
    return res.status(400).json({ ok: false, error: 'Invalid role for module permissions' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (membership.role !== ROLE_SUPERADMIN) {
      return res.status(403).json({ ok: false, error: 'Only superadmin can modify module permissions' });
    }

    const saved = updateRoleModulesByEstablishment(establishmentId, normalizedRole, modules);
    return res.json({ ok: true, data: { role: normalizedRole, modules: saved } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not update module permissions' });
  }
});

app.get('/api/organizations', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (!canAccessAdminPanel(membership.role) && membership.role !== ROLE_SUPERADMIN) {
      return res.status(403).json({ ok: false, error: 'No permission to manage organizations' });
    }

    const store = getOrganizationsStore();
    const orgIds = store.establishments[String(establishmentId)] || [];
    const data = orgIds
      .map(id => store.orgs[id])
      .filter(Boolean)
      .map(org => ({
        id: org.id,
        name: org.name,
        description: org.description || null,
        logo_url: org.logo_url || null,
        created_at: org.created_at,
        establishments: Array.isArray(org.establishments) ? org.establishments : []
      }));

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load organizations' });
  }
});

app.post('/api/organizations', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, name, description, logoUrl } = req.body || {};
  if (!establishmentId || !name) return res.status(400).json({ ok: false, error: 'establishmentId and name are required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (!canAccessAdminPanel(membership.role) && membership.role !== ROLE_SUPERADMIN) {
      return res.status(403).json({ ok: false, error: 'No permission to manage organizations' });
    }

    const store = getOrganizationsStore();
    const id = crypto.randomUUID();
    store.orgs[id] = {
      id,
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      logo_url: logoUrl ? String(logoUrl).trim() : null,
      created_at: new Date().toISOString(),
      created_by: profileId,
      establishments: [String(establishmentId)]
    };
    store.establishments[String(establishmentId)] = [
      ...(store.establishments[String(establishmentId)] || []),
      id
    ];
    store.establishments[String(establishmentId)] = [...new Set(store.establishments[String(establishmentId)])];
    saveOrganizationsStore(store);

    return res.status(201).json({ ok: true, data: store.orgs[id] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create organization' });
  }
});

app.put('/api/organizations/:organizationId/establishments', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { organizationId } = req.params;
  const { establishmentId, targetEstablishmentId } = req.body || {};
  if (!establishmentId || !targetEstablishmentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId and targetEstablishmentId are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (!canAccessAdminPanel(membership.role) && membership.role !== ROLE_SUPERADMIN) {
      return res.status(403).json({ ok: false, error: 'No permission to manage organizations' });
    }

    if (membership.role !== ROLE_SUPERADMIN && String(establishmentId) !== String(targetEstablishmentId)) {
      return res.status(403).json({ ok: false, error: 'Only superadmin can link external establishments' });
    }

    const store = getOrganizationsStore();
    const org = store.orgs[String(organizationId)];
    if (!org?.id) return res.status(404).json({ ok: false, error: 'Organization not found' });

    org.establishments = [...new Set([...(org.establishments || []), String(targetEstablishmentId)])];
    store.establishments[String(targetEstablishmentId)] = [
      ...(store.establishments[String(targetEstablishmentId)] || []),
      org.id
    ];
    store.establishments[String(targetEstablishmentId)] = [...new Set(store.establishments[String(targetEstablishmentId)])];
    saveOrganizationsStore(store);

    return res.json({ ok: true, data: org });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not link organization and establishment' });
  }
});

app.get('/api/finance/targets', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;
  if (!establishmentId || !disciplineCode) {
    return res.status(400).json({ ok: false, error: 'establishmentId and disciplineCode are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds);
    if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

    return res.json({
      ok: true,
      data: {
        discipline: targetDiscipline,
        expectedPerStudent: getExpectedFeeForDiscipline(establishmentId, targetDiscipline.code)
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load finance target' });
  }
});

app.put('/api/finance/targets', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode, expectedPerStudent } = req.body || {};
  if (!establishmentId || !disciplineCode || expectedPerStudent === undefined) {
    return res.status(400).json({ ok: false, error: 'establishmentId, disciplineCode and expectedPerStudent are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (!isManagerRole(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Only manager roles can update finance targets' });
    }

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds);
    if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

    const numericValue = Number(expectedPerStudent);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return res.status(400).json({ ok: false, error: 'expectedPerStudent must be a positive number' });
    }

    const saved = setExpectedFeeForDiscipline(establishmentId, targetDiscipline.code, numericValue);
    return res.json({ ok: true, data: { discipline: targetDiscipline, expectedPerStudent: saved } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not update finance target' });
  }
});

app.get('/api/finance/trends', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;
  const months = Math.min(24, Math.max(3, Number(req.query.months || 6)));
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    if (allowedDisciplineIds.length === 0) return res.json({ ok: true, data: [] });

    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds);
    const filteredDisciplineIds = targetDiscipline
      ? allowedDisciplineIds.filter(id => id === targetDiscipline.id)
      : allowedDisciplineIds;

    const now = new Date();
    const monthCursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const monthKeys = [];
    for (let i = 0; i < months; i += 1) {
      const y = monthCursor.getUTCFullYear();
      const m = String(monthCursor.getUTCMonth() + 1).padStart(2, '0');
      monthKeys.push(`${y}-${m}`);
      monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
    }

    const firstDate = `${monthKeys[0]}-01T00:00:00.000Z`;

    let paymentsQuery = supabaseAdmin
      .from('payments')
      .select('amount, paid_at, discipline_id')
      .eq('establishment_id', establishmentId)
      .gte('paid_at', firstDate)
      .in('discipline_id', filteredDisciplineIds)
      .limit(10000);

    const { data: payments, error: paymentsError } = await paymentsQuery;
    if (paymentsError) throw new Error(paymentsError.message);

    const { data: disciplines } = await supabaseAdmin
      .from('disciplines')
      .select('id, code')
      .in('id', filteredDisciplineIds);
    const discMap = new Map((disciplines || []).map(d => [d.id, d.code]));

    const { data: enrollments, error: enrollmentsError } = await supabaseAdmin
      .from('student_enrollments')
      .select('discipline_id, status')
      .in('discipline_id', filteredDisciplineIds)
      .eq('status', 'active')
      .limit(5000);
    if (enrollmentsError) throw new Error(enrollmentsError.message);

    const activeByDisc = {};
    (enrollments || []).forEach(e => {
      const code = discMap.get(e.discipline_id);
      if (!code) return;
      activeByDisc[code] = (activeByDisc[code] || 0) + 1;
    });

    const expectedIncome = Object.entries(activeByDisc).reduce((acc, [code, count]) => {
      return acc + (count * getExpectedFeeForDiscipline(establishmentId, code));
    }, 0);

    const receivedByMonth = {};
    (payments || []).forEach(p => {
      const key = String(p.paid_at || '').slice(0, 7);
      if (!key || !monthKeys.includes(key)) return;
      receivedByMonth[key] = (receivedByMonth[key] || 0) + Number(p.amount || 0);
    });

    const data = monthKeys.map(key => {
      const received = Number((receivedByMonth[key] || 0).toFixed(2));
      const expected = Number(expectedIncome.toFixed(2));
      const delinquencyRate = expected > 0
        ? Number((Math.max(0, expected - received) / expected * 100).toFixed(2))
        : 0;
      return {
        month: key,
        expectedIncome: expected,
        paymentsReceived: received,
        delinquencyRate
      };
    });

    return res.json({ ok: true, data, meta: { expectedIncomePerMonth: Number(expectedIncome.toFixed(2)), months } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load finance trends' });
  }
});

app.get('/api/classes', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode, date } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    let targetDiscipline = null;
    if (disciplineCode) {
      targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
      if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });
    }

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const filteredDisciplineIds = targetDiscipline
      ? allowedDisciplineIds.filter(id => id === targetDiscipline.id)
      : allowedDisciplineIds;

    if (filteredDisciplineIds.length === 0) return res.json({ ok: true, data: [] });

    let query = supabaseAdmin
      .from('class_sessions')
      .select('id, establishment_id, discipline_id, instructor_profile_id, title, scheduled_date, start_time, end_time, location, notes, status, created_at')
      .eq('establishment_id', establishmentId)
      .in('discipline_id', filteredDisciplineIds)
      .order('scheduled_date', { ascending: false })
      .limit(300);

    if (date) query = query.eq('scheduled_date', date);

    const { data: classes, error: classesError } = await query;
    if (classesError) throw new Error(classesError.message);

    const instructorIds = [...new Set((classes || []).map(c => c.instructor_profile_id).filter(Boolean))];
    const disciplineIds = [...new Set((classes || []).map(c => c.discipline_id))];

    const [{ data: instructors }, { data: disciplines }] = await Promise.all([
      instructorIds.length > 0
        ? supabaseAdmin.from('profiles').select('id, full_name').in('id', instructorIds)
        : Promise.resolve({ data: [] }),
      disciplineIds.length > 0
        ? supabaseAdmin.from('disciplines').select('id, code, name').in('id', disciplineIds)
        : Promise.resolve({ data: [] })
    ]);

    const instructorMap = new Map((instructors || []).map(i => [i.id, i]));
    const disciplineMap = new Map((disciplines || []).map(d => [d.id, d]));

    const data = (classes || []).map(c => ({
      ...c,
      instructor: c.instructor_profile_id ? instructorMap.get(c.instructor_profile_id) || null : null,
      discipline: disciplineMap.get(c.discipline_id) || null
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load classes' });
  }
});

app.post('/api/classes', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const {
    establishmentId,
    disciplineCode,
    title,
    scheduledDate,
    startTime,
    endTime,
    location,
    notes,
    instructorProfileId
  } = req.body || {};

  if (!establishmentId || !disciplineCode || !title || !scheduledDate || !startTime) {
    return res.status(400).json({ ok: false, error: 'establishmentId, disciplineCode, title, scheduledDate and startTime are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
    if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    if (!allowedDisciplineIds.includes(targetDiscipline.id)) {
      return res.status(403).json({ ok: false, error: 'Discipline is not allowed for this user' });
    }

    const targetInstructor = membership.role === ROLE_INSTRUCTOR
      ? profileId
      : (instructorProfileId || null);

    const { data, error } = await supabaseAdmin
      .from('class_sessions')
      .insert({
        establishment_id: establishmentId,
        discipline_id: targetDiscipline.id,
        instructor_profile_id: targetInstructor,
        title,
        scheduled_date: scheduledDate,
        start_time: startTime,
        end_time: endTime || null,
        location: location || null,
        notes: notes || null,
        status: 'scheduled'
      })
      .select('id, title, scheduled_date, start_time, end_time, location, status')
      .single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data: { ...data, discipline: targetDiscipline } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create class' });
  }
});

app.get('/api/classes/:classId/attendance', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { classId } = req.params;

  try {
    const { data: classSession, error: classError } = await supabaseAdmin
      .from('class_sessions')
      .select('id, establishment_id, discipline_id, title, scheduled_date, start_time, end_time, location, status, instructor_profile_id')
      .eq('id', classId)
      .single();
    if (classError || !classSession) return res.status(404).json({ ok: false, error: 'Class not found' });

    const membership = await getMembership(profileId, classSession.establishment_id);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, classSession.establishment_id);
    if (!allowedDisciplineIds.includes(classSession.discipline_id)) {
      return res.status(403).json({ ok: false, error: 'Discipline is not allowed for this user' });
    }

    const { data: enrollments, error: enrollmentError } = await supabaseAdmin
      .from('student_enrollments')
      .select('student_id, current_rank, status')
      .eq('discipline_id', classSession.discipline_id)
      .eq('status', 'active');
    if (enrollmentError) throw new Error(enrollmentError.message);

    const studentIds = [...new Set((enrollments || []).map(e => e.student_id))];

    const [{ data: students }, { data: attendanceRows }] = await Promise.all([
      studentIds.length > 0
        ? supabaseAdmin.from('students').select('id, full_name, email, phone').in('id', studentIds).eq('establishment_id', classSession.establishment_id)
        : Promise.resolve({ data: [] }),
      supabaseAdmin.from('class_attendance_records').select('student_id, status, notes, marked_at').eq('class_session_id', classId)
    ]);

    const enrollMap = new Map((enrollments || []).map(e => [e.student_id, e]));
    const attendanceMap = new Map((attendanceRows || []).map(a => [a.student_id, a]));

    const roster = (students || []).map(s => ({
      student: s,
      current_rank: enrollMap.get(s.id)?.current_rank || null,
      enrollment_status: enrollMap.get(s.id)?.status || null,
      attendance: attendanceMap.get(s.id) || null
    }));

    return res.json({ ok: true, data: { class: classSession, roster } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load attendance roster' });
  }
});

app.post('/api/classes/:classId/attendance', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { classId } = req.params;
  const { entries } = req.body || {};

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ ok: false, error: 'entries[] is required' });
  }

  try {
    const { data: classSession, error: classError } = await supabaseAdmin
      .from('class_sessions')
      .select('id, establishment_id, discipline_id')
      .eq('id', classId)
      .single();
    if (classError || !classSession) return res.status(404).json({ ok: false, error: 'Class not found' });

    const membership = await getMembership(profileId, classSession.establishment_id);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, classSession.establishment_id);
    if (!allowedDisciplineIds.includes(classSession.discipline_id)) {
      return res.status(403).json({ ok: false, error: 'Discipline is not allowed for this user' });
    }

    const normalized = entries
      .map(e => ({
        class_session_id: classId,
        student_id: String(e.studentId || '').trim(),
        status: String(e.status || '').trim().toLowerCase(),
        notes: (e.notes || null),
        marked_by: profileId,
        marked_at: new Date().toISOString()
      }))
      .filter(e => e.student_id && ['present', 'absent', 'late', 'excused'].includes(e.status));

    if (normalized.length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid attendance entries provided' });
    }

    const { data, error } = await supabaseAdmin
      .from('class_attendance_records')
      .upsert(normalized, { onConflict: 'class_session_id,student_id' })
      .select('id, student_id, status, notes, marked_at');

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data: data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not save attendance' });
  }
});

app.get('/api/payments', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode, studentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    let targetDiscipline = null;
    if (disciplineCode) {
      targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
      if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });
    }

    let allowedStudentIds = null;
    if (membership.role === ROLE_STUDENT) {
      const { data: ownStudent, error: ownStudentError } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('establishment_id', establishmentId)
        .eq('profile_id', profileId)
        .single();
      if (ownStudentError || !ownStudent?.id) return res.json({ ok: true, data: [] });
      allowedStudentIds = [ownStudent.id];
    } else if (membership.role === ROLE_GUARDIAN) {
      const { data: links, error: linksError } = await supabaseAdmin
        .from('guardian_students')
        .select('student_id')
        .eq('establishment_id', establishmentId)
        .eq('guardian_profile_id', profileId);
      if (linksError) throw new Error(linksError.message);
      allowedStudentIds = [...new Set((links || []).map(l => l.student_id).filter(Boolean))];
    } else if (membership.role === ROLE_INSTRUCTOR || membership.role === ROLE_SENSEI) {
      const { data: enrollments, error: enrollmentsError } = await supabaseAdmin
        .from('student_enrollments')
        .select('student_id, instructor_profile_id')
        .in('discipline_id', targetDiscipline ? [targetDiscipline.id] : await getAllowedDisciplineIds(membership.role, profileId, establishmentId))
        .limit(5000);
      if (enrollmentsError) throw new Error(enrollmentsError.message);

      const scoped = (enrollments || []).filter(e => {
        const links = getStudentInstructorLinks(establishmentId, e.student_id);
        const instructorsForStudent = [...new Set([...(links || []), e.instructor_profile_id].filter(Boolean))];
        if (membership.role === ROLE_INSTRUCTOR) {
          return instructorsForStudent.includes(profileId);
        }
        return instructorsForStudent.some(inst => getSenseiForInstructor(establishmentId, inst) === profileId);
      });
      allowedStudentIds = [...new Set(scoped.map(r => r.student_id).filter(Boolean))];
    }

    let query = supabaseAdmin
      .from('payments')
      .select('id, establishment_id, student_id, discipline_id, amount, currency, method, concept, paid_at, created_by')
      .eq('establishment_id', establishmentId)
      .order('paid_at', { ascending: false })
      .limit(500);

    if (targetDiscipline) query = query.eq('discipline_id', targetDiscipline.id);
    if (Array.isArray(allowedStudentIds)) {
      if (allowedStudentIds.length === 0) return res.json({ ok: true, data: [] });
      query = query.in('student_id', allowedStudentIds);
    }
    if (studentId) {
      if (Array.isArray(allowedStudentIds) && !allowedStudentIds.includes(studentId)) {
        return res.status(403).json({ ok: false, error: 'No access to this student payments' });
      }
      query = query.eq('student_id', studentId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return res.json({ ok: true, data: data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load payments' });
  }
});

app.post('/api/payments', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const {
    establishmentId,
    disciplineCode,
    studentId,
    amount,
    currency,
    method,
    concept,
    paidAt
  } = req.body || {};

  if (!establishmentId || !studentId || amount === undefined || amount === null) {
    return res.status(400).json({ ok: false, error: 'establishmentId, studentId and amount are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    let targetDiscipline = null;
    if (disciplineCode) {
      targetDiscipline = await resolveDisciplineByCode(establishmentId, disciplineCode);
      if (!targetDiscipline) return res.status(400).json({ ok: false, error: 'Invalid disciplineCode' });

      const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
      if (!allowedDisciplineIds.includes(targetDiscipline.id)) {
        return res.status(403).json({ ok: false, error: 'Discipline is not allowed for this user' });
      }
    }

    const { data: studentCheck, error: studentCheckError } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('id', studentId)
      .eq('establishment_id', establishmentId)
      .single();
    if (studentCheckError || !studentCheck?.id) {
      return res.status(400).json({ ok: false, error: 'Student does not belong to establishment' });
    }

    const { data, error } = await supabaseAdmin
      .from('payments')
      .insert({
        establishment_id: establishmentId,
        student_id: studentId,
        discipline_id: targetDiscipline?.id || null,
        amount: Number(amount),
        currency: currency || 'USD',
        method: method || null,
        concept: concept || null,
        paid_at: paidAt || new Date().toISOString(),
        created_by: profileId
      })
      .select('id, amount, currency, method, concept, paid_at')
      .single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create payment' });
  }
});

app.get('/api/reports/summary', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    if (allowedDisciplineIds.length === 0) {
      return res.json({ ok: true, data: { students: 0, activeEnrollments: 0, classes: 0, attendanceRate: 0, paymentsCount: 0, paymentsTotal: 0 } });
    }

    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds);
    const filteredDisciplineIds = targetDiscipline
      ? allowedDisciplineIds.filter(id => id === targetDiscipline.id)
      : allowedDisciplineIds;

    const { data: enrollments, error: enrollmentsError } = await supabaseAdmin
      .from('student_enrollments')
      .select('student_id, discipline_id, status')
      .in('discipline_id', filteredDisciplineIds)
      .limit(5000);
    if (enrollmentsError) throw new Error(enrollmentsError.message);

    const uniqueStudentIds = [...new Set((enrollments || []).map(e => e.student_id))];
    const activeEnrollments = (enrollments || []).filter(e => e.status === 'active').length;

    const { data: classes, error: classesError } = await supabaseAdmin
      .from('class_sessions')
      .select('id')
      .eq('establishment_id', establishmentId)
      .in('discipline_id', filteredDisciplineIds)
      .limit(5000);
    if (classesError) throw new Error(classesError.message);

    const classIds = (classes || []).map(c => c.id);
    let attendanceRows = [];
    if (classIds.length > 0) {
      const { data: rows, error: attendanceError } = await supabaseAdmin
        .from('class_attendance_records')
        .select('status')
        .in('class_session_id', classIds)
        .limit(10000);
      if (attendanceError) throw new Error(attendanceError.message);
      attendanceRows = rows || [];
    }
    const attended = attendanceRows.filter(r => ['present', 'late'].includes(r.status)).length;
    const attendanceRate = attendanceRows.length > 0 ? Number(((attended / attendanceRows.length) * 100).toFixed(2)) : 0;

    let paymentsQuery = supabaseAdmin
      .from('payments')
      .select('amount, discipline_id, paid_at')
      .eq('establishment_id', establishmentId)
      .limit(5000);
    if (targetDiscipline) paymentsQuery = paymentsQuery.eq('discipline_id', targetDiscipline.id);

    const { data: payments, error: paymentsError } = await paymentsQuery;
    if (paymentsError) throw new Error(paymentsError.message);
    const paymentsTotal = Number((payments || []).reduce((acc, p) => acc + Number(p.amount || 0), 0).toFixed(2));

    const { data: disciplineRows } = await supabaseAdmin
      .from('disciplines')
      .select('id, code')
      .in('id', filteredDisciplineIds);
    const disciplineCodeMap = new Map((disciplineRows || []).map(d => [d.id, d.code]));

    const activeByDiscipline = {};
    (enrollments || []).forEach(e => {
      if (e.status !== 'active') return;
      const code = disciplineCodeMap.get(e.discipline_id);
      if (!code) return;
      activeByDiscipline[code] = (activeByDiscipline[code] || 0) + 1;
    });

    const expectedIncome = Number(Object.entries(activeByDiscipline).reduce((acc, [code, count]) => {
      return acc + (count * getExpectedFeeForDiscipline(establishmentId, code));
    }, 0).toFixed(2));

    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const paymentsReceived = Number((payments || []).reduce((acc, p) => {
      const paidMonth = String(p.paid_at || '').slice(0, 7);
      if (paidMonth !== monthKey) return acc;
      return acc + Number(p.amount || 0);
    }, 0).toFixed(2));

    const delinquencyRate = expectedIncome > 0
      ? Number((Math.max(0, expectedIncome - paymentsReceived) / expectedIncome * 100).toFixed(2))
      : 0;

    return res.json({
      ok: true,
      data: {
        discipline: targetDiscipline || null,
        students: uniqueStudentIds.length,
        activeEnrollments,
        classes: classIds.length,
        attendanceRate,
        paymentsCount: (payments || []).length,
        paymentsTotal,
        expectedIncome,
        paymentsReceived,
        delinquencyRate,
        expectedGap: Number(Math.max(0, expectedIncome - paymentsReceived).toFixed(2))
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load report summary' });
  }
});

app.get('/api/reports/operational', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds).catch((e) => {
      if (e.message === 'Invalid disciplineCode' || e.message === 'Discipline is not allowed for this user') throw e;
      return null;
    });

    const filteredDisciplineIds = targetDiscipline
      ? allowedDisciplineIds.filter(id => id === targetDiscipline.id)
      : allowedDisciplineIds;

    if (filteredDisciplineIds.length === 0) {
      return res.json({
        ok: true,
        data: {
          studentsByRank: [],
          attendanceByStatus: [],
          attendanceByMonth: [],
          examSummary: { total: 0, passed: 0, failed: 0, postponed: 0, approvalRate: 0 },
          examByMonth: [],
          studentsDetail: []
        }
      });
    }

    const { data: enrollments, error: enrollmentError } = await supabaseAdmin
      .from('student_enrollments')
      .select('student_id, discipline_id, current_rank, joined_at, status')
      .in('discipline_id', filteredDisciplineIds)
      .limit(8000);
    if (enrollmentError) throw new Error(enrollmentError.message);

    const studentIds = [...new Set((enrollments || []).map(e => e.student_id))];
    const [{ data: students }, { data: disciplines }] = await Promise.all([
      studentIds.length
        ? supabaseAdmin.from('students').select('id, full_name, email, phone, birth_date').in('id', studentIds)
        : Promise.resolve({ data: [] }),
      filteredDisciplineIds.length
        ? supabaseAdmin.from('disciplines').select('id, code, name').in('id', filteredDisciplineIds)
        : Promise.resolve({ data: [] })
    ]);

    const disciplineById = new Map((disciplines || []).map(d => [d.id, d]));
    const studentById = new Map((students || []).map(s => [s.id, s]));

    const rankCount = {};
    (enrollments || []).forEach(e => {
      const rank = String(e.current_rank || 'Sin rango').trim() || 'Sin rango';
      rankCount[rank] = (rankCount[rank] || 0) + 1;
    });
    const studentsByRank = Object.entries(rankCount)
      .map(([rank, count]) => ({ rank, count }))
      .sort((a, b) => b.count - a.count);

    const { data: classes, error: classesError } = await supabaseAdmin
      .from('class_sessions')
      .select('id, scheduled_date')
      .eq('establishment_id', establishmentId)
      .in('discipline_id', filteredDisciplineIds)
      .limit(8000);
    if (classesError) throw new Error(classesError.message);

    const classIds = (classes || []).map(c => c.id);
    const classById = new Map((classes || []).map(c => [c.id, c]));

    let attendanceRows = [];
    if (classIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('class_attendance_records')
        .select('class_session_id, status')
        .in('class_session_id', classIds)
        .limit(20000);
      if (error) throw new Error(error.message);
      attendanceRows = data || [];
    }

    const attendanceStatusCount = {};
    const attendanceByMonthCounter = {};
    attendanceRows.forEach((row) => {
      const status = String(row.status || 'unknown').toLowerCase();
      attendanceStatusCount[status] = (attendanceStatusCount[status] || 0) + 1;
      const cls = classById.get(row.class_session_id);
      const month = String(cls?.scheduled_date || '').slice(0, 7);
      if (month) attendanceByMonthCounter[month] = (attendanceByMonthCounter[month] || 0) + 1;
    });

    const attendanceByStatus = Object.entries(attendanceStatusCount)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
    const attendanceByMonth = Object.entries(attendanceByMonthCounter)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    let evalRows = [];
    {
      const { data: evaluations, error: evalError } = await supabaseAdmin
        .from('evaluations')
        .select('student_id, discipline_id, passed, evaluated_at')
        .in('discipline_id', filteredDisciplineIds)
        .limit(10000);
      if (evalError) {
        const msg = String(evalError.message || '').toLowerCase();
        if (!msg.includes('could not find the table')) throw new Error(evalError.message);
      } else {
        evalRows = evaluations || [];
      }
    }

    let gradeResults = [];
    {
      const { data, error: gradeResultError } = await supabaseAdmin
        .from('exam_grade_results')
        .select('student_id, result, created_at')
        .eq('establishment_id', establishmentId)
        .limit(5000);
      if (gradeResultError) {
        const msg = String(gradeResultError.message || '').toLowerCase();
        if (!msg.includes('could not find the table')) throw new Error(gradeResultError.message);
      } else {
        gradeResults = data || [];
      }
    }

    const examByMonthCounter = {};
    let passed = 0;
    let failed = 0;
    let postponed = 0;

    evalRows.forEach((r) => {
      if (r.passed === true) passed += 1;
      else failed += 1;
      const month = String(r.evaluated_at || '').slice(0, 7);
      if (month) examByMonthCounter[month] = (examByMonthCounter[month] || 0) + 1;
    });

    (gradeResults || []).forEach((r) => {
      const normalized = String(r.result || '').toLowerCase();
      if (normalized.includes('aprob')) passed += 1;
      else if (normalized.includes('posp')) postponed += 1;
      else failed += 1;
      const month = String(r.created_at || '').slice(0, 7);
      if (month) examByMonthCounter[month] = (examByMonthCounter[month] || 0) + 1;
    });

    const totalExams = passed + failed + postponed;
    const examSummary = {
      total: totalExams,
      passed,
      failed,
      postponed,
      approvalRate: totalExams > 0 ? Number(((passed / totalExams) * 100).toFixed(2)) : 0
    };

    const examByMonth = Object.entries(examByMonthCounter)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const studentsDetail = (enrollments || []).map((e) => {
      const student = studentById.get(e.student_id) || {};
      const discipline = disciplineById.get(e.discipline_id) || {};
      return {
        studentId: e.student_id,
        fullName: student.full_name || '-',
        email: student.email || null,
        phone: student.phone || null,
        birthDate: student.birth_date || null,
        disciplineCode: discipline.code || '-',
        disciplineName: discipline.name || '-',
        currentRank: e.current_rank || null,
        status: e.status || null,
        joinedAt: e.joined_at || null
      };
    });

    return res.json({
      ok: true,
      data: {
        studentsByRank,
        attendanceByStatus,
        attendanceByMonth,
        examSummary,
        examByMonth,
        studentsDetail
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load operational report' });
  }
});

app.get('/api/absences', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, studentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const store = getAbsenceStore();
    const rows = Array.isArray(store[String(establishmentId)]) ? store[String(establishmentId)] : [];
    const filtered = studentId ? rows.filter(r => String(r.studentId) === String(studentId)) : rows;
    return res.json({ ok: true, data: filtered.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load absences' });
  }
});

app.post('/api/absences', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, studentId, date, reason, documentUrl } = req.body || {};
  if (!establishmentId || !studentId || !date || !reason) {
    return res.status(400).json({ ok: false, error: 'establishmentId, studentId, date and reason are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (![ROLE_SUPERADMIN, ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN, ROLE_INSTRUCTOR].includes(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient role' });
    }

    const store = getAbsenceStore();
    const estKey = String(establishmentId);
    store[estKey] = Array.isArray(store[estKey]) ? store[estKey] : [];

    const row = {
      id: crypto.randomUUID(),
      establishmentId: estKey,
      studentId: String(studentId),
      date: String(date),
      reason: String(reason),
      documentUrl: documentUrl ? String(documentUrl) : null,
      createdBy: String(profileId),
      createdAt: new Date().toISOString()
    };
    store[estKey].push(row);
    saveAbsenceStore(store);
    return res.status(201).json({ ok: true, data: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create absence' });
  }
});

app.delete('/api/absences/:absenceId', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { absenceId } = req.params;
  const { establishmentId } = req.body || {};
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (![ROLE_SUPERADMIN, ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN, ROLE_INSTRUCTOR].includes(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient role' });
    }

    const store = getAbsenceStore();
    const estKey = String(establishmentId);
    const rows = Array.isArray(store[estKey]) ? store[estKey] : [];
    const before = rows.length;
    store[estKey] = rows.filter(r => String(r.id) !== String(absenceId));
    if (store[estKey].length === before) {
      return res.status(404).json({ ok: false, error: 'Absence not found' });
    }
    saveAbsenceStore(store);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not delete absence' });
  }
});

app.get('/api/settings', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const all = getAppSettings();
    const data = all[String(establishmentId)] || {};
    return res.json({ ok: true, data: {
      beltColors: data.beltColors || {},
      monthlyFees: data.monthlyFees || {}
    } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load settings' });
  }
});

app.put('/api/settings', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, beltColors, monthlyFees } = req.body || {};
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (![ROLE_SUPERADMIN, ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN].includes(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient role' });
    }

    const all = getAppSettings();
    const estKey = String(establishmentId);
    const current = all[estKey] || {};
    all[estKey] = {
      ...current,
      beltColors: beltColors ? sanitizeBeltColors(beltColors) : (current.beltColors || {}),
      monthlyFees: monthlyFees ? sanitizeMonthlyFees(monthlyFees) : (current.monthlyFees || {})
    };
    saveAppSettings(all);

    return res.json({ ok: true, data: all[estKey] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not save settings' });
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds).catch((e) => {
      if (e.message === 'Invalid disciplineCode' || e.message === 'Discipline is not allowed for this user') throw e;
      return null;
    });

    let query = supabaseAdmin
      .from('notifications')
      .select('id, establishment_id, discipline_id, recipient_profile_id, audience_role, title, body, is_read, created_by, created_at')
      .eq('establishment_id', establishmentId)
      .or(`recipient_profile_id.is.null,recipient_profile_id.eq.${profileId},audience_role.eq.all,audience_role.eq.${membership.role}`)
      .order('created_at', { ascending: false })
      .limit(200);

    if (targetDiscipline) query = query.eq('discipline_id', targetDiscipline.id);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return res.json({ ok: true, data: data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load notifications' });
  }
});

app.post('/api/notifications', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const {
    establishmentId,
    disciplineCode,
    recipientProfileId,
    audienceRole,
    title,
    body
  } = req.body || {};

  if (!establishmentId || !title) {
    return res.status(400).json({ ok: false, error: 'establishmentId and title are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (!canCreateNotifications(membership.role)) {
      return res.status(403).json({ ok: false, error: 'No permission to create notifications' });
    }

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds);

    const validAudience = ['all', ROLE_OWNER, ROLE_ADMIN, ROLE_INSTRUCTOR, ROLE_STUDENT, ROLE_GUARDIAN];
    const finalAudience = validAudience.includes(audienceRole) ? audienceRole : 'all';

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .insert({
        establishment_id: establishmentId,
        discipline_id: targetDiscipline?.id || null,
        recipient_profile_id: recipientProfileId || null,
        audience_role: finalAudience,
        title,
        body: body || null,
        is_read: false,
        created_by: profileId
      })
      .select('id, title, body, audience_role, created_at')
      .single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create notification' });
  }
});

app.put('/api/notifications/:notificationId/read', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { notificationId } = req.params;

  try {
    const { data: notification, error: notificationError } = await supabaseAdmin
      .from('notifications')
      .select('id, establishment_id, recipient_profile_id, audience_role')
      .eq('id', notificationId)
      .single();
    if (notificationError || !notification) return res.status(404).json({ ok: false, error: 'Notification not found' });

    const membership = await getMembership(profileId, notification.establishment_id);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    if (notification.recipient_profile_id && notification.recipient_profile_id !== profileId && !isManagerRole(membership.role)) {
      return res.status(403).json({ ok: false, error: 'No permission to mark this notification' });
    }

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .select('id, is_read')
      .single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not mark notification as read' });
  }
});

app.get('/api/marketplace', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds).catch((e) => {
      if (e.message === 'Invalid disciplineCode' || e.message === 'Discipline is not allowed for this user') throw e;
      return null;
    });

    let query = supabaseAdmin
      .from('marketplace_items')
      .select('id, establishment_id, discipline_id, title, description, price, currency, is_active, image_url, created_at, discipline:disciplines(code,name)')
      .eq('establishment_id', establishmentId)
      .order('created_at', { ascending: false })
      .limit(300);

    if (targetDiscipline) query = query.eq('discipline_id', targetDiscipline.id);
    if (!isManagerRole(membership.role)) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data || []).map((row) => ({
      ...row,
      discipline_code: row?.discipline?.code || null,
      discipline_name: row?.discipline?.name || null,
      image_url: row?.image_url || getMarketplaceImage(row.id) || null
    }));

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load marketplace items' });
  }
});

app.post('/api/marketplace', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const {
    establishmentId,
    disciplineCode,
    title,
    description,
    price,
    currency,
    isActive,
    imageUrl
  } = req.body || {};

  if (!establishmentId || !title || price === undefined || price === null) {
    return res.status(400).json({ ok: false, error: 'establishmentId, title and price are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (!isManagerRole(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can create marketplace items' });
    }

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds);

    const { data, error } = await supabaseAdmin
      .from('marketplace_items')
      .insert({
        establishment_id: establishmentId,
        discipline_id: targetDiscipline?.id || null,
        title,
        description: description || null,
        price: Number(price),
        currency: currency || 'USD',
        is_active: isActive !== undefined ? Boolean(isActive) : true,
        image_url: imageUrl || null,
        created_by: profileId
      })
      .select('id, title, price, currency, is_active, image_url, created_at')
      .single();

    if (error) throw new Error(error.message);
    if (imageUrl && !data?.image_url) setMarketplaceImage(data.id, imageUrl);
    return res.json({ ok: true, data: { ...data, image_url: data?.image_url || imageUrl || null } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create marketplace item' });
  }
});

app.post('/api/portal/guardian/link', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, guardianProfileId, studentId, relationship } = req.body || {};

  if (!establishmentId || !guardianProfileId || !studentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId, guardianProfileId and studentId are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (![ROLE_SUPERADMIN, ROLE_OWNER, ROLE_SENSEI].includes(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Only superadmin/owner/sensei can link guardians' });
    }

    const { data: studentCheck, error: studentError } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('id', studentId)
      .eq('establishment_id', establishmentId)
      .single();
    if (studentError || !studentCheck?.id) {
      return res.status(400).json({ ok: false, error: 'Student does not belong to establishment' });
    }

    const { data: guardianMembership, error: guardianMembershipError } = await supabaseAdmin
      .from('establishment_members')
      .select('role')
      .eq('establishment_id', establishmentId)
      .eq('profile_id', guardianProfileId)
      .single();
    if (guardianMembershipError || guardianMembership?.role !== ROLE_GUARDIAN) {
      return res.status(400).json({ ok: false, error: 'guardianProfileId must belong to a guardian in this establishment' });
    }

    const { data: existingLinks, error: existingLinksError } = await supabaseAdmin
      .from('guardian_students')
      .select('guardian_profile_id')
      .eq('establishment_id', establishmentId)
      .eq('student_id', studentId);
    if (existingLinksError) throw new Error(existingLinksError.message);
    const anotherTutorExists = (existingLinks || []).some(l => l.guardian_profile_id !== guardianProfileId);
    if (anotherTutorExists) {
      return res.status(400).json({ ok: false, error: 'This student already has a tutor linked' });
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_students')
      .upsert({
        establishment_id: establishmentId,
        guardian_profile_id: guardianProfileId,
        student_id: studentId,
        relationship: relationship || null
      }, {
        onConflict: 'establishment_id,guardian_profile_id,student_id'
      })
      .select('id, guardian_profile_id, student_id, relationship')
      .single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not link guardian' });
  }
});

app.get('/api/portal/guardian', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, guardianProfileId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const targetGuardianId = membership.role === ROLE_GUARDIAN
      ? profileId
      : (isManagerRole(membership.role) ? (guardianProfileId || profileId) : profileId);

    if (membership.role !== ROLE_GUARDIAN && !isManagerRole(membership.role) && targetGuardianId !== profileId) {
      return res.status(403).json({ ok: false, error: 'No permission for this guardian portal' });
    }

    const { data: links, error: linksError } = await supabaseAdmin
      .from('guardian_students')
      .select('student_id, relationship')
      .eq('establishment_id', establishmentId)
      .eq('guardian_profile_id', targetGuardianId);
    if (linksError) {
      const msg = String(linksError.message || '');
      const code = String(linksError.code || '');
      if (code === '42P01' || /guardian_students/i.test(msg)) {
        return res.json({
          ok: true,
          data: { guardianProfileId: targetGuardianId, students: [] },
          warning: 'guardian_students table is missing; run migrations'
        });
      }
      throw new Error(linksError.message);
    }

    const studentIds = [...new Set((links || []).map(l => l.student_id))];
    const { data: students, error: studentsError } = studentIds.length > 0
      ? await supabaseAdmin.from('students').select('id, full_name, email, phone, birth_date').in('id', studentIds).eq('establishment_id', establishmentId)
      : { data: [], error: null };
    if (studentsError) throw new Error(studentsError.message);

    const relationMap = new Map((links || []).map(l => [l.student_id, l.relationship || null]));
    const data = (students || []).map(s => ({ student: s, relationship: relationMap.get(s.id) || null }));

    return res.json({ ok: true, data: { guardianProfileId: targetGuardianId, students: data } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load guardian portal' });
  }
});

app.get('/api/portal/student', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, studentId } = req.query;
  if (!establishmentId || !studentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId and studentId are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const { data: student, error: studentError } = await supabaseAdmin
      .from('students')
      .select('id, profile_id, full_name, email, phone, birth_date, establishment_id')
      .eq('id', studentId)
      .eq('establishment_id', establishmentId)
      .single();
    if (studentError || !student) return res.status(404).json({ ok: false, error: 'Student not found' });

    const { data: enrollmentScopeRows, error: enrollmentScopeError } = await supabaseAdmin
      .from('student_enrollments')
      .select('instructor_profile_id')
      .eq('student_id', studentId)
      .limit(200);
    if (enrollmentScopeError) throw new Error(enrollmentScopeError.message);

    if (membership.role === ROLE_INSTRUCTOR) {
      const fileLinks = getStudentInstructorLinks(establishmentId, studentId);
      const enrollmentInstructorIds = (enrollmentScopeRows || []).map(r => r.instructor_profile_id).filter(Boolean);
      const canSee = fileLinks.includes(profileId) || enrollmentInstructorIds.includes(profileId);
      if (!canSee) return res.status(403).json({ ok: false, error: 'Instructor can only access assigned students' });
    }

    if (membership.role === ROLE_SENSEI) {
      const fileLinks = getStudentInstructorLinks(establishmentId, studentId);
      const enrollmentInstructorIds = (enrollmentScopeRows || []).map(r => r.instructor_profile_id).filter(Boolean);
      const candidateInstructorIds = [...new Set([...fileLinks, ...enrollmentInstructorIds])];
      const canSee = candidateInstructorIds.some(instId => getSenseiForInstructor(establishmentId, instId) === profileId);
      if (!canSee) return res.status(403).json({ ok: false, error: 'Sensei can only access students linked to own instructors' });
    }

    if (membership.role === ROLE_STUDENT && student.profile_id !== profileId) {
      return res.status(403).json({ ok: false, error: 'Student can only access own portal' });
    }

    if (membership.role === ROLE_GUARDIAN) {
      const { data: link } = await supabaseAdmin
        .from('guardian_students')
        .select('id')
        .eq('establishment_id', establishmentId)
        .eq('guardian_profile_id', profileId)
        .eq('student_id', studentId)
        .single();
      if (!link?.id) return res.status(403).json({ ok: false, error: 'Guardian has no link to this student' });
    }

    const { data: enrollments, error: enrollmentsError } = await supabaseAdmin
      .from('student_enrollments')
      .select('id, discipline_id, current_rank, status, joined_at')
      .eq('student_id', studentId)
      .limit(200);
    if (enrollmentsError) throw new Error(enrollmentsError.message);

    const disciplineIds = [...new Set((enrollments || []).map(e => e.discipline_id))];
    const { data: disciplines } = disciplineIds.length > 0
      ? await supabaseAdmin.from('disciplines').select('id, code, name').in('id', disciplineIds)
      : { data: [] };

    const disciplineMap = new Map((disciplines || []).map(d => [d.id, d]));
    const enrollmentData = (enrollments || []).map(e => ({ ...e, discipline: disciplineMap.get(e.discipline_id) || null }));

    const [{ data: payments }, { data: evaluations }, { data: notifications }] = await Promise.all([
      supabaseAdmin
        .from('payments')
        .select('id, amount, currency, method, concept, paid_at, discipline_id')
        .eq('establishment_id', establishmentId)
        .eq('student_id', studentId)
        .order('paid_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('student_evaluations')
        .select('id, discipline_id, score, passed, notes, next_rank, evaluated_at')
        .eq('establishment_id', establishmentId)
        .eq('student_id', studentId)
        .order('evaluated_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('notifications')
        .select('id, title, body, audience_role, is_read, created_at')
        .eq('establishment_id', establishmentId)
        .or(`recipient_profile_id.eq.${student.profile_id || profileId},audience_role.eq.all,audience_role.eq.student`)
        .order('created_at', { ascending: false })
        .limit(20)
    ]);

    return res.json({
      ok: true,
      data: {
        student,
        enrollments: enrollmentData,
        payments: payments || [],
        evaluations: evaluations || [],
        notifications: notifications || []
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load student portal' });
  }
});

app.get('/api/disciplines', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('disciplines')
    .select('id, code, name, is_active')
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data });
});

app.get('/api/establishment-disciplines', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;

  if (!establishmentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership?.role) {
      return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    }

    const { data, error } = await supabaseAdmin
      .from('establishment_disciplines')
      .select('discipline:disciplines(id, code, name), is_active')
      .eq('establishment_id', establishmentId)
      .eq('is_active', true);
    if (error) throw new Error(error.message);

    return res.json({
      ok: true,
      data: (data || []).map((row) => row.discipline).filter(Boolean)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load establishment disciplines' });
  }
});

app.get('/api/establishments', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('establishments')
    .select('id, name, city, country, is_active')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data });
});

app.get('/api/import/global-context', requireAuth, async (req, res) => {
  if (req.authUser?.id !== 'superadmin') {
    return res.status(403).json({ ok: false, error: 'Only superadmin can access global import context' });
  }

  try {
    const [establishmentsResult, disciplinesResult, membersResult] = await Promise.all([
      supabaseAdmin
        .from('establishments')
        .select('id, name, city, country, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabaseAdmin
        .from('establishment_disciplines')
        .select('establishment_id, discipline:disciplines(id, code, name), is_active')
        .eq('is_active', true),
      supabaseAdmin
        .from('establishment_members')
        .select('establishment_id, profile_id, role, profile:profiles(full_name, username)')
        .in('role', [ROLE_INSTRUCTOR, ROLE_GUARDIAN])
    ]);

    if (establishmentsResult.error) throw new Error(establishmentsResult.error.message);
    if (disciplinesResult.error) throw new Error(disciplinesResult.error.message);
    if (membersResult.error) throw new Error(membersResult.error.message);

    const establishments = (establishmentsResult.data || []).map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      country: row.country,
      is_active: row.is_active
    }));

    const disciplinesByEstablishment = {};
    for (const row of (disciplinesResult.data || [])) {
      const estId = String(row.establishment_id || '');
      if (!estId || !row.discipline) continue;
      disciplinesByEstablishment[estId] = disciplinesByEstablishment[estId] || [];
      disciplinesByEstablishment[estId].push({
        id: row.discipline.id,
        code: row.discipline.code,
        name: row.discipline.name
      });
    }

    const instructorsByEstablishment = {};
    const guardiansByEstablishment = {};
    const instructorEstablishments = {};

    for (const row of (membersResult.data || [])) {
      const estId = String(row.establishment_id || '');
      const profileId = String(row.profile_id || '');
      if (!estId || !profileId) continue;
      const payload = {
        profileId,
        fullName: row.profile?.full_name || null,
        username: row.profile?.username || null
      };

      if (row.role === ROLE_INSTRUCTOR) {
        instructorsByEstablishment[estId] = instructorsByEstablishment[estId] || [];
        instructorsByEstablishment[estId].push(payload);
        instructorEstablishments[profileId] = instructorEstablishments[profileId] || [];
        if (!instructorEstablishments[profileId].includes(estId)) {
          instructorEstablishments[profileId].push(estId);
        }
      }

      if (row.role === ROLE_GUARDIAN) {
        guardiansByEstablishment[estId] = guardiansByEstablishment[estId] || [];
        guardiansByEstablishment[estId].push(payload);
      }
    }

    return res.json({
      ok: true,
      data: {
        establishments,
        disciplinesByEstablishment,
        instructorsByEstablishment,
        guardiansByEstablishment,
        instructorEstablishments
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load global import context' });
  }
});

app.post('/api/import/resolve-students-establishments', requireAuth, async (req, res) => {
  if (req.authUser?.id !== 'superadmin') {
    return res.status(403).json({ ok: false, error: 'Only superadmin can resolve global student ownership' });
  }

  const studentIds = Array.isArray(req.body?.studentIds)
    ? [...new Set(req.body.studentIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];

  if (studentIds.length === 0) {
    return res.json({ ok: true, data: {} });
  }

  try {
    const chunkSize = 200;
    const resolved = {};

    for (let index = 0; index < studentIds.length; index += chunkSize) {
      const chunk = studentIds.slice(index, index + chunkSize);
      const { data, error } = await supabaseAdmin
        .from('students')
        .select('id, establishment_id')
        .in('id', chunk);
      if (error) throw new Error(error.message);

      for (const row of (data || [])) {
        if (!row?.id || !row?.establishment_id) continue;
        resolved[row.id] = row.establishment_id;
      }
    }

    return res.json({ ok: true, data: resolved });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not resolve student establishments' });
  }
});

// ══════════════════════════════════════════════════════════════
// TORNEOS
// ══════════════════════════════════════════════════════════════

app.get('/api/tournaments', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access' });

    const [regData, resData] = await Promise.all([
      supabaseAdmin.from('tournament_registrations')
        .select('*, students(name)')
        .eq('establishment_id', establishmentId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin.from('tournament_results')
        .select('*, students(name)')
        .eq('establishment_id', establishmentId)
        .order('created_at', { ascending: false })
        .limit(200)
    ]);
    return res.json({ ok: true, registrations: regData.data || [], results: resData.data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/tournaments/register', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, studentId, tournamentName, tournamentDate, category, mode, cost, notes } = req.body;
  if (!establishmentId || !tournamentName) return res.status(400).json({ ok: false, error: 'establishmentId and tournamentName are required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });

    const { data, error } = await supabaseAdmin.from('tournament_registrations').insert({
      establishment_id: establishmentId,
      student_id: studentId || null,
      tournament_name: tournamentName,
      tournament_date: tournamentDate || null,
      category: category || null,
      mode: mode || null,
      cost: cost ? parseFloat(cost) : null,
      notes: notes || null
    }).select().single();

    if (error) throw new Error(error.message);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/tournaments/result', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, studentId, tournamentName, mode, roundReached, medal, points, notes } = req.body;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });

    const { data, error } = await supabaseAdmin.from('tournament_results').insert({
      establishment_id: establishmentId,
      student_id: studentId || null,
      tournament_name: tournamentName || null,
      mode: mode || null,
      round_reached: roundReached || null,
      medal: medal || null,
      points: points || null,
      notes: notes || null
    }).select().single();

    if (error) throw new Error(error.message);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// INVENTARIO
// ══════════════════════════════════════════════════════════════

app.get('/api/inventory', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access' });

    let query = supabaseAdmin.from('inventory_items')
      .select('*')
      .eq('establishment_id', establishmentId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (!isManagerRole(membership.role)) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return res.json({ ok: true, data: data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/inventory', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, name, category, supplier, size, cost, price, stock, imageUrl } = req.body;
  if (!establishmentId || !name) return res.status(400).json({ ok: false, error: 'establishmentId and name are required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });

    const { data, error } = await supabaseAdmin.from('inventory_items').insert({
      establishment_id: establishmentId,
      name,
      category: category || null,
      supplier: supplier || null,
      size: size || null,
      cost: cost ? parseFloat(cost) : null,
      price: price ? parseFloat(price) : null,
      base_stock: stock ? parseInt(stock) : 0,
      stock: stock ? parseInt(stock) : 0,
      image_url: imageUrl || null
    }).select().single();

    if (error) throw new Error(error.message);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/inventory/:id/stock', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { stock, establishmentId } = req.body;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });

    const { data, error } = await supabaseAdmin.from('inventory_items')
      .update({ stock: parseInt(stock) })
      .eq('id', id)
      .eq('establishment_id', establishmentId)
      .select().single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// ACADÉMICO (solicitudes y resultados de examen de grado)
// ══════════════════════════════════════════════════════════════

app.get('/api/academics', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access' });

    const [reqData, resData] = await Promise.all([
      supabaseAdmin.from('exam_grade_requests')
        .select('*, students(name)')
        .eq('establishment_id', establishmentId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin.from('exam_grade_results')
        .select('*, students(name)')
        .eq('establishment_id', establishmentId)
        .order('created_at', { ascending: false })
        .limit(200)
    ]);
    return res.json({ ok: true, requests: reqData.data || [], results: resData.data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/academics/request', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, studentId, currentGrade, targetGrade, examDate, examFee, examiner } = req.body;
  if (!establishmentId || !studentId) return res.status(400).json({ ok: false, error: 'establishmentId and studentId are required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });

    const { data, error } = await supabaseAdmin.from('exam_grade_requests').insert({
      establishment_id: establishmentId,
      student_id: studentId,
      current_grade: currentGrade || null,
      target_grade: targetGrade || null,
      exam_date: examDate || null,
      exam_fee: examFee ? parseFloat(examFee) : null,
      examiner: examiner || null
    }).select().single();

    if (error) throw new Error(error.message);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/academics/result', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, studentId, requestId, result, score, areasEvaluated, notes } = req.body;
  if (!establishmentId || !studentId || !result) return res.status(400).json({ ok: false, error: 'establishmentId, studentId and result are required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });

    const { data, error } = await supabaseAdmin.from('exam_grade_results').insert({
      establishment_id: establishmentId,
      student_id: studentId,
      request_id: requestId || null,
      result,
      score: score || null,
      areas_evaluated: areasEvaluated || null,
      notes: notes || null
    }).select().single();

    if (error) throw new Error(error.message);

    // Si aprobado, registrar comisión automáticamente
    if (result === 'Aprobado' && data) {
      await supabaseAdmin.from('system_commissions').insert({
        establishment_id: establishmentId,
        exam_result_id: data.id,
        student_id: studentId,
        amount_commission: 1.00,
        plan_type: 'standard',
        status: 'pending'
      });
    }

    return res.status(201).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// COMISIONES (solo superadmin)
// ══════════════════════════════════════════════════════════════

// DELETE torneos
app.delete('/api/tournaments/registration/:id', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId } = req.body;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });
    const { error } = await supabaseAdmin.from('tournament_registrations').delete().eq('id', id).eq('establishment_id', establishmentId);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/api/tournaments/result/:id', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId } = req.body;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });
    const { error } = await supabaseAdmin.from('tournament_results').delete().eq('id', id).eq('establishment_id', establishmentId);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

// DELETE inventario
app.delete('/api/inventory/:id', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId } = req.body;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });
    const { error } = await supabaseAdmin.from('inventory_items').delete().eq('id', id).eq('establishment_id', establishmentId);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

// POST movimiento de inventario
app.post('/api/inventory/:id/movement', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId, type, qty, movementDate, responsible, reason } = req.body;
  if (!establishmentId || !type || !qty) return res.status(400).json({ ok: false, error: 'establishmentId, type and qty required' });
  if (!['entrada', 'salida', 'ajuste'].includes(type)) return res.status(400).json({ ok: false, error: 'type must be entrada|salida|ajuste' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });
    const { data: mov, error: movErr } = await supabaseAdmin.from('inventory_movements').insert({
      establishment_id: establishmentId, item_id: id, type, qty: parseInt(qty),
      movement_date: movementDate || null, responsible: responsible || null, reason: reason || null
    }).select().single();
    if (movErr) throw new Error(movErr.message);
    // Recalcular stock
    const { data: allMovs } = await supabaseAdmin.from('inventory_movements').select('type, qty').eq('item_id', id);
    const { data: item } = await supabaseAdmin.from('inventory_items').select('base_stock').eq('id', id).single();
    let newStock = parseInt(item?.base_stock || 0);
    const adjusts = (allMovs || []).filter(m => m.type === 'ajuste');
    if (adjusts.length > 0) {
      newStock = parseInt(adjusts[adjusts.length - 1].qty);
      (allMovs || []).filter(m => m.type !== 'ajuste').forEach(m => {
        if (m.type === 'entrada') newStock += parseInt(m.qty);
        if (m.type === 'salida') newStock -= parseInt(m.qty);
      });
    } else {
      (allMovs || []).forEach(m => {
        if (m.type === 'entrada') newStock += parseInt(m.qty);
        if (m.type === 'salida') newStock -= parseInt(m.qty);
      });
    }
    newStock = Math.max(0, newStock);
    await supabaseAdmin.from('inventory_items').update({ stock: newStock }).eq('id', id);
    return res.status(201).json({ ok: true, data: mov, newStock });
  } catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

// GET movimientos de un item
app.get('/api/inventory/:id/movements', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId } = req.query;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access' });
    const { data, error } = await supabaseAdmin.from('inventory_movements')
      .select('*').eq('item_id', id).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return res.json({ ok: true, data: data || [] });
  } catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

// DELETE académico
app.delete('/api/academics/request/:id', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId } = req.body;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });
    const { error } = await supabaseAdmin.from('exam_grade_requests').delete().eq('id', id).eq('establishment_id', establishmentId);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/api/academics/result/:id', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId } = req.body;
  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });
    const { error } = await supabaseAdmin.from('exam_grade_results').delete().eq('id', id).eq('establishment_id', establishmentId);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/commissions', requireAuth, async (req, res) => {
  const { role } = req.authUser;
  if (role !== 'superadmin') return res.status(403).json({ ok: false, error: 'Superadmin only' });

  const { establishmentId, from, to } = req.query;
  try {
    let query = supabaseAdmin.from('system_commissions')
      .select('*, establishments(name)')
      .order('created_at', { ascending: false })
      .limit(500);

    if (establishmentId) query = query.eq('establishment_id', establishmentId);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to + 'T23:59:59');

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const total = (data || []).reduce((sum, c) => sum + parseFloat(c.amount_commission || 0), 0);
    return res.json({ ok: true, data: data || [], total_commissions: parseFloat(total.toFixed(2)) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/commissions/:id/status', requireAuth, async (req, res) => {
  const { role } = req.authUser;
  if (role !== 'superadmin') return res.status(403).json({ ok: false, error: 'Superadmin only' });

  const { id } = req.params;
  const { status } = req.body;
  if (!['pending', 'paid', 'waived'].includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });

  try {
    const { data, error } = await supabaseAdmin.from('system_commissions')
      .update({ status })
      .eq('id', id)
      .select().single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// PASARELA DE PAGO (configuración por establecimiento)
// ══════════════════════════════════════════════════════════════

app.get('/api/payment-gateway/:establishmentId', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.params;
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });

    const { data, error } = await supabaseAdmin.from('payment_gateway_configs')
      .select('id, provider, is_enabled, mode, currency, link_template, success_url, cancel_url, api_key_hint, updated_at')
      .eq('establishment_id', establishmentId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data: data || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/payment-gateway/:establishmentId', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.params;
  const { provider, isEnabled, mode, currency, linkTemplate, successUrl, cancelUrl, apiKeyHint } = req.body;
  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership || !isManagerRole(membership.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });

    const payload = {
      establishment_id: establishmentId,
      provider: provider || 'none',
      is_enabled: Boolean(isEnabled),
      mode: mode || 'link',
      currency: currency || 'USD',
      link_template: linkTemplate || null,
      success_url: successUrl || null,
      cancel_url: cancelUrl || null,
      api_key_hint: apiKeyHint || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin.from('payment_gateway_configs')
      .upsert(payload, { onConflict: 'establishment_id' })
      .select().single();

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// TEORÍA (banco de preguntas por estilo y nivel)
// ══════════════════════════════════════════════════════════════

const THEORY_BANK = {
  shotokan: {
    iniciacion: [
      { type: 'fill_blank', prompt: 'En Shotokan, la postura de avance basica se llama ________.', answer: 'Zenkutsu-Dachi', aliases: ['Zenkutsu Dachi', 'Zenkutsu'] },
      { type: 'fill_blank', prompt: 'La serie de katas basicos de Shotokan se llama Heian ________.', answer: 'Shodan', aliases: ['Heian Shodan'] },
      { type: 'fill_blank', prompt: 'El fundador de Shotokan fue Gichin ________.', answer: 'Funakoshi', aliases: ['Gichin Funakoshi'] },
      { type: 'fill_blank', prompt: 'El bloqueo alto en japones se llama ________-Uke.', answer: 'Age', aliases: ['Age-Uke'] },
      { type: 'fill_blank', prompt: 'El punietazo inverso en Shotokan se llama Gyaku-________.', answer: 'Tsuki', aliases: ['Gyaku-Tsuki'] },
      { type: 'fill_blank', prompt: 'La patada frontal se llama ________-Geri.', answer: 'Mae', aliases: ['Mae-Geri'] },
      { type: 'fill_blank', prompt: 'La postura de retroceso clasica de Shotokan es ________-Dachi.', answer: 'Kokutsu', aliases: ['Kokutsu-Dachi'] },
      { type: 'fill_blank', prompt: 'El saludo en el dojo se llama ________.', answer: 'Rei' },
      { type: 'fill_blank', prompt: 'El kata Heian ________ es comun para 8o kyu Shotokan.', answer: 'Nidan', aliases: ['Heian Nidan'] },
      { type: 'fill_blank', prompt: 'El grito de energia en karate se llama ________.', answer: 'Kiai' },
      { type: 'fill_blank', prompt: 'El uniforme de karate se llama ________.', answer: 'Karategi', aliases: ['Gi', 'Karategui'] },
      { type: 'fill_blank', prompt: 'El cinturon se llama ________.', answer: 'Obi' },
      { type: 'multiple_choice', q: '¿Quién fundó el estilo Shotokan?', options: ['A. Chojun Miyagi', 'B. Kenwa Mabuni', 'C. Hironori Ohtsuka', 'D. Gichin Funakoshi'], answer: 'D' },
      { type: 'multiple_choice', q: '¿Qué significa "Dojo"?', options: ['A. Cinturon', 'B. Uniforme', 'C. Lugar donde se practica el camino', 'D. Sensei'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Jodan"?', options: ['A. Nivel bajo (piernas)', 'B. Nivel medio (torso)', 'C. Nivel alto (cabeza/cara)', 'D. Nombre de postura'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Yame"?', options: ['A. Empezar', 'B. Saludar', 'C. Parar / Detener', 'D. Atacar'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Mae-Geri"?', options: ['A. Patada circular', 'B. Patada trasera', 'C. Patada frontal', 'D. Patada lateral'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Gedan-Barai"?', options: ['A. Bloqueo alto', 'B. Patada baja', 'C. Barrido/bloqueo descendente', 'D. Punietazo al abdomen'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Como se llama la postura de caballo en Shotokan?', options: ['A. Zenkutsu-Dachi', 'B. Kokutsu-Dachi', 'C. Kiba-Dachi', 'D. Neko-Ashi-Dachi'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Hajime"?', options: ['A. Parar', 'B. Comenzar / Empezar', 'C. Girar', 'D. Saltar'], answer: 'B' }
    ],
    intermedio: [
      { type: 'fill_blank', prompt: 'En Shotokan, el recorrido del kata se llama ________.', answer: 'Embusen' },
      { type: 'fill_blank', prompt: 'El estado de alerta al terminar una tecnica se llama ________.', answer: 'Zanshin' },
      { type: 'fill_blank', prompt: 'La kata avanzada Bassai ________ es clave en Shotokan.', answer: 'Dai', aliases: ['Bassai Dai'] },
      { type: 'fill_blank', prompt: 'El foco final de potencia en una tecnica se llama ________.', answer: 'Kime' },
      { type: 'fill_blank', prompt: 'En kumite, la distancia correcta se denomina ________.', answer: 'Ma-ai', aliases: ['Maai'] },
      { type: 'fill_blank', prompt: 'La kata de la linea Tekki mas comun es Tekki ________.', answer: 'Shodan', aliases: ['Tekki Shodan'] },
      { type: 'fill_blank', prompt: 'El principio de mirada correcta en kata se llama ________.', answer: 'Chakugan' },
      { type: 'fill_blank', prompt: 'La tecnica de codo en japones se llama ________-Uchi.', answer: 'Empi', aliases: ['Empi-Uchi'] },
      { type: 'fill_blank', prompt: 'La serie Heian tiene ________ katas en Shotokan.', answer: '5', aliases: ['cinco'] },
      { type: 'fill_blank', prompt: 'La mano que retrocede a la cadera para dar potencia se llama ________.', answer: 'Hikite' },
      { type: 'fill_blank', prompt: 'La aplicacion practica de los movimientos del kata se llama ________.', answer: 'Bunkai' },
      { type: 'multiple_choice', q: '¿Qué es "Kime" en Shotokan?', options: ['A. Un tipo de kata', 'B. Foco y contraccion muscular en el punto de impacto', 'C. Posicion de piernas', 'D. Grito de combate'], answer: 'B' },
      { type: 'multiple_choice', q: 'En Gohon Kumite, cuantos ataques ejecuta el atacante?', options: ['A. 1', 'B. 3', 'C. 5', 'D. 7'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Bunkai"?', options: ['A. Un tipo de kata', 'B. Analisis y aplicacion de los movimientos del kata', 'C. Un grado avanzado', 'D. El calentamiento'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Ma-ai"?', options: ['A. Un tipo de bloqueo', 'B. La distancia correcta entre combatientes', 'C. Un kata de Shotokan', 'D. El espiritu de lucha'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Gyaku-Tsuki"?', options: ['A. Punietazo con mano del mismo lado', 'B. Punietazo inverso (mano contraria a la pierna adelantada)', 'C. Patada inversa', 'D. Bloqueo con mano abierta'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cuantos katas tiene la serie Heian en Shotokan?', options: ['A. 3', 'B. 4', 'C. 5', 'D. 6'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Chakugan" en kata?', options: ['A. Respiracion', 'B. Posicion de los pies', 'C. La mirada / direccion de los ojos', 'D. El kiai'], answer: 'C' }
    ],
    avanzado: [
      { type: 'fill_blank', prompt: 'Una kata superior representativa de Shotokan es Kanku ________.', answer: 'Dai', aliases: ['Kanku Dai'] },
      { type: 'fill_blank', prompt: 'El principio tactico de anticipar la iniciativa del rival es Sen no ________.', answer: 'Sen' },
      { type: 'fill_blank', prompt: 'La aplicacion del kata se llama ________.', answer: 'Bunkai' },
      { type: 'fill_blank', prompt: 'Una kata avanzada usada en examen dan es Jion o ________.', answer: 'Empi', aliases: ['Enpi'] },
      { type: 'fill_blank', prompt: 'La postura Hangetsu-Dachi se usa en kata ________.', answer: 'Hangetsu' },
      { type: 'fill_blank', prompt: 'La aplicacion avanzada del kata se llama Bunkai ________.', answer: 'Oyo', aliases: ['Oyo'] },
      { type: 'fill_blank', prompt: 'En Shotokan, el contrataque sobre iniciativa del rival es Go no ________.', answer: 'Sen' },
      { type: 'multiple_choice', q: '¿Cuantos katas conforman el sistema oficial del Shotokan (JKA)?', options: ['A. 15', 'B. 20', 'C. 26', 'D. 35'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Cual es el principio de "Sen no Sen" en kumite?', options: ['A. Contrataque tardio', 'B. Iniciativa anticipada al momento de que el rival inicia su ataque', 'C. Defensa pura', 'D. Ataque despues de una finta'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual es el principio de "Go no Sen"?', options: ['A. Atacar primero', 'B. Contrataque simultaneo', 'C. Contrataque despues de bloquear la iniciativa del rival', 'D. Fintar sin atacar'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Bunkai Oyo"?', options: ['A. Practica del kata solo', 'B. Aplicacion libre y creativa de los movimientos del kata en situaciones reales', 'C. Entrenamiento con armas', 'D. Competencia de kata'], answer: 'B' },
      { type: 'multiple_choice', q: 'En kata de competencia WKF, que evaluan los jueces?', options: ['A. Solo velocidad y potencia', 'B. Forma tecnica, potencia, velocidad, equilibrio, kime, ritmo y actitud deportiva', 'C. Solo kime y kiai', 'D. El numero de tecnicas'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual es la primera linea del Dojo Kun Shotokan?', options: ['A. Ser fiel', 'B. Buscar la perfeccion del caracter', 'C. Esforzarse', 'D. Respetar a los demas'], answer: 'B' }
    ],
    junior: [
      { type: 'fill_blank', prompt: 'Antes de entrar al dojo hacemos ________.', answer: 'Rei' },
      { type: 'fill_blank', prompt: 'La patada frontal se llama ________-Geri.', answer: 'Mae', aliases: ['Mae-Geri'] },
      { type: 'fill_blank', prompt: 'En Shotokan contamos: Ichi, Ni, ________.', answer: 'San' },
      { type: 'fill_blank', prompt: 'El grito de energia se llama ________.', answer: 'Kiai' },
      { type: 'fill_blank', prompt: 'La postura basica de avance es Zenkutsu-________.', answer: 'Dachi' },
      { type: 'fill_blank', prompt: 'El maestro se llama ________.', answer: 'Sensei' },
      { type: 'multiple_choice', q: '¿Que debes hacer antes de entrar al dojo?', options: ['A. Correr', 'B. Hacer Rei (reverencia) en la entrada', 'C. Gritar', 'D. Esperar sin saludar'], answer: 'B' },
      { type: 'multiple_choice', q: '¿De que color es el primer cinturon en karate?', options: ['A. Amarillo', 'B. Verde', 'C. Blanco', 'D. Rojo'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es el "Kiai"?', options: ['A. Una patada especial', 'B. El grito de energia y espiritu durante la tecnica', 'C. El nombre del cinturon', 'D. Una posicion de pies'], answer: 'B' },
      { type: 'multiple_choice', q: 'Si llegas tarde al entrenamiento, que debes hacer?', options: ['A. Entrar corriendo', 'B. No entrar', 'C. Esperar y pedir permiso al Sensei con una reverencia', 'D. Entrar sin saludar'], answer: 'C' }
    ]
  },
  goju_ryu: {
    iniciacion: [
      { type: 'fill_blank', prompt: 'El fundador de Goju-Ryu fue Chojun ________.', answer: 'Miyagi', aliases: ['Chojun Miyagi'] },
      { type: 'fill_blank', prompt: 'Una kata inicial de Goju-Ryu es Gekisai Dai ________.', answer: 'Ichi', aliases: ['Dai Ichi', 'Gekisai Dai Ichi'] },
      { type: 'fill_blank', prompt: 'Otra kata basica de Goju-Ryu es Gekisai Dai ________.', answer: 'Ni', aliases: ['Dai Ni', 'Gekisai Dai Ni'] },
      { type: 'fill_blank', prompt: 'La kata de respiracion clave en Goju-Ryu es ________.', answer: 'Sanchin' },
      { type: 'fill_blank', prompt: 'Goju significa duro y ________.', answer: 'suave' },
      { type: 'fill_blank', prompt: 'El saludo en el dojo es ________.', answer: 'Rei' },
      { type: 'fill_blank', prompt: 'La patada frontal se llama ________-Geri.', answer: 'Mae', aliases: ['Mae-Geri'] },
      { type: 'fill_blank', prompt: 'El grito de energia se llama ________.', answer: 'Kiai' },
      { type: 'fill_blank', prompt: 'El uniforme de karate se llama ________.', answer: 'Karategi', aliases: ['Gi', 'Karategui'] },
      { type: 'fill_blank', prompt: 'El cinturon se llama ________.', answer: 'Obi' },
      { type: 'multiple_choice', q: '¿Quien fundo el estilo Goju-Ryu?', options: ['A. Gichin Funakoshi', 'B. Kenwa Mabuni', 'C. Chojun Miyagi', 'D. Hironori Ohtsuka'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Goju"?', options: ['A. Fuerte y rapido', 'B. Duro y suave', 'C. Duro y lineal', 'D. Suave y circular'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Mae-Geri"?', options: ['A. Patada circular', 'B. Patada trasera', 'C. Patada frontal', 'D. Patada lateral'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Cual es la kata de respiracion mas conocida de Goju-Ryu?', options: ['A. Saifa', 'B. Seiyunchin', 'C. Sanchin', 'D. Tensho'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Yame"?', options: ['A. Empezar', 'B. Saludar', 'C. Parar / Detener', 'D. Atacar'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Jodan"?', options: ['A. Nivel bajo (piernas)', 'B. Nivel medio (torso)', 'C. Nivel alto (cabeza)', 'D. Nombre de postura'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Cual es la primera kata de Goju-Ryu para principiantes?', options: ['A. Saifa', 'B. Sanchin', 'C. Gekisai Dai Ichi', 'D. Tensho'], answer: 'C' }
    ],
    intermedio: [
      { type: 'fill_blank', prompt: 'Una kata intermedia de Goju-Ryu es Seiun________.', answer: 'chin', aliases: ['Seiyunchin', 'Seiunchin'] },
      { type: 'fill_blank', prompt: 'Otra kata intermedia es Shi________.', answer: 'sochin', aliases: ['Shisochin'] },
      { type: 'fill_blank', prompt: 'La aplicacion del kata se llama ________.', answer: 'Bunkai' },
      { type: 'fill_blank', prompt: 'La distancia correcta en combate es ________.', answer: 'Ma-ai', aliases: ['Maai'] },
      { type: 'fill_blank', prompt: 'Control mental, corporal y espiritual: Sanchin significa tres ________.', answer: 'batallas' },
      { type: 'fill_blank', prompt: 'El foco final de tecnica se llama ________.', answer: 'Kime' },
      { type: 'fill_blank', prompt: 'El estado de alerta posterior a una tecnica es ________.', answer: 'Zanshin' },
      { type: 'fill_blank', prompt: 'El recorrido del kata se llama ________.', answer: 'Embusen' },
      { type: 'fill_blank', prompt: 'La mano que retrocede a la cadera para potenciar se llama ________.', answer: 'Hikite' },
      { type: 'fill_blank', prompt: 'La kata Saifa suele ser de nivel ________ en Goju-Ryu.', answer: 'intermedio' },
      { type: 'multiple_choice', q: '¿Qué significa "Sanchin" en Goju-Ryu?', options: ['A. Tres pasos', 'B. Tres batallas (mente, cuerpo y espiritu)', 'C. Tres bloqueos', 'D. Tres patadas'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Kime"?', options: ['A. Un tipo de kata', 'B. Foco y contraccion muscular en el punto de impacto', 'C. Posicion de piernas', 'D. Grito de combate'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Bunkai"?', options: ['A. Un tipo de kata', 'B. Analisis y aplicacion de los movimientos del kata', 'C. Un grado avanzado', 'D. El calentamiento'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Ma-ai"?', options: ['A. Un tipo de bloqueo', 'B. La distancia correcta entre combatientes', 'C. Un kata exclusivo de Goju-Ryu', 'D. El espiritu de lucha'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual de estas es una kata de nivel intermedio en Goju-Ryu?', options: ['A. Suparinpei', 'B. Gekisai Dai Ichi', 'C. Seiyunchin', 'D. Kururunfa'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Chakugan" en kata?', options: ['A. Respiracion', 'B. Posicion de los pies', 'C. La mirada / direccion de los ojos', 'D. El kiai'], answer: 'C' }
    ],
    avanzado: [
      { type: 'fill_blank', prompt: 'Una kata superior de Goju-Ryu es Suparin________.', answer: 'pei', aliases: ['Suparinpei'] },
      { type: 'fill_blank', prompt: 'Otra kata alta es Kuru________.', answer: 'runfa', aliases: ['Kururunfa'] },
      { type: 'fill_blank', prompt: 'Tensho se relaciona con respiracion y control de ________.', answer: 'energia', aliases: ['energía'] },
      { type: 'fill_blank', prompt: 'La aplicacion avanzada del kata es Bunkai ________.', answer: 'Oyo', aliases: ['Oyō'] },
      { type: 'fill_blank', prompt: 'Contrataque sobre iniciativa rival: Go no ________.', answer: 'Sen' },
      { type: 'fill_blank', prompt: 'Iniciativa anticipada al inicio del ataque rival: Sen no ________.', answer: 'Sen' },
      { type: 'fill_blank', prompt: 'Suparinpei tiene ________ movimientos (numero simbolico).', answer: '108' },
      { type: 'fill_blank', prompt: 'La kata Sanchin enfatiza la ________ correcta para generar potencia.', answer: 'respiracion', aliases: ['respiración'] },
      { type: 'multiple_choice', q: '¿Cual es la kata mas avanzada del Goju-Ryu con 108 movimientos?', options: ['A. Kururunfa', 'B. Suparinpei', 'C. Tensho', 'D. Seipai'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual es el principio de "Go no Sen"?', options: ['A. Atacar primero', 'B. Contrataque simultaneo', 'C. Contrataque despues de bloquear la iniciativa del rival', 'D. Fintar sin atacar'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Cual es el principio de "Sen no Sen"?', options: ['A. Contrataque tardio', 'B. Iniciativa anticipada al momento en que el rival inicia su ataque', 'C. Defensa pura', 'D. Ataque despues de finta'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Bunkai Oyo"?', options: ['A. Practica del kata solo', 'B. Aplicacion libre de los movimientos del kata en situaciones reales', 'C. Entrenamiento con armas', 'D. Competencia de kata'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué diferencia filosofica tiene el Goju-Ryu?', options: ['A. Solo usa tecnicas duras y lineales', 'B. Combina tecnicas duras (Go) y suaves (Ju) con trabajo cercano', 'C. Solo usa patadas altas', 'D. No tiene filosofia propia'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Shiai"?', options: ['A. Entrenamiento libre', 'B. Competencia / combate formal', 'C. Kata de examen', 'D. Defensa personal'], answer: 'B' }
    ],
    junior: [
      { type: 'fill_blank', prompt: 'Goju significa duro y ________.', answer: 'suave' },
      { type: 'fill_blank', prompt: 'La kata basica es Gekisai Dai ________.', answer: 'Ichi', aliases: ['Dai Ichi'] },
      { type: 'fill_blank', prompt: 'Cuando iniciamos la clase hacemos ________.', answer: 'Rei' },
      { type: 'fill_blank', prompt: 'El maestro se llama ________.', answer: 'Sensei' },
      { type: 'fill_blank', prompt: 'La patada frontal es ________-Geri.', answer: 'Mae', aliases: ['Mae-Geri'] },
      { type: 'fill_blank', prompt: 'El grito de energia es ________.', answer: 'Kiai' },
      { type: 'multiple_choice', q: '¿Qué significa "Goju"?', options: ['A. Fuerte y rapido', 'B. Duro y suave', 'C. Solo duro', 'D. Solo suave'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Que debes hacer antes de entrar al dojo?', options: ['A. Correr', 'B. Hacer Rei (reverencia) en la entrada', 'C. Gritar', 'D. Esperar sin saludar'], answer: 'B' },
      { type: 'multiple_choice', q: '¿De que color es el primer cinturon en karate?', options: ['A. Amarillo', 'B. Verde', 'C. Blanco', 'D. Rojo'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es el "Kiai"?', options: ['A. Una patada especial', 'B. El grito de energia y espiritu durante la tecnica', 'C. El nombre del cinturon', 'D. Una posicion de pies'], answer: 'B' }
    ]
  },
  wado_ryu: {
    iniciacion: [
      { type: 'fill_blank', prompt: 'El fundador de Wado-Ryu fue Hironori ________.', answer: 'Ohtsuka', aliases: ['Otsuka', 'Hironori Ohtsuka'] },
      { type: 'fill_blank', prompt: 'La serie basica en Wado-Ryu es Pinan ________.', answer: 'Shodan', aliases: ['Pinan Shodan'] },
      { type: 'fill_blank', prompt: 'Otra kata temprana es Pinan ________.', answer: 'Nidan', aliases: ['Pinan Nidan'] },
      { type: 'fill_blank', prompt: 'Wado se asocia a la via de la ________.', answer: 'armonía', aliases: ['armonia', 'paz'] },
      { type: 'fill_blank', prompt: 'El saludo en el dojo es ________.', answer: 'Rei' },
      { type: 'fill_blank', prompt: 'El punietazo de avance es Oi-________.', answer: 'Tsuki', aliases: ['Oi-Tsuki'] },
      { type: 'fill_blank', prompt: 'La patada frontal se llama ________-Geri.', answer: 'Mae', aliases: ['Mae-Geri'] },
      { type: 'fill_blank', prompt: 'El grito de energia se llama ________.', answer: 'Kiai' },
      { type: 'fill_blank', prompt: 'El uniforme de karate se llama ________.', answer: 'Karategi', aliases: ['Gi', 'Karategui'] },
      { type: 'fill_blank', prompt: 'El cinturon se llama ________.', answer: 'Obi' },
      { type: 'multiple_choice', q: '¿Quien fundo el estilo Wado-Ryu?', options: ['A. Chojun Miyagi', 'B. Kenwa Mabuni', 'C. Gichin Funakoshi', 'D. Hironori Ohtsuka'], answer: 'D' },
      { type: 'multiple_choice', q: '¿Qué significa "Wado"?', options: ['A. Via de la fuerza', 'B. Via de la armonia / paz', 'C. Via del combate', 'D. Via del viento'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Como se llama la serie basica de katas en Wado-Ryu?', options: ['A. Heian', 'B. Gekisai', 'C. Pinan', 'D. Taikyoku'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Mae-Geri"?', options: ['A. Patada circular', 'B. Patada trasera', 'C. Patada frontal', 'D. Patada lateral'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Yame"?', options: ['A. Empezar', 'B. Saludar', 'C. Parar / Detener', 'D. Atacar'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Jodan"?', options: ['A. Nivel bajo (piernas)', 'B. Nivel medio (torso)', 'C. Nivel alto (cabeza)', 'D. Nombre de postura'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Hajime"?', options: ['A. Parar', 'B. Comenzar / Empezar', 'C. Girar', 'D. Saltar'], answer: 'B' }
    ],
    intermedio: [
      { type: 'fill_blank', prompt: 'Una kata importante en Wado-Ryu es Ku________.', answer: 'shanku', aliases: ['Kushanku'] },
      { type: 'fill_blank', prompt: 'Otra kata tradicional es Sei________.', answer: 'shan', aliases: ['Seishan', 'Seisan'] },
      { type: 'fill_blank', prompt: 'La distancia correcta se llama ________.', answer: 'Ma-ai', aliases: ['Maai'] },
      { type: 'fill_blank', prompt: 'El recorrido de kata es ________.', answer: 'Embusen' },
      { type: 'fill_blank', prompt: 'La aplicacion del kata se llama ________.', answer: 'Bunkai' },
      { type: 'fill_blank', prompt: 'El estado de alerta posterior es ________.', answer: 'Zanshin' },
      { type: 'fill_blank', prompt: 'El foco final de tecnica es ________.', answer: 'Kime' },
      { type: 'fill_blank', prompt: 'La tecnica de mano de sable se llama ________-Uke.', answer: 'Shuto', aliases: ['Shuto-Uke'] },
      { type: 'fill_blank', prompt: 'La mano que retrocede a la cadera para potenciar se llama ________.', answer: 'Hikite' },
      { type: 'fill_blank', prompt: 'La mirada en kata se llama ________.', answer: 'Chakugan' },
      { type: 'multiple_choice', q: '¿Qué es "Kime"?', options: ['A. Un tipo de kata', 'B. Foco y contraccion muscular en el punto de impacto', 'C. Posicion de piernas', 'D. Grito de combate'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Bunkai"?', options: ['A. Un tipo de kata', 'B. Analisis y aplicacion de los movimientos del kata', 'C. Un grado avanzado', 'D. El calentamiento'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Ma-ai"?', options: ['A. Un tipo de bloqueo', 'B. La distancia correcta entre combatientes', 'C. Un kata de Wado-Ryu', 'D. El espiritu de lucha'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual de estas es una kata de Wado-Ryu?', options: ['A. Heian Shodan', 'B. Gekisai Dai Ichi', 'C. Kushanku', 'D. Suparinpei'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Chakugan" en kata?', options: ['A. Respiracion', 'B. Posicion de los pies', 'C. La mirada / direccion de los ojos', 'D. El kiai'], answer: 'C' },
      { type: 'multiple_choice', q: 'En Gohon Kumite, cuantos ataques ejecuta el atacante?', options: ['A. 1', 'B. 3', 'C. 5', 'D. 7'], answer: 'C' }
    ],
    avanzado: [
      { type: 'fill_blank', prompt: 'La kata superior de Wado-Ryu Chin________.', answer: 'to', aliases: ['Chinto'] },
      { type: 'fill_blank', prompt: 'Otra kata alta de Wado-Ryu: Ro________.', answer: 'hai', aliases: ['Rohai'] },
      { type: 'fill_blank', prompt: 'En tactica, anticipar el ataque es Sen no ________.', answer: 'Sen' },
      { type: 'fill_blank', prompt: 'Responder a la iniciativa rival es Go no ________.', answer: 'Sen' },
      { type: 'fill_blank', prompt: 'El kumite formal de competencia se llama ________.', answer: 'Shiai' },
      { type: 'fill_blank', prompt: 'La aplicacion avanzada se llama Bunkai ________.', answer: 'Oyo', aliases: ['Oyō'] },
      { type: 'fill_blank', prompt: 'Principio central de Wado-Ryu: evitar choque y usar ________.', answer: 'fluidez', aliases: ['armonia', 'armonía'] },
      { type: 'fill_blank', prompt: 'La tecnica de evasion caracteristica de Wado-Ryu se llama ________.', answer: 'Taisabaki' },
      { type: 'multiple_choice', q: '¿Cual es el principio de "Sen no Sen"?', options: ['A. Contrataque tardio', 'B. Iniciativa anticipada al momento en que el rival inicia su ataque', 'C. Defensa pura', 'D. Ataque despues de finta'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual es el principio de "Go no Sen"?', options: ['A. Atacar primero', 'B. Contrataque simultaneo', 'C. Contrataque despues de bloquear la iniciativa del rival', 'D. Fintar sin atacar'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Taisabaki" en Wado-Ryu?', options: ['A. Una tecnica de golpe', 'B. Evasion / movimiento del cuerpo para evitar el ataque', 'C. Una posicion de piernas', 'D. Un tipo de patada'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual es una caracteristica filosofica clave del Wado-Ryu?', options: ['A. Fuerza bruta contra el rival', 'B. Ceder ante la fuerza del rival y usar su energia (armonia, fluidez)', 'C. Solo usar patadas altas', 'D. No tiene filosofia definida'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Bunkai Oyo"?', options: ['A. Practica del kata solo', 'B. Aplicacion libre y creativa de los movimientos del kata', 'C. Entrenamiento con armas', 'D. Competencia de kata'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Shiai"?', options: ['A. Entrenamiento libre', 'B. Competencia / combate formal', 'C. Kata de examen', 'D. Defensa personal'], answer: 'B' }
    ],
    junior: [
      { type: 'fill_blank', prompt: 'La serie basica de Wado-Ryu es Pinan ________.', answer: 'Shodan', aliases: ['Pinan Shodan'] },
      { type: 'fill_blank', prompt: 'Para entrar al dojo hacemos ________.', answer: 'Rei' },
      { type: 'fill_blank', prompt: 'En clase contamos Ichi, Ni, ________.', answer: 'San' },
      { type: 'fill_blank', prompt: 'La patada frontal es ________-Geri.', answer: 'Mae', aliases: ['Mae-Geri'] },
      { type: 'fill_blank', prompt: 'El grito de energia es ________.', answer: 'Kiai' },
      { type: 'fill_blank', prompt: 'El instructor se llama ________.', answer: 'Sensei' },
      { type: 'multiple_choice', q: '¿Qué significa "Wado"?', options: ['A. Via de la fuerza', 'B. Via de la armonia / paz', 'C. Via del combate', 'D. Via del viento'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Que debes hacer antes de entrar al dojo?', options: ['A. Correr', 'B. Hacer Rei (reverencia) en la entrada', 'C. Gritar', 'D. Esperar sin saludar'], answer: 'B' },
      { type: 'multiple_choice', q: '¿De que color es el primer cinturon en karate?', options: ['A. Amarillo', 'B. Verde', 'C. Blanco', 'D. Rojo'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es el "Kiai"?', options: ['A. Una patada especial', 'B. El grito de energia y espiritu durante la tecnica', 'C. El nombre del cinturon', 'D. Una posicion de pies'], answer: 'B' }
    ]
  },
  shito_ryu: {
    iniciacion: [
      { type: 'fill_blank', prompt: 'El fundador de Shito-Ryu fue Kenwa ________.', answer: 'Mabuni', aliases: ['Kenwa Mabuni'] },
      { type: 'fill_blank', prompt: 'En Shito-Ryu, la serie basica se llama Pinan ________.', answer: 'Shodan', aliases: ['Pinan Shodan'] },
      { type: 'fill_blank', prompt: 'La kata de nivel inicial frecuente es Pinan ________.', answer: 'Nidan', aliases: ['Pinan Nidan'] },
      { type: 'fill_blank', prompt: 'El saludo en el dojo se llama ________.', answer: 'Rei' },
      { type: 'fill_blank', prompt: 'La patada circular se llama ________-Geri.', answer: 'Mawashi', aliases: ['Mawashi-Geri'] },
      { type: 'fill_blank', prompt: 'La postura de avance comun es Zenkutsu-________.', answer: 'Dachi' },
      { type: 'fill_blank', prompt: 'El punietazo se llama ________.', answer: 'Tsuki' },
      { type: 'fill_blank', prompt: 'El grito de energia se llama ________.', answer: 'Kiai' },
      { type: 'fill_blank', prompt: 'El uniforme de karate se llama ________.', answer: 'Karategi', aliases: ['Gi', 'Karategui'] },
      { type: 'fill_blank', prompt: 'El cinturon se llama ________.', answer: 'Obi' },
      { type: 'multiple_choice', q: '¿Quien fundo el estilo Shito-Ryu?', options: ['A. Chojun Miyagi', 'B. Kenwa Mabuni', 'C. Gichin Funakoshi', 'D. Hironori Ohtsuka'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Como se llama la serie basica de katas en Shito-Ryu?', options: ['A. Heian', 'B. Pinan', 'C. Gekisai', 'D. Taikyoku'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Mae-Geri"?', options: ['A. Patada circular', 'B. Patada trasera', 'C. Patada frontal', 'D. Patada lateral'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Yame"?', options: ['A. Empezar', 'B. Saludar', 'C. Parar / Detener', 'D. Atacar'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Jodan"?', options: ['A. Nivel bajo (piernas)', 'B. Nivel medio (torso)', 'C. Nivel alto (cabeza)', 'D. Nombre de postura'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Mawashi-Geri"?', options: ['A. Patada frontal', 'B. Patada lateral', 'C. Patada circular (de gancho)', 'D. Patada trasera'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Hajime"?', options: ['A. Parar', 'B. Comenzar / Empezar', 'C. Girar', 'D. Saltar'], answer: 'B' }
    ],
    intermedio: [
      { type: 'fill_blank', prompt: 'La aplicacion del kata se llama ________.', answer: 'Bunkai' },
      { type: 'fill_blank', prompt: 'Una kata intermedia de Shito-Ryu es Bassai ________.', answer: 'Dai', aliases: ['Bassai Dai'] },
      { type: 'fill_blank', prompt: 'La distancia correcta en combate es ________.', answer: 'Ma-ai', aliases: ['Maai'] },
      { type: 'fill_blank', prompt: 'El recorrido del kata se llama ________.', answer: 'Embusen' },
      { type: 'fill_blank', prompt: 'Naifanchi ________ aparece en grados intermedios.', answer: 'Shodan', aliases: ['Naifanchi Shodan'] },
      { type: 'fill_blank', prompt: 'La mirada en kata se llama ________.', answer: 'Chakugan' },
      { type: 'fill_blank', prompt: 'El enfoque final de energia se llama ________.', answer: 'Kime' },
      { type: 'fill_blank', prompt: 'El bloqueo bajo descendente se llama ________-Barai.', answer: 'Gedan', aliases: ['Gedan-Barai'] },
      { type: 'fill_blank', prompt: 'El estado de alerta posterior a una tecnica es ________.', answer: 'Zanshin' },
      { type: 'fill_blank', prompt: 'La mano que retrocede a la cadera para potenciar se llama ________.', answer: 'Hikite' },
      { type: 'multiple_choice', q: '¿Qué es "Kime"?', options: ['A. Un tipo de kata', 'B. Foco y contraccion muscular en el punto de impacto', 'C. Posicion de piernas', 'D. Grito de combate'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Bunkai"?', options: ['A. Un tipo de kata', 'B. Analisis y aplicacion de los movimientos del kata', 'C. Un grado avanzado', 'D. El calentamiento'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Ma-ai"?', options: ['A. Un tipo de bloqueo', 'B. La distancia correcta entre combatientes', 'C. Un kata de Shito-Ryu', 'D. El espiritu de lucha'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual de estas es una kata de Shito-Ryu?', options: ['A. Heian Shodan', 'B. Gekisai Dai Ichi', 'C. Naifanchi Shodan', 'D. Taikyoku Shodan'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué significa "Chakugan" en kata?', options: ['A. Respiracion', 'B. Posicion de los pies', 'C. La mirada / direccion de los ojos', 'D. El kiai'], answer: 'C' },
      { type: 'multiple_choice', q: 'En Gohon Kumite, cuantos ataques ejecuta el atacante?', options: ['A. 1', 'B. 3', 'C. 5', 'D. 7'], answer: 'C' }
    ],
    avanzado: [
      { type: 'fill_blank', prompt: 'Una kata avanzada de Shito-Ryu es Kosokun ________.', answer: 'Dai', aliases: ['Kosokun Dai'] },
      { type: 'fill_blank', prompt: 'Otra kata superior es Nisei________.', answer: 'shi', aliases: ['Niseishi'] },
      { type: 'fill_blank', prompt: 'El principio de alerta final se llama ________.', answer: 'Zanshin' },
      { type: 'fill_blank', prompt: 'La tecnica de mano de sable se llama ________-Uke.', answer: 'Shuto', aliases: ['Shuto-Uke'] },
      { type: 'fill_blank', prompt: 'El trabajo de aplicacion real avanzada se llama Bunkai ________.', answer: 'Oyo', aliases: ['Oyō'] },
      { type: 'fill_blank', prompt: 'En kumite avanzado, la iniciativa anticipada es Sen no ________.', answer: 'Sen' },
      { type: 'fill_blank', prompt: 'El contrataque sobre iniciativa del rival es Go no ________.', answer: 'Sen' },
      { type: 'fill_blank', prompt: 'La kata Chinte se considera de nivel ________.', answer: 'avanzado', aliases: ['superior'] },
      { type: 'multiple_choice', q: '¿Cual es el principio de "Sen no Sen"?', options: ['A. Contrataque tardio', 'B. Iniciativa anticipada al momento en que el rival inicia su ataque', 'C. Defensa pura', 'D. Ataque despues de finta'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual es el principio de "Go no Sen"?', options: ['A. Atacar primero', 'B. Contrataque simultaneo', 'C. Contrataque despues de bloquear la iniciativa del rival', 'D. Fintar sin atacar'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es "Bunkai Oyo"?', options: ['A. Practica del kata solo', 'B. Aplicacion libre y creativa de los movimientos del kata en situaciones reales', 'C. Entrenamiento con armas', 'D. Competencia de kata'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Qué es "Shiai"?', options: ['A. Entrenamiento libre', 'B. Competencia / combate formal', 'C. Kata de examen', 'D. Defensa personal'], answer: 'B' },
      { type: 'multiple_choice', q: 'En kata de competencia WKF, que evaluan los jueces?', options: ['A. Solo velocidad y potencia', 'B. Forma tecnica, potencia, velocidad, equilibrio, kime, ritmo y actitud deportiva', 'C. Solo kime y kiai', 'D. El numero de tecnicas'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Cual es una caracteristica del Shito-Ryu respecto a otros estilos?', options: ['A. Solo usa tecnicas de patada', 'B. Combina tecnicas de Shuri-Te y Naha-Te con un extenso repertorio de katas', 'C. No tiene katas propios', 'D. Solo usa tecnicas de brazo'], answer: 'B' }
    ],
    junior: [
      { type: 'fill_blank', prompt: 'La serie basica de Shito-Ryu se llama Pinan ________.', answer: 'Shodan', aliases: ['Pinan Shodan'] },
      { type: 'fill_blank', prompt: 'Para contar tres en japones: Ichi, Ni, ________.', answer: 'San' },
      { type: 'fill_blank', prompt: 'Cuando saludamos al maestro hacemos ________.', answer: 'Rei' },
      { type: 'fill_blank', prompt: 'El uniforme se llama Karate________.', answer: 'gi', aliases: ['Karategi'] },
      { type: 'fill_blank', prompt: 'La patada frontal es ________-Geri.', answer: 'Mae', aliases: ['Mae-Geri'] },
      { type: 'fill_blank', prompt: 'El grito de energia es ________.', answer: 'Kiai' },
      { type: 'multiple_choice', q: '¿Como se llama la serie basica de katas en Shito-Ryu?', options: ['A. Heian', 'B. Pinan', 'C. Gekisai', 'D. Taikyoku'], answer: 'B' },
      { type: 'multiple_choice', q: '¿Que debes hacer antes de entrar al dojo?', options: ['A. Correr', 'B. Hacer Rei (reverencia) en la entrada', 'C. Gritar', 'D. Esperar sin saludar'], answer: 'B' },
      { type: 'multiple_choice', q: '¿De que color es el primer cinturon en karate?', options: ['A. Amarillo', 'B. Verde', 'C. Blanco', 'D. Rojo'], answer: 'C' },
      { type: 'multiple_choice', q: '¿Qué es el "Kiai"?', options: ['A. Una patada especial', 'B. El grito de energia y espiritu durante la tecnica', 'C. El nombre del cinturon', 'D. Una posicion de pies'], answer: 'B' }
    ]
  }
};

app.get('/api/theory/bank', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, discipline, style } = req.query;
  if (!establishmentId || !discipline || !style) {
    return res.status(400).json({ ok: false, error: 'establishmentId, discipline and style are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (![ROLE_SUPERADMIN, ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN].includes(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient role' });
    }

    const safeDiscipline = String(discipline).trim();
    const safeStyle = String(style).trim();
    if (!/^[a-z0-9_]+$/i.test(safeDiscipline) || !/^[a-z0-9_]+$/i.test(safeStyle)) {
      return res.status(400).json({ ok: false, error: 'Invalid discipline/style format' });
    }

    const data = loadTheoryFromFile(safeDiscipline, safeStyle);
    if (!data) return res.status(404).json({ ok: false, error: `No theory data found for ${safeDiscipline}/${safeStyle}` });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load theory bank' });
  }
});

app.put('/api/theory/bank', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, discipline, style, data } = req.body || {};
  if (!establishmentId || !discipline || !style || !data) {
    return res.status(400).json({ ok: false, error: 'establishmentId, discipline, style and data are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });
    if (![ROLE_SUPERADMIN, ROLE_OWNER, ROLE_SENSEI, ROLE_ADMIN].includes(membership.role)) {
      return res.status(403).json({ ok: false, error: 'Insufficient role' });
    }

    const safeDiscipline = String(discipline).trim();
    const safeStyle = String(style).trim();
    if (!/^[a-z0-9_]+$/i.test(safeDiscipline) || !/^[a-z0-9_]+$/i.test(safeStyle)) {
      return res.status(400).json({ ok: false, error: 'Invalid discipline/style format' });
    }

    const requiredLevels = ['iniciacion', 'intermedio', 'avanzado', 'junior'];
    const payload = (data && typeof data === 'object') ? data : null;
    if (!payload) {
      return res.status(400).json({ ok: false, error: 'data must be a JSON object' });
    }

    for (const level of requiredLevels) {
      if (!Array.isArray(payload[level])) {
        return res.status(400).json({ ok: false, error: `Missing level array: ${level}` });
      }
    }

    const filePath = path.join(__dirname, '..', 'theory-data', safeDiscipline, `${safeStyle}.json`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');

    return res.json({ ok: true, data: { discipline: safeDiscipline, style: safeStyle, levels: requiredLevels } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not save theory bank' });
  }
});

app.get('/api/theory', requireAuth, async (req, res) => {
  const { discipline, style, level } = req.query;

  const normalizeToken = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const BELT_TO_LEVEL = {
    karate: {
      blanco: 'iniciacion',
      amarillo: 'iniciacion',
      naranja: 'intermedio',
      verde: 'intermedio',
      azul: 'avanzado',
      marron: 'avanzado',
      negro: 'junior'
    },
    judo: {
      blanco: 'iniciacion',
      amarillo: 'iniciacion',
      naranja: 'intermedio',
      verde: 'intermedio',
      azul: 'avanzado',
      marron: 'avanzado',
      negro: 'junior'
    },
    bjj: {
      blanco: 'iniciacion',
      azul: 'intermedio',
      morado: 'avanzado',
      marron: 'junior',
      negro: 'junior'
    },
    taekwondo: {
      blanco: 'iniciacion',
      amarillo: 'iniciacion',
      verde: 'intermedio',
      azul: 'avanzado',
      rojo: 'avanzado',
      negro: 'junior'
    },
    aikido: {
      blanco: 'iniciacion',
      amarillo: 'intermedio',
      verde: 'intermedio',
      azul: 'avanzado',
      marron: 'avanzado',
      negro: 'junior'
    },
    kendo: {
      blanco: 'iniciacion',
      azul: 'intermedio',
      marron: 'avanzado',
      negro: 'junior'
    }
  };

  const BELT_ALIASES = {
    blanca: 'blanco',
    white: 'blanco',
    yellow: 'amarillo',
    amarilla: 'amarillo',
    orange: 'naranja',
    naranja: 'naranja',
    green: 'verde',
    verde: 'verde',
    blue: 'azul',
    azul: 'azul',
    brown: 'marron',
    marron: 'marron',
    marronn: 'marron',
    black: 'negro',
    negra: 'negro',
    negro: 'negro',
    purple: 'morado',
    morada: 'morado',
    morado: 'morado',
    red: 'rojo',
    roja: 'rojo',
    rojo: 'rojo'
  };

  const resolveLevel = (disciplineCode, inputLevel, theoryDataByLevel) => {
    const raw = String(inputLevel || '').trim();
    const normalized = normalizeToken(raw);
    if (!normalized) return normalized;

    if (theoryDataByLevel[normalized]) return normalized;
    const mappedByDiscipline = BELT_TO_LEVEL[disciplineCode]?.[normalized];
    if (mappedByDiscipline && theoryDataByLevel[mappedByDiscipline]) return mappedByDiscipline;

    const chunks = normalized.split(/[\s/_-]+/).filter(Boolean);
    const candidateBelts = [normalized, ...chunks]
      .map(t => BELT_ALIASES[t] || t)
      .filter(Boolean);

    for (const beltName of candidateBelts) {
      const mapped = BELT_TO_LEVEL[disciplineCode]?.[beltName];
      if (mapped && theoryDataByLevel[mapped]) return mapped;
    }

    return normalized;
  };

  const THEORY_DISCIPLINES = {
    karate: {
      styles: ['shotokan', 'goju_ryu', 'wado_ryu', 'shito_ryu'],
      levelMode: 'belts'
    },
    judo: {
      styles: ['kodokan', 'ijf_sport'],
      levelMode: 'belts'
    },
    bjj: {
      styles: ['gracie_jiu_jitsu', 'sport_bjj'],
      levelMode: 'belts'
    },
    taekwondo: {
      styles: ['wt_olympic', 'itf'],
      levelMode: 'belts'
    },
    aikido: {
      styles: ['aikikai', 'yoshinkan'],
      levelMode: 'belts'
    },
    kendo: {
      styles: ['standard_curriculum'],
      levelMode: 'belts'
    },
    kickboxing: {
      styles: ['k1', 'dutch_style'],
      levelMode: 'levels'
    },
    muay_thai: {
      styles: ['traditional', 'sport'],
      levelMode: 'levels'
    },
    boxing: {
      styles: ['olympic', 'professional'],
      levelMode: 'levels'
    },
    mma: {
      styles: ['modern_mma'],
      levelMode: 'levels'
    }
  };

  const THEORY_LEVEL_LABELS = {
    karate: {
      iniciacion: 'Blanco a Amarillo (10-8 Kyu)',
      intermedio: 'Naranja a Verde (7-5 Kyu)',
      avanzado: 'Azul a Marron (4-1 Kyu)',
      junior: 'Shodan a Nidan (1-2 Dan)'
    },
    judo: {
      iniciacion: 'Blanco a Amarillo (6-4 Kyu)',
      intermedio: 'Naranja a Azul (3-1 Kyu)',
      avanzado: 'Marron (Pre-Dan)',
      junior: 'Shodan a Nidan (1-2 Dan)'
    },
    bjj: {
      iniciacion: 'Blanco (Fundamentos)',
      intermedio: 'Azul (Control y escapes)',
      avanzado: 'Morado (Transiciones)',
      junior: 'Marron a Negro (Alto rendimiento)'
    },
    taekwondo: {
      iniciacion: '10-7 Geup (Basico)',
      intermedio: '6-4 Geup (Intermedio)',
      avanzado: '3-1 Geup (Avanzado)',
      junior: '1-2 Dan (Cinturon negro inicial)'
    },
    aikido: {
      iniciacion: '6-4 Kyu (Ukemi y bases)',
      intermedio: '3-1 Kyu (Controles)',
      avanzado: 'Shodan (Aplicacion)',
      junior: 'Nidan a Sandan (Perfeccionamiento)'
    },
    kendo: {
      iniciacion: 'Mudansha (Kihon y reiho)',
      intermedio: 'Ikkyu a Shodan',
      avanzado: 'Nidan a Sandan',
      junior: 'Yondan a Godan'
    },
    kickboxing: {
      iniciacion: 'Nivel 1 - Fundamentos',
      intermedio: 'Nivel 2 - Tecnico tactico',
      avanzado: 'Nivel 3 - Competitivo',
      junior: 'Nivel 4 - Alto rendimiento'
    },
    muay_thai: {
      iniciacion: 'Nivel 1 - Fundamentos',
      intermedio: 'Nivel 2 - Clinch y timing',
      avanzado: 'Nivel 3 - Competitivo',
      junior: 'Nivel 4 - Alto rendimiento'
    },
    boxing: {
      iniciacion: 'Nivel 1 - Fundamentos',
      intermedio: 'Nivel 2 - Combinaciones',
      avanzado: 'Nivel 3 - Estrategia',
      junior: 'Nivel 4 - Alto rendimiento'
    },
    mma: {
      iniciacion: 'Nivel 1 - Bases mixtas',
      intermedio: 'Nivel 2 - Integracion de fases',
      avanzado: 'Nivel 3 - Competitivo',
      junior: 'Nivel 4 - Alto rendimiento'
    }
  };

  // If no discipline specified, return all disciplines
  if (!discipline) {
    return res.json({ ok: true, disciplines: THEORY_DISCIPLINES, levelLabels: THEORY_LEVEL_LABELS });
  }

  // Validate discipline
  const disciplineMeta = THEORY_DISCIPLINES[discipline];
  if (!disciplineMeta) {
    return res.status(400).json({ ok: false, error: `Discipline must be one of: ${Object.keys(THEORY_DISCIPLINES).join(', ')}` });
  }

  // If no style specified, return available styles for this discipline
  if (!style) {
    return res.json({
      ok: true,
      discipline,
      styles: disciplineMeta.styles,
      levelMode: disciplineMeta.levelMode,
      levelLabels: THEORY_LEVEL_LABELS[discipline] || THEORY_LEVEL_LABELS.kickboxing
    });
  }

  // Validate style
  if (!disciplineMeta.styles.includes(style)) {
    return res.status(400).json({ ok: false, error: `Style must be one of: ${disciplineMeta.styles.join(', ')}` });
  }

  // Try to load from JSON file first
  let theoryData = loadTheoryFromFile(discipline, style);

  // Fallback to THEORY_BANK for karate (backward compatibility)
  if (!theoryData && discipline === 'karate' && THEORY_BANK[style]) {
    theoryData = THEORY_BANK[style];
  }

  if (!theoryData) {
    return res.status(404).json({ ok: false, error: `No theory data found for ${discipline}/${style}` });
  }

  // If no level specified, return available levels
  if (!level) {
    return res.json({
      ok: true,
      discipline,
      style,
      levelMode: disciplineMeta.levelMode,
      levelLabels: THEORY_LEVEL_LABELS[discipline] || THEORY_LEVEL_LABELS.kickboxing,
      levels: Object.keys(theoryData)
    });
  }

  const resolvedLevel = resolveLevel(discipline, level, theoryData);

  // Validate level and return questions
  const questions = theoryData[resolvedLevel] || [];
  if (!questions.length) {
    return res.status(404).json({
      ok: false,
      error: `No questions found for level: ${level}`,
      resolvedLevel,
      availableLevels: Object.keys(theoryData)
    });
  }

  res.json({
    ok: true,
    discipline,
    style,
    level: resolvedLevel,
    requestedLevel: level,
    levelMode: disciplineMeta.levelMode,
    levelLabel: THEORY_LEVEL_LABELS[discipline]?.[resolvedLevel] || resolvedLevel,
    count: questions.length,
    data: questions
  });
});

// ─── CRM Prospectos ─────────────────────────────────────────────────────────
const prospectsPath = path.join(__dirname, '..', 'data', 'prospects.json');

const getProspectStore = () => {
  const data = readJsonStore(prospectsPath, {});
  return data && typeof data === 'object' ? data : {};
};

const saveProspectStore = (store) => {
  writeJsonStore(prospectsPath, store || {});
};

// GET /api/prospects — List prospects (with optional filters)
app.get('/api/prospects', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, status, source, daysOld } = req.query;

  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const store = getProspectStore();
    const estKey = String(establishmentId);
    let prospects = store[estKey] || [];

    // Filter by status
    if (status) {
      prospects = prospects.filter(p => String(p.status || '').toLowerCase() === String(status).toLowerCase());
    }

    // Filter by source
    if (source) {
      prospects = prospects.filter(p => String(p.source || '').toLowerCase() === String(source).toLowerCase());
    }

    // Filter by days old (e.g. prospects older than N days without follow-up)
    if (daysOld) {
      const cutoff = Date.now() - (Number(daysOld) * 86400000);
      prospects = prospects.filter(p => {
        if (!p.lastContactedAt) return new Date(p.createdAt).getTime() < cutoff;
        return new Date(p.lastContactedAt).getTime() < cutoff;
      });
    }

    // Sort by most recent first
    prospects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.json({ ok: true, data: prospects });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load prospects' });
  }
});

// POST /api/prospects — Create a new prospect
app.post('/api/prospects', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, name, phone, email, source, notes, disciplineCode } = req.body || {};

  if (!establishmentId || !name || !phone) {
    return res.status(400).json({ ok: false, error: 'establishmentId, name and phone are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const store = getProspectStore();
    const estKey = String(establishmentId);
    if (!store[estKey]) store[estKey] = [];

    const prospect = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: email ? String(email).trim() : null,
      source: source || 'direct',
      notes: notes || null,
      disciplineCode: disciplineCode || null,
      status: 'new',
      createdBy: profileId,
      createdAt: new Date().toISOString(),
      lastContactedAt: null,
      contactedCount: 0,
      convertedToStudentId: null
    };

    store[estKey].push(prospect);
    saveProspectStore(store);

    return res.status(201).json({ ok: true, data: prospect });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not create prospect' });
  }
});

// PATCH /api/prospects/:id — Update prospect status or info
app.patch('/api/prospects/:id', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId, status, notes, contacted } = req.body || {};

  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const store = getProspectStore();
    const estKey = String(establishmentId);
    const prospects = store[estKey] || [];
    const idx = prospects.findIndex(p => p.id === id);

    if (idx === -1) return res.status(404).json({ ok: false, error: 'Prospect not found' });

    if (status) {
      const validStatuses = ['new', 'contacted', 'trial_scheduled', 'trial_done', 'enrolled', 'lost'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ ok: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }
      prospects[idx].status = status;
    }
    if (notes !== undefined) prospects[idx].notes = notes;
    if (contacted === true) {
      prospects[idx].lastContactedAt = new Date().toISOString();
      prospects[idx].contactedCount = (prospects[idx].contactedCount || 0) + 1;
    }

    saveProspectStore(store);

    return res.json({ ok: true, data: prospects[idx] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not update prospect' });
  }
});

// GET /api/prospects/reminders — Get prospects that need follow-up
app.get('/api/prospects/reminders', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId } = req.query;

  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const store = getProspectStore();
    const estKey = String(establishmentId);
    const prospects = store[estKey] || [];

    const now = Date.now();
    const threeDays = 3 * 86400000;
    const sevenDays = 7 * 86400000;

    const reminders = prospects.filter(p => {
      if (p.status === 'enrolled' || p.status === 'lost') return false;
      const lastContact = p.lastContactedAt ? new Date(p.lastContactedAt).getTime() : new Date(p.createdAt).getTime();
      const elapsed = now - lastContact;
      return elapsed >= threeDays;
    }).map(p => {
      const lastContact = p.lastContactedAt ? new Date(p.lastContactedAt).getTime() : new Date(p.createdAt).getTime();
      const elapsed = now - lastContact;
      return {
        ...p,
        daysSinceContact: Math.floor(elapsed / 86400000),
        priority: elapsed >= sevenDays ? 'high' : 'medium'
      };
    }).sort((a, b) => b.daysSinceContact - a.daysSinceContact);

    return res.json({ ok: true, data: reminders });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load reminders' });
  }
});

// POST /api/prospects/:id/convert — Convert prospect to student
app.post('/api/prospects/:id/convert', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId, disciplineCode, studentId } = req.body || {};

  if (!establishmentId || !studentId) {
    return res.status(400).json({ ok: false, error: 'establishmentId and studentId are required' });
  }

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const store = getProspectStore();
    const estKey = String(establishmentId);
    const prospects = store[estKey] || [];
    const idx = prospects.findIndex(p => p.id === id);

    if (idx === -1) return res.status(404).json({ ok: false, error: 'Prospect not found' });

    prospects[idx].status = 'enrolled';
    prospects[idx].convertedToStudentId = studentId;
    prospects[idx].enrolledAt = new Date().toISOString();
    saveProspectStore(store);

    return res.json({ ok: true, data: prospects[idx] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not convert prospect' });
  }
});

// ─── Churn Rate ──────────────────────────────────────────────────────────
// GET /api/reports/churn — Detect students at risk of dropping out
app.get('/api/reports/churn', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { establishmentId, disciplineCode, daysInactive } = req.query;

  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  const inactiveThreshold = Number(daysInactive) || 15;

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const allowedDisciplineIds = await getAllowedDisciplineIds(membership.role, profileId, establishmentId);
    const targetDiscipline = await resolveDisciplineFilter(establishmentId, disciplineCode, allowedDisciplineIds).catch(() => null);
    const filteredDisciplineIds = targetDiscipline
      ? allowedDisciplineIds.filter(id => id === targetDiscipline.id)
      : allowedDisciplineIds;

    if (filteredDisciplineIds.length === 0) {
      return res.json({ ok: true, data: { atRisk: [], churnRate: 0, totalActive: 0, threshold: inactiveThreshold } });
    }

    // Get active enrollments
    const { data: enrollments, error: enrollmentError } = await supabaseAdmin
      .from('student_enrollments')
      .select('student_id, discipline_id, current_rank, joined_at')
      .in('discipline_id', filteredDisciplineIds)
      .eq('status', 'active')
      .limit(5000);
    if (enrollmentError) throw new Error(enrollmentError.message);

    const studentIds = [...new Set((enrollments || []).map(e => e.student_id).filter(Boolean))];
    if (studentIds.length === 0) {
      return res.json({ ok: true, data: { atRisk: [], churnRate: 0, totalActive: 0, threshold: inactiveThreshold } });
    }

    // Get latest attendance for each student
    const { data: attendanceRecords, error: attendanceError } = await supabaseAdmin
      .from('class_attendance_records')
      .select('student_id, marked_at')
      .in('student_id', studentIds)
      .order('marked_at', { ascending: false })
      .limit(10000);
    if (attendanceError) throw new Error(attendanceError.message);

    // Get students info
    const [{ data: students }, { data: disciplines }] = await Promise.all([
      supabaseAdmin.from('students').select('id, full_name, email, phone').in('id', studentIds),
      supabaseAdmin.from('disciplines').select('id, code, name').in('id', filteredDisciplineIds)
    ]);

    const discMap = new Map((disciplines || []).map(d => [d.id, { code: d.code, name: d.name }]));
    const studentMap = new Map((students || []).map(s => [s.id, s]));
    const enrollByStudent = new Map((enrollments || []).map(e => [e.student_id, e]));

    // Find latest attendance per student
    const latestAttendance = new Map();
    (attendanceRecords || []).forEach(r => {
      const sid = r.student_id;
      const existing = latestAttendance.get(sid);
      if (!existing || new Date(r.marked_at) > new Date(existing)) {
        latestAttendance.set(sid, r.marked_at);
      }
    });

    const now = Date.now();
    const cutoff = now - (inactiveThreshold * 86400000);

    const atRisk = [];
    studentIds.forEach(sid => {
      const lastDate = latestAttendance.get(sid);
      const lastTs = lastDate ? new Date(lastDate).getTime() : 0;
      const daysSince = Math.floor((now - lastTs) / 86400000);
      const student = studentMap.get(sid);
      const enrollment = enrollByStudent.get(sid);
      if (!student || !enrollment) return;

      if (!lastDate || daysSince >= inactiveThreshold) {
        atRisk.push({
          studentId: sid,
          fullName: student.full_name || '-',
          email: student.email || null,
          phone: student.phone || null,
          discipline: discMap.get(enrollment.discipline_id) || { code: '-', name: '-' },
          currentRank: enrollment.current_rank || null,
          joinedAt: enrollment.joined_at || null,
          lastAttendance: lastDate || null,
          daysSinceLastClass: lastDate ? daysSince : null,
          status: lastDate ? 'inactive' : 'never_attended'
        });
      }
    });

    atRisk.sort((a, b) => (b.daysSinceLastClass || 999) - (a.daysSinceLastClass || 999));

    const totalActive = studentIds.length;
    const churnRate = totalActive > 0 ? Number(((atRisk.length / totalActive) * 100).toFixed(2)) : 0;

    return res.json({
      ok: true,
      data: {
        atRisk,
        churnRate,
        totalActive,
        atRiskCount: atRisk.length,
        threshold: inactiveThreshold,
        discipline: targetDiscipline || null
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not load churn report' });
  }
});

// ─── QR de Identificación ──────────────────────────────────────────────────
const QRCode = require('qrcode');

// GET /api/students/:id/qr — Generate QR code for a student
app.get('/api/students/:id/qr', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { id } = req.params;
  const { establishmentId } = req.query;

  if (!establishmentId) return res.status(400).json({ ok: false, error: 'establishmentId is required' });

  try {
    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const { data: student, error: studentError } = await supabaseAdmin
      .from('students')
      .select('id, full_name, establishment_id')
      .eq('id', id)
      .eq('establishment_id', establishmentId)
      .single();
    if (studentError || !student) return res.status(404).json({ ok: false, error: 'Student not found' });

    // Build QR payload with student info
    const qrPayload = JSON.stringify({
      type: 'student_id',
      studentId: student.id,
      name: student.full_name,
      establishmentId: student.establishment_id,
      ts: Date.now()
    });

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      width: 400,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });

    return res.json({ ok: true, data: { qrDataUrl, student } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not generate QR code' });
  }
});

// POST /api/attendance/qr-scan — Mark attendance by scanning QR
app.post('/api/attendance/qr-scan', requireAuth, async (req, res) => {
  const profileId = req.authUser.id;
  const { qrData, classId, status } = req.body || {};

  if (!qrData || !classId) {
    return res.status(400).json({ ok: false, error: 'qrData and classId are required' });
  }

  try {
    let payload;
    try {
      payload = JSON.parse(qrData);
    } catch (_) {
      return res.status(400).json({ ok: false, error: 'Invalid QR data format' });
    }

    if (payload.type !== 'student_id' || !payload.studentId || !payload.establishmentId) {
      return res.status(400).json({ ok: false, error: 'Invalid QR code: not a student ID' });
    }

    const { studentId, establishmentId } = payload;

    const membership = await getMembership(profileId, establishmentId);
    if (!membership) return res.status(403).json({ ok: false, error: 'No access to this establishment' });

    const { data: classSession, error: classError } = await supabaseAdmin
      .from('class_sessions')
      .select('id, establishment_id, discipline_id')
      .eq('id', classId)
      .eq('establishment_id', establishmentId)
      .single();
    if (classError || !classSession) return res.status(404).json({ ok: false, error: 'Class not found' });

    const finalStatus = status || 'present';

    const { data, error } = await supabaseAdmin
      .from('class_attendance_records')
      .upsert({
        class_session_id: classId,
        student_id: studentId,
        status: finalStatus,
        notes: 'Marcado por QR',
        marked_by: profileId,
        marked_at: new Date().toISOString()
      }, { onConflict: 'class_session_id,student_id' })
      .select('id, student_id, status, marked_at');

    if (error) throw new Error(error.message);
    return res.json({ ok: true, data: data || [], scanned: { studentId, name: payload.name } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Could not process QR scan' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MartialSystem running at http://localhost:${PORT}`);
});

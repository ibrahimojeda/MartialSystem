// server/messaging.js
// Mensajería interna entre usuarios (Fase B).
// Tablas separadas de notifications. Todo acceso valida tenancy y membresía.
// Recibe el cliente Supabase como parámetro (db) para ser testeable sin red.

const crypto = require('crypto');

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

async function getLinkedStudentProfileIds(db, guardianProfileId) {
  const { data: links } = await db.from('guardian_students').select('student_id').eq('guardian_profile_id', guardianProfileId).limit(5000);
  const studentIds = [...new Set((links || []).map((l) => l.student_id).filter(Boolean))];
  if (!studentIds.length) return [];
  const { data: students } = await db.from('students').select('profile_id').in('id', studentIds).limit(5000);
  return [...new Set((students || []).map((s) => s.profile_id).filter(Boolean))];
}

async function isMember(db, conversationId, profileId) {
  const { data } = await db.from('conversation_members').select('id').eq('conversation_id', conversationId).eq('profile_id', profileId).maybeSingle();
  return Boolean(data);
}

// Regla de acceso a una conversación (fail-closed).
// - superadmin: global.
// - owner/admin: solo conversaciones de su establecimiento.
// - student/sensei/instructor: solo si es miembro.
// - guardian: si es miembro O un alumno vinculado es miembro.
async function canAccessConversation(db, ctx, conversation) {
  const role = String((ctx && ctx.role) || '').toLowerCase();
  if (role === 'superadmin') return true;
  if (role === 'owner' || role === 'admin') return String(conversation.establishment_id) === String(ctx.establishmentId);
  if (await isMember(db, conversation.id, ctx.profileId)) return true;
  if (role === 'guardian') {
    const linked = await getLinkedStudentProfileIds(db, ctx.profileId);
    if (!linked.length) return false;
    const { data } = await db.from('conversation_members').select('id').eq('conversation_id', conversation.id).in('profile_id', linked).maybeSingle();
    return Boolean(data);
  }
  return false;
}

async function unreadCount(db, conversationId, profileId) {
  const { data: msgs } = await db.from('messages').select('id, sender_profile_id').eq('conversation_id', conversationId).limit(200);
  const arr = msgs || [];
  const mine = arr.filter((m) => m.sender_profile_id !== profileId);
  if (!mine.length) return 0;
  const ids = mine.map((m) => m.id);
  const { data: reads } = await db.from('message_recipients').select('message_id').eq('profile_id', profileId).in('message_id', ids).limit(5000);
  const readIds = new Set((reads || []).map((r) => r.message_id));
  return mine.filter((m) => !readIds.has(m.id)).length;
}

// Lista conversaciones accesibles para el rol, con último mensaje y no leídos.
async function listConversations(db, ctx) {
  const role = String((ctx && ctx.role) || '').toLowerCase();
  let q = db.from('conversations').select('*').order('created_at', { ascending: false }).limit(200);
  if (role === 'owner' || role === 'admin') {
    if (!ctx.establishmentId) return [];
    q = q.eq('establishment_id', ctx.establishmentId);
  } else if (role !== 'superadmin') {
    let profileIds = [ctx.profileId];
    if (role === 'guardian') profileIds = profileIds.concat(await getLinkedStudentProfileIds(db, ctx.profileId));
    const { data: members } = await db.from('conversation_members').select('conversation_id').in('profile_id', profileIds).limit(5000);
    const ids = [...new Set((members || []).map((m) => m.conversation_id))];
    if (!ids.length) return [];
    q = q.in('id', ids);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const out = [];
  for (const c of (data || [])) {
    const membersRes = await db.from('conversation_members').select('profile_id').eq('conversation_id', c.id).limit(500);
    const msgsRes = await db.from('messages').select('id, sender_profile_id, body, created_at').eq('conversation_id', c.id).limit(200);
    const msgs = msgsRes.data || [];
    out.push({
      id: c.id, establishment_id: c.establishment_id, subject: c.subject,
      created_at: c.created_at, archived_at: c.archived_at,
      member_profile_ids: (membersRes.data || []).map((m) => m.profile_id),
      last_message: msgs.length ? msgs[msgs.length - 1] : null,
      unread_count: await unreadCount(db, c.id, ctx.profileId)
    });
  }
  return out;
}

async function getConversation(db, ctx, id) {
  const { data: c, error } = await db.from('conversations').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) { const e = new Error('Conversación no encontrada'); e.status = 404; throw e; }
  if (!(await canAccessConversation(db, ctx, c))) { const e = new Error('No access to this conversation'); e.status = 403; throw e; }
  const membersRes = await db.from('conversation_members').select('profile_id, last_read_at').eq('conversation_id', id).limit(500);
  const msgsRes = await db.from('messages').select('id, sender_profile_id, body, created_at').eq('conversation_id', id).limit(200);
  return {
    id: c.id, establishment_id: c.establishment_id, subject: c.subject, created_at: c.created_at, archived_at: c.archived_at,
    members: membersRes.data || [],
    messages: msgsRes.data || []
  };
}

async function createConversation(db, ctx, { subject, memberProfileIds }) {
  if (!ctx.establishmentId) throw httpError(400, 'establishmentId is required');
  const isSuperadmin = String(ctx.role) === 'superadmin';
  const creatorId = isSuperadmin ? null : ctx.profileId;
  const members = [...new Set((creatorId ? [creatorId] : []).concat(Array.isArray(memberProfileIds) ? memberProfileIds : []).filter(Boolean))];

  // Validar que todos los miembros pertenecen al establecimiento (fail-closed).
  for (const pid of members) {
    const { data: mem, error: memErr } = await db.from('establishment_members').select('id').eq('establishment_id', ctx.establishmentId).eq('profile_id', pid).maybeSingle();
    if (memErr) throw httpError(500, 'Error validando miembros: ' + memErr.message);
    if (!mem) throw httpError(400, 'El perfil no pertenece al establecimiento: ' + pid);
  }

  const convId = crypto.randomUUID();
  const { data: created, error: convErr } = await db.from('conversations')
    .insert({ id: convId, establishment_id: ctx.establishmentId, subject: subject || null, created_by: creatorId })
    .select().single();
  if (convErr || !created) throw httpError(500, 'No se pudo crear la conversación' + (convErr ? ': ' + convErr.message : ''));

  for (const pid of members) {
    const { error: mErr } = await db.from('conversation_members').insert({ id: crypto.randomUUID(), conversation_id: convId, profile_id: pid, joined_at: new Date().toISOString() });
    if (mErr) {
      // Compensación: borrar la conversación creada (cascada a miembros) para no dejar estado parcial.
      await db.from('conversations').delete().eq('id', convId);
      throw httpError(500, 'No se pudo registrar un miembro: ' + mErr.message);
    }
  }
  return created;
}

async function addMessage(db, ctx, conversationId, body) {
  const text = String(body || '').trim();
  if (!text) throw httpError(400, 'body is required');
  const { data: c, error: cErr } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  if (cErr) throw httpError(500, 'Error leyendo la conversación: ' + cErr.message);
  if (!c) throw httpError(404, 'Conversación no encontrada');
  if (!(await canAccessConversation(db, ctx, c))) throw httpError(403, 'No access to this conversation');
  const id = crypto.randomUUID();
  const { data: msg, error: mErr } = await db.from('messages')
    .insert({ id, conversation_id: conversationId, sender_profile_id: ctx.profileId, body: text, created_at: new Date().toISOString() })
    .select().single();
  if (mErr || !msg) throw httpError(500, 'No se pudo enviar el mensaje' + (mErr ? ': ' + mErr.message : ''));
  return msg;
}

async function markMessageRead(db, ctx, messageId) {
  const { data: msg, error: mErr } = await db.from('messages').select('id, conversation_id').eq('id', messageId).maybeSingle();
  if (mErr) throw httpError(500, 'Error leyendo el mensaje: ' + mErr.message);
  if (!msg) throw httpError(404, 'Mensaje no encontrado');
  const { data: c, error: cErr } = await db.from('conversations').select('*').eq('id', msg.conversation_id).maybeSingle();
  if (cErr) throw httpError(500, 'Error leyendo la conversación: ' + cErr.message);
  if (!c || !(await canAccessConversation(db, ctx, c))) throw httpError(403, 'No access to this conversation');
  const { data: existing } = await db.from('message_recipients').select('id').eq('message_id', messageId).eq('profile_id', ctx.profileId).maybeSingle();
  if (!existing) {
    const { error: rErr } = await db.from('message_recipients').insert({ id: crypto.randomUUID(), message_id: messageId, profile_id: ctx.profileId, read_at: new Date().toISOString() });
    if (rErr) throw httpError(500, 'No se pudo marcar el mensaje como leído: ' + rErr.message);
  }
  return { ok: true };
}

async function archiveConversation(db, ctx, conversationId) {
  const { data: c, error: cErr } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  if (cErr) throw httpError(500, 'Error leyendo la conversación: ' + cErr.message);
  if (!c) throw httpError(404, 'Conversación no encontrada');
  if (!(await canAccessConversation(db, ctx, c))) throw httpError(403, 'No access to this conversation');
  const { error: uErr } = await db.from('conversations').update({ archived_at: new Date().toISOString() }).eq('id', conversationId);
  if (uErr) throw httpError(500, 'No se pudo archivar: ' + uErr.message);
  const { data: updated, error: uErr2 } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  if (uErr2 || !updated) throw httpError(500, 'No se pudo leer la conversación archivada');
  return updated;
}

module.exports = {
  getLinkedStudentProfileIds, isMember, canAccessConversation, unreadCount,
  listConversations, getConversation, createConversation, addMessage, markMessageRead, archiveConversation
};

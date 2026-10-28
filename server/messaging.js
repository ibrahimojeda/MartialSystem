// server/messaging.js
// Mensajería interna entre usuarios (Fase B).
// Tablas separadas de notifications. Todo acceso valida tenancy y membresía.
// Recibe el cliente Supabase como parámetro (db) para ser testeable sin red.

const crypto = require('crypto');

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
  if (!ctx.establishmentId) { const e = new Error('establishmentId is required'); e.status = 400; throw e; }
  const members = [...new Set([ctx.profileId].concat(Array.isArray(memberProfileIds) ? memberProfileIds : []).filter(Boolean))];
  const convId = crypto.randomUUID();
  await db.from('conversations').insert({ id: convId, establishment_id: ctx.establishmentId, subject: subject || null, created_by: ctx.profileId });
  for (const pid of members) {
    const { data: mem } = await db.from('establishment_members').select('id').eq('establishment_id', ctx.establishmentId).eq('profile_id', pid).maybeSingle();
    if (mem) {
      await db.from('conversation_members').insert({ id: crypto.randomUUID(), conversation_id: convId, profile_id: pid, joined_at: new Date().toISOString() });
    }
  }
  const { data: created } = await db.from('conversations').select('*').eq('id', convId).maybeSingle();
  return created;
}

async function addMessage(db, ctx, conversationId, body) {
  const text = String(body || '').trim();
  if (!text) { const e = new Error('body is required'); e.status = 400; throw e; }
  const { data: c } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  if (!c) { const e = new Error('Conversación no encontrada'); e.status = 404; throw e; }
  if (!(await canAccessConversation(db, ctx, c))) { const e = new Error('No access to this conversation'); e.status = 403; throw e; }
  const id = crypto.randomUUID();
  await db.from('messages').insert({ id, conversation_id: conversationId, sender_profile_id: ctx.profileId, body: text, created_at: new Date().toISOString() });
  const { data: msg } = await db.from('messages').select('*').eq('id', id).maybeSingle();
  return msg;
}

async function markMessageRead(db, ctx, messageId) {
  const { data: msg } = await db.from('messages').select('id, conversation_id').eq('id', messageId).maybeSingle();
  if (!msg) { const e = new Error('Mensaje no encontrado'); e.status = 404; throw e; }
  const { data: c } = await db.from('conversations').select('*').eq('id', msg.conversation_id).maybeSingle();
  if (!c || !(await canAccessConversation(db, ctx, c))) { const e = new Error('No access to this conversation'); e.status = 403; throw e; }
  const { data: existing } = await db.from('message_recipients').select('id').eq('message_id', messageId).eq('profile_id', ctx.profileId).maybeSingle();
  if (!existing) {
    await db.from('message_recipients').insert({ id: crypto.randomUUID(), message_id: messageId, profile_id: ctx.profileId, read_at: new Date().toISOString() });
  }
  return { ok: true };
}

async function archiveConversation(db, ctx, conversationId) {
  const { data: c } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  if (!c) { const e = new Error('Conversación no encontrada'); e.status = 404; throw e; }
  if (!(await canAccessConversation(db, ctx, c))) { const e = new Error('No access to this conversation'); e.status = 403; throw e; }
  await db.from('conversations').update({ archived_at: new Date().toISOString() }).eq('id', conversationId);
  const { data: updated } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  return updated;
}

module.exports = {
  getLinkedStudentProfileIds, isMember, canAccessConversation, unreadCount,
  listConversations, getConversation, createConversation, addMessage, markMessageRead, archiveConversation
};

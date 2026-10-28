-- ══════════════════════════════════════════════════════════════
-- 021_conversations.sql — Mensajería interna entre usuarios.
-- Tablas separadas de notifications: esto es un chat, no avisos.
-- ══════════════════════════════════════════════════════════════

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  subject text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  unique(conversation_id, profile_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_profile_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

-- Lectura individual por mensaje (opcional pero pedido).
create table if not exists message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  read_at timestamptz,
  unique(message_id, profile_id)
);

create index if not exists idx_conversations_est on conversations(establishment_id);
create index if not exists idx_conversation_members_conv on conversation_members(conversation_id);
create index if not exists idx_conversation_members_profile on conversation_members(profile_id);
create index if not exists idx_messages_conv on messages(conversation_id);
create index if not exists idx_messages_created on messages(conversation_id, created_at);
create index if not exists idx_message_recipients_profile on message_recipients(profile_id);

alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table message_recipients enable row level security;

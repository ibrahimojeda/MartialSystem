-- ══════════════════════════════════════════════════════════════
-- 022_class_notifications.sql — Notificaciones de clases + versionado
-- para idempotencia (no duplicar avisos al repetir el mismo PATCH).
-- ══════════════════════════════════════════════════════════════

-- Versionado: updated_at se refresca en cada UPDATE (para la clave de dedup).
alter table class_sessions add column if not exists updated_at timestamptz not null default now();
drop trigger if exists trg_class_sessions_updated_at on class_sessions;
create trigger trg_class_sessions_updated_at
  before update on class_sessions
  for each row execute procedure set_updated_at();

-- Dedup de notificaciones por (clase, evento, destinatario, versión).
create table if not exists class_notification_events (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references class_sessions(id) on delete cascade,
  event_type text not null,
  recipient_profile_id uuid references profiles(id) on delete cascade,
  version text not null,
  created_at timestamptz not null default now(),
  unique(class_id, event_type, recipient_profile_id, version)
);

create index if not exists idx_class_notif_events_class on class_notification_events(class_id);
alter table class_notification_events enable row level security;

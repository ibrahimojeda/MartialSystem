-- ══════════════════════════════════════════════════════════════
-- 023_class_notification_outbox.sql — Outbox asíncrono de notificaciones de clases.
-- El PATCH/POST encola trabajos y responde rápido; un worker los procesa.
-- ══════════════════════════════════════════════════════════════

create table if not exists class_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references class_sessions(id) on delete cascade,
  establishment_id uuid not null references establishments(id) on delete cascade,
  event_type text not null,
  recipient_profile_id uuid not null references profiles(id) on delete cascade,
  version text not null,
  title text not null,
  body text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed','dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(class_id, event_type, recipient_profile_id, version)
);

create index if not exists idx_class_outbox_pending on class_notification_outbox(status, available_at) where status in ('pending','failed');
create index if not exists idx_class_outbox_class on class_notification_outbox(class_id);
create index if not exists idx_class_outbox_locked on class_notification_outbox(locked_at) where status = 'processing';

alter table class_notification_outbox enable row level security;

-- Vínculo idempotente notification ↔ outbox (evita duplicar al reintentar).
alter table notifications
  add column if not exists class_notification_outbox_id uuid
  references class_notification_outbox(id) on delete set null;

create unique index if not exists uq_notifications_class_outbox
  on notifications(class_notification_outbox_id)
  where class_notification_outbox_id is not null;

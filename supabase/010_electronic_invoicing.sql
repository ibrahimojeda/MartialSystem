-- ══════════════════════════════════════════════════════════════
-- FACTURACIÓN ELECTRÓNICA (Panamá - DGI)
-- ══════════════════════════════════════════════════════════════

-- Tabla de configuración DGI por establecimiento
create table if not exists dgi_configs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  ruc text not null,
  dv text not null,
  razon_social text not null,
  nombre_comercial text,
  direccion text,
  telefono text,
  email text,
  regimen text not null default 'general' check (regimen in ('general', 'pequeno_contribuyente', 'servicios_profesionales')),
  resolvedor text default 'nuevo_resuelto' check (resolvedor in ('nuevo_resuelto', 'resuelto_200', 'resuelto_201')),
  pi text default '00', -- Provincia de inscripción
  sucursal text default '0001',
  tipo_emision text default 'normal' check (tipo_emision in ('normal', 'contingencia', 'sin_internet')),
  ambiente text not null default 'test' check (ambiente in ('test', 'production')),
  dgi_token text,
  dgi_token_expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id)
);

-- Tabla de numeración de facturas (resoluciones DGI)
create table if not exists invoice_numbering (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  tipo_documento text not null check (tipo_documento in ('factura', 'nota_credito', 'nota_debito', 'tiquete')),
  resolucion text not null, -- Número de resolución DGI
  fecha_autorizacion date not null,
  fecha_vencimiento date not null,
  prefijo text not null, -- Ej: FA, NC, ND
  numero_inicial bigint not null,
  numero_final bigint not null,
  numero_actual bigint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (establishment_id, tipo_documento, prefijo, resolucion)
);

-- Tabla de clientes (personas naturales/jurídicas) para facturación
create table if not exists invoice_clients (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  tipo_identificacion text not null default 'cedula' check (tipo_identificacion in ('cedula', 'ruc', 'pasaporte', 'cedula_abogado', 'extranjero')),
  identificacion text not null, -- Cédula / RUC / Pasaporte
  dv text default '', -- Dígito verificador (solo RUC)
  nombre text not null,
  apellido text not null,
  razon_social text, -- Para empresas
  direccion text,
  correo text,
  telefono text,
  es_extranjero boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, tipo_identificacion, identificacion)
);

-- Tabla de facturas electrónicas
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  invoice_numbering_id uuid references invoice_numbering(id) on delete restrict,
  client_id uuid not null references invoice_clients(id) on delete restrict,
  
  -- Datos de factura
  prefijo text not null,
  numero_factura bigint not null,
  numero_completo text not null, -- Prefijo + número (ej: FA-0001-00000123)
  
  -- Fechas
  fecha_emision timestamptz not null default now(),
  fecha_vencimiento_pago date,
  
  -- Estado DGI
  estado_dgi text not null default 'pendiente' check (estado_dgi in ('pendiente', 'enviado', 'autorizado', 'rechazado', 'anulado', 'contingencia')),
  codigo_autorizacion text, -- Código de autorización DGI (32 dígitos)
  fecha_autorizacion_dgi timestamptz,
  mensaje_dgi text, -- Mensaje de respuesta DGI
  xml_enviado text, -- XML enviado a DGI
  xml_respuesta text, -- XML de respuesta DGI
  
  -- Totales
  subtotal numeric(12,2) not null default 0,
  descuento numeric(12,2) not null default 0,
  base_imponible numeric(12,2) not null default 0,
  itbms numeric(12,2) not null default 0, -- 7% Panamá
  total numeric(12,2) not null default 0,
  moneda text not null default 'USD' check (moneda in ('USD', 'PAB')),
  
  -- Referencias
  student_id uuid references students(id) on delete set null,
  payment_id uuid references payments(id) on delete set null,
  concepto_general text,
  notas text,
  
  -- Para notas de crédito/débito
  invoice_referencia_id uuid references invoices(id) on delete set null,
  tipo_nota text check (tipo_nota in ('credito', 'debito')),
  
  -- Auditoría
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  unique (establishment_id, numero_completo)
);

-- Tabla de items de factura (líneas)
create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  
  -- Detalle del item
  linea int not null,
  codigo text,
  descripcion text not null,
  cantidad numeric(12,2) not null default 1 check (cantidad > 0),
  unidad_medida text not null default 'uni' check (unidad_medida in ('uni', 'hrs', 'kg', 'lt', 'mts', 'mes', 'clase', 'otro')),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  descuento_item numeric(12,2) not null default 0,
  tipo_itbms text not null default '07' check (tipo_itbms in ('01', '03', '04', '05', '06', '07', '08', '09')),
  -- 01=alimentos, 03=servicios profesionales, 04=exportaciones, 05=construcción
  -- 06=intermediación financiera, 07=general (7%), 08=libros/textos, 09=medicinas
  monto_itbms numeric(12,2) not null default 0,
  total_linea numeric(12,2) not null default 0,
  
  created_at timestamptz not null default now()
);

-- Tabla de tasas de ITBMS (configuración por disciplina)
create table if not exists itbms_rates (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid references disciplines(id) on delete cascade,
  tipo_itbms text not null default '07',
  porcentaje numeric(5,2) not null default 7.00,
  descripcion text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (establishment_id, discipline_id, tipo_itbms)
);

-- Insert default ITBMS rates
insert into itbms_rates (establishment_id, discipline_id, tipo_itbms, porcentaje, descripcion)
select e.id, d.id, '07', 7.00, 'ITBMS General - Clases de artes marciales'
from establishments e, disciplines d
on conflict (establishment_id, discipline_id, tipo_itbms) do nothing;

-- Índices
create index if not exists idx_invoices_establishment on invoices(establishment_id);
create index if not exists idx_invoices_client on invoices(client_id);
create index if not exists idx_invoices_estado on invoices(estado_dgi);
create index if not exists idx_invoices_numero on invoices(numero_completo);
create index if not exists idx_invoice_items_invoice on invoice_items(invoice_id);
create index if not exists idx_invoice_clients_establishment on invoice_clients(establishment_id);
create index if not exists idx_invoice_clients_identificacion on invoice_clients(identificacion);
create index if not exists idx_invoice_numbering_establishment on invoice_numbering(establishment_id);
create index if not exists idx_dgi_configs_establishment on dgi_configs(establishment_id);

-- Trigger para updated_at
drop trigger if exists trg_invoices_updated_at on invoices;
create trigger trg_invoices_updated_at
before update on invoices
for each row execute procedure set_updated_at();

drop trigger if exists trg_invoice_clients_updated_at on invoice_clients;
create trigger trg_invoice_clients_updated_at
before update on invoice_clients
for each row execute procedure set_updated_at();

drop trigger if exists trg_dgi_configs_updated_at on dgi_configs;
create trigger trg_dgi_configs_updated_at
before update on dgi_configs
for each row execute procedure set_updated_at();

drop trigger if exists trg_invoice_numbering_updated_at on invoice_numbering;
create trigger trg_invoice_numbering_updated_at
before update on invoice_numbering
for each row execute procedure set_updated_at();
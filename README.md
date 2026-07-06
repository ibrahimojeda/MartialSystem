# MartialSystem (Nuevo)

Proyecto base desde cero para gestion multi-disciplina:
- Karate
- Judo
- BJJ
- Taekwondo
- Kickboxing
- y mas

## 1) Requisitos
- Node.js 18+
- Proyecto Supabase nuevo

## 2) Configurar entorno
1. Copia `.env.example` a `.env`
2. Completa valores:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 3) Crear base en Supabase
En SQL Editor ejecuta en orden:
1. `supabase/001_schema.sql`
2. `supabase/002_rls.sql`
3. `supabase/003_student_evaluations.sql`
4. `supabase/004_classes_attendance.sql`
5. `supabase/005_ops_modules.sql`
6. `supabase/006_usernames_superadmin.sql`

## 3.1) Acceso al sistema
- El login ahora es por `username` + `password`.
- Superadmin unico:
   - `SUPERADMIN_USERNAME=venta`
   - `SUPERADMIN_PASSWORD=Venta@Dojo2026!`
- Para owners/instructors creados desde onboarding, el sistema usa un email interno tecnico y no requiere email en UI.

## 4) Ejecutar local
```bash
npm install
npm run dev
```
Abrir: `http://localhost:8010`

## 5) Arquitectura inicial
- `server/index.js`: API Express + static web
- `server/supabaseClient.js`: cliente admin Supabase
- `web/index.html`: dashboard inicial
- `supabase/*.sql`: schema + RLS

## 6) Proximo paso recomendado
Crear modulo de autenticacion y onboarding de establecimiento/disciplinas.

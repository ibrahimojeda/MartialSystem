# Plan seguro de `git filter-repo` — purga del historial

> **Estado:** SOLO PLAN. No ejecutar todavía. Requiere coordinación y fuerza push coordinada.
> `git filter-repo` **reescribe todo el historial**: invalida clones existentes y cambia todos los SHAs posteriores.

## 0. Pre-requisitos

- [ ] Backup completo del repo (clon espejo): `git clone --mirror <url> backup.git`.
- [ ] Instalar `git-filter-repo` (`pip install git-filter-repo` o binario).
- [ ] Avisar a todos los colaboradores (deberán re-clonar después).
- [ ] Coordinar ventana de mantenimiento (se hará un push forzado).

## 1. Qué se eliminará del historial

| Objetivo | Tipo | Ubicación en el historial |
|---|---|---|
| Contraseña por defecto del superadmin (literal) | Texto | Commits `96fdc7a` (initial), `65e94ab`, y blobs de `948c7a3` (docs antes de redactar) |
| `data/trial-users.json` (PII de usuario de prueba) | Archivo | Añadido en `cec1d83` (y presente hasta hoy) |
| `data/superadmin-sessions.json`, `data/ai-config.json`, `data/*.json` con PII | Archivos | Cualquier commit que los haya trackeado |

> Nota: los valores reales se escriben en un archivo `replacements.txt` local (no versionado), nunca en este plan.

## 2. Comandos propuestos (a ejecutar en una copia)

```bash
# 2.1 Eliminar archivos sensibles de TODO el historial
git filter-repo --path data/trial-users.json --invert-paths
git filter-repo --path data/superadmin-sessions.json --invert-paths
git filter-repo --path data/ai-config.json --invert-paths

# 2.2 Reemplazar el literal de la contraseña en TODO el historial
#     replacements.txt (no versionado) contiene:  <LITERAL>==>REDACTED
git filter-repo --replace-text replacements.txt
```

> `--replace-text` reemplaza la cadena exacta (no regex) por `REDACTED` en todos los blobs.

## 3. Verificación post-purga

- [ ] `git log --all -S '<LITERAL>'` → sin resultados.
- [ ] `git log --all --oneline -- data/trial-users.json` → sin resultados.
- [ ] El código y los tests siguen verdes (`node --check server/index.js`, `node --test tests/`).
- [ ] `git fsck` sin errores.

## 4. Publicación (push forzado coordinado)

```bash
git push origin --force --all
git push origin --force --tags
```

- [ ] Todos los colaboradores re-clonan (`git clone`), **no** `git pull`.

## 5. Riesgos y mitigaciones

- **Riesgo:** reescribe historia → cualquier PR/rama basada en SHAs viejos se rompe. **Mitigación:** rebase de ramas abiertas.
- **Riesgo:** el literal puede seguir en GitHub cache/forks. **Mitigación:** rotar la credencial (obligatorio) además de purgar.
- **Riesgo:** force-push en `main`/`master`. **Mitigación:** hacerlo solo en ventana acordada y con backup espejo.

## 6. Decisión pendiente

Este plan **no se ejecuta** hasta que el equipo confirme: (a) backup espejo hecho, (b) rotación de secretos completada, (c) ventana acordada.

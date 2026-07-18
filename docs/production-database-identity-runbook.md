# Production Database Identity Runbook

Read-only audit: determine whether Railway API and Supabase SQL Editor point to the same PostgreSQL database.

---

## 1. Симптом и его интерпретация

Railway API logs показывают:

```
Applied: 005_public_profiles_and_follows.sql
Database pool initialized
```

При этом в открытом Supabase SQL Editor:

- `public.schema_migrations` возвращает пустую таблицу или ошибку
- `users`, `profiles`, `saved_routes`, `planned_runs`, `follows` возвращают `NULL` / 0 строк

**Почему это значит разные target database:**

`migrate.py` (строка 30) создаёт `public.schema_migrations` через `CREATE TABLE IF NOT EXISTS` и записывает туда имя каждого применённого SQL-файла (строка 52). Если Apply прошёл успешно, значит:

1. Migration подключилась к `DATABASE_URL` из Railway variables.
2. Таблица `public.schema_migrations` была создана и в неё были вставлены записи.

Если Supabase SQL Editor не видит ни таблицы, ни данных — значит SQL Editor подключён к другой PostgreSQL instance, другому project, или другой database branch. Это **не может** быть одной и той же БД.

**Ключевой факт:** `config.py:26-35` нормализует `postgres://` → `postgresql://`, что типично для Supabase pooler URLs. Сам URL хранится в `SecretStr` и никогда не логируется.

---

## 2. Как безопасно сопоставить DATABASE_URL

> **ВАЖНО:** Не копируйте и не передавайте полный URL. Смотрите только на структурные поля.

Откройте Railway → Variables → `DATABASE_URL`. Не копируя значение, проверьте:

| Поле URL | Что искать | Ожидание для Supabase |
|----------|------------|----------------------|
| hostname | Домен подключения | Содержит `supabase.co` или `railway.internal` (Railway own PG) |
| database name | Имя БД после `/` | Совпадает с Supabase project ref |
| Supabase project ref | Подстрока в hostname или username | `siquoydstcdbkxvcmbzu` (или другой ref проекта) |
| Pooler mode | `?sslmode=require` | Supabase pooler обычно `require` |
| порт | Число после `:` | `5432` (direct), `6543` (pooler), `32149` (Supabase pooler) |
| username | Часть до `@` | Может содержать `postgres.<ref>` или `supabase` |

**Формат Supabase URL:**

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@<HOST>:<PORT>/<DATABASE>
```

Ожидаемый PROJECT_REF: `siquoydstcdbkxvcmbzu`

**Пример hostname (без реального значения):**

- Supabase pooler: `aws-0-<region>.pooler.supabase.com`
- Supabase direct: `db.<ref>.supabase.co`
- Railway own PG: `<service-name>-<random>.railway.internal`

> **Не записывайте реальные hostname/database/username в эту документацию.**

---

## 3. Read-only SQL для Railway Target Database

Выполните эти запросы из приложения (через Railway Logs или временный read-only endpoint), **не** через Supabase SQL Editor.

### 3.1. Идентификация БД

```sql
SELECT current_database() AS db_name,
       current_user AS db_user,
       current_schema() AS schema,
       version() AS pg_version;
```

Ожидаемый результат для Supabase:
- `current_user` содержит `postgres.<ref>` или `supabase`
- `version()` содержит `PostgreSQL ... on x86_64-pc-linux-gnu` (Supabase hosts)

### 3.2. Поиск Supabase project ref в hostname/username

```sql
SELECT inet_server_addr() AS server_ip,
       inet_server_port() AS server_port;
```

Если `inet_server_addr()` возвращает IP — это прямое подключение. Если NULL — pooler.

### 3.3. Список всех таблиц в public schema

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Ожидаемый набор таблиц (миграции 001–006):

```
follows
planned_runs
profiles
reminder_deliveries
run_lobby_participants
run_lobbies
saved_routes
schema_migrations
users
```

### 3.4. Проверка каждой таблицы через to_regclass

```sql
SELECT 'users' AS tbl, to_regclass('public.users') IS NOT NULL AS exists
UNION ALL SELECT 'profiles',        to_regclass('public.profiles') IS NOT NULL
UNION ALL SELECT 'saved_routes',    to_regclass('public.saved_routes') IS NOT NULL
UNION ALL SELECT 'planned_runs',    to_regclass('public.planned_runs') IS NOT NULL
UNION ALL SELECT 'follows',         to_regclass('public.follows') IS NOT NULL
UNION ALL SELECT 'reminder_deliveries', to_regclass('public.reminder_deliveries') IS NOT NULL
UNION ALL SELECT 'run_lobbies',     to_regclass('public.run_lobbies') IS NOT NULL
UNION ALL SELECT 'run_lobby_participants', to_regclass('public.run_lobby_participants') IS NOT NULL
UNION ALL SELECT 'schema_migrations', to_regclass('public.schema_migrations') IS NOT NULL;
```

### 3.5. Список применённых миграций

```sql
SELECT filename, applied_at
FROM public.schema_migrations
ORDER BY filename;
```

Ожидаемый результат (6 миграций):

```
001_users_profiles.sql
002_secure_schema_migrations.sql
003_saved_routes_and_planned_runs.sql
004_planned_run_reminders.sql
005_public_profiles_and_follows.sql
006_run_lobbies.sql
```

### 3.6. Количество записей (COUNT без PII)

```sql
SELECT
  (SELECT count(*) FROM public.users)        AS users_count,
  (SELECT count(*) FROM public.profiles)     AS profiles_count,
  (SELECT count(*) FROM public.saved_routes) AS routes_count,
  (SELECT count(*) FROM public.planned_runs) AS runs_count,
  (SELECT count(*) FROM public.follows)      AS follows_count;
```

### 3.7. Последняя дата миграции

```sql
SELECT max(applied_at) AS last_migration_at
FROM public.schema_migrations;
```

### 3.8. Search path

```sql
SELECT current_setting('search_path') AS search_path;
```

Ожидаемое значение: `"$user", public`

---

## 4. Read-only SQL для Supabase SQL Editor

Выполните **те же самые запросы** из Supabase SQL Editor (Dashboard → SQL Editor → New query).

Все запросы из раздела 3 — read-only (SELECT), безопасны для выполнения в SQL Editor.

### 4.1. Дополнительная проверка: Supabase project identity

```sql
SELECT current_database() AS db_name,
       current_user AS db_user,
       current_schema() AS schema,
       version() AS pg_version;
```

### 4.2. Проверка是否有 schema_migrations

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'schema_migrations'
) AS has_schema_migrations;
```

---

## 5. Таблица сравнения

| Признак | Railway Target | Supabase SQL Editor | Совпадает? | Вывод |
|---------|---------------|---------------------|-----------|-------|
| `current_database()` | ? | ? | | имя БД |
| `current_user` | ? | ? | | пользователь подключения |
| `version()` | ? | ? | | версия PostgreSQL |
| `inet_server_addr()` | ? | ? | | IP сервера |
| `inet_server_port()` | ? | ? | | порт |
| Таблица `schema_migrations` существует | ? | ? | | ключевой индикатор |
| Количество миграций (001–006) | ? | ? | | applied files |
| Последний `applied_at` | ? | ? | | временная метка |
| Таблица `users` существует | ? | ? | | объектная модель |
| `users_count` | ? | ? | | реальные данные |
| `profiles_count` | ? | ? | | реальные данные |
| `routes_count` | ? | ? | | реальные данные |
| `runs_count` | ? | ? | | реальные данные |
| `follows_count` | ? | ? | | реальные данные |
| `search_path` | ? | ? | | схема поиска |

**Заполните таблицу и сравните строки.**

---

## 6. Возможные сценарии

### A. Railway DATABASE_URL указывает на другой Supabase project

**Как подтвердить:**

- `current_database()` в Railway: имя БД другого проекта (отличается от `siquoydstcdbkxvcmbzu`)
- `current_user`: `postgres.<другой-ref>` или другой username
- `inet_server_addr()`: другой IP

**Риски:**

- Supabase Dashboard привязан к исходному проекту
- Миграции Railway.apply применяются к другому проекту
- Данные пользователей分散ены между двумя проектами

**Что нельзя делать до резервного копирования:**

- Менять DATABASE_URL
- Удалять миграции или переменные
- Выполнять DDL из Dashboard

---

### B. Railway DATABASE_URL указывает на Supabase database branch

**Как подтвердить:**

- `current_database()` содержит branch name (например, `postgres` или `branch-xxx`)
- Hostname содержит `branch` или `preview` подстроку
- В Supabase Dashboard видны database branches

**Риски:**

- Branch может быть временной и удалена
- Branch может иметь другой набор миграций
- Переключение на main branch потребует синхронизации

**Что нельзя делать до резервного копирования:**

- Удалять branch
- Мержить branch в main через Dashboard
- Менять DATABASE_URL

---

### C. Railway использует Railway PostgreSQL, а не Supabase

**Как подтвердить:**

- Hostname содержит `railway.internal`
- `inet_server_addr()` возвращает RFC1918 IP (10.x, 172.16–31.x, 192.168.x)
- `current_user` — `railway` или service name
- Нет Supabase project ref в hostname/username

**Риски:**

- Railway PG — это managed PostgreSQL, не Supabase
- Supabase Dashboard не имеет к нему доступа
- Репликация, backups, pooler — от Railway, не от Supabase
- Если ожидается Supabase — это конфигурационная ошибка

**Что нельзя делать до резервного копирования:**

- Менять DATABASE_URL
- Удалять Railway PostgreSQL service
- Подключать Supabase Dashboard к Railway PG

---

### D. SQL Editor открыт в другом Supabase project

**Как подтвердить:**

- В Supabase Dashboard: Project Settings → Database → проект с ref `siquoydstcdbkxvcmbzu`
- Если ref отличается — SQL Editor подключён к другому проекту
- `current_database()` в SQL Editor не содержит `postgres` или содержит другой ref

**Риски:**

- Пользователь смотрит не на ту базу
- Не затрагивает production данные Railway

**Что нельзя делать:**

- Ничего критического — проблема на стороне Dashboard, не на стороне Railway

---

### E. Разные database name или pooler user

**Как подтвердить:**

- Hostname одинаковый, но `current_database()` или `current_user` отличаются
- Railway использует pooler user (`supabase_pooler`), SQL Editor — direct user (`postgres`)
- Разные порты: pooler `6543` vs direct `5432`

**Риски:**

- Pooler и direct могут указывать на одну БД, но с разными пользователями
- Разные permissions могут маскировать разницу
- RLS policies Supabase могут блокировать pooler-доступ

**Что нельзя делать:**

- Сбрасывать пароль pooler user
- Переключать DATABASE_URL без понимания pooler vs direct

---

## 7. Безопасный план исправления

> **Не выполнять автоматически.** Каждый шаг требует ручного подтверждения.

### Шаг 1. Определить БД, где сейчас находятся production-данные

- Выполнить запросы из раздела 3 и 4
- Сравнить результаты по таблице из раздела 5
- Определить, в какой из двух БД реальные данные (users_count > 0)

### Шаг 2. Зафиксировать количество записей

```sql
-- Выполнить в ОБЕИХ БД
SELECT
  (SELECT count(*) FROM public.users)        AS users,
  (SELECT count(*) FROM public.profiles)     AS profiles,
  (SELECT count(*) FROM public.saved_routes) AS routes,
  (SELECT count(*) FROM public.planned_runs) AS runs,
  (SELECT count(*) FROM public.follows)      AS follows,
  (SELECT count(*) FROM public.schema_migrations) AS migrations;
```

Записать результаты. Это «снимок» для будущей проверки.

### Шаг 3. Выбрать целевую production-БД

Решение принимает владелец проекта. Варианты:

| Вариант | Целевая БД | Действие |
|---------|-----------|----------|
| A | Railway current | Оставить как есть, переключить SQL Editor |
| B | Supabase current | Переключить Railway DATABASE_URL (после бэкапа!) |
| C | Новая БД | Мигрировать данные (сложная операция) |

### Шаг 4. Сделать резервную копию

```bash
# Способ 1: Supabase Dashboard → Database → Backups
# Способ 2: pg_dump (read-only, не影響 production)
pg_dump "$DATABASE_URL" -F c -f runroute_backup_$(date +%Y%m%d).dump
```

### Шаг 5. Проверить миграции целевой БД

```sql
SELECT filename, applied_at
FROM public.schema_migrations
ORDER BY filename;
```

Убедиться, что все 6 миграций (001–006) присутствуют.

### Шаг 6. Спланировать перенос данных

Если данные распределены между двумя БД — составить план переноса:

1. Определить, какие таблицы в какой БД
2. Решить, куда переносить (в какую сторону)
3. Составить SQL-скрипты переноса (INSERT ... ON CONFLICT)
4. Проверить foreign keys и целостность

### Шаг 7. Только затем менять DATABASE_URL

```bash
# В Railway Dashboard → Variables → DATABASE_URL
# Новое значение — целевая БД из шага 3
# Проверить нормализацию: postgres:// → postgresql:// (config.py:33-34)
```

### Шаг 8. Выполнить smoke tests

См. раздел 8.

### Шаг 9. Подготовить rollback

```bash
# Сохранить старый DATABASE_URL (не в коде!)
# В случае проблем — вернуть старое значение в Railway Variables
```

---

## 8. Smoke Checklist после переключения

| Проверка | Ожидаемый результат | Статус |
|----------|---------------------|--------|
| `GET /health/live` | 200 | |
| `GET /health/ready` | 200 (DB pool connected) | |
| `POST /api/me` | 200 + user object | |
| `GET /api/profile` | 200 + profile or empty | |
| `PUT /api/profile` | 200 + updated profile | |
| `GET /api/routes` | 200 + routes list | |
| `POST /api/routes` | 200 + saved route | |
| `GET /api/calendar/runs?from=...&to=...` | 200 + runs list | |
| `POST /api/calendar/runs` | 200 + created run | |
| Follows endpoints | 200 | |
| Отсутствие 500 ошибок | No Internal Server Error | |
| Миграции 001–006 | `schema_migrations` содержит 6 записей | |
| Существующие данные пользователя | users_count, profiles_count совпадают с шагом 2 | |

---

## 9. Итоговый отчёт

### Наиболее вероятный сценарий

**Сценарий D: SQL Editor открыт в другом Supabase project.**

Почему:
- Railway логи показывают успешные миграции → `DATABASE_URL` работает и указывает на реальную БД
- Supabase SQL Editor не видит `schema_migrations` → SQL Editor подключён к другой БД
- Самый частый случай: пользователь открыл не тот проект в Supabase Dashboard

Второй по вероятности — **Сценарий A** (Railway DATABASE_URL указывает на другой Supabase project) или **Сценарий E** (разные pooler/direct users).

### Какие данные ещё нужны от пользователя

1. **Hostname** из Railway `DATABASE_URL` (без username/password) — для определения project ref
2. **Порт** из Railway `DATABASE_URL` — для определения pooler vs direct
3. **Supabase project ref** в Dashboard — сравнить с `siquoydstcdbkxvcmbzu`
4. **Результаты запросов** из разделов 3 и 4 — заполнить таблицу сравнения

### Какие проверки безопасно выполнить сейчас

- Анализ кода `config.py`, `migrate.py`, `database.py` — **выполнено**
- Анализ миграций 001–006 — **выполнено**
- Определение формата URL — **выполнено**
- Read-only SQL запросы — **подготовлены**, ожидают выполнения пользователем

### Что нельзя менять

- Railway variables (DATABASE_URL, SUPABASE_URL, BOT_TOKEN, SECRET_KEY)
- Supabase project settings
- Миграции (001–006) — не добавлять, не удалять, не изменять
- `.env` файлы — не коммитить
- Production URL приложения

### Base commit SHA

```
2754e048d064fa7029c180e65f3d6bd99e83f97c
```

### Commit SHA документации

```
4f5b24aa73e7f39b51190975f7bb238888049820
```

### Compare URL

https://github.com/plan177/RunRoute/compare/docs/production-database-identity-runbook?expand=1

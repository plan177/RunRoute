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
- `users`, `profiles`, `saved_routes`, `planned_runs`, `follows` возвращают 0 строк

**Почему это требует проверки:**

`migrate.py` (строка 30) создаёт `public.schema_migrations` через `CREATE TABLE IF NOT EXISTS` и записывает туда имя каждого применённого SQL-файла (строка 52). Если Apply прошёл успешно, значит:

1. Migration подключилась к `DATABASE_URL` из Railway variables.
2. Таблица `public.schema_migrations` была создана и в неё были вставлены записи.

Однако **логи миграции не являются доказательством**, если не подтверждено, что:
- Логи относятся к текущему Railway project, service и environment
- Deployment timestamp совпадает с ожидаемым

Логи из другого environment или устаревший deployment не отражают текущее состояние production-БД.

**Ключевой факт:** `config.py:26-35` нормализует `postgres://` → `postgresql://`, что типично для Supabase pooler URLs. `config.py` хранит `DATABASE_URL` в `SecretStr` и сам не выводит его в лог. Это не отменяет необходимости не логировать исключения, argv, environment и значения connection string в другом коде.

---

## 2. Порядок диагностики

> **Важно:** Не пропускайте шаги. Сначала убедитесь, что смотрите на правильные проект и environment.

### Шаг 1. Проверить Railway project, service и environment

1. Откройте Railway Dashboard.
2. Убедитесь, что выбран правильный **project** (RunRoute).
3. Убедитесь, что выбран правильный **service** (API, не Bot).
4. Убедитесь, что выбран правильный **environment** (production).
5. Проверьте **deployment timestamp** — логи миграции должны относиться к текущему или недавнему deployment.

### Шаг 2. Проверить, что логи миграции относятся к этому service/environment

- Логи `Applied: 005_...` должны быть из текущего deployment
- Старые логи из другого environment не считаются

### Шаг 3. Сравнить базы

Только после шагов 1–2 выполнять запросы из разделов 3–4 и сравнивать результаты.

---

## 3. Как безопасно сопоставить DATABASE_URL

> **ВАЖНО:** Не копируйте и не передавайте полный URL. Смотрите только на структурные поля.

Откройте Railway → Variables → `DATABASE_URL`. Не копируя значение, проверьте:

| Поле URL | Что искать | Ожидание для Supabase |
|----------|------------|----------------------|
| hostname | Домен подключения | Содержит `supabase.co` или `railway.internal` (Railway own PG) |
| database name | Имя БД после `/` | Для Supabase обычно `postgres` |
| Supabase project ref | Подстрока в username (формат `postgres.<ref>`) | `siquoydstcdbkxvcmbzu` (или другой ref проекта) |
| порт | Число после `:` | `5432` (direct / session pooler), `6543` (transaction pooler) |
| username | Часть до `@` | Может содержать `postgres.<ref>` |

**Форматы Supabase URL:**

Direct connection:
```
postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres
```

Session pooler:
```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@<POOLER_HOST>:5432/postgres
```

Transaction pooler:
```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@<POOLER_HOST>:6543/postgres
```

Ожидаемый PROJECT_REF: `siquoydstcdbkxvcmbzu`

**Где находится project ref:**

- У direct connection project ref находится в hostname (`db.<ref>.supabase.co`)
- У pooler project ref обычно находится в username (`postgres.<ref>`)
- Pooler hostname может быть общим и не содержать project ref

**Типовые hostname:**

- Supabase pooler: `aws-0-<region>.pooler.supabase.com`
- Supabase direct: `db.<ref>.supabase.co`
- Railway own PG: `<service-name>-<random>.railway.internal`

**Важно:**

- Session pooler и transaction pooler могут использовать общий hostname, который не содержит project ref
- Разные IP и разные пользователи не обязательно означают разные базы при использовании pooler
- `current_user`, `version()` и `inet_server_addr()` **не являются** самостоятельным доказательством принадлежности проекту

> **Не записывайте реальные hostname/database/username в эту документацию.**

---

## 4. Способы выполнения read-only SQL

Все проверки должны оставаться read-only. Не предлагайте временные HTTP endpoint.

### Вариант A: Supabase SQL Editor

Подключитесь к базе выбранного Supabase project через Dashboard → SQL Editor.

### Вариант B: Railway CLI

Одноразовая локальная команда с переменными выбранного Railway environment:

```bash
railway run psql "$DATABASE_URL" -c "SELECT current_database();"
```

### Вариант C: psql через локальное защищённое подключение

```bash
psql "$DATABASE_URL" -c "SELECT current_database();"
```

Все команды используют переменную окружения и **не печатают** DATABASE_URL.

---

## 5. Read-only SQL для Railway Target Database

Выполните эти запросы одним из способов из раздела 4.

### 5.1. Идентификация БД

```sql
SELECT current_database() AS db_name,
       current_user AS db_user,
       current_schema() AS schema,
       version() AS pg_version;
```

### 5.2. IP и порт сервера

```sql
SELECT inet_server_addr() AS server_ip,
       inet_server_port() AS server_port;
```

### 5.3. Список всех таблиц в public schema

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

### 5.4. Проверка каждой таблицы через to_regclass

```sql
SELECT 'schema_migrations' AS tbl, to_regclass('public.schema_migrations') IS NOT NULL AS exists
UNION ALL SELECT 'users',          to_regclass('public.users') IS NOT NULL
UNION ALL SELECT 'profiles',       to_regclass('public.profiles') IS NOT NULL
UNION ALL SELECT 'saved_routes',   to_regclass('public.saved_routes') IS NOT NULL
UNION ALL SELECT 'planned_runs',   to_regclass('public.planned_runs') IS NOT NULL
UNION ALL SELECT 'follows',        to_regclass('public.follows') IS NOT NULL
UNION ALL SELECT 'reminder_deliveries', to_regclass('public.reminder_deliveries') IS NOT NULL
UNION ALL SELECT 'run_lobbies',    to_regclass('public.run_lobbies') IS NOT NULL
UNION ALL SELECT 'run_lobby_participants', to_regclass('public.run_lobby_participants') IS NOT NULL;
```

### 5.5. Список применённых миграций

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

> **Список filename из `schema_migrations` — основной прикладной индикатор.** Совпадение `current_database` / `current_user` / IP недостаточно.

### 5.6. Количество записей (COUNT, только после проверки to_regclass)

```sql
-- Выполнить только если to_regclass('public.users') NOT NULL
SELECT
  (SELECT count(*) FROM public.users)        AS users_count,
  (SELECT count(*) FROM public.profiles)     AS profiles_count,
  (SELECT count(*) FROM public.saved_routes) AS routes_count,
  (SELECT count(*) FROM public.planned_runs) AS runs_count,
  (SELECT count(*) FROM public.follows)      AS follows_count,
  (SELECT count(*) FROM public.run_lobbies)  AS lobbies_count,
  (SELECT count(*) FROM public.run_lobby_participants) AS lobby_participants_count;
```

### 5.7. Последняя дата миграции

```sql
SELECT max(applied_at) AS last_migration_at
FROM public.schema_migrations;
```

### 5.8. Search path

```sql
SELECT current_setting('search_path') AS search_path;
```

Запишите результат. Различие `search_path` означает различие ролей/настроек подключения, но не обязательно разные базы. Сравните значения между Railway и Supabase.

---

## 6. Read-only SQL для Supabase SQL Editor

Выполните **те же самые запросы** из Supabase SQL Editor (Dashboard → SQL Editor → New query), подключившись к базе **ожидаемого** Supabase project (`siquoydstcdbkxvcmbzu`).

Все запросы из раздела 5 — read-only (SELECT), безопасны для выполнения в SQL Editor.

---

## 7. Таблица сравнения

| Признак | Railway Target | Supabase SQL Editor | Совпадает? | Вывод |
|---------|---------------|---------------------|-----------|-------|
| `current_database()` | ? | ? | | имя БД (для Supabase обычно `postgres`) |
| `current_user` | ? | ? | | пользователь подключения |
| `version()` | ? | ? | | версия PostgreSQL |
| `inet_server_addr()` | ? | ? | | IP сервера |
| `inet_server_port()` | ? | ? | | порт |
| Таблица `schema_migrations` существует | ? | ? | | ключевой индикатор |
| Список filename из `schema_migrations` | ? | ? | | **основной прикладной индикатор** |
| Последний `applied_at` | ? | ? | | временная метка |
| `users_count` | ? | ? | | реальные данные (после to_regclass) |
| `profiles_count` | ? | ? | | реальные данные |
| `routes_count` | ? | ? | | реальные данные |
| `runs_count` | ? | ? | | реальные данные |
| `follows_count` | ? | ? | | реальные данные |

**Заполните таблицу и сравните строки.**

---

## 8. Дерево решений

После заполнения таблицы сравнения определите категорию.

**Важно:** SQL-индикаторы используются как подтверждение состояния, а не как единственный способ доказать физическую идентичность БД.

Разные hostname, порты, IP, `current_user` или direct vs pooler **не являются** доказательством разных БД — они могут вести в одну Supabase database.

Совпадение `schema_migrations` и COUNT **не является** доказательством одной БД — клонированные/восстановленные базы могут иметь одинаковое состояние.

### Подтверждена одна target identity

Если выполняется **все** из:

- Локально сопоставлен одинаковый Supabase project ref (из connection string Railway и Dashboard Supabase)
- Одинаковый database name/branch
- Connection strings относятся к direct/pooler одного проекта

**Вывод:** Это одна и та же target database identity.

### Прикладное состояние согласуется

Если выполняется **все** из:

- Совпадают списки filename из `schema_migrations`
- Совпадают ожидаемые агрегированные COUNT
- Совпадают контрольные временные метки (`applied_at`)

**Вывод:** Прикладное состояние идентично. Это подтверждает, что базы содержат одни и те же данные и миграции. Для полной уверенности в физической идентичности необходима проверка target identity (выше).

### Вероятно разные target

Если выполняется **любое** из:

- Разные Supabase project ref (из connection string)
- Supabase vs Railway PostgreSQL (hostname содержит `railway.internal`)
- Разные database branch/service identity

**Вывод:** Скорее всего разные target databases. Требуется дополнительная проверка project ref в Supabase Dashboard.

---

## 9. Возможные сценарии

### A. Railway DATABASE_URL указывает на другой Supabase project

**Как подтвердить:**

- Project ref в username connection string отличается от `siquoydstcdbkxvcmbzu`
- `schema_migrations` не содержит ожидаемых миграций

**Риски:**

- Supabase Dashboard привязан к исходному проекту
- Миграции Railway применяются к другому проекту
- Данные пользователей распределены между двумя проектами

**Что нельзя делать до резервного копирования:**

- Менять DATABASE_URL
- Удалять миграции или переменные
- Выполнять DDL из Dashboard

---

### B. Railway DATABASE_URL указывает на Supabase database branch

**Как подтвердить:**

- Hostname содержит `branch` или `preview` подстроку
- В Supabase Dashboard видны database branches
- `schema_migrations` может отличаться от main branch

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
- Нет Supabase project ref в hostname/username

**Риски:**

- Railway PG — это managed PostgreSQL, не Supabase
- Supabase Dashboard не имеет к нему доступа
- Репликация, backups, pooler — от Railway, не от Supabase

**Что нельзя делать до резервного копирования:**

- Менять DATABASE_URL
- Удалять Railway PostgreSQL service

---

### D. SQL Editor открыт в другом Supabase project

**Как подтвердить:**

- В Supabase Dashboard: Project Settings → Database → проект с ref `siquoydstcdbkxvcmbzu`
- Если ref отличается — SQL Editor подключён к другому проекту
- `schema_migrations` отсутствует или содержит другой набор миграций

**Риски:**

- Пользователь смотрит не на ту базу
- Не затрагивает production данные Railway

**Что нельзя делать:**

- Ничего критического — проблема на стороне Dashboard

---

### E. Разные pooler user при одной базе

**Как подтвердить:**

- Hostname одинаковый
- `schema_migrations` и список filename совпадают
- Отличаются только `current_user` или `inet_server_addr()` (pooler vs direct)

**Риски:**

- Минимальные — это разные способы подключения к одной БД
- Разные permissions могут маскировать разницу
- RLS policies Supabase могут блокировать pooler-доступ

**Что нельзя делать:**

- Сбрасывать пароль pooler user
- Переключать DATABASE_URL без понимания pooler vs direct

---

## 10. Безопасный план исправления

> **Не выполнять автоматически.** Каждый шаг требует ручного подтверждения.

### Шаг 1. Определить БД, где сейчас находятся production-данные

- Выполнить запросы из разделов 5 и 6
- Сравнить результаты по таблице из раздела 7
- Определить категорию по дереву решений (раздел 8)

### Шаг 2. Зафиксировать количество записей

```sql
-- Выполнить в ОБЕИХ БД (только после проверки to_regclass)
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

### Шаг 4. Сделать резервную копию

**Предпочтительный вариант:** managed backup Supabase или Railway (Dashboard → Backups).

Альтернатива — `pg_dump`:

```bash
# pg_dump не изменяет данные, но создаёт нагрузку и файл,
# содержащий production-данные.
# Не коммитить, не отправлять в чат, хранить с контролем доступа.
# Не включать реальный DATABASE_URL в документацию.
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
2. Решить, куда переносить
3. Составить SQL-скрипты переноса (INSERT ... ON CONFLICT)
4. Проверить foreign keys и целостность

### Шаг 7. Только затем менять DATABASE_URL

```bash
# В Railway Dashboard → Variables → DATABASE_URL
# Новое значение — целевая БД из шага 3
# Проверить нормализацию: postgres:// → postgresql:// (config.py:33-34)
```

### Шаг 8. Выполнить smoke tests

См. раздел 11.

### Шаг 9. Подготовить rollback

```bash
# Сохранить старый DATABASE_URL (не в коде!)
# В случае проблем — вернуть старое значение в Railway Variables
```

---

## 11. Smoke Checklist после переключения

### A. Диагностические HTTP-проверки без явной пользовательской мутации

| Проверка | Ожидаемый результат | Статус |
|----------|---------------------|--------|
| `GET /health/live` | 200 | |
| `GET /health/ready` | 200 (DB pool connected) | |

### B. Авторизованные application smoke tests

| Проверка | Ожидаемый результат | Статус |
|----------|---------------------|--------|
| `GET /api/me` | 200 + user object | |
| `GET /api/profile` | 200 + profile or empty | |
| `GET /api/routes` | 200 + routes list | |
| `GET /api/calendar/runs?from=...&to=...` | 200 + runs list | |
| `GET /api/me/followers` | 200 + followers list | |
| `GET /api/me/following` | 200 + following list | |
| `GET /api/users/{user_id}/profile` | 200 + public profile | |

> **Внимание:** Несмотря на GET, авторизованные endpoints могут вызвать upsert/sync текущего Telegram user и не являются строго read-only для PostgreSQL.

### C. Явные write smoke tests

| Проверка | Ожидаемый результат | Статус |
|----------|---------------------|--------|
| `PUT /api/profile` | 200 + updated profile | |
| `POST /api/routes` | 200 + saved route | |
| `POST /api/calendar/runs` | 200 + created run | |
| `POST /api/calendar/runs/{run_id}/cancel` | 200 + cancelled run | |
| `POST /api/users/{user_id}/follow` | 200 + is_following: true | |
| `DELETE /api/users/{user_id}/follow` | 200 + is_following: false | |

### D. Общие проверки

| Проверка | Ожидаемый результат | Статус |
|----------|---------------------|--------|
| Отсутствие 500 ошибок | No Internal Server Error | |
| Миграции 001–006 | `schema_migrations` содержит 6 записей | |
| Существующие данные пользователя | users_count, profiles_count совпадают с шагом 2 | |

---

## 12. Итоговый отчёт

### Какие данные ещё нужны от пользователя

1. **Hostname** из Railway `DATABASE_URL` (без username/password) — для определения project ref
2. **Порт** из Railway `DATABASE_URL` — для определения pooler vs direct
3. **Project ref** в Supabase Dashboard — сравнить с `siquoydstcdbkxvcmbzu`
4. **Результаты запросов** из разделов 5 и 6 — заполнить таблицу сравнения

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

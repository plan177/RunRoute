# RunRoute

Telegram Mini App для построения и записи беговых маршрутов.

## Возможности

- Автоматический маршрут заданной длины (3–42 км)
- Ручной маршрут (точки на карте)
- GPS-трекинг в реальном времени
- Экспорт/отправка маршрута (GPX)
- Калькулятор темпа и сплитов
- Запуск через Telegram-бота

## Архитектура

| Компонент | Файл | Описание |
|-----------|------|----------|
| Telegram-бот | `bot.py` | Обработка команд, открытие Mini App |
| Mini App (разметка) | `mini-app/index.html` | Интерфейс приложения |
| Mini App (логика) | `mini-app/app.js` | Клиентская логика (маршруты, GPS, карта) |
| Mini App (стили) | `mini-app/style.css` | Оформление |
| Карта | Leaflet 1.9.4 + Carto тайлы | Отображение карты |
| Маршрутизация | Valhalla (openstreetmap.de) | Построение маршрутов по дорогам |
| Геокодирование | Nominatim (openstreetmap.org) | Поиск адресов и координат |
| Хостинг Mini App | Vercel | Размещение статических файлов |
| Хостинг бота | Railway | Запуск Python-процесса |

## Локальный запуск

### Предварительные требования

- Python 3
- Node.js 18+ (для `npx serve`)
- Telegram-аккаунт и токен бота

### 1. Создание виртуального окружения

```bash
python -m venv .venv
source .venv/bin/activate   # Linux/macOS
.venv\Scripts\activate      # Windows
```

### 2. Установка зависимостей

```bash
pip install -r requirements.txt
```

### 3. Настройка переменных окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
cp .env.example .env
```

Обязательные переменные:

| Переменная | Описание |
|------------|----------|
| `BOT_TOKEN` | Токен Telegram-бота (от @BotFather) |
| `WEB_APP_URL` | URL Mini App (https://run-route-ten.vercel.app или http://localhost:8080) |

### 4. Запуск бота

```bash
python bot.py
```

### 5. Запуск Mini App (локально)

```bash
cd mini-app
npx serve -p 8080
```

Откройте `http://localhost:8080` в браузере.

## Пользовательские сценарии для ручной проверки

### GPS и местоположение
- [ ] При входе в приложение запрашивается разрешение на GPS
- [ ] Координаты отображаются на карте
- [ ] Кнопка GPS определяет текущее местоположение

### Карта
- [ ] Клик по карте устанавливает точку старта
- [ ] Карта масштабируется и центрируется

### Автоматический режим
- [ ] Выбор дистанции (3/5/10/15/21.1/42.2 км)
- [ ] Построение маршрута по кнопке
- [ ] Маршрут отображается на карте
- [ ] Отображается расстояние и точность

### Повторная генерация
- [ ] Кнопка "Заново" строит новый маршрут
- [ ] Маршрут отличается от предыдущего

### Ручной режим
- [ ] Добавление точек кликом по карте
- [ ] Перетаскивание точек
- [ ] Удаление точек (клик по точке)
- [ ] Вставка точки между существующими (режим вставки)
- [ ] Замыкание маршрута
- [ ] Построение маршрута по точкам

### Переключение режимов
- [ ] Auto → Manual: маршрут очищается, точка старта добавляется
- [ ] Manual → Auto: маршрут очищается
- [ ] Любой → Track: не показывается предложение поделиться маршрутом; проверить корректное включение режима GPS-трекинга
- [ ] При переключении Auto/Manual предлагается поделиться маршрутом
- [ ] Повторный клик по активному режиму ничего не сбрасывает
- [ ] Track → Auto/Manual останавливает активную запись
- [ ] Переход в Track не предлагает поделиться
- [ ] Переход из Track с завершённым маршрутом в Auto/Manual предлагает поделиться перед удалением
- [ ] Активный Track → Auto: после остановки появляется предложение поделиться записанным маршрутом
- [ ] Track с менее чем двумя точками → Auto: предложение не появляется
- [ ] Manual с построенным маршрутом → Track: generated route сохраняется, manual draft очищается

### GPS-трекинг
- [ ] Начало трекинга (кнопка "Старт")
- [ ] Отображение текущей позиции на карте
- [ ] Запись следа маршрута
- [ ] Остановка трекинга (кнопка "Стоп")
- [ ] Построение маршрута по записанным точкам

### Экспорт и шаринг
- [ ] Кнопка "Поделиться" отправляет GPX
- [ ] Скачивание GPX при отсутствии Share API

### Калькулятор темпа
- [ ] Вкладка "Темп"
- [ ] Ввод дистанции и времени
- [ ] Расчёт темпа (мин/км) и скорости (км/ч)
- [ ] Расчёт времени на сплиты (100м/200м/400м)

## Тесты

Запуск всех модульных тестов:

```bash
node --test tests/route-utils.test.js tests/makeGPX.test.js tests/pace-utils.test.js tests/mode-utils.test.js
```

Тесты используют встроенный `node:test` и `node:assert/strict`. Дополнительные зависимости не требуются.

## Backend API

### Локальный запуск

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### Endpoints

| Endpoint | Описание |
|----------|----------|
| [`GET /health/live`](https://authentic-growth-runroute-pr-51.up.railway.app/health/live) | Проверка: процесс API работает |
| [`GET /health/ready`](https://authentic-growth-runroute-pr-51.up.railway.app/health/ready) | Проверка: API подключён к PostgreSQL (200/503) |
| `GET /api/health` | Совместимый liveness alias |
| `GET /api/me` | Текущий пользователь (требует Telegram initData) |

### Telegram Authentication

Mini App передаёт `Telegram.WebApp.initData` в заголовке `X-Telegram-Init-Data` при каждом запросе к защищённым endpoints.

**Production API URL:**

```
https://authentic-growth-runroute-pr-51.up.railway.app
```

Для локальной разработки установите `API_BASE_URL` в пустую строку в `mini-app/config.js` — будут использоваться относительные пути.

**Настройка Railway:**

В переменных Railway API service `ALLOWED_ORIGINS` должен содержать домен Vercel:

```
ALLOWED_ORIGINS=https://run-route-ten.vercel.app
```

**GET /api/me:**

Проверяет Telegram initData, создаёт/обновляет пользователя в `public.users`, возвращает данные текущего пользователя:

```json
{
  "user": {
    "id": "uuid",
    "telegram_user_id": 123,
    "telegram_username": "user",
    "first_name": "Name",
    "last_name": "Last",
    "language_code": "ru",
    "telegram_photo_url": "https://..."
  },
  "profile": null
}
```

**Ограничение срока жизни initData:**

По умолчанию `TELEGRAM_AUTH_MAX_AGE_SECONDS=86400` (24 часа). Значение настраивается через переменную окружения.

**Ручная проверка внутри Telegram:**

1. Откройте Mini App через бота
2. В DevTools (Chrome DevTools Remote Debugging) проверьте Network → `/api/me` → Headers → `X-Telegram-Init-Data`
3. Ответ должен содержать `user` с `telegram_user_id`

**Запрос из обычного браузера:**

Без Telegram initData запрос `/api/me` вернёт 401. Это ожидаемое поведение — Mini App работает только внутри Telegram.

### Миграции

```bash
python -m backend.migrate
```

- Миграции **не выполняются** автоматически при старте API
- Повторный запуск пропускает уже применённые файлы
- Перед применением production-миграции проверьте `DATABASE_URL`
- Секреты нельзя передавать в командной строке или коммитить

### Railway

Проект использует два отдельных Railway service из одного GitHub repo:

**Bot service:**

| Параметр | Значение |
|----------|----------|
| Config file | `/railway.json` |
| Start command | `python bot.py` |

**API service:**

| Параметр | Значение |
|----------|----------|
| Config file | `/railway.api.json` |
| Pre-deploy | `python -m backend.migrate` |
| Start command | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
| Healthcheck path | `/health/ready` |
| Healthcheck timeout | 30s |

| Variable | Required | Описание |
|----------|----------|----------|

| Variable | Required | Описание |
|----------|----------|----------|
| DATABASE_URL | ✅ | PostgreSQL URL (Supabase) |
| SUPABASE_URL | ✅ | Supabase project URL |
| SUPABASE_SECRET_KEY | ✅ | Supabase secret key |
| BOT_TOKEN | ✅ | Telegram bot token |
| SECRET_KEY | ✅ | Application secret key |
| SUPABASE_PUBLISHABLE_KEY | ❌ | До подключения клиентской авторизации |
| WEB_APP_URL | ❌ | URL Mini App |
| FEEDBACK_CHAT_ID | ❌ | Telegram chat ID для обратной связи |
| ALLOWED_ORIGINS | ❌ | CORS origins |

Миграцию применяем отдельно один раз после review.

## Ограничения

- Основная клиентская логика находится в `mini-app/app.js` (1600+ строк)
- Backend и схема БД подготовлены; профильные endpoints и подключение Mini App будут добавлены следующими этапами
- Профили, подписки, календарь пробежек и социальная карта пока не реализованы
- Секреты (токены, ключи) нельзя хранить в клиентском коде
- Маршруты строятся через публичный Valhalla API (ограничения на количество запросов)

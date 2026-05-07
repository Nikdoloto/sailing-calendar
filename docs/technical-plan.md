# Технический план MVP

## Стек

- Frontend: статическое веб-приложение на HTML, CSS и JavaScript.
- PWA: `manifest.webmanifest` и `service-worker.js`.
- Backend: Node.js 24+ без внешних npm-зависимостей.
- Хранилище: SQLite через встроенный `node:sqlite`.
- Запуск за nginx: nginx отдаёт статику и проксирует `/api/*` на Node.js.

Такой стек выбран, чтобы MVP было проще перенести на сервер: не нужно ставить отдельную базу данных и npm-пакеты.

## Структура проекта

```text
public/
  app.js
  index.html
  manifest.webmanifest
  service-worker.js
  styles.css
server/
  server.js
  storage.js
  auth.js
  config.js
tests/
  api.test.js
docs/
  spec.md
  technical-plan.md
  backlog.md
data/
  sail-calendar.sqlite
```

## Данные

### users

- `id`
- `name`
- `role`
- `password_hash`
- `password_salt`
- `avatar`

### sessions

- `token_hash`
- `user_id`
- `expires_at`
- `created_at`

### availability

- `user_id`
- `date`
- `slot`
- `available`
- `updated_at`

Уникальность: один пользователь может иметь только одну запись на дату и слот.

### trainings

- `date`
- `slot`
- `time_label`
- `instructor`
- `comment`
- `created_by`
- `updated_at`

В MVP одна тренировка на дату. Если позже понадобятся несколько тренировок в один день, схему можно расширить.

## API

Все ответы в JSON.

### Auth

- `GET /api/users` - список профилей для экрана входа.
- `POST /api/login` - вход по `userId` и `password`.
- `GET /api/me` - текущий пользователь.
- `POST /api/logout` - выход.

### Calendar

- `GET /api/calendar?month=YYYY-MM` - календарь месяца с агрегированной доступностью и тренировками.
- `GET /api/day?date=YYYY-MM-DD` - детальная информация по дню.

### Availability

- `PUT /api/availability` - обновить доступность текущего пользователя.

Payload:

```json
{
  "date": "2026-06-13",
  "slots": {
    "morning": true,
    "day": false,
    "evening": true
  }
}
```

### Training

- `PUT /api/training` - создать или обновить тренировку. Только Никита.
- `DELETE /api/training?date=YYYY-MM-DD` - удалить тренировку. Только Никита.

Payload:

```json
{
  "date": "2026-06-13",
  "slot": "morning",
  "timeLabel": "08:00-12:00",
  "instructor": "Сергей",
  "comment": "Гонка на технику и старты."
}
```

## Безопасность MVP

- Пароли хранятся как `scrypt`-хэши с солью.
- Cookie хранит только случайный session token.
- В базе хранится только хэш session token.
- Cookie: `HttpOnly`, `SameSite=Lax`, срок 90 дней.
- Для production рекомендуется включить `Secure` cookie через переменную окружения.

## Проверка

Минимальные команды:

```bash
npm test
npm start
```

Ручная проверка:

- войти каждым пользователем;
- отметить разные слоты;
- проверить зелёную и жёлтую подсветку;
- забронировать тренировку под Никитой;
- убедиться, что остальные не могут бронировать.

## Риски

- `node:sqlite` требует Node.js 24+ и пока помечается Node как experimental.
- Демо-PIN нельзя оставлять на публичном сервере.
- Без уведомлений участникам нужно самим привыкнуть отмечать доступность.
- SVG-иконки используются для PWA как лёгкий MVP-вариант. Если конкретный мобильный браузер потребует PNG, их можно добавить без изменения логики приложения.
- При размещении в подпапке, например `/sailing-calendar/`, PWA-файлы должны отдаваться из этой же подпапки. Manifest, service worker и иконки используют относительные пути.
- Safari на iPhone не даёт сайту программно открыть окно установки PWA. Установка делается через системное меню `Поделиться -> Добавить на главный экран`.

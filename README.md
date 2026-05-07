# Sail Team Calendar

MVP-календарь доступности для парусной команды: участники отмечают свободные слоты, а Никита бронирует тренировку.

## Запуск

Нужен Node.js 24+.

```bash
npm start
```

Локальный адрес:

```text
http://localhost:3000
```

Тесты:

```bash
npm test
```

## Демо-PIN

- Никита: `1111`
- Даня: `2222`
- Лиза: `3333`
- Настя: `4444`

Требование к PIN: только цифры, длина от 4 до 12 символов.

Перед публикацией на сервере замени PIN через переменные окружения:

```bash
NIKITA_PIN=...
DANYA_PIN=...
LIZA_PIN=...
NASTYA_PIN=...
```

## Переменные окружения

| Переменная | Значение по умолчанию | Для чего |
| --- | --- | --- |
| `PORT` | `3000` | Порт Node.js-сервера |
| `DB_PATH` | `data/sail-calendar.sqlite` | Путь к SQLite-базе |
| `SESSION_DAYS` | `90` | Сколько дней помнить вход |
| `COOKIE_SECURE` | `false` | `true` для HTTPS в production |
| `NIKITA_PIN` | `1111` | PIN Никиты |
| `DANYA_PIN` | `2222` | PIN Дани |
| `LIZA_PIN` | `3333` | PIN Лизы |
| `NASTYA_PIN` | `4444` | PIN Насти |

## nginx

Пример проксирования, если приложение висит на том же домене:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Для HTTPS поставь `COOKIE_SECURE=true`.

## Важные решения MVP

- Регистрации нет: четыре профиля создаются при старте.
- `Весь день` в интерфейсе включает или выключает `Утро`, `День`, `Вечер`.
- Бронирование не блокируется автоматически, если свободны не все: Никита принимает решение сам.
- Если доступность меняется после бронирования, бронь остаётся видимой.
- PWA поддерживает установку и базовый cache статических файлов, но не offline-редактирование.

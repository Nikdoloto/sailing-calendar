# Как работать с test/prod, ветками и откатом

Этот документ написан для продуктового процесса Sailing Team Calendar: как безопасно тестировать изменения, просить DevOps-агента обновлять окружения и не ломать прод.

## 1. Короткая схема

У проекта две основные ветки:

| Ветка | URL | Для чего |
| --- | --- | --- |
| `develop` | `https://niknotes.online/sailing-calendar-test/` | Тестовая версия, новые фичи, эксперименты |
| `main` | `https://niknotes.online/sailing-calendar/` | Продакшен, версия для команды |

Правило простое:

- Всё новое сначала идёт в `develop`.
- Ты проверяешь это на test URL.
- Только после твоего “ок, можно в прод” изменения переносятся в `main`.
- DevOps-агент обновляет prod только из `main`.

## 2. Что выбирать в Codex

Когда просишь Codex что-то разработать:

- Для новой фичи, улучшения UI, push-уведомлений, автосинка, правок PWA: выбирай ветку `develop`.
- Для срочной правки production-багa можно работать от `main`, но лучше всё равно сделать фикс в `develop`, быстро проверить на test и потом перенести в `main`.
- Не проси Codex пушить экспериментальные изменения сразу в `main`.

Хорошая формулировка для Codex:

```text
Работаем в ветке develop. Сделай изменение, прогони тесты и запушь в origin/develop. В main пока не мержи.
```

Когда тест прошёл:

```text
Проверил test, всё ок. Перенеси develop в main, прогони тесты и запушь main.
```

## 3. Что говорить DevOps-агенту

### Обновить test

Используй после того, как Codex запушил изменения в `origin/develop`.

```bash
cd /opt/sailing-calendar-test \
&& git fetch origin \
&& git checkout develop \
&& git pull --ff-only origin develop \
&& npm test \
&& sudo systemctl restart sailing-calendar-test
```

После обновления проверить:

- `https://niknotes.online/sailing-calendar-test/` открывается;
- логин работает;
- тестовая доступность сохраняется;
- test ходит в `/sailing-calendar-test/api/...`;
- prod не изменился.

### Обновить prod

Используй только после того, как test проверен и изменения уже попали в `origin/main`.

```bash
cd /opt/sailing-calendar \
&& git fetch origin \
&& git checkout main \
&& git pull --ff-only origin main \
&& npm test \
&& sudo systemctl restart sailing-calendar
```

После обновления проверить:

- `https://niknotes.online/sailing-calendar/` открывается;
- логин работает;
- реальные данные команды на месте;
- test и prod всё ещё используют разные базы.

## 4. Как делать безопасное обновление

Перед каждым обновлением prod DevOps-агент должен сохранить:

1. Текущий commit.
2. Backup SQLite-базы.

Пример:

```bash
cd /opt/sailing-calendar
mkdir -p /var/backups/sailing-calendar
git rev-parse HEAD > /var/backups/sailing-calendar/last-prod-commit.txt
cp /opt/sailing-calendar/data/sail-calendar.sqlite \
  /var/backups/sailing-calendar/sail-calendar-$(date +%Y%m%d-%H%M%S).sqlite
```

Для test то же самое, но с test-базой:

```bash
cd /opt/sailing-calendar-test
mkdir -p /var/backups/sailing-calendar-test
git rev-parse HEAD > /var/backups/sailing-calendar-test/last-test-commit.txt
cp /var/lib/sailing-calendar-test/sail-calendar-test.sqlite \
  /var/backups/sailing-calendar-test/sail-calendar-test-$(date +%Y%m%d-%H%M%S).sqlite
```

## 5. Как откатиться, если обновление прошло плохо

Есть два разных типа отката.

### Откатить только код

Если приложение сломалось, но данные в базе нормальные:

```bash
cd /opt/sailing-calendar
PREVIOUS_COMMIT=$(cat /var/backups/sailing-calendar/last-prod-commit.txt)
git checkout $PREVIOUS_COMMIT
sudo systemctl restart sailing-calendar
```

Так записи в SQLite остаются как есть. Это лучший вариант, если проблема только в новом коде.

### Откатить код и базу

Если обновление испортило данные или схему базы:

```bash
cd /opt/sailing-calendar
PREVIOUS_COMMIT=$(cat /var/backups/sailing-calendar/last-prod-commit.txt)
git checkout $PREVIOUS_COMMIT
sudo systemctl stop sailing-calendar
cp /var/backups/sailing-calendar/НУЖНЫЙ_BACKUP.sqlite \
  /opt/sailing-calendar/data/sail-calendar.sqlite
sudo systemctl start sailing-calendar
```

Важно: откат базы возвращает состояние на момент backup. Всё, что пользователи успели записать после backup, пропадёт.

## 6. Что особенно важно для будущих push-уведомлений

Push-уведомления добавят новые данные: подписки устройств.

Поэтому для test и prod обязательно должны быть разные:

- SQLite-базы;
- push-подписки;
- желательно VAPID-ключи;
- `APP_PUBLIC_URL`.

Пример:

```text
TEST:
APP_PUBLIC_URL=https://niknotes.online/sailing-calendar-test/
DB_PATH=/var/lib/sailing-calendar-test/sail-calendar-test.sqlite
PUSH_ENABLED=false

PROD:
APP_PUBLIC_URL=https://niknotes.online/sailing-calendar/
DB_PATH=/opt/sailing-calendar/data/sail-calendar.sqlite
PUSH_ENABLED=true
```

Нельзя тестировать push на production-подписках. Иначе реальные участники могут получить тестовые уведомления.

## 7. Хороший рабочий цикл

1. Идея или баг.
2. Codex делает изменение в `develop`.
3. Codex пушит `origin/develop`.
4. DevOps-агент обновляет test.
5. Ты проверяешь test URL.
6. Если плохо: Codex правит `develop`, DevOps-агент снова обновляет test.
7. Если хорошо: Codex переносит `develop` в `main`.
8. DevOps-агент делает backup prod и обновляет prod.
9. После prod-проверки можно считать релиз завершённым.

Главное правило: `main` трогаем только тогда, когда test уже проверен.

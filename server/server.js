const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { parseCookies, serializeCookie } = require('./auth');
const { SLOT_DEFINITIONS, getConfig } = require('./config');
const { SLOT_IDS, Storage, validateDate, validateMonth } = require('./storage');

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon']
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function setMethodNotAllowed(res) {
  sendJson(res, 405, { error: 'Метод не поддерживается' });
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

function slotTimeLabel(slotId) {
  return SLOT_DEFINITIONS.find((slot) => slot.id === slotId)?.time ?? '';
}

function validateSlotPayload(slots) {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    throw new HttpError(400, 'Нужно передать слоты');
  }

  const normalized = {};
  let hasValidSlot = false;

  for (const slot of SLOT_IDS) {
    if (Object.hasOwn(slots, slot)) {
      if (typeof slots[slot] !== 'boolean') {
        throw new HttpError(400, 'Значение слота должно быть true или false');
      }

      normalized[slot] = slots[slot];
      hasValidSlot = true;
    }
  }

  if (!hasValidSlot) {
    throw new HttpError(400, 'Нет известных слотов для обновления');
  }

  return normalized;
}

function createApp(overrides = {}) {
  const config = getConfig(overrides);
  const storage = new Storage(config);
  storage.init();

  function sessionCookie(value, maxAge) {
    return serializeCookie(config.cookieName, value, {
      maxAge,
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.secureCookies
    });
  }

  function getSessionToken(req) {
    return parseCookies(req.headers.cookie ?? '')[config.cookieName];
  }

  function requireUser(req) {
    const token = getSessionToken(req);
    const user = storage.getSessionUser(token);

    if (!user) {
      throw new HttpError(401, 'Нужно войти');
    }

    return {
      token,
      user
    };
  }

  async function handleApi(req, res, url) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/api/users') {
      if (req.method !== 'GET') {
        setMethodNotAllowed(res);
        return;
      }

      sendJson(res, 200, { users: storage.listUsers() });
      return;
    }

    if (url.pathname === '/api/login') {
      if (req.method !== 'POST') {
        setMethodNotAllowed(res);
        return;
      }

      const body = await readJsonBody(req);
      const userId = Number(body.userId);
      const password = String(body.password ?? '');
      const user = storage.authenticateUser(userId, password);

      if (!user) {
        throw new HttpError(401, 'Неверный пользователь или пароль');
      }

      const session = storage.createSession(user.id);
      sendJson(
        res,
        200,
        {
          user,
          expiresAt: session.expiresAt
        },
        {
          'Set-Cookie': sessionCookie(
            session.token,
            config.sessionMaxAgeSeconds
          )
        }
      );
      return;
    }

    if (url.pathname === '/api/logout') {
      if (req.method !== 'POST') {
        setMethodNotAllowed(res);
        return;
      }

      storage.deleteSession(getSessionToken(req));
      sendJson(
        res,
        200,
        { ok: true },
        {
          'Set-Cookie': sessionCookie('', 0)
        }
      );
      return;
    }

    if (url.pathname === '/api/me') {
      if (req.method !== 'GET') {
        setMethodNotAllowed(res);
        return;
      }

      const { user } = requireUser(req);
      sendJson(res, 200, { user });
      return;
    }

    if (url.pathname === '/api/calendar') {
      if (req.method !== 'GET') {
        setMethodNotAllowed(res);
        return;
      }

      const { user } = requireUser(req);
      const month = url.searchParams.get('month');

      if (!month || !validateMonth(month)) {
        throw new HttpError(400, 'Месяц должен быть в формате YYYY-MM');
      }

      sendJson(res, 200, storage.getMonthCalendar(month, user.id));
      return;
    }

    if (url.pathname === '/api/day') {
      if (req.method !== 'GET') {
        setMethodNotAllowed(res);
        return;
      }

      const { user } = requireUser(req);
      const date = url.searchParams.get('date');

      if (!date || !validateDate(date)) {
        throw new HttpError(400, 'Дата должна быть в формате YYYY-MM-DD');
      }

      sendJson(res, 200, storage.getDay(date, user.id));
      return;
    }

    if (url.pathname === '/api/availability') {
      if (req.method !== 'PUT') {
        setMethodNotAllowed(res);
        return;
      }

      const { user } = requireUser(req);
      const body = await readJsonBody(req);

      if (!validateDate(body.date)) {
        throw new HttpError(400, 'Дата должна быть в формате YYYY-MM-DD');
      }

      const slots = validateSlotPayload(body.slots);
      storage.updateAvailability(user.id, body.date, slots);
      sendJson(res, 200, storage.getDay(body.date, user.id));
      return;
    }

    if (url.pathname === '/api/training') {
      const { user } = requireUser(req);

      if (user.role !== 'admin') {
        throw new HttpError(403, 'Бронирование доступно только Никите');
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);

        if (!validateDate(body.date)) {
          throw new HttpError(400, 'Дата должна быть в формате YYYY-MM-DD');
        }

        if (!SLOT_IDS.includes(body.slot)) {
          throw new HttpError(400, 'Неизвестный слот');
        }

        const instructor = String(body.instructor ?? '').trim();
        if (!instructor) {
          throw new HttpError(400, 'Укажите инструктора');
        }

        const training = storage.upsertTraining({
          date: body.date,
          slot: body.slot,
          timeLabel: String(body.timeLabel ?? '').trim() || slotTimeLabel(body.slot),
          instructor,
          comment: String(body.comment ?? '').trim(),
          createdBy: user.id
        });

        sendJson(res, 200, { training });
        return;
      }

      if (req.method === 'DELETE') {
        const date = url.searchParams.get('date');

        if (!date || !validateDate(date)) {
          throw new HttpError(400, 'Дата должна быть в формате YYYY-MM-DD');
        }

        storage.deleteTraining(date);
        sendJson(res, 200, { ok: true });
        return;
      }

      setMethodNotAllowed(res);
      return;
    }

    sendJson(res, 404, { error: 'API не найден' });
  }

  async function serveStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') {
      pathname = '/index.html';
    }

    const publicDir = path.resolve(config.publicDir);
    const filePath = path.resolve(publicDir, `.${pathname}`);
    const relativePath = path.relative(publicDir, filePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new HttpError(403, 'Доступ запрещён');
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        throw new HttpError(404, 'Файл не найден');
      }

      const extension = path.extname(filePath);
      const contentType =
        MIME_TYPES.get(extension) ?? 'application/octet-stream';
      const content = await fs.readFile(filePath);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control':
          extension === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new HttpError(404, 'Файл не найден');
      }
      throw error;
    }
  }

  async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }

      await serveStatic(req, res, url);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }

      console.error(error);
      sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
  }

  return {
    config,
    handler,
    storage
  };
}

function start() {
  const app = createApp();
  const server = http.createServer(app.handler);

  server.listen(app.config.port, () => {
    console.log(`Sail Team Calendar is running on http://localhost:${app.config.port}`);
  });

  const close = () => {
    server.close(() => {
      app.storage.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

if (require.main === module) {
  start();
}

module.exports = {
  createApp,
  start
};

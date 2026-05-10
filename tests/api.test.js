const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { createApp } = require('../server/server');

async function startTestApp() {
  const dbPath = path.join(
    os.tmpdir(),
    `sail-calendar-test-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.sqlite`
  );
  const app = createApp({
    dbPath,
    secureCookies: false,
    sessionDays: 90
  });
  const server = http.createServer(app.handler);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    app.storage.close();
    await fs.rm(dbPath, { force: true });
  }

  return {
    baseUrl,
    close
  };
}

async function request(context, url, options = {}) {
  const headers = {};

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const response = await fetch(`${context.baseUrl}${url}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await response.json().catch(() => ({}));

  return {
    status: response.status,
    json,
    setCookie: response.headers.get('set-cookie')
  };
}

async function login(context, userId, password) {
  const response = await request(context, '/api/login', {
    method: 'POST',
    body: {
      userId,
      password
    }
  });

  assert.equal(response.status, 200);
  assert.match(response.setCookie, /sail_calendar_session=/);
  return response.setCookie;
}

test('auth uses seeded profiles and cookie sessions', async () => {
  const context = await startTestApp();

  try {
    const users = await request(context, '/api/users');
    assert.equal(users.status, 200);
    assert.deepEqual(
      users.json.users.map((user) => user.name),
      ['Никита', 'Даня', 'Лиза', 'Настя']
    );

    const anonymousMe = await request(context, '/api/me');
    assert.equal(anonymousMe.status, 401);

    const rejected = await request(context, '/api/login', {
      method: 'POST',
      body: {
        userId: 1,
        password: 'wrong'
      }
    });
    assert.equal(rejected.status, 401);

    const cookie = await login(context, 1, '1111');
    const me = await request(context, '/api/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.name, 'Никита');
    assert.equal(me.json.user.role, 'admin');

    const logout = await request(context, '/api/logout', {
      method: 'POST',
      cookie
    });
    assert.equal(logout.status, 200);

    const afterLogout = await request(context, '/api/me', { cookie });
    assert.equal(afterLogout.status, 401);
  } finally {
    await context.close();
  }
});

test('availability aggregates dates as 3 of 4 and all 4', async () => {
  const context = await startTestApp();

  try {
    const nikita = await login(context, 1, '1111');
    const danya = await login(context, 2, '2222');
    const liza = await login(context, 3, '3333');
    const nastya = await login(context, 4, '4444');
    const date = '2026-06-13';

    for (const cookie of [nikita, danya, liza]) {
      const update = await request(context, '/api/availability', {
        method: 'PUT',
        cookie,
        body: {
          date,
          slots: {
            morning: true
          }
        }
      });
      assert.equal(update.status, 200);
    }

    const warningCalendar = await request(
      context,
      '/api/calendar?month=2026-06',
      { cookie: nikita }
    );
    const warningDay = warningCalendar.json.days.find((day) => day.date === date);
    assert.equal(warningDay.overallStatus, 'three');
    assert.equal(warningDay.bestCount, 3);

    const fourthUpdate = await request(context, '/api/availability', {
      method: 'PUT',
      cookie: nastya,
      body: {
        date,
        slots: {
          morning: true
        }
      }
    });
    assert.equal(fourthUpdate.status, 200);

    const successCalendar = await request(
      context,
      '/api/calendar?month=2026-06',
      { cookie: nikita }
    );
    const successDay = successCalendar.json.days.find((day) => day.date === date);
    assert.equal(successDay.overallStatus, 'all');
    assert.equal(successDay.bestCount, 4);

    const detail = await request(context, `/api/day?date=${date}`, {
      cookie: nikita
    });
    const morning = detail.json.slots.find((slot) => slot.id === 'morning');
    assert.equal(morning.availableCount, 4);
    assert.equal(morning.isCurrentUserAvailable, true);

    const removeDanya = await request(context, '/api/availability', {
      method: 'PUT',
      cookie: danya,
      body: {
        date,
        slots: {
          morning: false
        }
      }
    });
    assert.equal(removeDanya.status, 200);
    assert.equal(removeDanya.json.overallStatus, 'three');
  } finally {
    await context.close();
  }
});

test('only Nikita can book and delete training', async () => {
  const context = await startTestApp();

  try {
    const nikita = await login(context, 1, '1111');
    const danya = await login(context, 2, '2222');
    const date = '2026-06-13';

    const rejected = await request(context, '/api/training', {
      method: 'PUT',
      cookie: danya,
      body: {
        date,
        slot: 'morning',
        timeLabel: '08:00-12:00',
        instructor: 'Сергей',
        comment: 'Гонка на технику и старты.'
      }
    });
    assert.equal(rejected.status, 403);

    const booked = await request(context, '/api/training', {
      method: 'PUT',
      cookie: nikita,
      body: {
        date,
        slot: 'morning',
        timeLabel: '08:00-12:00',
        instructor: 'Сергей',
        comment: 'Гонка на технику и старты.'
      }
    });
    assert.equal(booked.status, 200);
    assert.equal(booked.json.training.instructor, 'Сергей');

    const visibleToParticipant = await request(context, `/api/day?date=${date}`, {
      cookie: danya
    });
    assert.equal(visibleToParticipant.status, 200);
    assert.equal(visibleToParticipant.json.training.instructor, 'Сергей');

    const deleteRejected = await request(
      context,
      `/api/training?date=${date}`,
      {
        method: 'DELETE',
        cookie: danya
      }
    );
    assert.equal(deleteRejected.status, 403);

    const deleted = await request(context, `/api/training?date=${date}`, {
      method: 'DELETE',
      cookie: nikita
    });
    assert.equal(deleted.status, 200);

    const afterDelete = await request(context, `/api/day?date=${date}`, {
      cookie: nikita
    });
    assert.equal(afterDelete.json.training, null);
  } finally {
    await context.close();
  }
});

test('PWA assets are served as static files', async () => {
  const context = await startTestApp();

  try {
    const manifest = await fetch(`${context.baseUrl}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get('content-type'), /manifest/);
    const manifestJson = await manifest.json();
    assert.equal(manifestJson.start_url, './');
    assert.equal(manifestJson.scope, './');
    assert.equal(manifestJson.icons[0].src, 'icons/icon-192.svg');

    const serviceWorker = await fetch(`${context.baseUrl}/service-worker.js`);
    assert.equal(serviceWorker.status, 200);
    assert.match(serviceWorker.headers.get('content-type'), /javascript/);

    const icon = await fetch(`${context.baseUrl}/icons/sail-logo.svg`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /svg/);
  } finally {
    await context.close();
  }
});

test('frontend resolves API paths relative to the mounted app folder', async () => {
  const appScript = await fs.readFile(
    path.join(__dirname, '..', 'public', 'app.js'),
    'utf8'
  );

  assert.match(appScript, /function apiUrl\(path\)/);
  assert.match(appScript, /new URL\(normalizedPath, document\.baseURI\)/);
  assert.doesNotMatch(appScript, /fetch\(path,/);
});

const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const SEEDED_USERS = [
  {
    id: 1,
    name: 'Никита',
    role: 'admin',
    avatar: 'Н',
    envName: 'NIKITA_PIN',
    defaultPassword: '1111'
  },
  {
    id: 2,
    name: 'Даня',
    role: 'participant',
    avatar: 'Д',
    envName: 'DANYA_PIN',
    defaultPassword: '2222'
  },
  {
    id: 3,
    name: 'Лиза',
    role: 'participant',
    avatar: 'Л',
    envName: 'LIZA_PIN',
    defaultPassword: '3333'
  },
  {
    id: 4,
    name: 'Настя',
    role: 'participant',
    avatar: 'А',
    envName: 'NASTYA_PIN',
    defaultPassword: '4444'
  }
];

const SLOT_DEFINITIONS = [
  {
    id: 'morning',
    label: 'Утро',
    time: '08:00-12:00'
  },
  {
    id: 'day',
    label: 'День',
    time: '12:00-16:00'
  },
  {
    id: 'evening',
    label: 'Вечер',
    time: '16:00-20:00'
  }
];

function numberFromEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveUserPin(user, overrides) {
  const pin =
    overrides.passwords?.[user.name] ??
    process.env[user.envName] ??
    user.defaultPassword;

  if (!/^\d{4,12}$/.test(String(pin))) {
    throw new Error(
      `${user.envName} должен быть цифровым PIN-кодом длиной от 4 до 12 символов`
    );
  }

  return pin;
}

function getConfig(overrides = {}) {
  const sessionDays = numberFromEnv(
    overrides.sessionDays ?? process.env.SESSION_DAYS,
    90
  );

  const users = SEEDED_USERS.map((user) => ({
    ...user,
    password: resolveUserPin(user, overrides)
  }));

  return {
    port: numberFromEnv(overrides.port ?? process.env.PORT, 3000),
    dbPath:
      overrides.dbPath ??
      process.env.DB_PATH ??
      path.join(PROJECT_ROOT, 'data', 'sail-calendar.sqlite'),
    publicDir: overrides.publicDir ?? path.join(PROJECT_ROOT, 'public'),
    cookieName: overrides.cookieName ?? 'sail_calendar_session',
    secureCookies:
      overrides.secureCookies ??
      process.env.COOKIE_SECURE === 'true' ??
      false,
    sessionDays,
    sessionMaxAgeSeconds: sessionDays * 24 * 60 * 60,
    users
  };
}

module.exports = {
  PROJECT_ROOT,
  SEEDED_USERS,
  SLOT_DEFINITIONS,
  getConfig
};

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  createPasswordHash,
  createSessionToken,
  hashToken,
  verifyPassword
} = require('./auth');
const { SLOT_DEFINITIONS } = require('./config');

const SLOT_IDS = SLOT_DEFINITIONS.map((slot) => slot.id);
const TOTAL_USERS = 4;

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    avatar: row.avatar
  };
}

function validateMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return false;
  }

  const [year, monthNumber] = month.split('-').map(Number);
  return year >= 2000 && monthNumber >= 1 && monthNumber <= 12;
}

function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthDateRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 0);

  return {
    start,
    end,
    startDate: formatDate(start),
    endDate: formatDate(end),
    daysInMonth: end.getDate()
  };
}

function createEmptySlot(slot) {
  return {
    ...slot,
    availableUsers: [],
    availableCount: 0,
    status: 'less',
    isCurrentUserAvailable: false
  };
}

function statusForCount(count) {
  if (count >= TOTAL_USERS) {
    return 'all';
  }

  if (count >= 3) {
    return 'three';
  }

  return 'less';
}

class Storage {
  constructor(config) {
    this.config = config;
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    this.db = new DatabaseSync(config.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  init() {
    this.migrate();
    this.seedUsers();
    this.deleteExpiredSessions();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'participant')),
        avatar TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS availability (
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        slot TEXT NOT NULL,
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, date, slot),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS trainings (
        date TEXT PRIMARY KEY,
        slot TEXT NOT NULL,
        time_label TEXT NOT NULL,
        instructor TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        created_by INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }

  seedUsers() {
    const statement = this.db.prepare(`
      INSERT INTO users (
        id,
        name,
        role,
        avatar,
        password_hash,
        password_salt,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        role = excluded.role,
        avatar = excluded.avatar,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        updated_at = excluded.updated_at
    `);

    const now = Date.now();
    for (const user of this.config.users) {
      const password = createPasswordHash(user.password);
      statement.run(
        user.id,
        user.name,
        user.role,
        user.avatar,
        password.hash,
        password.salt,
        now
      );
    }
  }

  listUsers() {
    return this.db
      .prepare('SELECT id, name, role, avatar FROM users ORDER BY id')
      .all()
      .map(publicUser);
  }

  getUserById(userId) {
    const row = this.db
      .prepare('SELECT id, name, role, avatar FROM users WHERE id = ?')
      .get(userId);
    return row ? publicUser(row) : null;
  }

  authenticateUser(userId, password) {
    const row = this.db
      .prepare(
        'SELECT id, name, role, avatar, password_hash, password_salt FROM users WHERE id = ?'
      )
      .get(userId);

    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
      return null;
    }

    return publicUser(row);
  }

  createSession(userId) {
    const token = createSessionToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const expiresAt = now + this.config.sessionMaxAgeSeconds * 1000;

    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(tokenHash, userId, expiresAt, now);

    return {
      token,
      expiresAt
    };
  }

  getSessionUser(token) {
    if (!token) {
      return null;
    }

    const row = this.db
      .prepare(
        `
        SELECT users.id, users.name, users.role, users.avatar
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `
      )
      .get(hashToken(token), Date.now());

    return row ? publicUser(row) : null;
  }

  deleteSession(token) {
    if (!token) {
      return;
    }

    this.db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .run(hashToken(token));
  }

  deleteExpiredSessions() {
    this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(Date.now());
  }

  updateAvailability(userId, date, slots) {
    const statement = this.db.prepare(`
      INSERT INTO availability (user_id, date, slot, available, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date, slot) DO UPDATE SET
        available = excluded.available,
        updated_at = excluded.updated_at
    `);
    const now = Date.now();

    this.db.exec('BEGIN');
    try {
      for (const slot of SLOT_IDS) {
        if (typeof slots[slot] === 'boolean') {
          statement.run(userId, date, slot, slots[slot] ? 1 : 0, now);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getMonthCalendar(month, currentUserId) {
    const range = getMonthDateRange(month);
    const days = [];

    for (let day = 1; day <= range.daysInMonth; day += 1) {
      const date = new Date(
        Number(month.slice(0, 4)),
        Number(month.slice(5, 7)) - 1,
        day
      );
      days.push(this.buildDaySummary(formatDate(date), currentUserId));
    }

    return {
      month,
      users: this.listUsers(),
      slots: SLOT_DEFINITIONS,
      days
    };
  }

  getDay(date, currentUserId) {
    return {
      ...this.buildDaySummary(date, currentUserId),
      users: this.listUsers()
    };
  }

  buildDaySummary(date, currentUserId) {
    const slotMap = new Map(
      SLOT_DEFINITIONS.map((slot) => [slot.id, createEmptySlot(slot)])
    );

    const availabilityRows = this.db
      .prepare(
        `
        SELECT
          availability.slot,
          users.id,
          users.name,
          users.role,
          users.avatar
        FROM availability
        JOIN users ON users.id = availability.user_id
        WHERE availability.date = ? AND availability.available = 1
        ORDER BY users.id
      `
      )
      .all(date);

    for (const row of availabilityRows) {
      const slot = slotMap.get(row.slot);
      if (!slot) {
        continue;
      }

      const user = publicUser(row);
      slot.availableUsers.push(user);
      if (user.id === currentUserId) {
        slot.isCurrentUserAvailable = true;
      }
    }

    const slots = Array.from(slotMap.values()).map((slot) => {
      const availableCount = slot.availableUsers.length;
      return {
        ...slot,
        availableCount,
        status: statusForCount(availableCount)
      };
    });

    const hasAll = slots.some((slot) => slot.status === 'all');
    const hasThree = slots.some((slot) => slot.status === 'three');
    const bestCount = Math.max(...slots.map((slot) => slot.availableCount), 0);
    const parsedDate = new Date(`${date}T00:00:00`);
    const dayOfWeek = parsedDate.getDay();

    return {
      date,
      dayOfWeek,
      isWeekendFocus: [5, 6, 0].includes(dayOfWeek),
      overallStatus: hasAll ? 'all' : hasThree ? 'three' : 'less',
      bestCount,
      slots,
      training: this.getTrainingByDate(date)
    };
  }

  getTrainingByDate(date) {
    const row = this.db
      .prepare(
        `
        SELECT
          trainings.date,
          trainings.slot,
          trainings.time_label AS timeLabel,
          trainings.instructor,
          trainings.comment,
          trainings.created_by AS createdBy,
          trainings.updated_at AS updatedAt,
          users.name AS createdByName
        FROM trainings
        JOIN users ON users.id = trainings.created_by
        WHERE trainings.date = ?
      `
      )
      .get(date);

    return row ?? null;
  }

  upsertTraining(training) {
    const now = Date.now();

    this.db
      .prepare(
        `
        INSERT INTO trainings (
          date,
          slot,
          time_label,
          instructor,
          comment,
          created_by,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          slot = excluded.slot,
          time_label = excluded.time_label,
          instructor = excluded.instructor,
          comment = excluded.comment,
          created_by = excluded.created_by,
          updated_at = excluded.updated_at
      `
      )
      .run(
        training.date,
        training.slot,
        training.timeLabel,
        training.instructor,
        training.comment ?? '',
        training.createdBy,
        now
      );

    return this.getTrainingByDate(training.date);
  }

  deleteTraining(date) {
    this.db.prepare('DELETE FROM trainings WHERE date = ?').run(date);
  }
}

module.exports = {
  SLOT_IDS,
  Storage,
  validateDate,
  validateMonth
};

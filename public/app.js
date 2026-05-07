const app = document.querySelector('#app');

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const BASE_SLOTS = [
  { id: 'morning', label: 'Утро', time: '08:00-12:00' },
  { id: 'day', label: 'День', time: '12:00-16:00' },
  { id: 'evening', label: 'Вечер', time: '16:00-20:00' }
];

const state = {
  users: [],
  me: null,
  month: toMonth(new Date()),
  selectedDate: toDate(new Date()),
  calendar: null,
  day: null,
  message: '',
  installPrompt: null
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toMonth(date) {
  return toDate(date).slice(0, 7);
}

function parseDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const label = new Date(year, monthNumber - 1, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric'
  });
  return label[0].toUpperCase() + label.slice(1);
}

function dayLabel(date) {
  const parsed = parseDate(date);
  return parsed.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long'
  });
}

function addMonths(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  return toMonth(new Date(year, monthNumber - 1 + delta, 1));
}

function firstDateOfMonth(month) {
  return `${month}-01`;
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin'
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? 'Ошибка запроса');
  }

  return payload;
}

async function loadUsers() {
  const payload = await api('/api/users');
  state.users = payload.users;
}

async function loadMe() {
  const payload = await api('/api/me');
  state.me = payload.user;
}

async function loadCalendar() {
  const payload = await api(`/api/calendar?month=${state.month}`);
  state.calendar = payload;

  if (!state.selectedDate.startsWith(state.month)) {
    state.selectedDate = firstDateOfMonth(state.month);
  }

  await loadDay();
}

async function loadDay() {
  const payload = await api(`/api/day?date=${state.selectedDate}`);
  state.day = payload;
}

function statusLabel(status, count) {
  if (status === 'all') {
    return 'Все 4 свободны';
  }

  if (status === 'three') {
    return '3 из 4 свободны';
  }

  return count ? `${count} из 4 свободны` : 'Меньше 3';
}

function userPills(slot) {
  const activeIds = new Set(slot.availableUsers.map((user) => user.id));
  return state.users
    .map((user) => {
      const active = activeIds.has(user.id);
      return `
        <span class="user-pill ${active ? 'is-active' : ''}">
          <span class="mini-avatar">${escapeHtml(user.avatar)}</span>
          ${escapeHtml(user.name)}
        </span>
      `;
    })
    .join('');
}

function renderLogin() {
  const selectedId = state.users[0]?.id ?? '';
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-panel">
        <div class="brand">
          <img class="brand-mark" src="icons/sail-logo.svg" alt="" />
          <div>
            <h1 class="brand-title">Sail Team Calendar</h1>
            <p class="brand-caption">Календарь тренировок команды</p>
          </div>
        </div>

        <form class="login-form" id="login-form">
          <label class="field-label">Выберите пользователя</label>
          <div class="profile-list">
            ${state.users
              .map(
                (user, index) => `
                  <label class="profile-option ${index === 0 ? 'is-selected' : ''}">
                    <span class="avatar">${escapeHtml(user.avatar)}</span>
                    <span class="profile-name">${escapeHtml(user.name)}</span>
                    <input class="sr-only" type="radio" name="userId" value="${user.id}" ${
                      index === 0 ? 'checked' : ''
                    } />
                    <span class="radio-dot" aria-hidden="true"></span>
                  </label>
                `
              )
              .join('')}
          </div>

          <div class="password-row">
            <label class="field-label" for="password">PIN-код</label>
            <input class="text-input" id="password" name="password" type="password" inputmode="numeric" pattern="[0-9]{4,12}" maxlength="12" autocomplete="current-password" placeholder="Введите PIN-код" required />
          </div>

          <button class="primary-button" type="submit">Войти</button>
          <p class="caption">Вход запоминается на 30-90 дней.</p>
          ${state.message ? `<div class="message">${escapeHtml(state.message)}</div>` : ''}
        </form>
      </section>
    </main>
  `;

  const form = document.querySelector('#login-form');
  form.addEventListener('change', () => {
    document.querySelectorAll('.profile-option').forEach((option) => {
      const radio = option.querySelector('input[type="radio"]');
      option.classList.toggle('is-selected', radio.checked);
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);

    try {
      state.message = '';
      const payload = await api('/api/login', {
        method: 'POST',
        body: {
          userId: Number(data.get('userId') || selectedId),
          password: data.get('password')
        }
      });
      state.me = payload.user;
      await loadCalendar();
      renderApp();
    } catch (error) {
      state.message = error.message;
      renderLogin();
    }
  });
}

function monthCells() {
  const [year, monthNumber] = state.month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = [];

  for (let index = 0; index < totalCells; index += 1) {
    const dayNumber = index - startOffset + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cells.push(null);
    } else {
      cells.push(toDate(new Date(year, monthNumber - 1, dayNumber)));
    }
  }

  return cells;
}

function renderCalendar() {
  const today = toDate(new Date());
  const dayMap = new Map(
    (state.calendar?.days ?? []).map((day) => [day.date, day])
  );

  return `
    <section class="panel calendar-panel" id="calendar">
      <div class="panel-header">
        <button class="icon-button" type="button" data-month-prev aria-label="Предыдущий месяц">‹</button>
        <h2 class="panel-title">${escapeHtml(monthLabel(state.month))}</h2>
        <button class="icon-button" type="button" data-month-next aria-label="Следующий месяц">›</button>
      </div>

      <div class="calendar-weekdays" aria-hidden="true">
        ${WEEKDAYS.map(
          (day, index) =>
            `<div class="weekday ${index >= 4 ? 'is-focus' : ''}">${day}</div>`
        ).join('')}
      </div>

      <div class="calendar-grid">
        ${monthCells()
          .map((date) => {
            if (!date) {
              return '<button class="day-cell is-empty" type="button" tabindex="-1"></button>';
            }

            const day = dayMap.get(date);
            const parsed = parseDate(date);
            const dayNumber = parsed.getDate();
            const status = day?.overallStatus ?? 'less';
            const count = day?.bestCount ?? 0;

            return `
              <button class="day-cell status-${status} ${
                day?.isWeekendFocus ? 'is-focus-day' : ''
              } ${date === state.selectedDate ? 'is-selected' : ''} ${
                date === today ? 'is-today' : ''
              }" type="button" data-date="${date}" aria-label="${escapeHtml(
                `${dayNumber}, ${statusLabel(status, count)}`
              )}">
                <span class="day-number">${dayNumber}</span>
                <span class="day-count">${count}/4</span>
                ${day?.training ? '<span class="training-dot"></span>' : ''}
              </button>
            `;
          })
          .join('')}
      </div>

      <div class="legend">
        <span class="legend-item"><span class="legend-dot status-all"></span>Все 4 свободны</span>
        <span class="legend-item"><span class="legend-dot status-three"></span>3 из 4 свободны</span>
        <span class="legend-item"><span class="legend-dot status-less"></span>Меньше 3 свободны</span>
      </div>
    </section>
  `;
}

function renderTrainingStatus(training) {
  if (!training) {
    return '';
  }

  return `
    <section class="training-card" id="booking">
      <h3>Тренировка забронирована</h3>
      <dl class="metadata">
        <div><dt>Дата</dt><dd>${escapeHtml(dayLabel(training.date))}</dd></div>
        <div><dt>Слот</dt><dd>${escapeHtml(training.timeLabel)}</dd></div>
        <div><dt>Инструктор</dt><dd>${escapeHtml(training.instructor)}</dd></div>
        ${
          training.comment
            ? `<div><dt>Комментарий</dt><dd>${escapeHtml(training.comment)}</dd></div>`
            : ''
        }
      </dl>
    </section>
  `;
}

function bestBookingSlot() {
  if (state.day?.training?.slot) {
    return state.day.training.slot;
  }

  const best =
    state.day?.slots.find((slot) => slot.status === 'all') ??
    state.day?.slots.find((slot) => slot.status === 'three') ??
    state.day?.slots[0];

  return best?.id ?? 'morning';
}

function renderBookingForm() {
  if (state.me?.role !== 'admin') {
    return '';
  }

  const training = state.day?.training;
  const selectedSlot = bestBookingSlot();
  const selectedSlotTime =
    BASE_SLOTS.find((slot) => slot.id === selectedSlot)?.time ?? '';

  return `
    <form class="booking-form" id="training-form">
      <h3>Бронирование тренировки</h3>
      <input type="hidden" name="date" value="${escapeHtml(state.selectedDate)}" />
      <label>
        <span class="field-label">Слот</span>
        <select class="select-input" name="slot" id="training-slot">
          ${BASE_SLOTS.map(
            (slot) => `
              <option value="${slot.id}" ${slot.id === selectedSlot ? 'selected' : ''}>
                ${escapeHtml(slot.label)} (${escapeHtml(slot.time)})
              </option>
            `
          ).join('')}
        </select>
      </label>
      <label>
        <span class="field-label">Время</span>
        <input class="text-input" name="timeLabel" value="${escapeHtml(
          training?.timeLabel ?? selectedSlotTime
        )}" />
      </label>
      <label>
        <span class="field-label">Инструктор</span>
        <input class="text-input" name="instructor" value="${escapeHtml(
          training?.instructor ?? ''
        )}" required />
      </label>
      <label>
        <span class="field-label">Комментарий</span>
        <textarea class="textarea-input" name="comment">${escapeHtml(
          training?.comment ?? ''
        )}</textarea>
      </label>
      <div class="form-actions">
        <button class="primary-button" type="submit">Забронировать тренировку</button>
        ${
          training
            ? '<button class="ghost-button" type="button" id="delete-training">Снять бронь</button>'
            : ''
        }
      </div>
    </form>
  `;
}

function renderDay() {
  const day = state.day;
  if (!day) {
    return '<section class="panel"><h2 class="panel-title">День</h2></section>';
  }

  const allDayChecked = day.slots.every((slot) => slot.isCurrentUserAvailable);

  return `
    <section class="panel day-panel" id="day">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(dayLabel(day.date))}</h2>
          <p class="caption">${escapeHtml(statusLabel(day.overallStatus, day.bestCount))}</p>
        </div>
        <span class="status-chip status-${day.overallStatus}">
          ${escapeHtml(statusLabel(day.overallStatus, day.bestCount))}
        </span>
      </div>

      <div class="day-actions">
        <span class="section-label">Слоты дня</span>
        <label class="toggle-row">
          <span>
            <strong>Весь день</strong>
            <span class="slot-time">08:00-20:00</span>
          </span>
          <span class="switch">
            <input type="checkbox" data-full-day ${allDayChecked ? 'checked' : ''} />
            <span class="switch-track"></span>
          </span>
        </label>
      </div>

      <div class="slot-list">
        ${day.slots
          .map(
            (slot) => `
              <article class="slot-card status-${slot.status}">
                <div class="slot-top">
                  <div>
                    <h3 class="slot-title">${escapeHtml(slot.label)}</h3>
                    <span class="slot-time">${escapeHtml(slot.time)}</span>
                  </div>
                  <label class="switch" aria-label="Свободен в слот ${escapeHtml(
                    slot.label
                  )}">
                    <input type="checkbox" data-slot-toggle="${slot.id}" ${
                      slot.isCurrentUserAvailable ? 'checked' : ''
                    } />
                    <span class="switch-track"></span>
                  </label>
                </div>
                <div class="user-pills">
                  ${userPills(slot)}
                </div>
              </article>
            `
          )
          .join('')}
      </div>

      ${renderTrainingStatus(day.training)}
      ${renderBookingForm()}
    </section>
  `;
}

function renderPwaBanner() {
  if (isStandalone()) {
    return '<section class="pwa-banner is-hidden"></section>';
  }

  return `
    <section class="pwa-banner">
      <button class="pwa-icon" type="button" id="install-icon" aria-label="Как добавить на главный экран">+</button>
      <div class="pwa-copy">
        <strong>Добавить на главный экран</strong>
        <p class="caption">Установите приложение как ярлык на телефон.</p>
      </div>
      <button class="secondary-button" type="button" id="install-button">Добавить</button>
    </section>
  `;
}

function renderApp() {
  app.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <div class="brand">
          <img class="brand-mark" src="icons/sail-logo.svg" alt="" />
          <div>
            <h1 class="brand-title">Sail Team Calendar</h1>
            <p class="brand-caption">Календарь тренировок команды</p>
          </div>
        </div>
        <div class="user-menu">
          <span class="user-chip">
            <span class="avatar">${escapeHtml(state.me.avatar)}</span>
            ${escapeHtml(state.me.name)}
          </span>
          <button class="icon-button" type="button" id="logout-button" aria-label="Выйти">×</button>
        </div>
      </header>

      ${renderPwaBanner()}
      ${state.message ? `<div class="message">${escapeHtml(state.message)}</div>` : ''}

      <div class="dashboard">
        ${renderCalendar()}
        ${renderDay()}
      </div>

      <nav class="bottom-nav" aria-label="Навигация">
        <button class="nav-button is-active" type="button" data-scroll-target="calendar">Календарь</button>
        <button class="nav-button" type="button" data-scroll-target="day">День</button>
        <button class="nav-button" type="button" data-scroll-target="booking">Бронь</button>
      </nav>
    </main>
  `;

  bindAppEvents();
}

function setMessage(message) {
  state.message = message;
  renderApp();
}

async function refreshAfterChange() {
  await loadCalendar();
  state.message = '';
  renderApp();
}

function bindAppEvents() {
  document.querySelector('[data-month-prev]')?.addEventListener('click', async () => {
    state.month = addMonths(state.month, -1);
    state.selectedDate = firstDateOfMonth(state.month);
    await refreshAfterChange();
  });

  document.querySelector('[data-month-next]')?.addEventListener('click', async () => {
    state.month = addMonths(state.month, 1);
    state.selectedDate = firstDateOfMonth(state.month);
    await refreshAfterChange();
  });

  document.querySelectorAll('[data-date]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.selectedDate = button.dataset.date;
      await loadDay();
      state.message = '';
      renderApp();
    });
  });

  document.querySelectorAll('[data-slot-toggle]').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api('/api/availability', {
          method: 'PUT',
          body: {
            date: state.selectedDate,
            slots: {
              [input.dataset.slotToggle]: input.checked
            }
          }
        });
        await refreshAfterChange();
      } catch (error) {
        setMessage(error.message);
      }
    });
  });

  document.querySelector('[data-full-day]')?.addEventListener('change', async (event) => {
    try {
      await api('/api/availability', {
        method: 'PUT',
        body: {
          date: state.selectedDate,
          slots: Object.fromEntries(
            BASE_SLOTS.map((slot) => [slot.id, event.target.checked])
          )
        }
      });
      await refreshAfterChange();
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.querySelector('#training-slot')?.addEventListener('change', (event) => {
    const selected = BASE_SLOTS.find((slot) => slot.id === event.target.value);
    const input = document.querySelector('input[name="timeLabel"]');
    if (selected && input) {
      input.value = selected.time;
    }
  });

  document.querySelector('#training-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    try {
      await api('/api/training', {
        method: 'PUT',
        body: {
          date: data.get('date'),
          slot: data.get('slot'),
          timeLabel: data.get('timeLabel'),
          instructor: data.get('instructor'),
          comment: data.get('comment')
        }
      });
      await refreshAfterChange();
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.querySelector('#delete-training')?.addEventListener('click', async () => {
    try {
      await api(`/api/training?date=${state.selectedDate}`, {
        method: 'DELETE'
      });
      await refreshAfterChange();
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.querySelector('#logout-button')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    state.me = null;
    state.calendar = null;
    state.day = null;
    state.message = '';
    renderLogin();
  });

  const handleInstallClick = async () => {
    if (!state.installPrompt) {
      setMessage(
        'На iPhone установка работает через Safari: Поделиться -> Добавить на главный экран. После обновления PWA откроется как /sailing-calendar, а не как корень сайта.'
      );
      return;
    }

    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    renderApp();
  };

  document.querySelector('#install-button')?.addEventListener('click', handleInstallClick);
  document.querySelector('#install-icon')?.addEventListener('click', handleInstallClick);

  document.querySelectorAll('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => {
      document
        .querySelector(`#${button.dataset.scrollTarget}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

async function init() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    if (state.me) {
      renderApp();
    }
  });

  await registerServiceWorker();
  await loadUsers();

  try {
    await loadMe();
    await loadCalendar();
    renderApp();
  } catch {
    state.me = null;
    renderLogin();
  }
}

init().catch((error) => {
  app.innerHTML = `
    <main class="loading-screen">
      <section class="login-panel">
        <h1 class="brand-title">Sail Team Calendar</h1>
        <div class="message">${escapeHtml(error.message)}</div>
      </section>
    </main>
  `;
});

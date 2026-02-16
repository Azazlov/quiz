import { escapeHtml, formatTimestamp } from './modules/utils.js';

class Dashboard {
    constructor() {
        this.updateInterval = null;
        this.init();
    }

    displayedBlocks = {}
    
    init() {
        this.loadStats();
        this.setupEventListeners();
        
        // Автообновление каждые 5 секунд
        this.updateInterval = setInterval(() => this.loadStats(), 5000);
    }
    
    setupEventListeners() {
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.loadStats();
        });
        const refreshFilesBtn = document.getElementById('refresh-files-btn');
        if (refreshFilesBtn) {
            refreshFilesBtn.addEventListener('click', () => {
                this.loadLessonFiles();
            });
        this.loadLessonFiles();
        }
        try{
                    // Находим контейнер, в котором лежат все тесты
        const container = document.getElementById('recent-tests-container');
        
        container.addEventListener('click', (e) => {
            // Проверяем, что кликнули по карточке или внутри неё
            const testItem = e.target.closest('.test-item');
            if (testItem) {
                const testId = testItem.dataset.testId;
                this.toggleTestDetails(testId);
            }
        });
        }
        catch(e){
            console.warn(e);
        }

    }

    async loadLessonFiles() {
        try {
            const response = await fetch('/api/tests/list');
            const data = await response.json();
            
            if (data.success) {
                this.renderLessonFilesList(data.files, data.current_lesson);
            } else {
                this.showError('Не удалось загрузить список файлов: ' + (data.error || 'Неизвестная ошибка'));
            }
        } catch (error) {
            console.error('Ошибка загрузки списка файлов:', error);
            this.showError('Ошибка подключения к серверу при загрузке файлов');
        }
    }
    
    renderLessonFilesList(files, currentLesson) {
        const container = document.getElementById('lesson-files-list');
        const currentLessonNameEl = document.getElementById('current-lesson-name');
        
        if (!container || !currentLessonNameEl) return;
        
        // Отображение текущего урока
        if (currentLesson) {
            currentLessonNameEl.textContent = currentLesson;
        } else {
            currentLessonNameEl.textContent = 'Не выбран';
        }
        
        // Если файлов нет
        if (!files || files.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📁</div>
                    <p>Файлы уроков не найдены</p>
                </div>
            `;
            return;
        }
        
        // Рендеринг списка файлов
        container.innerHTML = files.map(file => {
            const isCurrent = file.is_current;
            return `
                <div class="lesson-file-item ${isCurrent ? 'current' : ''}" data-filename="${this.escapeHtml(file.name)}">
                    <div class="lesson-file-info">
                        <div class="lesson-file-name">
                            ${this.escapeHtml(file.name)}
                            ${isCurrent ? '<span class="badge-current">Текущий</span>' : ''}
                        </div>
                        <div class="lesson-file-meta">
                            ${file.title !== file.name ? `<span class="lesson-file-title">${this.escapeHtml(file.title)}</span>` : ''}
                            ${file.questions_count > 0 ? `<span>❓ ${file.questions_count} вопросов</span>` : ''}
                            ${file.lessons_count > 0 ? `<span>📚 ${file.lessons_count} уроков</span>` : ''}
                            <span>💾 ${file.size_kb} KB</span>
                        </div>
                        <div class="lesson-file-date">
                            Обновлен: ${this.escapeHtml(file.modified)}
                        </div>
                    </div>
                    ${!isCurrent ? `
                        <button class="btn-select-lesson" data-filename="${this.escapeHtml(file.name)}">
                            Выбрать
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        // Добавление обработчиков событий для кнопок выбора
        container.querySelectorAll('.btn-select-lesson').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const filename = btn.getAttribute('data-filename');
                await this.selectLessonFile(filename);
            });
        });
    }
    
    async selectLessonFile(filename) {
        if (!filename) {
            this.showError('Не указано имя файла');
            return;
        }
        
        try {
            // Показываем индикатор загрузки
            this.showNotification(`🔄 Переключение на урок "${filename}"...`, 'info');
            
            const response = await fetch('/api/select_lesson', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lesson_name: filename
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Успешное переключение
                this.showNotification(`✅ Урок "${filename}" успешно выбран!`, 'success');
                
                // Обновляем интерфейс
                this.loadLessonFiles();
                this.loadStats(); // Обновляем статистику
                
                // Обновляем список уроков на главной странице (если открыта)
                setTimeout(() => {
                    window.quizApp?.loadLessons?.();
                }, 500);
            } else {
                this.showError('Не удалось выбрать урок: ' + (data.message || data.error || 'Неизвестная ошибка'));
            }
        } catch (error) {
            console.error('Ошибка выбора урока:', error);
            this.showError('Ошибка подключения к серверу при выборе урока');
        }
    }
    
    showNotification(message, type = 'info') {
        let notification = document.getElementById('dashboard-notification');
        
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'dashboard-notification';
            notification.className = 'notification';
            document.body.appendChild(notification);
        }
        
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.display = 'block';
        
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }
    
    showError(message) {
        console.error('[Dashboard Error]:', message);
        this.showNotification(`❌ ${message}`, 'error');
    }
    
async loadStats() {
    try {
        // ✅ СОХРАНЯЕМ состояние открытых тестов перед обновлением
        const preservedBlocks = { ...this.displayedBlocks };
        
        const response = await fetch('/api/dashboard/stats');
        const data = await response.json();
        
        this.updateStats(data);
        this.updateLastUpdateTime();
        
        // ✅ ВОССТАНАВЛИВАЕМ состояние открытых тестов после обновления
        this.restoreDisplayedBlocks(preservedBlocks);
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

// ✅ НОВЫЙ МЕТОД для восстановления состояния
restoreDisplayedBlocks(preservedBlocks) {
    if (!preservedBlocks || Object.keys(preservedBlocks).length === 0) {
        return;
    }
    
    for (const [testId, displayState] of Object.entries(preservedBlocks)) {
        if (displayState === 'block') {
            const item = document.querySelector(`.test-item[data-test-id="${testId}"] .test-details`);
            if (item) {
                item.style.display = 'block';
                this.displayedBlocks[testId] = 'block';
            }
        }
    }
}

    restoreDisplayedBlocks(preservedBlocks) {
        if (!preservedBlocks || Object.keys(preservedBlocks).length === 0) {
            return;
        }
        
        // Восстанавливаем только те тесты, которые всё ещё существуют
        for (const [testId, displayState] of Object.entries(preservedBlocks)) {
            if (displayState === 'block') {
                const item = document.querySelector(`.test-item[data-test-id="${testId}"] .test-details`);
                if (item) {
                    item.style.display = 'block';
                    // Обновляем состояние в displayedBlocks
                    this.displayedBlocks[testId] = 'block';
                }
            }
        }
    }
    
    updateStats(data) {
        this.updateTotalStats(data.total_stats);
        this.updateActiveSessions(data.active_sessions);
        this.updateRecentTests(data.recent_tests);
        this.updateLessonStats(data.lesson_stats);
        if (data.unique_devices) this.updateUniqueDevices(data.unique_devices);
        this.loadLessonControls();
    }

    updateUniqueDevices(devices) {
        const container = document.getElementById('ip-groups-container');
        if (!container) {
             console.warn('Контейнер ip-groups-container не найден');
             return;
        }

        if (!devices || devices.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🖥️</div>
                    <p>Нет данных об IP-адресах</p>
                </div>
            `;
            return;
        }

        container.innerHTML = devices.map(device => {
            const studentsHtml = device.students.slice(0, 5).map(student => 
                `<span class="device-student">${this.escapeHtml(student)}</span>`
            ).join(', ') + (device.students.length > 5 ? `, ... (+${device.students.length - 5})` : '');

            const lessonsHtml = device.lessons.slice(0, 3).map(lesson => 
                `<span class="device-lesson">${this.escapeHtml(lesson)}</span>`
            ).join(', ') + (device.lessons.length > 3 ? '...' : '');

            const statusBadge = device.is_active 
                ? '<span class="badge-active">🟢 Online</span>'
                : '<span class="badge-inactive">⚪ Offline</span>';

            const ipAddress = device.device_id;
            const displayName = device.device_name 
                ? `<strong>${this.escapeHtml(device.device_name)}</strong> <span class="device-ip-small">(${this.escapeHtml(ipAddress)})</span>`
                : `<span class="device-id-raw">${this.escapeHtml(ipAddress)}</span>`;
            return `
                <div class="device-card ${device.is_active ? 'device-active' : ''}">
                    <div class="device-header">
                        <div class="device-title">
                            ${displayName}
                            ${statusBadge}
                        </div>
                        <div class="device-actions">
                            <button class="btn device-edit" data-ip="${this.escapeHtml(ipAddress)}" data-current-name="${this.escapeHtml(device.device_name || '')}">
                                ✎ Имя
                            </button>
                        </div>
                    </div>
                    
                    <div class="device-stats">
                        <div class="stat-item">
                            <span class="stat-label">📊 Тестов:</span>
                            <span class="stat-value">${device.total_tests}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">✅ Сдано:</span>
                            <span class="stat-value">${device.completed_tests}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">⭐ Ср. балл:</span>
                            <span class="stat-value ${this.getGradeClass(device.average_percentage)}">
                                ${device.average_percentage}%
                            </span>
                        </div>
                    </div>

                    <div class="device-details">
                        ${device.student_count > 0 ? `
                            <div class="device-detail-section">
                                <div class="detail-label">👤 Студенты (${device.student_count}):</div>
                                <div class="detail-value">${studentsHtml}</div>
                            </div>
                        ` : ''}
                        
                        ${device.lesson_count > 0 ? `
                            <div class="device-detail-section">
                                <div class="detail-label">📚 Уроки:</div>
                                <div class="detail-value">${lessonsHtml}</div>
                            </div>
                        ` : ''}
                        
                        <div class="device-detail-section" style="margin-top: 5px; font-size: 0.85em; color: #666;">
                            ${device.last_seen ? `🕒 Посл. актив: ${this.escapeHtml(formatTimestamp(device.last_seen))}` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.device-edit').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const ip = btn.getAttribute('data-ip');
                const currentName = btn.getAttribute('data-current-name');
                const name = prompt(`Введите имя для IP ${ip}:`, currentName);
                if (name === null) return;
                try {
                    const res = await fetch('/api/ip_names', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ip: ip, name: name.trim() || null})
                    });
                    const j = await res.json();
                    if (j.success) {
                        this.showNotification(`✅ Имя для IP обновлено!`, 'success');
                        this.loadStats();
                    } else {
                        this.showError('Ошибка: ' + (j.error || 'Неизвестная ошибка'));
                    }
                } catch (err) {
                    console.error(err);
                    this.showError('Ошибка запроса к серверу');
                }
            });
        });
    }

    getGradeClass(percentage) {
        // ✅ НОВАЯ СПРАВЕДЛИВАЯ СИСТЕМА ОЦЕНОК
        if (percentage >= 90) return 'grade-excellent';      // 5
        if (percentage >= 61) return 'grade-good';           // 4 (было 75)
        if (percentage >= 41) return 'grade-satisfactory';   // 3 (было 60)
        return 'grade-unsatisfactory';                       // 2 (≤40%)
    }

    async loadLessonControls() {
        try {
            const res = await fetch('/api/lessons');
            const lessons = await res.json();
            const container = document.getElementById('lessons-control-container');
            if (!container) return;

            container.innerHTML = lessons.map(l => `
                <div class="lesson-control ${l.available ? '' : 'lesson-disabled'}">
                    <div class="lesson-title">${this.escapeHtml(l.name)}</div>
                    <div class="lesson-actions">
                        <button class="toggle-availability btn" data-id="${l.id}" data-available="${l.available}">
                            ${l.available ? 'Отключить' : 'Включить'}
                        </button>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.toggle-availability').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = Number(btn.getAttribute('data-id'));
                    const cur = btn.getAttribute('data-available') === 'true';
                    const newVal = !cur;
                    try {
                        const r = await fetch('/api/lessons/availability', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lesson_id: id, available: newVal })
                        });
                        const j = await r.json();
                        if (j.success) {
                            this.loadStats();
                        } else {
                            alert('Не удалось изменить доступность: ' + (j.error||''));
                        }
                    } catch (err) {
                        console.error(err);
                        alert('Ошибка запроса');
                    }
                });
            });
        } catch (err) {
            console.error('Ошибка загрузки уроков для управления:', err);
        }
    }
    
    updateTotalStats(stats) {
        document.getElementById('active-count').textContent = stats.total_active;
        document.getElementById('completed-count').textContent = stats.total_completed;
        document.getElementById('average-score').textContent = `${stats.average_percentage}%`;
        document.getElementById('average-time').textContent = Math.round(stats.average_time);
        
        document.getElementById('grade-excellent').textContent = stats.excellent;
        document.getElementById('grade-good').textContent = stats.good;
        document.getElementById('grade-satisfactory').textContent = stats.satisfactory;
        document.getElementById('grade-unsatisfactory').textContent = stats.unsatisfactory;
    }
    
    updateActiveSessions(sessions) {
        const container = document.getElementById('active-sessions-container');
        const countEl = document.getElementById('active-sessions-count');
        
        countEl.textContent = sessions.length;
        
        if (sessions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">😴</div>
                    <p>Нет активных сессий</p>
                </div>
            `;
            return;
        }
        container.innerHTML = sessions.map(session => `
            <div class="session-item">
                <div class="session-header">
                    <span class="session-name">${this.escapeHtml(session.student_name)}${session.ip_name ? ' (' + this.escapeHtml(session.ip_name) + ')' : ''}</span>
                    <span class="session-session-id">SessionID: ${this.escapeHtml(session.session_id)}</span>
                    <span class="session-device-id">DeviceID: ${this.escapeHtml(session.device_id)}</span>
                    <span class="session-time">${session.elapsed_time_formatted}</span>
                </div>
                <div class="session-info">
                    <div class="session-lesson">${this.escapeHtml(session.lesson_name)}</div>
                    <div class="session-meta">IP: ${this.escapeHtml(session.ip || 'unknown')} • Started: ${this.escapeHtml(formatTimestamp(session.start_timestamp))}</div>
                    <div class="session-progress">
                        <span>${session.questions_answered}/${session.total_questions}</span>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${session.progress}%; background-color: ${session.progress_color}"></div>
                        </div>
                        <span>${session.progress}%</span>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    updateRecentTests(tests) {
        const container = document.getElementById('recent-tests-container');
        const countEl = document.getElementById('recent-tests-count');
        
        countEl.textContent = tests.length;
        
        if (tests.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📝</div>
                    <p>Еще нет завершенных тестов</p>
                </div>
            `;
            return;
        }

        // ✅ Просто рендерим все тесты через renderTestItem
        container.innerHTML = tests.map(test => this.renderTestItem(test)).join('');
    }

renderTestItem(test) {
    const isVisible = this.displayedBlocks[test.id] === 'block';
    const displayStyle = isVisible ? 'block' : 'none';
    const gradeClass = this.getGradeClass(test.percentage);
    
    const moduleDisplay = test.module_name 
        ? `<span class="test-module">${this.escapeHtml(test.module_name)}</span>`
        : '';

    const lessonDisplay = test.lesson_id && test.lesson_name
        ? `<span class="test-lesson">${this.escapeHtml(test.lesson_name)}</span>`
        : `<span class="test-lesson">${this.escapeHtml(test.lesson_name || 'Без названия')}</span>`;

    return `
        <div class="test-item" style="cursor: pointer;" data-test-id="${test.id}">
            <div class="test-header">
                <span class="test-name">${this.escapeHtml(test.student_name)}${test.ip_name ? ' (' + this.escapeHtml(test.ip_name) + ')' : ''}</span>
                <span class="test-id">ID: ${this.escapeHtml(test.id || '')}</span>
                <span class="test-time">${test.timestamp && test.timestamp.length > 11 ? formatTimestamp(test.timestamp) : test.timestamp}</span>
            </div>
            <div class="test-info">
                <div class="test-module-lesson">
                    ${moduleDisplay}
                    ${lessonDisplay}
                </div>
                <div class="test-meta">IP: ${this.escapeHtml(test.ip || 'unknown')} • Device: ${this.escapeHtml(test.device_id || '')}</div>
                <div class="test-score ${gradeClass}">
                    ${test.score}/${test.total} (${test.percentage}%)
                    <span class="test-grade">${test.grade}</span>
                </div>
                <div class="test-duration">⏱️ ${test.elapsed_time_formatted || this.formatElapsedTime(test.elapsed_time)}</div>
            </div>
            <div class="test-details" style="display: ${displayStyle}">
                ${this.renderDetails(test)}
            </div>
        </div>
    `;
}

    renderDetails(test) {
        // Если в объекте test нет данных о вопросах, возвращаем заглушку
        if (!test.results || !Array.isArray(test.results)) {
            return `<div class="no-details">Детальная информация о вопросах отсутствует.</div>`;
        }

        return `
            <div class="test-details-content">
                <h4 class="details-title">Результаты по вопросам:</h4>
                <ul class="questions-list">
                    ${test.results.map((q, index) => {
                        const isCorrect = q.is_correct; // Или q.user_answer === q.correct_answer
                        const statusClass = isCorrect ? 'q-success' : 'q-error';
                        const statusIcon = isCorrect ? '✅' : '❌';

                        return `
                            <li class="question-item ${statusClass}">
                                <div class="q-main">
                                    <span class="q-number">#${index + 1}</span>
                                    <span class="q-text">${this.escapeHtml(q.question_text)}</span>
                                    <span class="q-icon">${statusIcon}</span>
                                </div>
                                <div class="q-answers">
                                    <div class="q-user-answer">
                                        <strong>Ваш ответ:</strong> ${this.escapeHtml(q.options[q.user_answer] || 'нет ответа')}
                                    </div>
                                    ${!isCorrect ? `
                                        <div class="q-correct-answer">
                                            <strong>Правильный:</strong> ${this.escapeHtml(q.options[q.correct_answer])}
                                        </div>
                                    ` : ''}
                                </div>
                            </li>
                        `;
                    }).join('')}
                </ul>
            </div>
        `;
    }

toggleTestDetails(testId) {
    // Переключаем состояние в JS
    const current = this.displayedBlocks[testId];
    this.displayedBlocks[testId] = (current === 'block') ? 'none' : 'block';
    
    // Обновляем DOM без полного перерендера
    const item = document.querySelector(`.test-item[data-test-id="${testId}"] .test-details`);
    if (item) {
        item.style.display = this.displayedBlocks[testId];
    }
}
    
    updateLessonStats(lessons) {
        const container = document.getElementById('lessons-stats-container');
        
        if (lessons.length === 0 || lessons.every(l => l.completed_count === 0)) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📊</div>
                    <p>Нет данных</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = lessons
            .filter(l => l.completed_count > 0)
            .map(lesson => `
                <div class="lesson-stat">
                    <div class="lesson-header">
                        <div class="lesson-title">${this.escapeHtml(lesson.lesson_name)}</div>
                        <span class="lesson-count">${lesson.completed_count} тестов</span>
                    </div>
                    <div class="lesson-body">
                        <span class="lesson-avg">${lesson.average_percentage}%</span>
                        <span class="lesson-trend ${lesson.trend}">${lesson.trend === 'up' ? '📈' : '📉'}</span>
                    </div>
                </div>
            `).join('');
    }
    
    updateLastUpdateTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        document.getElementById('last-update-time').textContent = timeString;
    }

    escapeHtml(text) {
        return escapeHtml(text);
    }
    
    formatElapsedTime(elapsed_time){
        return `${String(Math.floor(elapsed_time / 60)).padStart(2, '0')}:${String(elapsed_time % 60).padStart(2, '0')}`
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});
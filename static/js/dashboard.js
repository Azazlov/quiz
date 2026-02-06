import { escapeHtml, formatTimestamp } from './modules/utils.js';

class Dashboard {
    constructor() {
        this.updateInterval = null;
        this.init();
    }
    
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
    
    // Показать уведомление
    showNotification(message, type = 'info') {
        // Создаем или обновляем уведомление
        let notification = document.getElementById('dashboard-notification');
        
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'dashboard-notification';
            notification.className = 'notification';
            document.body.appendChild(notification);
        }
        
        // Устанавливаем класс в зависимости от типа
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.display = 'block';
        
        // Автоматическое скрытие через 3 секунды
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }
    
    // Показать ошибку
    showError(message) {
        console.error('[Dashboard Error]:', message);
        this.showNotification(`❌ ${message}`, 'error');
    }
    
    // ==================== СУЩЕСТВУЮЩИЕ МЕТОДЫ ====================
    
    async loadStats() {
        try {
            const response = await fetch('/api/dashboard/stats');
            const data = await response.json();
            
            this.updateStats(data);
            this.updateLastUpdateTime();
        } catch (error) {
            console.error('Ошибка загрузки статистики:', error);
            this.showError('Ошибка загрузки статистики');
        }
    }
    
    async loadStats() {
        try {
            const response = await fetch('/api/dashboard/stats');
            const data = await response.json();
            
            this.updateStats(data);
            this.updateLastUpdateTime();
        } catch (error) {
            console.error('Ошибка загрузки статистики:', error);
        }
    }
    
    updateStats(data) {
        // Обновление основной статистики
        this.updateTotalStats(data.total_stats);
        
        // Обновление активных сессий
        this.updateActiveSessions(data.active_sessions);
        
        // Обновление недавних тестов
        this.updateRecentTests(data.recent_tests);
        
        // Обновление статистики по урокам
        this.updateLessonStats(data.lesson_stats);
        
        // Обновление групп по IP (визуализация)
        if (data.ip_groups) this.updateIpGroups(data.ip_groups);

        // Загрузка панели управления уроками (доступность)
        this.loadLessonControls();
    }

// Заменяем метод отображения групп по IP на уникальные девайсы
updateUniqueDevices(devices) {
    const container = document.getElementById('ip-groups-container');
    if (!container) return;

    if (!devices || devices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📱</div>
                <p>Нет данных об устройствах</p>
            </div>
        `;
        return;
    }

    container.innerHTML = devices.map(device => {
        // Форматируем информацию о студентах
        const studentsHtml = device.students.map(student => 
            `<span class="device-student">${this.escapeHtml(student)}</span>`
        ).join(', ');

        // Форматируем информацию об уроках
        const lessonsHtml = device.lessons.map(lesson => 
            `<span class="device-lesson">${this.escapeHtml(lesson)}</span>`
        ).join(', ');

        // Статус активности
        const statusBadge = device.is_active 
            ? '<span class="badge-active">🟢 Активен</span>'
            : '<span class="badge-inactive">⚪ Неактивен</span>';

        // Имя устройства или заглушка
        const displayName = device.device_name 
            ? `<strong>${this.escapeHtml(device.device_name)}</strong> (${this.escapeHtml(device.device_id)})`
            : `<span class="device-id-raw">${this.escapeHtml(device.device_id)}</span>`;

        return `
            <div class="device-card ${device.is_active ? 'device-active' : ''}">
                <div class="device-header">
                    <div class="device-title">
                        ${displayName}
                        ${statusBadge}
                    </div>
                    <div class="device-actions">
                        <button class="btn device-edit" data-device-id="${this.escapeHtml(device.device_id)}">
                            ✎ Редактировать
                        </button>
                    </div>
                </div>
                
                <div class="device-stats">
                    <div class="stat-item">
                        <span class="stat-label">📊 Тестов всего:</span>
                        <span class="stat-value">${device.total_tests}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">✅ Завершено:</span>
                        <span class="stat-value">${device.completed_tests}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">👥 Активных сессий:</span>
                        <span class="stat-value">${device.active_sessions}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">⭐ Средний результат:</span>
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
                            <div class="detail-label">📚 Пройденные уроки (${device.lesson_count}):</div>
                            <div class="detail-value">${lessonsHtml}</div>
                        </div>
                    ` : ''}
                    
                    ${device.first_seen ? `
                        <div class="device-detail-section">
                            <div class="detail-label">🕐 Первый тест:</div>
                            <div class="detail-value">${this.escapeHtml(device.first_seen)}</div>
                        </div>
                    ` : ''}
                    
                    ${device.last_seen ? `
                        <div class="device-detail-section">
                            <div class="detail-label">🕐 Последний тест:</div>
                            <div class="detail-value">${this.escapeHtml(device.last_seen)}</div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Добавляем обработчики событий для кнопок редактирования
    container.querySelectorAll('.device-edit').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const deviceId = btn.getAttribute('data-device-id');
            const currentName = btn.closest('.device-card').querySelector('.device-title strong')?.textContent || '';
            
            const name = prompt(`Введите имя для устройства ${deviceId}\n(пусто для удаления имени):`, currentName);
            
            if (name === null) return; // Отмена
            
            try {
                const res = await fetch('/api/ip_names', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ip: deviceId, name: name || null})
                });
                const j = await res.json();
                if (j.success) {
                    this.showNotification(`✅ Имя устройства обновлено!`, 'success');
                    this.loadStats(); // Обновляем статистику
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

// Вспомогательный метод для определения класса оценки
getGradeClass(percentage) {
    if (percentage >= 90) return 'grade-excellent';
    if (percentage >= 75) return 'grade-good';
    if (percentage >= 60) return 'grade-satisfactory';
    return 'grade-unsatisfactory';
}

// В методе updateStats заменяем вызов
updateStats(data) {
    // Обновление основной статистики
    this.updateTotalStats(data.total_stats);
    
    // Обновление активных сессий
    this.updateActiveSessions(data.active_sessions);
    
    // Обновление недавних тестов
    this.updateRecentTests(data.recent_tests);
    
    // Обновление статистики по урокам
    this.updateLessonStats(data.lesson_stats);
    
    // Обновление уникальных девайсов (ЗАМЕНА)
    if (data.unique_devices) this.updateUniqueDevices(data.unique_devices);

    // Загрузка панели управления уроками
    this.loadLessonControls();
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

            // Attach listeners
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
        
        // Оценки
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

        container.innerHTML = tests.map(test => {
            const gradeClass = test.percentage >= 90 ? 'excellent' :
                              test.percentage >= 75 ? 'good' :
                              test.percentage >= 60 ? 'satisfactory' : 'unsatisfactory';
            console.log(test.ip_name)
            return `
                <div class="test-item">
                    <div class="test-header">
                        <span class="test-name">${this.escapeHtml(test.student_name)}${test.ip_name ? ' (' + this.escapeHtml(test.ip_name) + ')' : ''}</span>
                        <span class="test-id">ID: ${this.escapeHtml(test.id || '')}</span>
                        <span class="test-time">${test.timestamp.length > 11?formatTimestamp(test.timestamp) : test.timestamp}</span>
                    </div>
                    <div class="test-info">
                        <div class="test-lesson">${this.escapeHtml(test.lesson_name)}</div>
                        <div class="test-meta">IP: ${this.escapeHtml(test.ip || 'unknown')} • Device: ${this.escapeHtml(test.device_id || '')}</div>
                        <div class="test-score ${gradeClass}">
                            ${test.score}/${test.total} (${test.percentage}%)
                            <span class="test-grade">${test.grade}</span>
                        </div>
                        <div class="test-duration">⏱️ ${test.elapsed_time_formatted || `${Math.floor(test.elapsed_time/60)}:${test.elapsed_time%60}`}</div>
                    </div>
                </div>
            `;
        }).join('');
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

    // Using shared formatter from utils module
    
    escapeHtml(text) {
        return escapeHtml(text);
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});

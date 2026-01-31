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

    updateIpGroups(ipGroups) {
        const container = document.getElementById('ip-groups-container');
        if (!container) return;

        if (!ipGroups || ipGroups.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🛰️</div>
                    <p>Нет активных IP</p>
                </div>
            `;
            return;
        }

        container.innerHTML = ipGroups.map(group => {
            const sessionsHtml = (group.active_sessions || []).map(s => `
                <div class="ip-session">
                    <div class="ip-session-name">${this.escapeHtml(s.student_name)}${s.ip_name ? ' (' + this.escapeHtml(s.ip_name) + ')' : ''}</div>
                    <div class="ip-session-lesson">${this.escapeHtml(s.lesson_name)}</div>
                    <div class="ip-session-time">${this.escapeHtml(s.elapsed_time_formatted)}</div>
                </div>
            `).join('');

            const displayName = group.ip_name ? `${this.escapeHtml(group.ip_name)} (${this.escapeHtml(group.ip)})` : this.escapeHtml(group.ip);
            return `
                <div class="ip-group">
                    <div class="ip-group-header">
                        <div class="ip-badge">${displayName}</div>
                        <div class="ip-count">${group.total_active} active</div>
                        <button class="btn ip-edit" data-ip="${this.escapeHtml(group.ip)}">✎</button>
                    </div>
                    <div class="ip-group-body">${sessionsHtml}</div>
                </div>
            `;
        }).join('');

        // attach edit handlers
        container.querySelectorAll('.ip-edit').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const ip = btn.getAttribute('data-ip');
                const current = ''; // could fetch current from data, but we'll prompt
                const name = prompt('Введите имя для IP ' + ip + ' (пусто для удаления):', current);
                if (name === null) return;
                try {
                    const res = await fetch('/api/ip_names', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ip: ip, name: name || null})
                    });
                    const j = await res.json();
                    if (j.success) {
                        this.loadStats();
                    } else {
                        alert('Ошибка: ' + (j.error || ''));
                    }
                } catch (err) {
                    console.error(err);
                    alert('Ошибка запроса');
                }
            });
        });
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
                    <span class="session-device">Device: ${this.escapeHtml(session.device_id || session.session_id)}</span>
                    <span class="session-time">${session.elapsed_time_formatted}</span>
                </div>
                <div class="session-info">
                    <div class="session-lesson">${this.escapeHtml(session.lesson_name)}</div>
                    <div class="session-meta">IP: ${this.escapeHtml(session.ip || 'unknown')} • Started: ${this.escapeHtml(formatTimestamp(session.start_timestamp || session.start_time))}</div>
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
            
            return `
                <div class="test-item">
                    <div class="test-header">
                        <span class="test-name">${this.escapeHtml(test.student_name)}${test.ip_name ? ' (' + this.escapeHtml(test.ip_name) + ')' : ''}</span>
                        <span class="test-id">ID: ${this.escapeHtml(test.id || '')}</span>
                        <span class="test-time">${this.escapeHtml(formatTimestamp(test.timestamp || ''))}</span>
                    </div>
                    <div class="test-info">
                        <div class="test-lesson">${this.escapeHtml(test.lesson_name)}</div>
                        <div class="test-meta">IP: ${this.escapeHtml(test.ip || 'unknown')} • Device: ${this.escapeHtml(test.device_id || '')}</div>
                        <div class="test-score ${gradeClass}">
                            ${test.score}/${test.total} (${test.percentage}%)
                            <span class="test-grade">${test.grade}</span>
                        </div>
                        <div class="test-duration">⏱️ ${test.elapsed_time_formatted}</div>
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

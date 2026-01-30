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
                    <span class="session-name">${this.escapeHtml(session.student_name)}</span>
                    <span class="session-uuid">ID: ${this.escapeHtml(session.session_id)}</span>
                    <span class="session-time">${session.elapsed_time_formatted}</span>
                </div>
                <div class="session-info">
                    <div class="session-lesson">${this.escapeHtml(session.lesson_name)}</div>
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
                        <span class="test-name">${this.escapeHtml(test.student_name)}</span>
                        <span class="test-id">ID: ${this.escapeHtml(test.id || '')}</span>
                        <span class="test-time">${this.escapeHtml(test.timestamp || '')}</span>
                    </div>
                    <div class="test-info">
                        <div class="test-lesson">${this.escapeHtml(test.lesson_name)}</div>
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
    
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        text = String(text);
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m] || m);
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});
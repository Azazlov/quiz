/**
 * Перемешивает массив алгоритмом Фишера-Йетса
 * @param {Array} array - Массив для перемешивания
 * @returns {Array} Новый перемешанный массив
 */
export function shuffleArray(array) {
    if (!Array.isArray(array) || array.length < 2) {
        return array ? [...array] : [];
    }
    
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Экранирует HTML-специальные символы для защиты от XSS
 * @param {*} text - Текст для экранирования
 * @returns {string} Экранированная строка
 */
export function escapeHtml(text) {
    if (text === null || text === undefined) {
        return '';
    }
    
    text = String(text);
    
    // ✅ ИСПРАВЛЕНО: Правильные HTML-entities
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    
    return text.replace(/[&<>"']/g, char => map[char] || char);
}

/**
 * Перемешивает варианты ответов вопроса, сохраняя связь с правильным ответом
 * @param {Object} question - Объект вопроса с полями: options, correct_answer
 * @returns {Object} Вопрос с перемешанными вариантами и маппингом
 */
export function shuffleQuestionOptions(question) {
    if (!question || !Array.isArray(question.options)) {
        return {
            ...question,
            shuffledOptions: [],
            optionMapping: [],
            shuffledCorrectAnswer: -1
        };
    }
    
    // ✅ ОПТИМИЗИРОВАНО: Создаём массив индексов вместо объектов
    const indices = question.options.map((_, index) => index);
    const shuffledIndices = shuffleArray(indices);
    
    // Находим новый индекс правильного ответа
    const newCorrectIndex = shuffledIndices.indexOf(question.correct_answer);
    
    return {
        ...question,
        shuffledOptions: shuffledIndices.map(i => question.options[i]),
        optionMapping: shuffledIndices,
        shuffledCorrectAnswer: newCorrectIndex
    };
}

/**
 * Форматирует timestamp в локальную дату/время
 * @param {*} ts - Timestamp (строка, число или Date)
 * @param {Object} options - Опции форматирования
 * @returns {string} Отформатированная дата или исходное значение при ошибке
 */
export function formatTimestamp(ts, options = {}) {
    if (!ts) {
        return '';
    }
    
    try {
        const d = new Date(ts);
        
        // Проверка на невалидную дату
        if (isNaN(d.getTime())) {
            return String(ts);
        }
        
        // ✅ ОПТИМИЗИРОВАНО: Объединённые опции форматирования
        const defaultOptions = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            ...options
        };
        
        return d.toLocaleString('ru-RU', defaultOptions);
    } catch (e) {
        console.warn('[utils.js] formatTimestamp error:', e);
        return String(ts);
    }
}

/**
 * Форматирует время в секундах в формат MM:SS
 * @param {number} seconds - Время в секундах
 * @returns {string} Форматированное время (например, "05:30")
 */
export function formatElapsedTime(seconds) {
    if (typeof seconds !== 'number' || seconds < 0) {
        return '00:00';
    }
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Вычисляет процент правильных ответов
 * @param {number} correct - Количество правильных ответов
 * @param {number} total - Общее количество вопросов
 * @returns {number} Процент (0-100)
 */
export function calculatePercentage(correct, total) {
    if (!total || total <= 0) {
        return 0;
    }
    
    return Math.round((correct / total) * 100 * 100) / 100;
}

/**
 * Вычисляет оценку по проценту (справедливая система)
 * @param {number} percentage - Процент правильных ответов (0-100)
 * @returns {string} Оценка с описанием
 */
export function calculateGrade(percentage) {
    if (typeof percentage !== 'number' || percentage < 0) {
        return '2 (Неудовлетворительно)';
    }
    
    // ✅ НОВАЯ СПРАВЕДЛИВАЯ СИСТЕМА ОЦЕНОК
    if (percentage >= 90) return '5 (Отлично)';
    if (percentage >= 61) return '4 (Хорошо)';
    if (percentage >= 41) return '3 (Удовлетворительно)';
    return '2 (Неудовлетворительно)';
}

/**
 * Получает CSS класс для оценки
 * @param {number} percentage - Процент правильных ответов
 * @returns {string} CSS класс
 */
export function getGradeClass(percentage) {
    if (percentage >= 90) return 'grade-excellent';
    if (percentage >= 61) return 'grade-good';
    if (percentage >= 41) return 'grade-satisfactory';
    return 'grade-unsatisfactory';
}

/**
 * Глубокое клонирование объекта
 * @param {*} obj - Объект для клонирования
 * @returns {*} Клон объекта
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item));
    }
    
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, deepClone(value)])
    );
}

/**
 * Debounce функция для ограничения частоты вызовов
 * @param {Function} func - Функция для вызова
 * @param {number} wait - Время ожидания в мс
 * @returns {Function} Debounced функция
 */
export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle функция для ограничения частоты вызовов
 * @param {Function} func - Функция для вызова
 * @param {number} limit - Лимит в мс
 * @returns {Function} Throttled функция
 */
export function throttle(func, limit = 300) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}
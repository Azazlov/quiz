class QuizApp {
    constructor() {
        this.questions = [];
        this.currentQuestionIndex = 0;
        this.userAnswers = [];
        this.shuffledQuestions = [];
        this.questionOrderMap = [];
        this.timer = null;
        this.seconds = 0;
        this.modalActive = false;
        this.currentLessonId = null;
        this.sessionId = null;
        this.studentName = null;
        
        this.init();
    }
    
    init() {
        this.loadLessons();
        this.setupEventListeners();
    }
    
    // Функция для перемешивания массива (алгоритм Фишера-Йейтса)
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
    
    // Функция для перемешивания вариантов ответа с сохранением маппинга
    shuffleQuestionOptions(question) {
        // Создаем массив с вариантами и их оригинальными индексами
        const optionsWithIndex = question.options.map((option, index) => ({
            text: option,
            originalIndex: index
        }));
        
        // Перемешиваем варианты
        const shuffled = this.shuffleArray(optionsWithIndex);
        
        // Находим новый индекс правильного ответа
        const newCorrectIndex = shuffled.findIndex(
            opt => opt.originalIndex === question.correct_answer
        );
        
        return {
            ...question,
            shuffledOptions: shuffled.map(opt => opt.text),
            optionMapping: shuffled.map(opt => opt.originalIndex),
            shuffledCorrectAnswer: newCorrectIndex
        };
    }
    
async loadLessons() {
    try {
        const response = await fetch('/api/lessons');
        const lessons = await response.json();
        
        const lessonsList = document.getElementById('lessons-list');
        if (!lessonsList) return;
        
        lessonsList.innerHTML = '';
        
        if (!lessons || lessons.length === 0) {
            lessonsList.innerHTML = '<p class="no-lessons">Уроки не найдены. Выберите файл в консоли сервера.</p>';
            return;
        }
        
        lessons.forEach(lesson => {
            const lessonCard = document.createElement('div');
            lessonCard.className = 'lesson-card';
            // Используем только имя из JSON, так как там уже может быть написано "Занятие 1"
            lessonCard.innerHTML = `
                <div class="lesson-number">#${lesson.id}</div>
                <h3>${lesson.name}</h3>
            `;
            lessonCard.addEventListener('click', () => this.startQuiz(lesson.id));
            lessonsList.appendChild(lessonCard);
        });
    } catch (error) {
        console.error('Ошибка загрузки уроков:', error);
    }
}
    
    async startQuiz(lessonId) {
        // Запрос имени ученика
        const name = prompt('📝 Введите ваше имя для начала теста:', 'Ученик');
        if (!name || name.trim() === '') {
            alert('Пожалуйста, введите ваше имя!');
            return;
        }
        
        this.studentName = name.trim();
        this.currentLessonId = lessonId;
        
        try {
            // Создание сессии на сервере
            const response = await fetch('/api/start_session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    student_name: this.studentName,
                    lesson_id: lessonId
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.sessionId = result.session_id;
                this.showScreen('quiz-screen');
                this.startTimer();
                this.loadQuestionsForLesson(lessonId);
            } else {
                alert('Ошибка создания сессии: ' + result.error);
            }
        } catch (error) {
            console.error('Ошибка создания сессии:', error);
            alert('Не удалось начать тест. Проверьте подключение к серверу.');
        }
    }
    
    async loadQuestionsForLesson(lessonId) {
        try {
            const response = await fetch(`/api/questions/${lessonId}`);
            const questions = await response.json();
            
            if (questions.length > 0) {
                // 1. Перемешиваем ПОРЯДОК вопросов
                const indices = Array.from({length: questions.length}, (_, i) => i);
                this.questionOrderMap = this.shuffleArray(indices);
                
                // 2. Для каждого вопроса в новом порядке перемешиваем ВАРИАНТЫ ответов
                this.shuffledQuestions = this.questionOrderMap.map(originalIndex => {
                    const question = questions[originalIndex];
                    return this.shuffleQuestionOptions(question);
                });
                
                this.questions = questions;
                this.userAnswers = Array(this.shuffledQuestions.length).fill(null);
                this.currentQuestionIndex = 0;
                
                // Обновляем интерфейс
                const totalEl = document.getElementById('total-questions');
                const currentEl = document.getElementById('current-question');
                if (totalEl) totalEl.textContent = this.shuffledQuestions.length;
                if (currentEl) currentEl.textContent = '1';
                
                this.showQuestion();
            } else {
                alert('Вопросы для этого урока не найдены!');
                this.showScreen('welcome-screen');
            }
        } catch (error) {
            console.error('Ошибка загрузки вопросов:', error);
            alert('Не удалось загрузить вопросы. Проверьте подключение к серверу.');
            this.showScreen('welcome-screen');
        }
    }
    
    setupEventListeners() {
        // Кнопки навигации в тесте
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        const submitBtn = document.getElementById('submit-btn');
        const restartBtn = document.getElementById('restart-btn');
        
        if (prevBtn) prevBtn.addEventListener('click', () => this.prevQuestion());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextQuestion());
        if (submitBtn) submitBtn.addEventListener('click', () => this.submitQuiz());
        if (restartBtn) restartBtn.addEventListener('click', () => this.restartQuiz());
        
        // Кнопка добавления вопроса
        const addQuestionBtn = document.getElementById('add-question-btn');
        if (addQuestionBtn) {
            addQuestionBtn.addEventListener('click', () => this.openAddQuestionModal());
        }
        
        // Модальное окно
        const closeBtn = document.querySelector('.close');
        const addQuestionForm = document.getElementById('add-question-form');
        
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
        if (addQuestionForm) addQuestionForm.addEventListener('submit', (e) => this.addQuestion(e));
        
        // Закрытие модалки по клику вне
        window.addEventListener('click', (e) => {
            if (this.modalActive && e.target.classList.contains('modal')) {
                this.closeModal();
            }
        });
    }
    
    showQuestion() {
        const shuffledQuestion = this.shuffledQuestions[this.currentQuestionIndex];
        const container = document.getElementById('question-container');
        
        if (!container || !shuffledQuestion) {
            console.error('Не удалось отобразить вопрос:', { container, shuffledQuestion });
            return;
        }
        
        const currentDisplay = document.getElementById('current-question');
        if (currentDisplay) {
            currentDisplay.textContent = this.currentQuestionIndex + 1;
        }
        
        container.innerHTML = `
            <div class="question-text"></div>
            <div class="options-container" id="options-container"></div>
        `;
        
        // Установка текста вопроса через textContent
        const questionTextEl = container.querySelector('.question-text');
        if (questionTextEl) {
            questionTextEl.textContent = shuffledQuestion.question;
        }
        
        const optionsContainer = document.getElementById('options-container');
        if (!optionsContainer) return;
        
        optionsContainer.innerHTML = '';
        
        // Отображаем ПЕРЕМЕШАННЫЕ варианты ответов
        shuffledQuestion.shuffledOptions.forEach((option, shuffledIndex) => {
            const optionElement = document.createElement('div');
            optionElement.className = 'option';
            
            // Проверяем, был ли выбран этот вариант
            if (this.userAnswers[this.currentQuestionIndex] === shuffledQuestion.optionMapping[shuffledIndex]) {
                optionElement.classList.add('selected');
            }
            
            const optionLabel = document.createElement('span');
            optionLabel.className = 'option-label';
            optionLabel.textContent = `${String.fromCharCode(65 + shuffledIndex)}. ${option}`;
            
            optionElement.appendChild(optionLabel);
            optionElement.dataset.shuffledIndex = shuffledIndex;
            optionElement.addEventListener('click', (e) => this.selectOption(e, shuffledIndex));
            optionsContainer.appendChild(optionElement);
        });
        
        // Логирование просмотра вопроса на сервере
        this.logQuestionToServer();
        
        // Обновление кнопок навигации
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        const submitBtn = document.getElementById('submit-btn');
        
        if (prevBtn) prevBtn.disabled = this.currentQuestionIndex === 0;
        
        if (nextBtn && submitBtn) {
            if (this.currentQuestionIndex === this.shuffledQuestions.length - 1) {
                nextBtn.style.display = 'none';
                submitBtn.style.display = 'block';
            } else {
                nextBtn.style.display = 'block';
                submitBtn.style.display = 'none';
            }
        }
    }
    
    // Логирование вопроса на сервер
    async logQuestionToServer() {
        if (!this.sessionId) return;
        
        try {
            const shuffledQuestion = this.shuffledQuestions[this.currentQuestionIndex];
            await fetch('/api/log_question', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    question_num: this.currentQuestionIndex + 1,
                    question_text: shuffledQuestion.question
                })
            });
        } catch (error) {
            console.error('Ошибка логирования вопроса:', error);
        }
    }
    
    selectOption(event, shuffledIndex) {
        const currentQuestion = this.shuffledQuestions[this.currentQuestionIndex];
        
        // Снятие выделения со всех опций
        document.querySelectorAll('.option').forEach(opt => {
            opt.classList.remove('selected');
        });
        
        // Выделение выбранной опции
        event.target.closest('.option').classList.add('selected');
        
        // Сохраняем ОРИГИНАЛЬНЫЙ индекс ответа
        const originalAnswerIndex = currentQuestion.optionMapping[shuffledIndex];
        this.userAnswers[this.currentQuestionIndex] = originalAnswerIndex;
    }
    
    prevQuestion() {
        if (this.currentQuestionIndex > 0) {
            this.currentQuestionIndex--;
            this.showQuestion();
        }
    }
    
    nextQuestion() {
        if (this.currentQuestionIndex < this.shuffledQuestions.length - 1) {
            this.currentQuestionIndex++;
            this.showQuestion();
        }
    }
    
    startTimer() {
        this.seconds = 0;
        clearInterval(this.timer);
        
        this.timer = setInterval(() => {
            this.seconds++;
            const minutes = Math.floor(this.seconds / 60);
            const seconds = this.seconds % 60;
            const timerEl = document.getElementById('timer');
            if (timerEl) {
                timerEl.textContent = 
                    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }
    
    async submitQuiz() {
        try {
            // Преобразуем ответы из перемешанного порядка в оригинальный порядок вопросов
            const answersInOriginalOrder = Array(this.questions.length).fill(null);
            this.questionOrderMap.forEach((originalQuestionIndex, shuffledQuestionIndex) => {
                answersInOriginalOrder[originalQuestionIndex] = this.userAnswers[shuffledQuestionIndex];
            });
            
            // Отправка ответов
            const response = await fetch('/api/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    answers: answersInOriginalOrder,
                    lesson_id: this.currentLessonId,
                    session_id: this.sessionId
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Добавляем информацию о перемешанном порядке для корректного отображения результатов
                result.shuffledOrder = this.questionOrderMap;
                result.shuffledQuestions = this.shuffledQuestions;
                this.showResults(result);
            } else {
                alert('Ошибка при отправке ответов: ' + result.error);
            }
        } catch (error) {
            console.error('Ошибка отправки:', error);
            alert('Произошла ошибка при отправке результатов.');
        }
    }
    
    showResults(result) {
        clearInterval(this.timer);
        this.showScreen('results-screen');
        
        // Отображение основной информации
        const scoreEl = document.getElementById('score');
        const totalEl = document.getElementById('total');
        const percentageEl = document.getElementById('percentage');
        const gradeEl = document.getElementById('grade');
        
        if (scoreEl) scoreEl.textContent = result.score;
        if (totalEl) totalEl.textContent = result.total;
        if (percentageEl) percentageEl.textContent = result.percentage;
        
        // Определение оценки
        const grade = this.calculateGrade(result.percentage);
        if (gradeEl) gradeEl.textContent = `Оценка: ${grade}`;
        
        // Детальные результаты в ПЕРЕМЕШАННОМ порядке
        const detailedResults = document.getElementById('detailed-results');
        if (detailedResults) {
            detailedResults.innerHTML = '';
            
            // Отображаем результаты в том порядке, в котором вопросы были показаны ученику
            result.shuffledQuestions.forEach((shuffledQ, shuffledIndex) => {
                const originalQuestionIndex = result.shuffledOrder[shuffledIndex];
                const res = result.results.find(r => r.question_id === shuffledQ.id);
                
                if (!res) return;
                
                const resultItem = document.createElement('div');
                resultItem.className = `result-item ${res.is_correct ? 'correct' : 'incorrect'}`;
                
                const correctOption = shuffledQ.options[res.correct_answer];
                const userOptionIndex = this.userAnswers[shuffledIndex];
                const userOption = userOptionIndex !== null ? shuffledQ.options[userOptionIndex] : 'Не отвечено';
                
                resultItem.innerHTML = `
                    <div class="result-question">${shuffledIndex + 1}. ${this.escapeHtml(shuffledQ.question)}</div>
                    <div class="result-answer">
                        ${res.is_correct ? '✅' : '❌'} Ваш ответ: ${this.escapeHtml(userOption)}
                        ${!res.is_correct ? `<br>Правильный ответ: ${this.escapeHtml(correctOption)}` : ''}
                    </div>
                `;
                
                detailedResults.appendChild(resultItem);
            });
        }
    }
    
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m] || m);
    }
    
    calculateGrade(percentage) {
        if (percentage >= 90) return '5 (Отлично)';
        if (percentage >= 75) return '4 (Хорошо)';
        if (percentage >= 60) return '3 (Удовлетворительно)';
        return '2 (Неудовлетворительно)';
    }
    
    restartQuiz() {
        this.showScreen('welcome-screen');
        this.currentQuestionIndex = 0;
        this.userAnswers = [];
        this.shuffledQuestions = [];
        this.questionOrderMap = [];
        this.sessionId = null;
        this.studentName = null;
    }
    
    showScreen(screenId) {
        // Скрытие всех экранов
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // Показ выбранного экрана
        const screenEl = document.getElementById(screenId);
        if (screenEl) {
            screenEl.classList.add('active');
        } else {
            console.error(`Экран ${screenId} не найден!`);
        }
    }
    
    openAddQuestionModal() {
        const modal = document.getElementById('add-question-modal');
        if (modal) {
            modal.classList.add('active');
            this.modalActive = true;
        }
    }
    
    closeModal() {
        const modal = document.getElementById('add-question-modal');
        if (modal) {
            modal.classList.remove('active');
            this.modalActive = false;
        }
        const form = document.getElementById('add-question-form');
        if (form) form.reset();
    }
    
    async addQuestion(event) {
        event.preventDefault();
        
        const questionText = document.getElementById('question-text').value;
        const optionInputs = document.querySelectorAll('.option-input');
        const correctOption = document.querySelector('input[name="correct-option"]:checked').value;
        const points = parseInt(document.getElementById('points').value);
        
        const options = Array.from(optionInputs).map(input => input.value);
        
        const newQuestion = {
            question: questionText,
            options: options,
            correct_answer: parseInt(correctOption),
            points: points
        };
        
        try {
            const response = await fetch('/api/add_question', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newQuestion)
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert('Вопрос успешно добавлен!');
                this.closeModal();
                // Перезагрузка вопросов
                if (this.currentLessonId) {
                    this.loadQuestionsForLesson(this.currentLessonId);
                }
            } else {
                alert('Ошибка при добавлении вопроса: ' + result.error);
            }
        } catch (error) {
            console.error('Ошибка добавления вопроса:', error);
            alert('Произошла ошибка при добавлении вопроса.');
        }
    }
}

// Инициализация приложения при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.quizApp = new QuizApp();
});
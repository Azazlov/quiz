import { shuffleArray, escapeHtml, shuffleQuestionOptions } from './modules/utils.js';

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
    
async loadLessons() {
    try {
        const response = await fetch('/api/lessons');
        const lessons = await response.json();
        
        const lessonsList = document.getElementById('lessons-list');
        if (!lessonsList) return;
        
        lessonsList.innerHTML = '';
        
        if (!lessons || lessons.length === 0) {
            lessonsList.innerHTML = '<a href="/dashboard" class="no-lessons">Уроки не найдены. Выберите файл в консоли сервера.</p>';
            return;
        }
        
        lessons.forEach(lesson => {
            const lessonCard = document.createElement('div');
            lessonCard.className = 'lesson-card';
            const disabled = lesson.available === false;
            lessonCard.innerHTML = `
                <div class="lesson-number">#${lesson.id}</div>
                <h3>${lesson.name}${disabled ? ' <span class="locked">(Недоступен)</span>' : ''}</h3>
            `;
            if (!disabled) {
                lessonCard.addEventListener('click', () => this.startQuiz(lesson.id));
            } else {
                lessonCard.classList.add('lesson-unavailable');
            }
            lessonsList.appendChild(lessonCard);
        });
    } catch (error) {
        console.error('Ошибка загрузки уроков:', error);
    }
}
    
    async startQuiz(lessonId) {
        const name = prompt('📝 Введите ваше имя для начала теста:', 'Ученик');
        if (!name || name.trim() === '') {
            alert('Пожалуйста, введите ваше имя!');
            return;
        }
        
        this.studentName = name.trim();
        this.currentLessonId = lessonId;
        
        try {
            let deviceId = localStorage.getItem('device_id');
            if (!deviceId) {
                deviceId = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2,'0')).join('');
                localStorage.setItem('device_id', deviceId);
            }

            const response = await fetch('/api/start_session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    student_name: this.studentName,
                    lesson_id: lessonId,
                    device_id: deviceId
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
                const indices = Array.from({length: questions.length}, (_, i) => i);
                this.questionOrderMap = shuffleArray(indices);
                
                this.shuffledQuestions = this.questionOrderMap.map(originalIndex => {
                    const question = questions[originalIndex];
                    return shuffleQuestionOptions(question);
                });
                
                this.questions = questions;
                this.userAnswers = Array(this.shuffledQuestions.length).fill(null);
                this.currentQuestionIndex = 0;
                
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
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        const submitBtn = document.getElementById('submit-btn');
        const restartBtn = document.getElementById('restart-btn');
        
        if (prevBtn) prevBtn.addEventListener('click', () => this.prevQuestion());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextQuestion());
        if (submitBtn) submitBtn.addEventListener('click', () => this.submitQuiz());
        if (restartBtn) restartBtn.addEventListener('click', () => this.restartQuiz());
        
        const addQuestionBtn = document.getElementById('add-question-btn');
        if (addQuestionBtn) {
            addQuestionBtn.addEventListener('click', () => this.openAddQuestionModal());
        }
        
        const closeBtn = document.querySelector('.close');
        const addQuestionForm = document.getElementById('add-question-form');
        
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
        if (addQuestionForm) addQuestionForm.addEventListener('submit', (e) => this.addQuestion(e));
        
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
        
        const questionTextEl = container.querySelector('.question-text');
        if (questionTextEl) {
            questionTextEl.textContent = shuffledQuestion.question;
        }
        
        const optionsContainer = document.getElementById('options-container');
        if (!optionsContainer) return;
        
        optionsContainer.innerHTML = '';
        
        shuffledQuestion.shuffledOptions.forEach((option, shuffledIndex) => {
            const optionElement = document.createElement('div');
            optionElement.className = 'option';
            
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
        
        this.logQuestionToServer();
        
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
        
        document.querySelectorAll('.option').forEach(opt => {
            opt.classList.remove('selected');
        });
        
        event.target.closest('.option').classList.add('selected');
        
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
                    `Прошло времени: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }
    
    async submitQuiz() {
        try {
            const answersInOriginalOrder = Array(this.questions.length).fill(null);
            this.questionOrderMap.forEach((originalQuestionIndex, shuffledQuestionIndex) => {
                answersInOriginalOrder[originalQuestionIndex] = this.userAnswers[shuffledQuestionIndex];
            });
            
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
        
        const scoreEl = document.getElementById('score');
        const totalEl = document.getElementById('total');
        const percentageEl = document.getElementById('percentage');
        const gradeEl = document.getElementById('grade');
        
        if (scoreEl) scoreEl.textContent = result.score;
        if (totalEl) totalEl.textContent = result.total;
        if (percentageEl) percentageEl.textContent = result.percentage;
        
        const grade = this.calculateGrade(result.percentage);
        if (gradeEl) gradeEl.textContent = `Оценка: ${grade}`;
        
        const detailedResults = document.getElementById('detailed-results');
        if (detailedResults) {
            detailedResults.innerHTML = '';
            
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
        return escapeHtml(text);
    }
    
calculateGrade(percentage) {
    // ✅ НОВАЯ СПРАВЕДЛИВАЯ СИСТЕМА ОЦЕНОК
    if (percentage >= 90) return '5 (Отлично)';
    if (percentage >= 61) return '4 (Хорошо)';           // Было: 75
    if (percentage >= 41) return '3 (Удовлетворительно)'; // Было: 60
    return '2 (Неудовлетворительно)';                     // Было: <60
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
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
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

document.addEventListener('DOMContentLoaded', () => {
    window.quizApp = new QuizApp();
});
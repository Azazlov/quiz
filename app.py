from flask import Flask, render_template, jsonify, request, session, redirect, url_for
import hashlib
import json
import os
import time
import uuid
from datetime import datetime
from colorama import init, Fore, Style
import glob
import sys
from functools import lru_cache

# ────────────────────────────────────────────
# Инициализация
# ────────────────────────────────────────────
init(autoreset=True)
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key')

# ────────────────────────────────────────────
# Константы
# ────────────────────────────────────────────
LOG_FILE = 'logs.json'
IP_NAMES_FILE = 'ip_names.json'
TESTS_DIR = 'tests'
SESSION_TIMEOUT = 3600  # 1 час
COOLDOWN_TIME = 600     # 10 минут

# ────────────────────────────────────────────
# Глобальные переменные
# ────────────────────────────────────────────
SELECTED_TEST_FILE = None
LESSONS = []
sessions = {}
completed_tests = []
IP_NAMES = {}
cooldown_devices = {}

# ────────────────────────────────────────────
# Админские учётные данные
# ────────────────────────────────────────────
ADMIN_NICK = os.environ.get('ADMIN_NICK', 'admin')
ADMIN_PASS_HASH = os.environ.get(
    'ADMIN_PASS_HASH',
    hashlib.sha256('secret123'.encode()).hexdigest()
)

# ────────────────────────────────────────────
# Система оценок (справедливая)
# ────────────────────────────────────────────
def calculate_grade(percentage):
    """Расчёт оценки по проценту правильных ответов"""
    if percentage >= 90:
        return '5 (Отлично)'
    elif percentage >= 61:
        return '4 (Хорошо)'
    elif percentage >= 41:
        return '3 (Удовлетворительно)'
    else:
        return '2 (Неудовлетворительно)'

def get_grade_class(percentage):
    """CSS класс для оценки"""
    if percentage >= 90:
        return 'grade-excellent'
    elif percentage >= 61:
        return 'grade-good'
    elif percentage >= 41:
        return 'grade-satisfactory'
    return 'grade-unsatisfactory'

# ────────────────────────────────────────────
# Работа с уроками
# ────────────────────────────────────────────
@lru_cache(maxsize=10)
def load_questions_cached(lesson_id, file_path):
    """Кэшированная загрузка вопросов"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if 'lessons' in data and lesson_id is not None:
            lessons = data.get('lessons', [])
            idx = max(0, lesson_id - 1)
            if 0 <= idx < len(lessons):
                return lessons[idx].get('questions', [])
        
        qs_all = data.get('questions', [])
        lessons_count = len(LESSONS)
        if qs_all and lessons_count > 0 and len(qs_all) % lessons_count == 0:
            chunk = len(qs_all) // lessons_count
            idx = max(0, lesson_id - 1)
            return qs_all[idx * chunk:(idx + 1) * chunk]
        
        return qs_all
    except Exception:
        return []

def load_questions(lesson_id=None):
    """Загрузка вопросов с кэшированием"""
    if SELECTED_TEST_FILE and os.path.exists(SELECTED_TEST_FILE):
        return load_questions_cached(lesson_id, SELECTED_TEST_FILE)
    
    if lesson_id is not None:
        filename = f'{TESTS_DIR}/lesson{lesson_id}.json'
        if os.path.exists(filename):
            try:
                with open(filename, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                return data.get('questions', [])
            except Exception:
                pass
    return []

def build_lessons_from_file(file_path):
    """Построение списка уроков из файла"""
    global LESSONS
    if not file_path or not os.path.exists(file_path):
        return
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return

    if 'lessons' in data:
        lessons_arr = data.get('lessons', [])
        LESSONS = [
            {
                'id': l.get('id'),
                'name': l.get('name') or f"Занятие {l.get('id')}",
                'available': l.get('available', True)
            }
            for l in lessons_arr
        ]
        if LESSONS:
            print(f"[INFO] Уроки загружены из файла: {len(LESSONS)} шт.")
            return

    qs = data.get('questions', [])
    if qs:
        sources = list(dict.fromkeys(
            q.get('_source') for q in qs 
            if isinstance(q, dict) and q.get('_source')
        ))
        
        if sources:
            LESSONS = [
                {'id': i, 'name': f"Занятие {i}: {src}", 'available': True}
                for i, src in enumerate(sources, start=1)
            ]
            print(f"[INFO] Уроки построены по _source: {len(LESSONS)} шт.")
            return

        lessons_count = len(LESSONS) if LESSONS else 1
        if lessons_count == 1 and len(qs) > 1:
            if len(qs) % 8 == 0:
                lessons_count = 8
            elif len(qs) % 4 == 0:
                lessons_count = 4

        LESSONS = [
            {'id': i, 'name': f"Занятие {i}", 'available': True}
            for i in range(1, lessons_count + 1)
        ]
        print(f"[INFO] Уроки построены из плоского списка: {len(LESSONS)} шт.")

def scan_test_files():
    """Сканирование файлов тестов"""
    return sorted(glob.glob(os.path.join(TESTS_DIR, '*.json')))

def merge_test_files(selected_paths, out_filename):
    """Объединение файлов тестов"""
    lessons_payload = []
    merged_questions = []

    for path in selected_paths:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"Не удалось прочитать {path}: {e}")
            continue

        questions = data.get('questions') or []
        lesson_questions = []
        for i, q in enumerate(questions, start=1):
            nq = dict(q)
            nq['id'] = i
            nq['_source'] = os.path.basename(path)
            lesson_questions.append(nq)
            merged_questions.append(nq)

        lessons_payload.append({
            'file': os.path.basename(path),
            'questions': lesson_questions
        })

    out_path = os.path.join(TESTS_DIR, out_filename)
    payload = {
        'title': out_filename,
        'available': True,
        'lessons': lessons_payload,
        'questions': merged_questions
    }
    
    try:
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"Создан объединённый файл: {out_path}")
    except Exception as e:
        print(f"Ошибка при записи {out_path}: {e}")

# ────────────────────────────────────────────
# Логирование событий
# ────────────────────────────────────────────
def log_event(session_id, event_type, message, **kwargs):
    """Логирование событий в терминал"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    student_name = sessions.get(session_id, {}).get('student_name', 'Неизвестный')
    
    colors = {
        'START': Fore.GREEN + Style.BRIGHT,
        'QUESTION': Fore.BLUE + Style.BRIGHT,
        'ANSWER': Fore.CYAN + Style.BRIGHT,
        'SUBMIT': Fore.YELLOW + Style.BRIGHT,
        'ERROR': Fore.RED + Style.BRIGHT,
        'INFO': Fore.WHITE + Style.BRIGHT
    }
    color = colors.get(event_type, Fore.WHITE)

    if event_type == 'START':
        print(f"\n{'='*80}")
        print(f"{color}🎓 [{timestamp}] {event_type}: {student_name}")
        print(f"{color}📝 {message}")
        print(f"{'='*80}\n")
    elif event_type == 'SUBMIT':
        print(f"\n{'─'*80}")
        print(f"{color}🏁 [{timestamp}] ТЕСТ ЗАВЕРШЕН: {student_name}")
        print(f"{color}📊 Результаты: {kwargs.get('score')}/{kwargs.get('total')} ({kwargs.get('percentage')}%)")
        print(f"{color}⭐ Оценка: {kwargs.get('grade')}")
        print(f"{'─'*80}\n")
    elif event_type == 'ERROR':
        print(f"{color}❌ [{timestamp}] ОШИБКА: {message}")
    else:
        print(f"{color}[{timestamp}] {event_type}: {message}")

# ────────────────────────────────────────────
# Работа с логами
# ────────────────────────────────────────────
def validate_log_entry(entry):
    """Валидация записи лога"""
    required = ['id', 'student_name', 'lesson_id', 'score', 'total', 'percentage', 'grade', 'elapsed_time', 'timestamp']
    
    for field in required:
        if field not in entry:
            return False, f"Отсутствует поле: {field}"
    
    try:
        if entry['score'] < 0 or entry['total'] <= 0 or entry['score'] > entry['total']:
            return False, "Некорректные score/total"
        if not (0 <= entry['percentage'] <= 100):
            return False, "percentage вне диапазона 0-100"
    except (ValueError, TypeError):
        return False, "Ошибка типов данных"
    
    return True, None

def normalize_log_entry(entry):
    """Нормализация записи перед сохранением"""
    timestamp = entry.get('timestamp') or entry.get('start_time')
    if timestamp and 'T' not in str(timestamp):
        timestamp = f"{datetime.now().strftime('%Y-%m-%d')}T{timestamp}"
    elif not timestamp:
        timestamp = datetime.now().isoformat()

    return {
        'id': entry.get('id') or str(uuid.uuid4())[:8],
        'student_name': str(entry.get('student_name', 'Ученик')).strip() or 'Ученик',
        'device_id': entry.get('device_id'),
        'lesson_id': int(entry.get('lesson_id', 1)),
        'lesson_name': entry.get('lesson_name', f"Урок {entry.get('lesson_id', 1)}"),
        'module_name': entry.get('module_name', f"module_{entry.get('lesson_id', 1)}"),
        'score': int(entry.get('score', 0)),
        'total': int(entry.get('total', 0)),
        'percentage': round(float(entry.get('percentage', 0.0)), 2),
        'grade': str(entry.get('grade', calculate_grade(0))),
        'elapsed_time': int(entry.get('elapsed_time', 0)),
        'elapsed_time_formatted': f"{int(entry.get('elapsed_time', 0)) // 60}:{int(entry.get('elapsed_time', 0)) % 60:02d}",
        'timestamp': timestamp,
        'ip': entry.get('ip'),
        'results': entry.get('results', [])
    }

def load_logs(path=LOG_FILE):
    """Загрузка логов из файла"""
    global completed_tests
    completed_tests.clear()
    
    if not os.path.exists(path):
        print(f"[INFO] Файл логов {path} не найден")
        return

    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if not isinstance(data, dict) or 'completed_tests' not in data:
            print(f"[WARN] Некорректная структура {path}")
            return
        
        seen_ids = set()
        for record in data['completed_tests']:
            is_valid, _ = validate_log_entry(record)
            if not is_valid:
                continue
            
            record_id = record.get('id')
            if record_id in seen_ids:
                continue
            seen_ids.add(record_id)
            
            # Восстановление module_name и lesson_name
            if 'module_name' not in record:
                record['module_name'] = f"module_{record.get('lesson_id', 1)}"
            if 'lesson_name' not in record:
                for lesson in LESSONS:
                    if lesson.get('id') == record.get('lesson_id'):
                        record['lesson_name'] = lesson.get('name', f"Урок {record.get('lesson_id')}")
                        break
                if 'lesson_name' not in record:
                    record['lesson_name'] = f"Урок {record.get('lesson_id', 1)}"
            
            completed_tests.append(record)
        
        print(f"[INFO] Загружено {len(completed_tests)} записей")
    except json.JSONDecodeError as e:
        print(f"[ERROR] Файл {path} повреждён: {e}")
    except Exception as e:
        print(f"[ERROR] Ошибка чтения логов: {e}")

def append_log_entry(entry, path=LOG_FILE):
    """Добавление записи в лог"""
    try:
        normalized = normalize_log_entry(entry)
        is_valid, error_msg = validate_log_entry(normalized)
        if not is_valid:
            print(f"[ERROR] Невалидная запись: {error_msg}")
            return False
        
        data = {'completed_tests': []}
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if not isinstance(data, dict) or 'completed_tests' not in data:
                    data = {'completed_tests': []}
            except Exception:
                data = {'completed_tests': []}
        
        data['completed_tests'].append(normalized)
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        print(f"[INFO] Запись сохранена: ID={normalized.get('id')}")
        return True
    except Exception as e:
        print(f"[ERROR] Ошибка записи в лог: {e}")
        return False

# ────────────────────────────────────────────
# IP имена
# ────────────────────────────────────────────
def load_ip_names(path=IP_NAMES_FILE):
    """Загрузка имён IP"""
    global IP_NAMES
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                IP_NAMES = json.load(f)
            print(f"[INFO] Загружено имён IP: {len(IP_NAMES)}")
        except Exception:
            IP_NAMES = {}
    else:
        IP_NAMES = {}

def save_ip_names(path=IP_NAMES_FILE):
    """Сохранение имён IP"""
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(IP_NAMES, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[WARN] Не удалось сохранить {path}: {e}")

# ────────────────────────────────────────────
# Маршруты
# ────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html', lessons=LESSONS)

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        nick = request.form.get('nick', '')
        password = request.form.get('password', '')
        pw_hash = hashlib.sha256(password.encode()).hexdigest()
        
        if nick == ADMIN_NICK and pw_hash == ADMIN_PASS_HASH:
            session['admin'] = True
            session['admin_nick'] = nick
            return redirect(url_for('teacher_dashboard'))
        else:
            error = 'Неправильный ник или пароль.'
    
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.pop('admin', None)
    session.pop('admin_nick', None)
    return redirect(url_for('login'))

@app.route('/dashboard')
def teacher_dashboard():
    if not session.get('admin'):
        return redirect(url_for('login'))
    return render_template('dashboard.html')

@app.route('/api/lessons', methods=['GET'])
def get_lessons():
    return jsonify([
        {**l, 'available': l.get('available', True)}
        for l in LESSONS
    ])

@app.route('/api/lessons/availability', methods=['POST'])
def set_lesson_availability():
    if not session.get('admin'):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    data = request.get_json() or {}
    lesson_id = data.get('lesson_id')
    available = data.get('available')
    
    if lesson_id is None or available is None:
        return jsonify({'success': False, 'error': 'Missing parameters'}), 400

    for l in LESSONS:
        if l.get('id') == lesson_id:
            l['available'] = bool(available)
            break
    
    # Сохранение в файл
    if SELECTED_TEST_FILE and os.path.exists(SELECTED_TEST_FILE):
        try:
            with open(SELECTED_TEST_FILE, 'r', encoding='utf-8') as f:
                file_data = json.load(f)
            if 'lessons' in file_data:
                for item in file_data['lessons']:
                    if item.get('id') == lesson_id:
                        item['available'] = bool(available)
                        break
            with open(SELECTED_TEST_FILE, 'w', encoding='utf-8') as f:
                json.dump(file_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[WARN] Ошибка сохранения: {e}")

    return jsonify({'success': True, 'lessons': LESSONS})

@app.route('/api/ip_names', methods=['GET', 'POST'])
def api_ip_names():
    if request.method == 'GET':
        return jsonify(IP_NAMES)
    
    if not session.get('admin'):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    ip = data.get('ip')
    name = data.get('name')
    
    if not ip:
        return jsonify({'success': False, 'error': 'Missing ip'}), 400

    if name is None:
        IP_NAMES.pop(ip, None)
    else:
        IP_NAMES[ip] = str(name)

    save_ip_names()
    return jsonify({'success': True, 'ip_names': IP_NAMES})

@app.route('/api/select_lesson', methods=['POST'])
def select_lesson():
    try:
        data = request.get_json()
        lesson_name = data.get('lesson_name')
        
        if not lesson_name:
            return jsonify({'success': False, 'error': 'Не указано название урока'}), 400
        
        lesson_path = os.path.join(TESTS_DIR, lesson_name)
        if not os.path.exists(lesson_path):
            return jsonify({'success': False, 'error': f'Файл не найден: {lesson_name}'}), 404
        
        global SELECTED_TEST_FILE
        SELECTED_TEST_FILE = lesson_path
        
        build_lessons_from_file(SELECTED_TEST_FILE)
        load_logs()
        load_ip_names()
        
        print(f"[INFO] Урок выбран: {lesson_name}")
        
        return jsonify({
            'success': True,
            'message': f'Урок "{lesson_name}" выбран',
            'lessons_count': len(LESSONS),
            'lessons': LESSONS
        })
    except Exception as e:
        print(f"[ERROR] Ошибка выбора урока: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tests/list', methods=['GET'])
def list_test_files():
    try:
        if not os.path.exists(TESTS_DIR):
            return jsonify({'success': False, 'error': 'Папка tests не найдена', 'files': []})
        
        files = []
        for filename in sorted(os.listdir(TESTS_DIR)):
            if filename.endswith('.json'):
                file_path = os.path.join(TESTS_DIR, filename)
                file_stat = os.stat(file_path)
                
                title = filename
                questions_count = 0
                lessons_info = []
                
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    title = data.get('title', filename)
                    questions_count = len(data.get('questions', []))
                    if 'lessons' in data:
                        lessons_info = [
                            {'name': l.get('name'), 'questions_count': len(l.get('questions', []))}
                            for l in data.get('lessons', [])
                        ]
                except Exception:
                    pass
                
                files.append({
                    'name': filename,
                    'path': file_path,
                    'size': file_stat.st_size,
                    'size_kb': round(file_stat.st_size / 1024, 2),
                    'modified': datetime.fromtimestamp(file_stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                    'title': title,
                    'questions_count': questions_count,
                    'lessons_count': len(lessons_info),
                    'lessons': lessons_info,
                    'is_current': SELECTED_TEST_FILE and os.path.abspath(file_path) == os.path.abspath(SELECTED_TEST_FILE)
                })
        
        return jsonify({
            'success': True,
            'files': files,
            'total': len(files),
            'current_lesson': os.path.basename(SELECTED_TEST_FILE) if SELECTED_TEST_FILE else None
        })
    except Exception as e:
        print(f"[ERROR] Ошибка списка файлов: {e}")
        return jsonify({'success': False, 'error': str(e), 'files': []}), 500

@app.route('/api/questions/<int:lesson_id>', methods=['GET'])
def get_questions(lesson_id):
    questions = load_questions(lesson_id)
    return jsonify(questions)

@app.route('/api/start_session', methods=['POST'])
def start_session():
    global cooldown_devices
    try:
        data = request.get_json()
        student_name = data.get('student_name', 'Ученик')
        lesson_id = data.get('lesson_id', 1)
        device_id = data.get('device_id')
        
        if not device_id:
            return jsonify({'success': False, 'error': 'Не указан device_id'}), 400
        
        client_ip = request.headers.get('X-Forwarded-For', request.remote_addr).split(',')[0].strip()
        cooldown_key = f"{device_id}_{client_ip}"
        
        # Проверка активной сессии
        for sid, sess in sessions.items():
            if (sess.get('device_id') == device_id and 
                sess.get('ip') == client_ip and
                sess.get('lesson_id') == lesson_id and
                not sess.get('completed', False)):
                log_event(sid, 'RESUME', f'Восстановлена сессия')
                return jsonify({
                    'success': True,
                    'session_id': sid,
                    'student_name': sess.get('student_name', student_name),
                    'resumed': True,
                    'current_question': sess.get('current_question', 1),
                    'questions_answered': sess.get('questions_answered', 0)
                })
        
        # Проверка кулдауна
        if cooldown_key in cooldown_devices:
            elapsed = time.time() - cooldown_devices[cooldown_key]
            if elapsed < COOLDOWN_TIME:
                return jsonify({
                    'success': False,
                    'error': f'Подождите {int(COOLDOWN_TIME - elapsed)} сек.'
                }), 429
        
        # Проверка доступности урока
        for l in LESSONS:
            if l.get('id') == lesson_id and l.get('available') is False:
                return jsonify({'success': False, 'error': 'Урок недоступен'}), 403
        
        # Создание сессии
        cooldown_devices[cooldown_key] = time.time()
        session_id = str(uuid.uuid4())[:8]
        
        module_name = os.path.basename(SELECTED_TEST_FILE) if SELECTED_TEST_FILE else f"module_{lesson_id}"
        lesson_name = next((l['name'] for l in LESSONS if l.get('id') == lesson_id), f"Урок {lesson_id}")
        
        sessions[session_id] = {
            'student_name': student_name,
            'lesson_id': lesson_id,
            'lesson_name': lesson_name,
            'module_name': module_name,
            'start_time': time.time(),
            'start_timestamp': datetime.now().isoformat(),
            'ip': client_ip,
            'device_id': device_id,
            'questions_answered': 0,
            'current_question': 1,
            'completed': False,
            'last_activity': time.time()
        }
        
        log_event(session_id, 'START', f'Начал тест: {lesson_name}')
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'student_name': student_name,
            'resumed': False,
            'current_question': 1,
            'questions_answered': 0
        })
    except Exception as e:
        log_event('unknown', 'ERROR', str(e))
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/log_question', methods=['POST'])
def log_question():
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        question_num = data.get('question_num')
        
        if session_id in sessions:
            sessions[session_id]['current_question'] = question_num
            try:
                qn = int(question_num)
                sessions[session_id]['questions_answered'] = max(0, qn - 1)
            except Exception:
                pass
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/submit', methods=['POST'])
def submit_answers():
    try:
        data = request.get_json()
        user_answers = data.get('answers', [])
        lesson_id = data.get('lesson_id', 1)
        session_id = data.get('session_id')
        
        if session_id not in sessions:
            return jsonify({'success': False, 'error': 'Сессия не найдена'}), 400
        
        session_data = sessions[session_id]
        session_data['completed'] = True
        session_data['end_time'] = time.time()
        
        questions = load_questions(lesson_id)
        score = 0
        results = []
        
        for i, question in enumerate(questions):
            user_answer = user_answers[i] if i < len(user_answers) else None
            correct_answer = question['correct_answer']
            is_correct = user_answer == correct_answer
            
            if is_correct:
                score += question.get('points', 1)
            
            results.append({
                'question_id': question['id'],
                'user_answer': user_answer,
                'correct_answer': correct_answer,
                'is_correct': is_correct,
                'question_text': question['question'],
                'options': question['options']
            })
        
        percentage = (score / len(questions)) * 100 if questions else 0
        grade = calculate_grade(percentage)
        
        student_name = session_data['student_name']
        elapsed_time = int(time.time() - session_data['start_time'])
        module_name = session_data.get('module_name', f"module_{lesson_id}")
        lesson_name = session_data.get('lesson_name', f"Урок {lesson_id}")
        client_ip = session_data.get('ip', 'unknown')
        
        log_event(session_id, 'SUBMIT', 'Тест завершен',
                  score=score, total=len(questions), percentage=round(percentage, 2),
                  grade=grade, elapsed_time=elapsed_time)
        
        record = {
            'id': str(uuid.uuid4())[:8],
            'student_name': student_name,
            'lesson_id': session_data['lesson_id'],
            'lesson_name': lesson_name,
            'module_name': module_name,
            'device_id': session_data.get('device_id'),
            'score': score,
            'total': len(questions),
            'percentage': round(percentage, 2),
            'grade': grade,
            'elapsed_time': elapsed_time,
            'elapsed_time_formatted': f"{elapsed_time // 60}:{elapsed_time % 60:02d}",
            'timestamp': datetime.now().isoformat(),
            'ip': client_ip,
            'results': results
        }
        
        completed_tests.append(record)
        append_log_entry(record)
        
        del sessions[session_id]
        
        return jsonify({
            'success': True,
            'score': score,
            'total': len(questions),
            'percentage': round(percentage, 2),
            'grade': grade,
            'results': results
        })
    except Exception as e:
        log_event('unknown', 'ERROR', str(e))
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    current_time = time.time()
    
    # Очистка старых сессий
    for sid in list(sessions.keys()):
        if current_time - sessions[sid]['start_time'] > SESSION_TIMEOUT:
            del sessions[sid]

    # Активные сессии
    active_sessions_list = []
    for sid, data in sessions.items():
        elapsed = int(current_time - data['start_time'])
        total_questions = len(load_questions(data.get('lesson_id')))
        progress = (data.get('questions_answered', 0) / total_questions * 100) if total_questions > 0 else 0
        
        client_ip = data.get('ip', 'unknown')
        active_sessions_list.append({
            'session_id': sid,
            'device_id': data.get('device_id'),
            'student_name': data['student_name'],
            'lesson_name': data['lesson_name'],
            'lesson_id': data['lesson_id'],
            'ip': client_ip,
            'ip_name': IP_NAMES.get(client_ip),
            'elapsed_time': elapsed,
            'elapsed_time_formatted': f"{elapsed // 60}:{elapsed % 60:02d}",
            'questions_answered': data.get('questions_answered', 0),
            'start_timestamp': data.get('start_timestamp'),
            'total_questions': total_questions,
            'progress': round(progress, 1),
            'progress_color': '#4CAF50' if progress > 75 else '#FF9800' if progress > 50 else '#F44336'
        })

    # Агрегация по IP
    ip_stats = {}
    for test in completed_tests:
        ip = test.get('ip')
        if not ip:
            continue
        if ip not in ip_stats:
            ip_stats[ip] = {
                'ip': ip,
                'device_name': IP_NAMES.get(ip),
                'students': set(),
                'lessons': set(),
                'active_sessions': 0,
                'completed_tests': 0,
                'total_tests': 0,
                'total_percentage': 0,
                'first_seen': None,
                'last_seen': None
            }
        
        entry = ip_stats[ip]
        entry['students'].add(test.get('student_name', 'Unknown'))
        entry['lessons'].add(test.get('lesson_name', 'Unknown'))
        entry['completed_tests'] += 1
        entry['total_tests'] += 1
        entry['total_percentage'] += test.get('percentage', 0)
        
        ts = test.get('timestamp')
        if ts:
            if entry['first_seen'] is None or ts < entry['first_seen']:
                entry['first_seen'] = ts
            if entry['last_seen'] is None or ts > entry['last_seen']:
                entry['last_seen'] = ts

    for s in active_sessions_list:
        ip = s.get('ip')
        if not ip:
            continue
        if ip not in ip_stats:
            ip_stats[ip] = {
                'ip': ip,
                'device_name': IP_NAMES.get(ip),
                'students': set(),
                'lessons': set(),
                'active_sessions': 0,
                'completed_tests': 0,
                'total_tests': 0,
                'total_percentage': 0,
                'first_seen': None,
                'last_seen': None
            }
        
        entry = ip_stats[ip]
        entry['active_sessions'] += 1
        entry['total_tests'] += 1
        entry['students'].add(s.get('student_name'))
        entry['lessons'].add(s.get('lesson_name'))
        
        ts = s.get('start_timestamp')
        if ts:
            if entry['first_seen'] is None or ts < entry['first_seen']:
                entry['first_seen'] = ts
            if entry['last_seen'] is None or ts > entry['last_seen']:
                entry['last_seen'] = ts

    unique_devices_output = []
    for ip, data in ip_stats.items():
        avg_pct = round(data['total_percentage'] / data['completed_tests'], 1) if data['completed_tests'] > 0 else 0
        unique_devices_output.append({
            'device_id': ip,
            'device_name': data['device_name'],
            'is_active': data['active_sessions'] > 0,
            'total_tests': data['total_tests'],
            'completed_tests': data['completed_tests'],
            'active_sessions': data['active_sessions'],
            'average_percentage': avg_pct,
            'students': list(data['students']),
            'student_count': len(data['students']),
            'lessons': list(data['lessons']),
            'lesson_count': len(data['lessons']),
            'first_seen': data['first_seen'],
            'last_seen': data['last_seen']
        })

    unique_devices_output.sort(key=lambda x: (not x['is_active'], x['last_seen'] or ''), reverse=False)

    # Недавние тесты
    recent_tests = completed_tests[-20:][::-1]
    for rt in recent_tests:
        rt['ip_name'] = IP_NAMES.get(rt.get('ip'))

    # Статистика по урокам
    lesson_stats = {}
    for lesson in LESSONS:
        lesson_stats[lesson['id']] = {
            'lesson_id': lesson['id'],
            'lesson_name': lesson['name'],
            'completed_count': 0,
            'average_percentage': 0,
            'total_points': 0,
            'trend': 'flat'
        }

    for test in completed_tests:
        lid = test.get('lesson_id')
        if lid in lesson_stats:
            lesson_stats[lid]['completed_count'] += 1
            lesson_stats[lid]['total_points'] += test.get('percentage', 0)

    for lid, stats in lesson_stats.items():
        if stats['completed_count'] > 0:
            stats['average_percentage'] = round(stats['total_points'] / stats['completed_count'], 1)
            stats['trend'] = 'up' if stats['average_percentage'] > 75 else 'down' if stats['average_percentage'] < 50 else 'flat'

    # Общие цифры
    total_completed = len(completed_tests)
    total_active = len(active_sessions_list)
    avg_percentage = sum(t['percentage'] for t in completed_tests) / total_completed if total_completed > 0 else 0
    avg_time = sum(t['elapsed_time'] for t in completed_tests) / total_completed if total_completed > 0 else 0

    return jsonify({
        'active_sessions': active_sessions_list,
        'recent_tests': recent_tests,
        'lesson_stats': list(lesson_stats.values()),
        'unique_devices': unique_devices_output,
        'total_stats': {
            'total_completed': total_completed,
            'total_active': total_active,
            'average_percentage': round(avg_percentage, 1),
            'average_time': round(avg_time, 1),
            'excellent': len([t for t in completed_tests if t['percentage'] >= 90]),
            'good': len([t for t in completed_tests if 61 <= t['percentage'] < 90]),
            'satisfactory': len([t for t in completed_tests if 41 <= t['percentage'] < 61]),
            'unsatisfactory': len([t for t in completed_tests if t['percentage'] <= 40])
        },
        'timestamp': datetime.now().strftime('%H:%M:%S')
    })

# ────────────────────────────────────────────
# Запуск приложения
# ────────────────────────────────────────────
if __name__ == '__main__':
    import warnings
    import logging
    
    # ✅ Подавляем warnings Werkzeug
    warnings.filterwarnings('ignore', category=Warning, module='werkzeug')
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    
    # ✅ Инициализация
    completed_tests = []
    
    try:
        load_logs()
        load_ip_names()
    except Exception as e:
        print(f"[WARN] Ошибка при загрузке логов: {e}")

    # ✅ Восстановление lesson_name в загруженных логах
    for test in completed_tests:
        if 'lesson_name' not in test or not test['lesson_name']:
            for lesson in LESSONS:
                if lesson.get('id') == test.get('lesson_id'):
                    test['lesson_name'] = lesson.get('name', f"Урок {test.get('lesson_id')}")
                    break
            if 'lesson_name' not in test:
                test['lesson_name'] = f"Урок {test.get('lesson_id', 1)}"

    # ✅ Красивый вывод без предупреждений
    print(f"\n{Fore.GREEN + Style.BRIGHT}🚀 Сервер запускается...")
    print(f"{Fore.CYAN}📚 Доступные уроки: {len(LESSONS)}")
    for lesson in LESSONS:
        print(f"   {lesson['id']}. {lesson['name']}")
    print(f"\n{Fore.YELLOW}📡 Сервер: {Fore.WHITE + Style.BRIGHT}http://localhost:80")
    print(f"{Fore.YELLOW}📊 Дашборд: {Fore.WHITE + Style.BRIGHT}http://localhost:80/dashboard")
    print(f"{Fore.YELLOW}📈 API: {Fore.WHITE + Style.BRIGHT}http://localhost:80/api/dashboard/stats")
    print(f"\n{Fore.GREEN + Style.BRIGHT}{'─'*80}\n")

    # ✅ Запуск сервера (для разработки)
    # Для production используйте: waitress-serve --port=80 app:app
    app.run(debug=True, host='0.0.0.0', port=80, use_reloader=False)
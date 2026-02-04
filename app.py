from flask import Flask, render_template, jsonify, request, session, redirect, url_for
import hashlib
import json
import dotenv
import os
import time
import uuid
from datetime import datetime
from colorama import init, Fore, Back, Style
import glob
import sys

# Инициализация цветного вывода
init(autoreset=True)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key')

# Selected test file path (set at startup via CLI selector or TEST_FILE env)
SELECTED_TEST_FILE = None
# Allow selecting test file via environment variable (useful for non-interactive runs)
env_test = os.environ.get('TEST_FILE')
if env_test:
    candidate = os.path.join('tests', env_test) if not os.path.isabs(env_test) else env_test
    if os.path.exists(candidate):
        SELECTED_TEST_FILE = candidate
        print(f"[INFO] SELECTED_TEST_FILE set from TEST_FILE env: {SELECTED_TEST_FILE}")

# Список уроков
# В начале app.py удаляем старый список LESSONS и инициализируем пустым
LESSONS = []

cooldown_devices = {}

# Simple admin credentials (stored as hash in code)
# Change these values as needed. Nickname is plain, password stored as sha256 hex.
ADMIN_NICK = dotenv.get_key('.env', 'ADMIN_NICK') or os.environ.get('ADMIN_NICK', 'admin')
ADMIN_PASS_HASH = dotenv.get_key('.env', 'ADMIN_PASSWORD') or os.environ.get('ADMIN_PASS_HASH', hashlib.sha256('secret123'.encode()).hexdigest())

def build_lessons_from_file(file_path):
    global LESSONS
    if not file_path or not os.path.exists(file_path):
        return

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return

    # Если в файле есть структура 'lessons'
    if 'lessons' in data:
        lessons_arr = data.get('lessons', [])
        new_lessons = []
        for l in lessons_arr:
            # Берем имя урока из JSON, если его нет — генерируем по ID
            name = l.get('name') or f"Занятие {l.get('id')}"
            # поддержка флага доступности урока
            available = l.get('available', True)
            new_lessons.append({'id': l.get('id'), 'name': name, 'available': available})
        
        if new_lessons:
            LESSONS = new_lessons
            print(f"[INFO] Уроки загружены из файла: {len(LESSONS)} шт.")
            return

    # Если файла нет 'lessons', попробуем по-умному построить уроки из плоского массива 'questions'
    qs = data.get('questions', [])
    if qs:
        # Попробуем определить количество уроков
        # 1) Если есть поле _source у вопросов — разделим по уникальным источникам
        sources = [q.get('_source') for q in qs if isinstance(q, dict) and q.get('_source')]
        unique_sources = []
        for s in sources:
            if s not in unique_sources:
                unique_sources.append(s)

        if unique_sources:
            new_lessons = []
            for i, src in enumerate(unique_sources, start=1):
                new_lessons.append({'id': i, 'name': f"Занятие {i}: {src}", 'available': True})
            LESSONS = new_lessons
            print(f"[INFO] Уроки построены по _source: {len(LESSONS)} шт.")
            return


        lessons_count = len(LESSONS) if len(LESSONS) > 0 else 1

        # Если в данный момент LESSONS пуст, и мы не смогли определить count — попробуем равномерно разделить
        if lessons_count == 1 and len(qs) > 1:
            # Если количество вопросов кратно 4 или 8, выберем более разумное число
            if len(qs) % 8 == 0:
                lessons_count = 8
            elif len(qs) % 4 == 0:
                lessons_count = 4

        # Построим LESSONS с именами "Занятие N"
        new_lessons = [{'id': i, 'name': f"Занятие {i}", 'available': True} for i in range(1, lessons_count + 1)]
        LESSONS = new_lessons
        print(f"[INFO] Уроки построены из плоского списка: {len(LESSONS)} шт.")
        return

    # Ничего не получилось — оставляем LESSONS пустым
    print("[WARN] Не удалось построить LESSONS из файла", file_path)

# Хранилище сессий учеников
sessions = {}

# Хранилище завершенных тестов
completed_tests = []

# IP name mapping (persistent)
IP_NAMES_FILE = 'ip_names.json'
IP_NAMES = {}

def load_ip_names(path=IP_NAMES_FILE):
    global IP_NAMES
    if not os.path.exists(path):
        IP_NAMES = {}
        return
    try:
        with open(path, 'r', encoding='utf-8') as f:
            IP_NAMES = json.load(f)
        print(f"[INFO] Загружено имён IP: {len(IP_NAMES)}")
    except Exception as e:
        print(f"[WARN] Не удалось загрузить {path}: {e}")
        IP_NAMES = {}

def save_ip_names(path=IP_NAMES_FILE):
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(IP_NAMES, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[WARN] Не удалось сохранить {path}: {e}")

LOG_FILE = 'logs.txt'

def normalize_log_entry(entry):
    """
    Нормализует запись перед сохранением:
    - Убирает избыточные/производные поля
    - Стандартизирует формат timestamp
    - Гарантирует наличие обязательных полей
    """
    # Обязательные поля с безопасными значениями по умолчанию
    normalized = {
        'id': entry.get('id') or str(uuid.uuid4())[:8],
        'student_name': str(entry.get('student_name', 'Ученик')).strip() or 'Ученик',
        'device_id': entry.get('device_id'),
        'lesson_id': int(entry.get('lesson_id', 1)),
        'score': int(entry.get('score', 0)),
        'total': int(entry.get('total', 0)),
        'percentage': round(float(entry.get('percentage', 0.0)), 2),
        'grade': str(entry.get('grade', '2 (Неудовлетворительно)')),
        'elapsed_time': int(entry.get('elapsed_time', 0)),
        'ip': entry.get('ip')
    }
    
    # Стандартизация timestamp → ISO 8601 (полный формат)
    timestamp = entry.get('timestamp') or entry.get('start_time')
    if timestamp:
        try:
            # Если timestamp уже в ISO формате — оставляем как есть
            if 'T' in str(timestamp):
                normalized['timestamp'] = timestamp
            else:
                # Преобразуем "00:53:49" → "2026-02-04T00:53:49"
                today = datetime.now().strftime('%Y-%m-%d')
                normalized['timestamp'] = f"{today}T{timestamp}"
        except:
            normalized['timestamp'] = datetime.now().isoformat()
    else:
        normalized['timestamp'] = datetime.now().isoformat()
    
    # Убираем избыточные поля (хранятся в других источниках или вычисляются)
    # - elapsed_time_formatted → вычисляется из elapsed_time
    # - lesson_name → восстанавливается по lesson_id из LESSONS
    # - ip_name → хранится в отдельном ip_names.json
    # - start_time → вычисляется как timestamp - elapsed_time
    # - date → извлекается из timestamp
    
    return normalized

def append_log_entry(entry, path=LOG_FILE):
    try:
        normalized = normalize_log_entry(entry)
        with open(path, 'a', encoding='utf-8') as f:
            json.dump(normalized, f, ensure_ascii=False)
            f.write('\n')
    except Exception as e:
        print(f"[ERROR] Не удалось записать в лог {path}: {e}")


def load_logs(path=LOG_FILE):
    """Load existing completed test records from logs file into completed_tests."""
    if not os.path.exists(path):
        return
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    # Basic validation
                    if isinstance(rec, dict) and 'id' in rec:
                        completed_tests.append(rec)
                except Exception:
                    # skip malformed lines
                    continue
        print(f"[INFO] Загружено {len(completed_tests)} записей из {path}")
    except Exception as e:
        print(f"[ERROR] Не удалось прочитать логи {path}: {e}")

def load_questions(lesson_id=None):
    """Load questions from the selected test file if set, otherwise fall back
    to the legacy `tests/lesson{lesson_id}.json` behaviour.
    """
    # If a test file was selected at startup, use it.
    if SELECTED_TEST_FILE:
        if os.path.exists(SELECTED_TEST_FILE):
            try:
                with open(SELECTED_TEST_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # If merged file contains per-lesson grouping
                if 'lessons' in data and lesson_id is not None:
                    lessons = data.get('lessons', [])
                    idx = max(0, lesson_id - 1)
                    if 0 <= idx < len(lessons):
                        qs = lessons[idx].get('questions', [])
                        print(f"[DEBUG] load_questions -> using lessons[{idx}] from {SELECTED_TEST_FILE}, questions={len(qs)}")
                        return qs
                    else:
                        # If requested lesson_id out of range, fallback to empty
                        return []

                # If no 'lessons' grouping, but flat 'questions' exists, try to split evenly
                qs_all = data.get('questions', [])
                if qs_all and lesson_id is not None:
                    # try to split into equal chunks per configured LESSONS
                    lessons_count = len(LESSONS)
                    if lessons_count > 0 and len(qs_all) % lessons_count == 0:
                        chunk = len(qs_all) // lessons_count
                        idx = max(0, lesson_id - 1)
                        start = idx * chunk
                        end = start + chunk
                        subset = qs_all[start:end]
                        print(f"[DEBUG] load_questions -> split flat questions into chunks, returning {len(subset)} questions for lesson {lesson_id}")
                        return subset

                # Fallback: return all questions if no lesson_id provided
                print(f"[DEBUG] load_questions -> returning all questions from {SELECTED_TEST_FILE}, total={len(qs_all)}")
                return qs_all
            except Exception:
                print(f"[DEBUG] load_questions -> failed reading SELECTED_TEST_FILE={SELECTED_TEST_FILE}")
                return []

    # Fallback: legacy behaviour by lesson id
    if lesson_id is not None:
        filename = f'tests/lesson{lesson_id}.json'
        if os.path.exists(filename):
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data.get('questions', [])

    return []


def scan_test_files():
    """Return list of json files in the `tests` directory."""
    files = sorted(glob.glob(os.path.join('tests', '*.json')))
    return files


def merge_test_files(selected_paths, out_filename):
    """Merge selected JSON test files (each expected to have 'questions') into one JSON file.

    Reassigns incremental numeric `id` to questions to avoid duplicates.
    """
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
        # assign new ids within this lesson starting at 1
        lesson_questions = []
        next_id = 1
        for q in questions:
            nq = dict(q)
            nq['id'] = next_id
            nq['_source'] = os.path.basename(path)
            lesson_questions.append(nq)
            merged_questions.append(nq)
            next_id += 1

        lessons_payload.append({
            'file': os.path.basename(path),
            'questions': lesson_questions
        })

    out_path = os.path.join('tests', out_filename)
    payload = {
        'title': out_filename,
        'available': True,
        'lessons': lessons_payload,
        'questions': merged_questions
    }
    try:
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"Создан объединённый файл: {out_path} ({len(merged_questions)} вопросов, {len(lessons_payload)} уроков)")
    except Exception as e:
        print(f"Ошибка при записи {out_path}: {e}")


def interactive_test_selector():
    """Interactive selector at startup.

    Allows choosing a single existing `tests/*.json` file to use as the lesson,
    or selecting multiple files to merge into a new file. Returns the selected
    filename (basename) or None.
    """
    global SELECTED_TEST_FILE

    if not sys.stdin.isatty():
        return None

    files = scan_test_files()
    if not files:
        print('Файлы тестов не найдены в папке tests/.')
        return None

    print('\nНайденные JSON файлы в tests/:')
    for i, p in enumerate(files, start=1):
        print(f"  {i}. {os.path.basename(p)}")

    print('\nВыберите один номер для использования как урок (например: 2),')
    # print('или укажите несколько номеров через запятую для объединения (например: 1,2).')
    # print('Нажмите Enter чтобы пропустить:')
    sel = input('> ').strip()
    if not sel:
        return None

    try:
        indices = [int(x.strip()) for x in sel.split(',') if x.strip()]
    except ValueError:
        print('Некорректный ввод.')
        return None

    selected = []
    for idx in indices:
        if 1 <= idx <= len(files):
            selected.append(files[idx - 1])

    if not selected:
        print('Нет выбранных файлов.')
        return None

    if len(selected) == 1:
        # single file selected -> use it as the lesson
        SELECTED_TEST_FILE = selected[0]
        print(f"Выбран файл урока: {os.path.basename(SELECTED_TEST_FILE)}")
        return os.path.basename(SELECTED_TEST_FILE)

    # multiple selected -> merge
    print('Введите имя выходного файла (например web+css.json):')
    out_name = input('> ').strip()
    if not out_name:
        out_name = 'web+css.json'

    merge_test_files(selected, out_name)
    SELECTED_TEST_FILE = os.path.join('tests', out_name)
    return out_name

def log_event(session_id, event_type, message, **kwargs):
    """Логирование событий в терминал с цветами"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    session_info = sessions.get(session_id, {})
    student_name = session_info.get('student_name', 'Неизвестный ученик')
    
    # Цвета для разных типов событий
    colors = {
        'START': Fore.GREEN + Style.BRIGHT,
        'QUESTION': Fore.BLUE + Style.BRIGHT,
        'ANSWER': Fore.CYAN + Style.BRIGHT,
        'SUBMIT': Fore.YELLOW + Style.BRIGHT,
        'ERROR': Fore.RED + Style.BRIGHT,
        'INFO': Fore.WHITE + Style.BRIGHT
    }
    
    color = colors.get(event_type, Fore.WHITE)
    
    # Формирование сообщения
    if event_type == 'START':
        print(f"\n{'='*80}")
        print(f"{color}🎓 [{timestamp}] {event_type}: {student_name}")
        print(f"{color}📝 {message}")
        print(f"{'='*80}\n")
        
    elif event_type == 'QUESTION':
        question_num = kwargs.get('question_num', '?')
        total_questions = kwargs.get('total_questions', '?')
        print(f"{color}❓ [{timestamp}] {student_name} - Вопрос {question_num}/{total_questions}: {message}")
        
    elif event_type == 'ANSWER':
        question_num = kwargs.get('question_num', '?')
        is_correct = kwargs.get('is_correct', False)
        user_answer = kwargs.get('user_answer', '?')
        correct_answer = kwargs.get('correct_answer', '?')
        status = '✅ Правильно' if is_correct else '❌ Неправильно'
        status_color = Fore.GREEN if is_correct else Fore.RED
        print(f"{Fore.WHITE}📝 [{timestamp}] {student_name} - Ответ {question_num}: {status_color}{status}")
        print(f"{Fore.WHITE}   Ваш ответ: {user_answer} | Правильный: {correct_answer}")
        
    elif event_type == 'SUBMIT':
        score = kwargs.get('score', 0)
        total = kwargs.get('total', 0)
        percentage = kwargs.get('percentage', 0)
        grade = kwargs.get('grade', '-')
        elapsed_time = kwargs.get('elapsed_time', 0)
        print(f"\n{'─'*80}")
        print(f"{color}🏁 [{timestamp}] ТЕСТ ЗАВЕРШЕН: {student_name}")
        print(f"{color}📊 Результаты: {Fore.WHITE + Style.BRIGHT}{score}/{total} ({percentage}%)")
        print(f"{color}⭐ Оценка: {Fore.WHITE + Style.BRIGHT}{grade}")
        print(f"{color}⏱️  Время: {Fore.WHITE + Style.BRIGHT}{elapsed_time} сек")
        print(f"{'─'*80}\n")
        
    elif event_type == 'ERROR':
        print(f"{color}❌ [{timestamp}] ОШИБКА: {message}")
        
    else:
        print(f"{color}[{timestamp}] {event_type}: {message}")

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

@app.route('/api/lessons', methods=['GET'])
def get_lessons():
    # Ensure each lesson has 'available' flag
    out = []
    for l in LESSONS:
        copy = dict(l)
        if 'available' not in copy:
            copy['available'] = True
        out.append(copy)
    return jsonify(out)


@app.route('/api/lessons/availability', methods=['POST'])
def set_lesson_availability():
    # Only admin can toggle availability
    if not session.get('admin'):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    lesson_id = data.get('lesson_id')
    available = data.get('available')
    if lesson_id is None or available is None:
        return jsonify({'success': False, 'error': 'Missing lesson_id or available'}), 400

    updated = False
    for l in LESSONS:
        if l.get('id') == lesson_id:
            l['available'] = bool(available)
            updated = True
            break

    if not updated:
        return jsonify({'success': False, 'error': 'Lesson not found'}), 404

    # Persist availability into the selected merged file if present
    try:
        if SELECTED_TEST_FILE and os.path.exists(SELECTED_TEST_FILE):
            with open(SELECTED_TEST_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if 'lessons' in data:
                for item in data['lessons']:
                    if item.get('id') == lesson_id:
                        item['available'] = bool(available)
                        break
                try:
                    with open(SELECTED_TEST_FILE, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                except Exception as e:
                    print(f"[WARN] Не удалось обновить {SELECTED_TEST_FILE}: {e}")

    except Exception as e:
        print(f"[WARN] Ошибка при попытке сохранить доступность в {SELECTED_TEST_FILE}: {e}")

    return jsonify({'success': True, 'lessons': LESSONS})


@app.route('/api/ip_names', methods=['GET', 'POST'])
def api_ip_names():
    # Admin-only for setting names
    if request.method == 'GET':
        return jsonify(IP_NAMES)

    # POST
    if not session.get('admin'):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    ip = data.get('ip')
    name = data.get('name')
    if not ip:
        return jsonify({'success': False, 'error': 'Missing ip'}), 400

    if name is None:
        # delete name
        IP_NAMES.pop(ip, None)
    else:
        IP_NAMES[ip] = str(name)

    save_ip_names()
    return jsonify({'success': True, 'ip_names': IP_NAMES})

@app.route('/api/select_lesson', methods=['POST'])
def select_lesson():
    """
    Выбор урока по названию файла.
    Принимает: {"lesson_name": "web+css.json"}
    Возвращает: информацию о выбранном уроке и список уроков
    """
    try:
        data = request.get_json()
        lesson_name = data.get('lesson_name')
        
        if not lesson_name:
            return jsonify({
                'success': False,
                'error': 'Не указано название урока'
            }), 400
        
        # Формируем путь к файлу
        lesson_path = os.path.join('tests', lesson_name)
        
        # Проверяем существование файла
        if not os.path.exists(lesson_path):
            return jsonify({
                'success': False,
                'error': f'Файл урока не найден: {lesson_name}'
            }), 404
        
        # Обновляем глобальную переменную
        global SELECTED_TEST_FILE
        SELECTED_TEST_FILE = lesson_path
        
        # Перестраиваем список уроков из выбранного файла
        build_lessons_from_file(SELECTED_TEST_FILE)
        
        # Загружаем сохраненные результаты и имена IP
        load_logs()
        load_ip_names()
        
        print(f"[INFO] Урок выбран: {lesson_name}")
        print(f"[INFO] Доступно уроков: {len(LESSONS)}")
        
        return jsonify({
            'success': True,
            'message': f'Урок "{lesson_name}" успешно выбран',
            'file_path': lesson_path,
            'lessons_count': len(LESSONS),
            'lessons': LESSONS
        })
        
    except Exception as e:
        print(f"[ERROR] Ошибка выбора урока: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
@app.route('/api/tests/list', methods=['GET'])
def list_test_files():
    """
    Получение списка всех файлов тестов в папке tests/
    Возвращает: список файлов с метаинформацией
    """
    try:
        tests_dir = 'tests'
        
        # Проверяем существование папки
        if not os.path.exists(tests_dir):
            return jsonify({
                'success': False,
                'error': 'Папка tests не найдена',
                'files': []
            })
        
        # Получаем все JSON файлы
        files = []
        for filename in sorted(os.listdir(tests_dir)):
            if filename.endswith('.json'):
                file_path = os.path.join(tests_dir, filename)
                
                # Получаем информацию о файле
                file_stat = os.stat(file_path)
                
                # Читаем содержимое для получения метаинформации
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    
                    # Извлекаем метаинформацию
                    title = data.get('title', filename)
                    questions_count = len(data.get('questions', []))
                    
                    # Если есть структура уроков
                    lessons_info = []
                    if 'lessons' in data:
                        for lesson in data.get('lessons', []):
                            lessons_info.append({
                                'name': lesson.get('name'),
                                'questions_count': len(lesson.get('questions', []))
                            })
                    
                except Exception as e:
                    title = filename
                    questions_count = 0
                    lessons_info = []
                    print(f"[WARN] Не удалось прочитать {filename}: {e}")
                
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
        print(f"[ERROR] Ошибка получения списка файлов: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e),
            'files': []
        }), 500
    
@app.route('/api/tests/<filename>', methods=['GET'])
def get_test_file(filename):
    """
    Получение содержимого конкретного файла теста
    """
    try:
        file_path = os.path.join('tests', filename)
        
        if not os.path.exists(file_path):
            return jsonify({
                'success': False,
                'error': 'Файл не найден'
            }), 404
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return jsonify({
            'success': True,
            'filename': filename,
            'data': data
        })
        
    except Exception as e:
        print(f"[ERROR] Ошибка чтения файла {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/questions/<int:lesson_id>', methods=['GET'])
def get_questions(lesson_id):
    # If a selected merged file exists, prefer slicing there to be explicit
    if SELECTED_TEST_FILE and os.path.exists(SELECTED_TEST_FILE):
        try:
            with open(SELECTED_TEST_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # If file has per-lesson grouping
            if 'lessons' in data:
                lessons = data.get('lessons', [])
                idx = max(0, lesson_id - 1)
                if 0 <= idx < len(lessons):
                    qs = lessons[idx].get('questions', [])
                    print(f"[DEBUG] /api/questions -> returning lessons[{idx}] from {SELECTED_TEST_FILE} ({len(qs)})")
                    return jsonify(qs)

            # If flat questions array, try to split evenly by LESSONS
            qs_all = data.get('questions', [])
            lessons_count = len(LESSONS)
            if qs_all and lessons_count > 0 and len(qs_all) % lessons_count == 0:
                chunk = len(qs_all) // lessons_count
                idx = max(0, lesson_id - 1)
                start = idx * chunk
                end = start + chunk
                subset = qs_all[start:end]
                print(f"[DEBUG] /api/questions -> returning chunk {idx} ({len(subset)}) from {SELECTED_TEST_FILE}")
                return jsonify(subset)

            # Fallback: return entire questions array
            print(f"[DEBUG] /api/questions -> fallback returning all ({len(qs_all)}) from {SELECTED_TEST_FILE}")
            return jsonify(qs_all)
        except Exception as e:
            print(f"[DEBUG] /api/questions error reading {SELECTED_TEST_FILE}: {e}")

    # Default behaviour
    questions = load_questions(lesson_id)
    try:
        print(f"[DEBUG] /api/questions/{lesson_id} -> type={type(questions).__name__}, len={len(questions) if hasattr(questions, '__len__') else 'n/a'}")
    except Exception:
        pass
    return jsonify(questions)

@app.route('/api/start_session', methods=['POST'])
def start_session():
    """Создание новой сессии для ученика или восстановление существующей"""
    global cooldown_devices
    try:
        data = request.get_json()
        student_name = data.get('student_name', 'Ученик')
        lesson_id = data.get('lesson_id', 1)
        device_id = data.get('device_id')
        
        if not device_id:
            return jsonify({'success': False, 'error': 'Не указан идентификатор устройства'}), 400
        
        # Получаем реальный IP клиента (с учётом прокси)
        client_ip = request.headers.get('X-Forwarded-For', request.remote_addr).split(',')[0].strip()
        
        # Создаём уникальный идентификатор для кулдауна: комбинация device_id + IP
        # Это предотвращает обход кулдауна при смене браузера или очистке куки
        cooldown_key = f"{device_id}_{client_ip}"
        
        # ============================================
        # ШАГ 1: Проверяем, есть ли активная сессия для этого устройства + урока
        # ============================================
        active_session = None
        for sid, sess in sessions.items():
            # Ищем сессию по совпадению device_id, IP и lesson_id
            if (sess.get('device_id') == device_id and 
                sess.get('ip') == client_ip and
                sess.get('lesson_id') == lesson_id):
                
                # Если сессия НЕ завершена — восстанавливаем её
                if not sess.get('completed', False):
                    active_session = sid
                    break
        
        if active_session:
            # Восстанавливаем существующую сессию
            session_data = sessions[active_session]
            log_event(
                active_session, 
                'RESUME', 
                f'Восстановлена сессия: {session_data.get("questions_answered", 0)}/{len(session_data.get("answers_log", []))} вопросов пройдено'
            )
            
            return jsonify({
                'success': True,
                'session_id': active_session,
                'student_name': session_data.get('student_name', student_name),
                'resumed': True,
                'current_question': session_data.get('current_question', 1),
                'questions_answered': session_data.get('questions_answered', 0)
            })
        
        # ============================================
        # ШАГ 2: Проверяем кулдаун (только если нет активной сессии)
        # ============================================
        # Проверяем кулдаун по комбинации device_id + IP
        if cooldown_key in cooldown_devices:
            time_since_last_test = time.time() - cooldown_devices[cooldown_key]
            if time_since_last_test < 600:  # 10 минут кулдаун
                remaining = 600 - int(time_since_last_test)
                log_event(
                    'unknown',
                    'COOLDOWN',
                    f'Попытка обхода кулдауна: device={device_id}, ip={client_ip}'
                )
                return jsonify({
                    'success': False, 
                    'error': f'Пожалуйста, подождите {remaining}сек. перед началом нового теста.'
                }), 429
        
        # ============================================
        # ШАГ 3: Проверяем доступность урока
        # ============================================
        lesson_entry = None
        for l in LESSONS:
            if l.get('id') == lesson_id:
                lesson_entry = l
                break

        if lesson_entry and lesson_entry.get('available') is False:
            return jsonify({'success': False, 'error': 'Урок временно недоступен'}), 403
        
        # ============================================
        # ШАГ 4: Создаём новую сессию
        # ============================================
        # Обновляем время кулдауна (только при создании НОВОЙ сессии)
        cooldown_devices[cooldown_key] = time.time()
        
        # Генерация уникального ID сессии
        session_id = str(uuid.uuid4())[:8]

        # Determine lesson name/file: prefer SELECTED_TEST_FILE if set
        if SELECTED_TEST_FILE and os.path.exists(SELECTED_TEST_FILE):
            lesson_file = SELECTED_TEST_FILE
            try:
                lesson_name = lesson_entry['name'] if lesson_entry else os.path.splitext(os.path.basename(lesson_file))[0]
            except Exception:
                lesson_name = os.path.splitext(os.path.basename(lesson_file))[0]
            stored_lesson_id = lesson_id
        else:
            lesson_file = None
            lesson_name = lesson_entry['name'] if lesson_entry else f"Занятие {lesson_id}"
            stored_lesson_id = lesson_id

        # capture client IP and start timestamp
        start_ts = datetime.now().isoformat()

        # Сохранение информации о сессии
        sessions[session_id] = {
            'student_name': student_name,
            'lesson_id': stored_lesson_id,
            'lesson_file': lesson_file,
            'lesson_name': lesson_name,
            'start_time': time.time(),
            'start_timestamp': start_ts,
            'ip': client_ip,
            'device_id': device_id,
            'questions_answered': 0,
            'correct_answers': 0,
            'current_question': 1,
            'answers_log': [],
            'completed': False,  # ← Флаг завершённости сессии
            'last_activity': time.time()  # ← Время последней активности
        }
        
        # Логирование начала теста
        log_event(
            session_id, 
            'START', 
            f'Начал тест по уроку: {lesson_name} (device={device_id}, ip={client_ip})',
            lesson_id=stored_lesson_id
        )
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'student_name': student_name,
            'resumed': False,
            'current_question': 1,
            'questions_answered': 0
        })
        
    except Exception as e:
        log_event('unknown', 'ERROR', f'Ошибка создания/восстановления сессии: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500
    
@app.route('/api/log_question', methods=['POST'])
def log_question():
    """Логирование просмотра вопроса"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        question_num = data.get('question_num')
        question_text = data.get('question_text', '')
        
        if session_id in sessions:
            # Обновляем текущий вопрос
            sessions[session_id]['current_question'] = question_num
            # Обновляем количество отвеченных вопросов: если ученик на вопросе N, значит отвечен N-1
            try:
                qn = int(question_num)
                prev_ans = sessions[session_id].get('questions_answered', 0)
                sessions[session_id]['questions_answered'] = max(prev_ans, max(0, qn - 1))
            except Exception:
                # если question_num не число — не меняем
                pass
            total_questions = len(load_questions(sessions[session_id].get('lesson_id')))
            
            log_event(
                session_id,
                'QUESTION',
                question_text,
                question_num=question_num,
                total_questions=total_questions
            )
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Ошибка логирования вопроса: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/add_question', methods=['POST'])
def add_question():
    try:
        new_question = request.get_json()
        
        # Загрузка текущих вопросов
        with open('questions.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Генерация нового ID
        max_id = max([q['id'] for q in data['questions']], default=0)
        new_question['id'] = max_id + 1
        
        # Добавление нового вопроса
        data['questions'].append(new_question)
        
        # Сохранение обратно в файл
        with open('questions.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return jsonify({'success': True, 'message': 'Вопрос добавлен'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Получение списка активных сессий"""
    active_sessions = []
    current_time = time.time()
    
    for sid, data in list(sessions.items()):
        elapsed = int(current_time - data['start_time'])
        # Удаляем сессии старше 1 часа
        if elapsed > 3600:
            del sessions[sid]
            continue
            
        active_sessions.append({
            'lesson_name': data['lesson_name'],
            'lesson_id': data['lesson_id'],
            'ip': data.get('ip'),
            'ip_name': IP_NAMES.get(data.get('ip')) if data.get('ip') else None,
            'device_id': data.get('device_id'),
            'start_timestamp': data.get('start_timestamp'),
            'ip': data.get('ip'),
            'start_timestamp': data.get('start_timestamp'),
            'elapsed_time': elapsed,
            'questions_answered': data.get('questions_answered', 0),
            'correct_answers': data.get('correct_answers', 0),
            'current_question': data.get('current_question', 1),
            'start_time': data.get('start_timestamp', '')
        })
    
    return jsonify({
        'active_sessions': active_sessions,
        'total_active': len(active_sessions),
        'timestamp': datetime.now().strftime('%H:%M:%S')
    })

# Хранилище завершенных тестов
completed_tests = []

@app.route('/dashboard')
def teacher_dashboard():
    print(session)
    """Страница дашборда для преподавателя"""
    if not session.get('admin'):
        return redirect(url_for('login'))
    return render_template('dashboard.html')

@app.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    """Получение статистики для дашборда"""
    current_time = time.time()
    
    # Фильтрация старых сессий
    for sid in list(sessions.keys()):
        if current_time - sessions[sid]['start_time'] > 3600:
            del sessions[sid]
    
    # Активные сессии
    active_sessions = []
    # print(sessions.items())
    for sid, data in sessions.items():
        print(sid, data)
        elapsed = int(current_time - data['start_time'])
        total_questions = len(load_questions(data.get('lesson_id')))
        progress = (data.get('questions_answered', 0) / total_questions * 100) if total_questions > 0 else 0
        active_sessions.append({
            'session_id': sid,
            'device_id': data.get('device_id'),
            'student_name': data['student_name'],
            'lesson_name': data['lesson_name'],
            'lesson_id': data['lesson_id'],
            'ip': data.get('ip'),
            'ip_name': IP_NAMES.get(data.get('device_id')) or None,
            'elapsed_time': elapsed,
            'elapsed_time_formatted': f"{elapsed // 60}:{elapsed % 60:02d}",
            'questions_answered': data.get('questions_answered', 0),
            'start_timestamp': data.get('start_timestamp'),
            'correct_answers': data.get('correct_answers', 0),
            'total_questions': total_questions,
            'progress': round(progress, 1),
            'progress_color': '#4CAF50' if progress > 75 else '#FF9800' if progress > 50 else '#F44336'
        })
    
    # Недавние завершенные тесты (последние 20)
    recent_tests = completed_tests[-20:][::-1]  # последние 20 в обратном порядке
    
    # Статистика по урокам
    lesson_stats = {}
    for lesson in LESSONS:
        lesson_stats[lesson['id']] = {
            'lesson_id': lesson['id'],
            'lesson_name': lesson['name'],
            'completed_count': 0,
            'average_score': 0,
            'average_percentage': 0,
            'total_points': 0
        }
    
    for test in completed_tests:
        lid = test['lesson_id']
        if lid in lesson_stats:
            lesson_stats[lid]['completed_count'] += 1
            lesson_stats[lid]['total_points'] += test['percentage']

    # Группировка по IP для дашборда
    ip_groups = {}
    for s in active_sessions:
        ip = s.get('ip') or 'unknown'
        device_id = s.get('device_id') or 'unknown'
        ip_groups.setdefault(ip, {'ip': ip, 'active_sessions': [], 'total_active': 0, 'device_id': device_id})
        ip_groups[ip]['active_sessions'].append(s)
        ip_groups[ip]['total_active'] = len(ip_groups[ip]['active_sessions'])

    # недавние тесты по IP
    recent_by_ip = {}
    for t in completed_tests[-200:]:
        ip = t.get('device_id') or 'unknown'
        recent_by_ip.setdefault(ip, [])
        recent_by_ip[ip].append(t)

    # enrich recent_tests with ip_name and device_id
    for rt in recent_tests:
        ip = rt.get('ip')
        rt['ip_name'] = IP_NAMES.get(rt.get('device_id')) or None
        rt['device_id'] = rt.get('device_id') or None
    
    for lid, stats in lesson_stats.items():
        if stats['completed_count'] > 0:
            stats['average_percentage'] = round(stats['total_points'] / stats['completed_count'], 1)
            stats['average_score_text'] = f"{stats['average_percentage']}%"
            stats['trend'] = 'up' if stats['average_percentage'] > 70 else 'down'
    
    # Общая статистика
    total_completed = len(completed_tests)
    total_active = len(active_sessions)
    
    if total_completed > 0:
        avg_percentage = sum(t['percentage'] for t in completed_tests) / total_completed
        avg_time = sum(t['elapsed_time'] for t in completed_tests) / total_completed
        
        # Расчет оценок
        excellent = len([t for t in completed_tests if t['percentage'] >= 90])
        good = len([t for t in completed_tests if 75 <= t['percentage'] < 90])
        satisfactory = len([t for t in completed_tests if 60 <= t['percentage'] < 75])
        unsatisfactory = len([t for t in completed_tests if t['percentage'] < 60])
    else:
        avg_percentage = 0
        avg_time = 0
        excellent = good = satisfactory = unsatisfactory = 0
    
    return jsonify({
        'active_sessions': active_sessions,
        'recent_tests': recent_tests,
        'lesson_stats': list(lesson_stats.values()),
        'ip_groups': list(ip_groups.values()),
        'recent_by_ip': recent_by_ip,
        'total_stats': {
            'total_completed': total_completed,
            'total_active': total_active,
            'average_percentage': round(avg_percentage, 1),
            'average_time': round(avg_time, 1),
            'excellent': excellent,
            'good': good,
            'satisfactory': satisfactory,
            'unsatisfactory': unsatisfactory
        },
        'timestamp': datetime.now().strftime('%H:%M:%S')
    })

# Обновление метода submit_answers для сохранения завершенных тестов
@app.route('/api/submit', methods=['POST'])
def submit_answers():
    """Проверка ответов и завершение теста - ОСНОВНОЙ МЕТОД С ЛОГИРОВАНИЕМ"""
    try:
        data = request.get_json()
        user_answers = data.get('answers', [])
        lesson_id = data.get('lesson_id', 1)
        session_id = data.get('session_id')

        session_data = sessions[session_id]
        session_data['completed'] = True
        session_data['end_time'] = time.time()
        session_data['last_activity'] = time.time()
        
        questions = load_questions(lesson_id)
        
        score = 0
        total_questions = len(questions)
        results = []
        
        # Логирование КАЖДОГО ответа
        print(f"\n{Fore.CYAN + Style.BRIGHT}📝 Детальная проверка ответов:")
        print(f"{Fore.CYAN}{'─'*80}")
        
        for i, question in enumerate(questions):
            user_answer = user_answers[i] if i < len(user_answers) else None
            correct_answer = question['correct_answer']
            is_correct = user_answer == correct_answer
            
            # Получение текста ответов
            user_answer_text = question['options'][user_answer] if user_answer is not None else 'Не отвечено'
            correct_answer_text = question['options'][correct_answer]
            
            # Логирование каждого ответа
            status = '✅' if is_correct else '❌'
            status_color = Fore.GREEN if is_correct else Fore.RED
            answer_color = Fore.CYAN if is_correct else Fore.YELLOW
            
            print(f"{status_color}{status} {Fore.WHITE}Вопрос {i+1}: {question['question'][:60]}...")
            print(f"   {answer_color}Ваш ответ: {user_answer_text}")
            print(f"   {Fore.GREEN}Правильно: {correct_answer_text}")
            print()
            
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
        
        print(f"{Fore.CYAN}{'─'*80}\n")
        
        percentage = (score / total_questions) * 100 if total_questions > 0 else 0
        
        # Расчет оценки
        if percentage >= 90:
            grade = '5 (Отлично)'
        elif percentage >= 75:
            grade = '4 (Хорошо)'
        elif percentage >= 60:
            grade = '3 (Удовлетворительно)'
        else:
            grade = '2 (Неудовлетворительно)'
        
        # Логирование результатов
        if session_id in sessions:
            student_name = sessions[session_id]['student_name']
            elapsed_time = int(time.time() - sessions[session_id]['start_time'])
            
            log_event(
                session_id,
                'SUBMIT',
                f'Тест завершен',
                score=score,
                total=total_questions,
                percentage=round(percentage, 2),
                grade=grade,
                elapsed_time=elapsed_time
            )
            # Сохранение завершенного теста (в память и в лог-файл)
            record = {
                'id': str(uuid.uuid4())[:8],
                'student_id': session_id,
                'student_name': student_name,
                'lesson_id': sessions[session_id]['lesson_id'],
                'lesson_name': sessions[session_id]['lesson_name'],
                'device_id': sessions[session_id].get('device_id'),
                'score': score,
                'total': total_questions,
                'percentage': round(percentage, 2),
                'grade': grade,
                'elapsed_time': elapsed_time,
                'elapsed_time_formatted': f"{elapsed_time // 60}:{elapsed_time % 60:02d}",
                'timestamp': datetime.now().strftime('%H:%M:%S'),
                'date': datetime.now().strftime('%Y-%m-%d'),
                'ip': sessions[session_id].get('ip'),
                'ip_name': IP_NAMES.get(sessions[session_id].get('device_id')),
                'start_time': sessions[session_id].get('start_timestamp')
            }
            completed_tests.append(record)
            try:
                append_log_entry(record)
            except Exception:
                print('[WARN] Не удалось записать запись в logs.txt')
            
            # Очистка сессии
            del sessions[session_id]
        
        return jsonify({
            'success': True,
            'score': score,
            'total': total_questions,
            'percentage': round(percentage, 2),
            'grade': grade,
            'results': results
        })
    except Exception as e:
        log_event('unknown', 'ERROR', f'Ошибка при проверке ответов: {str(e)}')
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    # При запуске — предложим интерактивно выбрать/объединить файлы тестов (если TTY).
    # Avoid running twice when Flask debug reloader is enabled by running
    # the selector only in the reloader child or when no reloader is present.
    try:
        # should_run_selector = (os.environ.get('WERKZEUG_RUN_MAIN') == 'true') or ('WERKZEUG_RUN_MAIN' not in os.environ)
        # if should_run_selector:
        #     print(2)
        #     created = interactive_test_selector()
            
        #     if created:
        #         print(f"Объединённый файл создан: tests/{created}")
        #     # Rebuild LESSONS from the selected file (if any)
        #     if SELECTED_TEST_FILE:
        #         build_lessons_from_file(SELECTED_TEST_FILE)
            # Load persisted completed tests from logs.txt and ip names
        load_logs()
        load_ip_names()
    except Exception:
        # не мешаем запуску сервера в случае ошибок в селекторе
        pass

    print(f"\n{Fore.GREEN + Style.BRIGHT}🚀 Сервер запускается...")
    print(f"{Fore.CYAN}📚 Доступные уроки:")
    for lesson in LESSONS:
        print(f"   {lesson['id']}. {lesson['name']}")
    print(f"\n{Fore.YELLOW}📡 Сервер запущен: {Fore.WHITE + Style.BRIGHT}http://localhost:8000")
    print(f"{Fore.YELLOW}📊 Дашборд: {Fore.WHITE + Style.BRIGHT}http://localhost:8000/dashboard")
    print(f"{Fore.YELLOW}📈 API статистики: {Fore.WHITE + Style.BRIGHT}http://localhost:8000/api/dashboard/stats")
    print(f"\n{Fore.GREEN + Style.BRIGHT}{'─'*80}\n")
    
    app.run(debug=True, host='0.0.0.0', port=8000)
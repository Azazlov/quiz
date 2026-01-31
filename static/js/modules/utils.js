export function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function escapeHtml(text) {
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

export function shuffleQuestionOptions(question) {
    const optionsWithIndex = question.options.map((option, index) => ({ text: option, originalIndex: index }));
    const shuffled = shuffleArray(optionsWithIndex);
    const newCorrectIndex = shuffled.findIndex(opt => opt.originalIndex === question.correct_answer);
    return {
        ...question,
        shuffledOptions: shuffled.map(opt => opt.text),
        optionMapping: shuffled.map(opt => opt.originalIndex),
        shuffledCorrectAnswer: newCorrectIndex
    };
}

export function formatTimestamp(ts) {
    if (!ts) return '';
    try {
        const d = new Date(ts);
        return d.toLocaleString('ru-RU', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    } catch (e) {
        return ts;
    }
}

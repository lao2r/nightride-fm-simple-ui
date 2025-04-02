let audioElement;
let playing = false;
let audioContext; // Объявляем глобально, но не создаем сразу
let analyser;
let sourceNode; // Для хранения узла источника
let isMuted = false;
let animationId;
let currentStyle = 'chillsynth';
let metaInfo = {};

const playBtn = document.getElementById('playBtn');
const muteBtn = document.getElementById('muteBtn');
const status = document.getElementById('status');
const currentInfo = document.getElementById('currentInfo');
const volumeControl = document.querySelector('.volume-level');
const volumeBar = document.querySelector('.volume-bar');
const frequencyCanvas = document.getElementById('frequencyCanvas');
const barsCanvas = document.getElementById('barsCanvas');
const styleButtons = document.querySelectorAll('.style-btn');

const { ipcRenderer } = require('electron'); // Оставляем для Electron

// --- Функции управления окном Electron ---
document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('close-window');
});

// --- Предотвращение стандартных действий ---
document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' || (event.ctrlKey && event.shiftKey && event.key === 'I') || event.key === ' ' || (event.ctrlKey && event.key === 'R') || (event.ctrlKey && event.shiftKey && event.key === 'R')) {
        event.preventDefault();
    }
});

// --- Громкость ---
let defaultVolume = 0.5;
volumeControl.style.width = `${defaultVolume * 100}%`; // Установить начальное положение

let isChangingVolume = false;

volumeBar.addEventListener('mousedown', startVolumeChange);
document.addEventListener('mousemove', changeVolume);
document.addEventListener('mouseup', stopVolumeChange);

function startVolumeChange(e) {
    isChangingVolume = true;
    changeVolume(e);
}

function changeVolume(e) {
    if (!isChangingVolume) return;
    const rect = volumeBar.getBoundingClientRect();
    let x = e.clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    const volume = x / rect.width;
    setVolume(volume);
}

function stopVolumeChange() {
    isChangingVolume = false;
}

function setVolume(volume) {
    defaultVolume = volume; // Сохраняем для будущих воспроизведений
    if (audioElement) {
        audioElement.volume = volume;
    }
    volumeControl.style.width = `${volume * 100}%`;
}

// --- Переключение стилей ---
styleButtons.forEach(button => {
    button.addEventListener('click', (e) => {
        const newStyle = e.target.dataset.style;
        if (newStyle !== currentStyle) {
            // Останавливаем текущее воспроизведение и анимацию
            stopAudio();

            // Меняем стиль
            document.body.className = newStyle;
            currentStyle = newStyle;
            styleButtons.forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            updateVisualColors(); // Обновляем цвета сразу
            updateCurrentInfo();
            updateButtonStyles(); // Обновляем активную кнопку стиля

            // Сразу пытаемся запустить новый стиль, если предыдущий играл
            // (Пользователь уже дал разрешение на предыдущем шаге)
            // Если не играл, то просто сменили стиль, ждем нажатия Play
            // NOTE: Из-за stopAudio(), playing будет false. Нужно будет нажать Play снова.
            // Или можно было бы запомнить состояние playing и вызвать playAudio() здесь.
            // Но безопаснее требовать повторного нажатия Play после смены стиля.
            status.textContent = 'Ready to play'; // Сбрасываем статус
        }
    });
});

// --- Получение метаданных ---
const sseUrl = 'https://nightride.fm/meta';
const eventSource = new EventSource(sseUrl);

eventSource.onmessage = (event) => {
    if (event.data !== "keepalive") {
        try {
            const data = JSON.parse(event.data);
            data.forEach(item => {
                metaInfo[item.station] = item;
            });
            updateCurrentInfo(); // Обновляем инфо, если пришло новое
        } catch (e) {
            console.error("Error parsing metadata:", e);
        }
    }
};

function updateCurrentInfo() {
    const currentMeta = metaInfo[currentStyle];
    if (currentMeta) {
        const { artist, title, album } = currentMeta;
        // Проверяем, что значения не null или undefined
        const displayArtist = artist || "Unknown Artist";
        const displayTitle = title || "Unknown Title";
        const displayAlbum = album ? ` (${album})` : "";
        currentInfo.textContent = `${displayArtist} - ${displayTitle}${displayAlbum}`;
    } else {
        // Отображаем инфо для текущего стиля, даже если метаданные еще не пришли
         currentInfo.textContent = `Playing: ${currentStyle}`;
        // Можно добавить "Loading track info..." если нужно
    }
}

// --- Управление воспроизведением ---

playBtn.addEventListener('click', togglePlay);
muteBtn.addEventListener('click', toggleMute);

// **ВАЖНО:** Инициализация AudioContext и его возобновление
async function initializeAudioContext() {
    if (!audioContext) {
        try {
            console.log("Creating new AudioContext...");
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log("AudioContext created, state:", audioContext.state);
            // Если контекст сразу создался в suspended, попробуем возобновить
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log("AudioContext resumed on creation, state:", audioContext.state);
            }
        } catch (e) {
            console.error("Error creating AudioContext:", e);
            status.textContent = 'Error: Web Audio API is not supported or allowed.';
            audioContext = null; // Сбрасываем, если ошибка
            return false; // Сигнализируем об ошибке
        }
    } else if (audioContext.state === 'suspended') {
        try {
            console.log("Resuming existing AudioContext...");
            await audioContext.resume();
            console.log("AudioContext resumed, state:", audioContext.state);
        } catch (e) {
            console.error("Error resuming AudioContext:", e);
            status.textContent = 'Error resuming audio context.';
            return false; // Сигнализируем об ошибке
        }
    } else if (audioContext.state === 'closed') {
        console.warn("AudioContext was closed. Recreating...");
        audioContext = null; // Сбрасываем старый
        sourceNode = null; // Сбрасываем источник
        return initializeAudioContext(); // Пытаемся создать заново
    }
    // Если дошли сюда, контекст либо уже был 'running', либо успешно создан/возобновлен
    return audioContext.state === 'running';
}

// **ВАЖНО:** Настройка анализатора и источника
function setupAnalyserAndSource() {
    if (!audioContext || audioContext.state !== 'running') {
        console.warn("Cannot setup analyser: AudioContext not running.");
        return;
    }
    if (!audioElement) {
        console.warn("Cannot setup analyser: Audio element does not exist.");
        return;
    }
    if (sourceNode) {
         console.log("Analyser and source already set up.");
         // Переподключать не нужно, если элемент тот же
         // Если бы элемент менялся, нужно было бы `sourceNode.disconnect()` и создать новый
         return;
    }

    try {
        console.log("Setting up Analyser and Source Node...");
        analyser = audioContext.createAnalyser();
        // analyser.fftSize = 2048; // Можно настроить размер FFT

        sourceNode = audioContext.createMediaElementSource(audioElement);
        sourceNode.connect(analyser);
        analyser.connect(audioContext.destination);
        console.log("Analyser and Source Node connected.");

        // Запускаем визуализацию ТОЛЬКО после успешной настройки
        if (!animationId) {
             updateVisualizers();
        }

    } catch(e) {
        console.error("Error setting up analyser node:", e);
        status.textContent = "Error initializing visualiser.";
        analyser = null;
        sourceNode = null;
    }
}


async function togglePlay() {
    // 1. Инициализируем/возобновляем AudioContext ПРИ НАЖАТИИ
    const contextReady = await initializeAudioContext();

    if (!contextReady) {
        // Если контекст не готов (ошибка или не поддерживается),
        // не продолжаем с воспроизведением, которое требует анализа
        console.error("AudioContext could not be initialized or resumed.");
        // Можно попытаться просто играть аудио без анализатора, если это приемлемо
        // Но для визуализации контекст нужен.
        return; // Выходим
    }

    // 2. Если контекст готов, переключаем воспроизведение
    if (playing) {
        pauseAudio();
    } else {
        // Проверяем, есть ли уже элемент и он на паузе
        if (audioElement && audioElement.paused) {
            console.log("Resuming existing audio element...");
            audioElement.play().then(() => {
                status.textContent = 'Now playing';
                playing = true;
                playBtn.textContent = '❚❚';
                // Убедимся, что анализатор подключен и визуализация запущена
                setupAnalyserAndSource();
                 if (!animationId && analyser) { updateVisualizers(); }
            }).catch(e => {
                console.error("Error resuming playback:", e);
                status.textContent = 'Error resuming';
                playing = false;
                playBtn.textContent = '▶';
            });
        } else {
            // Если элемента нет или он не на паузе (например, после stopAudio), запускаем новый
             console.log("Starting new playback...");
             playAudio(); // Эта функция создаст новый элемент и запустит play()
        }
    }
}

function playAudio() {
    // Останавливаем предыдущий поток и анимацию, если они были
    stopAudio(true); // true - мягкая остановка без закрытия контекста

    console.log(`Creating new AudioElement for: ${currentStyle}`);
    audioElement = new Audio(`https://stream.nightride.fm/${currentStyle}.mp3`);
    audioElement.crossOrigin = "anonymous";
    audioElement.volume = defaultVolume; // Используем сохраненную громкость
    audioElement.muted = isMuted; // Применяем состояние mute

    status.textContent = 'Connecting...';
    playBtn.textContent = '❚❚'; // Оптимистично ставим паузу
    playing = true; // Оптимистично ставим playing

    audioElement.addEventListener('loadedmetadata', () => {
         console.log("Audio metadata loaded.");
    });

    audioElement.addEventListener('canplay', () => {
        console.log("Audio canplay event.");
        status.textContent = 'Now playing';
        // **ВАЖНО:** Настраиваем анализатор ЗДЕСЬ, когда элемент готов
        // и мы знаем, что AudioContext уже 'running' (из togglePlay)
        setupAnalyserAndSource();
    });

     audioElement.addEventListener('playing', () => {
         console.log("Audio playing event.");
         // Можно еще раз убедиться, что все запущено
         status.textContent = 'Now playing';
         playing = true;
         playBtn.textContent = '❚❚';
         if (!animationId && analyser) {
             updateVisualizers();
         }
     });

     audioElement.addEventListener('pause', () => {
        console.log("Audio pause event.");
        // Не меняем статус на 'Paused' здесь, т.к. это может быть временная пауза буферизации
        // Статус меняется в pauseAudio()
     });

    audioElement.addEventListener('ended', () => {
        console.log("Audio ended event.");
        status.textContent = 'Stream ended. Reconnecting...';
        playing = false;
        playBtn.textContent = '▶';
        // Можно попытаться переподключиться
        // playAudio(); // Или требовать нажатия Play
        stopAudio(); // Очищаем ресурсы
    });


    audioElement.addEventListener('error', (e) => {
        console.error('Audio Element Error:', e);
        status.textContent = 'Stream error. Check connection.';
        playing = false;
        playBtn.textContent = '▶';
        stopAudio(); // Очищаем ресурсы при ошибке
    });

    // Запускаем воспроизведение
    audioElement.play().catch(error => {
        console.error('Error starting playback:', error);
        status.textContent = 'Error starting play.';
        playing = false;
        playBtn.textContent = '▶';
        stopAudio(); // Очищаем при ошибке запуска
    });
}

function pauseAudio() {
    if (audioElement) {
        console.log("Pausing audio element.");
        audioElement.pause();
    }
    // Останавливаем цикл анимации при паузе
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
        console.log("Animation frame cancelled.");
    }
    status.textContent = 'Paused';
    playing = false;
    playBtn.textContent = '▶';
}

// Добавим параметр, чтобы различать полную остановку и мягкую (перед сменой трека)
function stopAudio(softStop = false) {
    console.log(`Stopping audio. Soft stop: ${softStop}`);
    if (audioElement) {
        audioElement.pause();
        audioElement.src = ''; // Отвязываем источник
        // Удаляем слушатели, чтобы избежать утечек памяти
        audioElement.removeEventListener('loadedmetadata', null);
        audioElement.removeEventListener('canplay', null);
        audioElement.removeEventListener('playing', null);
        audioElement.removeEventListener('pause', null);
        audioElement.removeEventListener('ended', null);
        audioElement.removeEventListener('error', null);
        audioElement.load(); // Прерываем загрузку
        audioElement = null;
        console.log("Audio element stopped and cleared.");
    }

    // Останавливаем цикл анимации
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
        console.log("Animation frame cancelled.");
    }

    // При полной остановке (не softStop) можно закрыть AudioContext для экономии ресурсов
    // Но это потребует его полного воссоздания при следующем Play.
    // Для мобильных может быть лучше НЕ закрывать, а дать ему уйти в suspend.
    // Если происходит softStop (например, смена стиля), точно не закрываем контекст.
    // if (!softStop && audioContext && audioContext.state !== 'closed') {
    //     audioContext.close().then(() => {
    //         console.log("AudioContext closed.");
    //         audioContext = null;
    //         analyser = null;
    //         sourceNode = null;
    //     }).catch(e => console.error("Error closing AudioContext:", e));
    // }

    // Сбрасываем анализатор и источник при любой остановке, т.к. audioElement удален
     if (sourceNode) {
         sourceNode.disconnect(); // Отключаем узел
         sourceNode = null;
         analyser = null; // Analyser создается заново при подключении нового source
         console.log("Source node disconnected and cleared.");
     }


    playing = false;
    playBtn.textContent = '▶';
    // Не меняем статус здесь, т.к. stopAudio вызывается в разных сценариях
}

function toggleMute() {
    isMuted = !isMuted; // Меняем сохраненное состояние
    if (audioElement) {
        audioElement.muted = isMuted;
    }
    muteBtn.textContent = isMuted ? '🔇' : '♫'; // Используем эмодзи для Mute
     console.log("Mute toggled:", isMuted);
}


// --- Визуализация ---

function updateVisualizers() {
    if (!analyser || !playing) {
        // Если нет анализатора или не играем, останавливаем цикл
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        return;
    }

    // Запрашиваем следующий кадр
    animationId = requestAnimationFrame(updateVisualizers);

    // Рисуем визуализаторы
    drawFrequency();
    drawBars();
}

function drawFrequency() {
    if (!analyser) return; // Доп. проверка

    const bufferLength = analyser.frequencyBinCount; // analyser.fftSize / 2
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray); // Получаем данные частот

    const canvas = frequencyCanvas;
    const ctx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    ctx.clearRect(0, 0, WIDTH, HEIGHT); // Очищаем холст

    // Получаем цвет из CSS-переменных текущего стиля
    const lineColor = getComputedStyle(document.body).getPropertyValue('color');
    ctx.lineWidth = 1;
    ctx.strokeStyle = lineColor || '#beb6a9'; // Резервный цвет

    ctx.beginPath();

    const sliceWidth = WIDTH * 1.0 / (bufferLength / 4); // Рисуем только часть спектра для наглядности
    let x = 0;

    for (let i = 0; i < bufferLength / 4; i++) {
        const v = dataArray[i] / 128.0; // Нормализуем значение (0-2)
        const y = HEIGHT / 2 - (v * HEIGHT / 4); // Рисуем от центра, инвертируем для верха

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }

    // Нижняя часть (зеркально) - можно убрать для другого вида
    x = 0;
     for (let i = 0; i < bufferLength / 4; i++) {
        const v = dataArray[i] / 128.0;
        const y = HEIGHT / 2 + (v * HEIGHT / 4); // Рисуем от центра вниз

        if (i === 0) {
            // Если начинаем новую линию, нужно moveTo
            // Но мы продолжаем предыдущую, так что можно использовать lineTo,
            // или начать новую ctx.moveTo(x, y); ctx.lineTo(...)
             ctx.lineTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }


    //ctx.lineTo(WIDTH, HEIGHT / 2); // Завершаем линию по центру справа
    ctx.stroke(); // Рисуем линию
}

function drawBars() {
     if (!analyser) return; // Доп. проверка

    const bufferLength = analyser.frequencyBinCount; // Используем analyser.fftSize / 2
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray); // Получаем данные частот

    const canvas = barsCanvas;
    const ctx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const numBars = 64; // Количество столбиков (можно настроить)
    const barWidth = (WIDTH / numBars) * 0.8; // Ширина столбика с небольшим отступом
    const barSpacing = (WIDTH / numBars) * 0.2; // Отступ
    let x = barSpacing / 2; // Начальная позиция X

    // Определяем цвета градиента из CSS
    const colorBottom = getComputedStyle(document.body).getPropertyValue('color');
    const colorTop = getComputedStyle(document.querySelector('#currentInfo')).getPropertyValue('color');

    const gradient = ctx.createLinearGradient(0, HEIGHT, 0, 0);
    gradient.addColorStop(0, colorBottom || '#a923c2'); // Резервный цвет низ
    gradient.addColorStop(1, colorTop || '#e02cd2');    // Резервный цвет верх


    // Усредняем данные для нужного количества столбиков
    const dataPointsPerBar = Math.floor(bufferLength / numBars);

    for (let i = 0; i < numBars; i++) {
        let sum = 0;
        // Усредняем значения частот для этого столбика
        for (let j = 0; j < dataPointsPerBar; j++) {
             // Добавляем защиту от выхода за пределы массива
             const index = i * dataPointsPerBar + j;
             if (index < bufferLength) {
                sum += dataArray[index];
             }
        }
        const average = sum / dataPointsPerBar;
        // Масштабируем высоту, можно добавить Math.pow для нелинейности
        const barHeight = (average / 255) * HEIGHT * 0.8; // Делаем чуть ниже макс высоты

        ctx.fillStyle = gradient;
        // Рисуем прямоугольник снизу вверх
        ctx.fillRect(x, HEIGHT - barHeight, barWidth, barHeight);

        x += barWidth + barSpacing; // Переходим к следующему столбику
    }
}


function updateVisualColors() {
    // Просто перерисовываем текущий кадр с новыми цветами
    // Функция updateVisualizers сама вызовет эти функции в следующем кадре,
    // но можно вызвать и здесь для немедленного эффекта, если нужно.
    // drawFrequency();
    // drawBars();
     console.log("Visual colors will update on the next frame.");
}

function updateButtonStyles() {
    styleButtons.forEach(button => {
        const style = button.dataset.style;
        if (style === currentStyle) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
}

function resizeCanvas() {
    // Устанавливаем размер canvas равным его отображаемому размеру
    frequencyCanvas.width = frequencyCanvas.offsetWidth;
    frequencyCanvas.height = frequencyCanvas.offsetHeight;
    barsCanvas.width = barsCanvas.offsetWidth;
    barsCanvas.height = barsCanvas.offsetHeight;
     console.log("Canvases resized.");
    // Перерисовываем после изменения размера, если что-то играет
    if (playing && analyser) {
        drawFrequency();
        drawBars();
    }
}

// --- Инициализация при загрузке ---
window.addEventListener('resize', resizeCanvas);
// Вызываем resize сразу, чтобы установить начальные размеры
resizeCanvas();
// Устанавливаем начальную информацию
updateCurrentInfo();
// Устанавливаем начальную активную кнопку стиля
updateButtonStyles();
// Устанавливаем иконку Mute по умолчанию
muteBtn.textContent = isMuted ? '🔇' : '♫';

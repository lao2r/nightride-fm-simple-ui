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

// Проверка, выполняется ли код в Electron или в обычном браузере
const isElectron = typeof require === 'function';
let ipcRenderer = null;
if (isElectron) {
    ipcRenderer = require('electron').ipcRenderer;
    console.log("Running in Electron environment.");
} else {
    console.log("Running in standard browser environment.");
}

// --- Функции управления окном Electron (только если в Electron) ---
if (isElectron && ipcRenderer) {
    document.getElementById('minimize-btn').addEventListener('click', () => {
        ipcRenderer.send('minimize-window');
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        ipcRenderer.send('close-window');
    });
} else {
    // Скрываем или отключаем кнопки управления окном в браузере
    const titlebar = document.querySelector('.titlebar');
    if (titlebar) {
        // Можно просто скрыть кнопки
         const minBtn = document.getElementById('minimize-btn');
         const closeBtn = document.getElementById('close-btn');
         if (minBtn) minBtn.style.display = 'none';
         if (closeBtn) closeBtn.style.display = 'none';
        // Или скрыть весь titlebar, если он не нужен для перетаскивания в браузере
        // titlebar.style.display = 'none';
    }
     // Убираем возможность перетаскивания для body в браузере
     document.body.style.webkitAppRegion = 'no-drag';
}


// --- Предотвращение стандартных действий ---
document.addEventListener('keydown', (event) => {
    // Оставляем только предотвращение Tab, остальное может быть полезно для отладки в браузере
    if (event.key === 'Tab') {
         event.preventDefault();
    }
    // В Electron блокируем перезагрузку, в браузере - нет
    if (isElectron && ((event.ctrlKey && event.key === 'R') || (event.ctrlKey && event.shiftKey && event.key === 'R') || event.key === 'F5')) {
         event.preventDefault();
    }
     // Блокируем пробел только если фокус не на кнопке (чтобы не триггерить кнопки случайно)
     if (event.key === ' ' && document.activeElement !== playBtn && document.activeElement !== muteBtn && !document.activeElement.classList.contains('style-btn')) {
        event.preventDefault();
    }
    // Блокируем Ctrl+Shift+I в Electron
    if (isElectron && event.ctrlKey && event.shiftKey && event.key === 'I') {
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
// Добавим поддержку Touch событий для мобильных
volumeBar.addEventListener('touchstart', startVolumeChange, { passive: true }); // passive: true для лучшей производительности скролла
document.addEventListener('touchmove', changeVolume, { passive: false }); // passive: false, т.к. мы можем захотеть preventDefault для скролла страницы
document.addEventListener('touchend', stopVolumeChange);


function startVolumeChange(e) {
    isChangingVolume = true;
    // Используем e.clientX или e.touches[0].clientX
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    changeVolume(e); // Первый расчет громкости сразу
    // Предотвращаем стандартное поведение (например, скролл) при тач-перемещении по бару
     if (e.type === 'touchmove') {
        e.preventDefault();
     }
}

function changeVolume(e) {
    if (!isChangingVolume) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = volumeBar.getBoundingClientRect();
    let x = clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    const volume = x / rect.width;
    setVolume(volume);

     // Предотвращаем стандартное поведение (например, скролл) при тач-перемещении по бару
     if (e.type === 'touchmove') {
        e.preventDefault();
     }
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
            const wasPlaying = playing; // Запоминаем, играло ли радио

            stopAudio(); // Останавливаем текущее (сбрасывает playing на false)

            document.body.className = newStyle; // Применяем класс стиля к body
            currentStyle = newStyle;
            styleButtons.forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            updateVisualColors();
            updateCurrentInfo(); // Обновляем инфо для нового стиля
            updateButtonStyles();

            // Если радио играло до смены стиля, пытаемся запустить новый стиль
            if (wasPlaying) {
                // Используем setTimeout, чтобы дать браузеру время "переварить" stopAudio
                // и избежать возможных конфликтов при немедленном запуске playAudio
                setTimeout(() => {
                     // Имитируем нажатие кнопки Play для запуска нового потока
                     // Это обеспечит правильную инициализацию AudioContext в iOS
                     playBtn.click();
                     // Или напрямую вызываем togglePlay, если уверены в контексте
                     // togglePlay();
                }, 100); // Небольшая задержка
            } else {
                 status.textContent = 'Ready to play'; // Если не играло, просто готово
            }
        }
    });
});

// --- Получение метаданных ---
const sseUrl = 'https://nightride.fm/meta';
let eventSource = null;

function startMetadataUpdates() {
    if (eventSource) {
        eventSource.close(); // Закрываем предыдущее соединение, если есть
    }
    console.log("Starting EventSource for metadata...");
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
        console.log("Metadata connection opened.");
    };

    eventSource.onmessage = (event) => {
        if (event.data !== "keepalive") {
            try {
                const data = JSON.parse(event.data);
                data.forEach(item => {
                    metaInfo[item.station] = item;
                });
                // Обновляем инфо только если текущий стиль уже играет
                // или если метаданные пришли для выбранного, но не играющего стиля
                if (playing || metaInfo[currentStyle]) {
                    updateCurrentInfo();
                }
            } catch (e) {
                console.error("Error parsing metadata:", e, "Data:", event.data);
            }
        } else {
             // console.log("Metadata keepalive received."); // Можно раскомментировать для отладки
        }
    };

    eventSource.onerror = (err) => {
        console.error("EventSource failed:", err);
        // Можно попытаться переподключиться через некоторое время
        eventSource.close();
        setTimeout(startMetadataUpdates, 5000); // Попробовать снова через 5 секунд
    };
}


function updateCurrentInfo() {
    const currentMeta = metaInfo[currentStyle];
    if (currentMeta) {
        const displayArtist = currentMeta.artist || "Unknown Artist";
        const displayTitle = currentMeta.title || "Unknown Title";
        const displayAlbum = currentMeta.album ? ` (${currentMeta.album})` : "";
        currentInfo.textContent = `${displayArtist} - ${displayTitle}${displayAlbum}`;
    } else {
        // Отображаем название стиля, пока нет метаданных
         currentInfo.textContent = `Style: ${currentStyle}`;
         // Можно добавить "Loading track info..."
         // currentInfo.textContent += ' (Loading info...)';
    }
}

// --- Управление воспроизведением ---

playBtn.addEventListener('click', togglePlay);
muteBtn.addEventListener('click', toggleMute);

// **Упрощенная инициализация/возобновление AudioContext**
function ensureAudioContext() {
    if (!audioContext) {
        try {
            console.log("Creating new AudioContext...");
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log("AudioContext created, initial state:", audioContext.state);
            if (audioContext.state === 'suspended') {
                console.log("Attempting to resume context immediately after creation...");
                audioContext.resume().then(() => {
                    console.log("Context resumed successfully (async). State:", audioContext.state);
                    if (audioElement && !audioElement.paused && audioContext.state === 'running') {
                         setupAnalyserAndSource(); // Попытка настройки, если уже играет
                    }
                }).catch(e => console.error("Error resuming context after creation:", e));
            }
        } catch (e) {
            console.error("Error creating AudioContext:", e);
            status.textContent = 'Error: Web Audio API not supported/allowed.';
            audioContext = null;
            return false;
        }
    } else if (audioContext.state === 'suspended') {
        console.log("Attempting to resume existing suspended context...");
        audioContext.resume().then(() => {
            console.log("Existing context resumed successfully (async). State:", audioContext.state);
             if (audioElement && !audioElement.paused && audioContext.state === 'running') {
                 setupAnalyserAndSource(); // Попытка настройки, если уже играет
             }
        }).catch(e => console.error("Error resuming existing context:", e));
    } else if (audioContext.state === 'closed') {
        console.warn("AudioContext was closed. Recreating...");
        audioContext = null;
        sourceNode = null;
        analyser = null;
        return ensureAudioContext();
    } else {
         console.log("AudioContext already exists and is in state:", audioContext.state);
    }
    return !!audioContext;
}

// Настройка анализатора - вызывается, когда звук ТОЧНО играет
function setupAnalyserAndSource() {
    if (!audioContext || audioContext.state !== 'running') {
        console.warn(`Cannot setup analyser: AudioContext not ready (state: ${audioContext ? audioContext.state : 'null'}). Waiting for context to resume.`);
        // Можно запланировать повторную попытку через короткое время
        // setTimeout(setupAnalyserAndSource, 100);
        return;
    }
    if (!audioElement || audioElement.paused) { // Добавили проверку на паузу
        console.warn("Cannot setup analyser: Audio element does not exist or is paused.");
        return;
    }
    if (sourceNode && sourceNode.mediaElement === audioElement) {
         console.log("Analyser and source already set up for this element.");
         if (!animationId && playing) { updateVisualizers(); }
         return;
    }
    if (sourceNode) {
        sourceNode.disconnect(); sourceNode = null; analyser = null;
        console.log("Disconnected old source node.");
    }

    try {
        console.log("Setting up Analyser and Source Node...");
        analyser = audioContext.createAnalyser();
        // analyser.fftSize = 1024; // Можно уменьшить для производительности на мобильных
        // analyser.smoothingTimeConstant = 0.8; // Сглаживание

        sourceNode = audioContext.createMediaElementSource(audioElement);
        sourceNode.connect(analyser);
        analyser.connect(audioContext.destination);
        console.log("Analyser and Source Node connected.");

        if (!animationId && playing) {
             updateVisualizers();
        }
    } catch(e) {
        console.error("Error setting up analyser node:", e);
        status.textContent = "Error initializing visualiser.";
        analyser = null; sourceNode = null;
    }
}


function togglePlay() {
    console.log("Toggle play called. Current state playing:", playing);
    // 1. Убедимся, что контекст есть и пытаемся его возобновить (внутри клика!)
    const contextExists = ensureAudioContext();

    // 2. Переключаем воспроизведение
    if (playing) {
        pauseAudio();
    } else {
        // Пытаемся запустить воспроизведение
        if (contextExists || !audioContext) { // Позволяем играть, даже если контекст еще suspended
             if (audioElement && audioElement.paused) {
                console.log("Resuming existing audio element...");
                status.textContent = 'Resuming...'; // Промежуточный статус
                audioElement.play().catch(e => {
                    console.error("Error resuming playback:", e);
                    status.textContent = 'Error resuming';
                    playing = false; playBtn.textContent = '▶';
                });
            } else {
                console.log("Starting new playback sequence...");
                playAudio(); // Запустит создание и play() нового элемента
            }
        } else {
             console.error("AudioContext could not be created. Cannot start playback.");
             status.textContent = 'Audio Setup Error';
             playBtn.textContent = '▶'; playing = false;
        }
    }
}

function playAudio() {
    stopAudio(true); // Мягкая остановка предыдущего

    console.log(`Creating new AudioElement for: ${currentStyle}`);
    audioElement = new Audio(); // Создаем пустой элемент сначала
    audioElement.crossOrigin = "anonymous";
    audioElement.volume = defaultVolume;
    audioElement.muted = isMuted;

    status.textContent = 'Connecting...';
    playBtn.disabled = true; // Блокируем кнопку на время загрузки

    // --- СЛУШАТЕЛИ СОБЫТИЙ (до установки src) ---
    audioElement.addEventListener('loadedmetadata', () => {
         console.log("Audio event: loadedmetadata");
    });
    audioElement.addEventListener('loadeddata', () => {
        console.log("Audio event: loadeddata");
        status.textContent = 'Buffering...';
    });
     audioElement.addEventListener('canplay', () => {
        console.log("Audio event: canplay.");
        status.textContent = 'Ready to play';
        playBtn.disabled = false; // Разблокируем кнопку, когда может начать играть
    });
    audioElement.addEventListener('canplaythrough', () => {
        console.log("Audio event: canplaythrough.");
        status.textContent = 'Ready (Buffered)';
        playBtn.disabled = false;
    });
     audioElement.addEventListener('playing', () => {
         console.log("Audio event: playing fired.");
         status.textContent = 'Now playing';
         playing = true;
         playBtn.textContent = '❚❚';
         playBtn.disabled = false;
         // Пытаемся настроить анализатор здесь, т.к. звук пошел
         setupAnalyserAndSource();
     });
     audioElement.addEventListener('waiting', () => {
         console.log("Audio event: waiting (buffering).");
         status.textContent = 'Buffering...';
     });
     audioElement.addEventListener('pause', () => {
        console.log("Audio event: pause.");
        // Если пауза не вызвана пользователем (playing все еще true)
        if (playing) {
             status.textContent = 'Stream paused'; // Может быть буферизация или проблема сети
        }
     });
    audioElement.addEventListener('ended', () => {
        console.log("Audio event: ended.");
        status.textContent = 'Stream ended';
        playing = false; playBtn.textContent = '▶'; playBtn.disabled = false;
        stopAudio();
    });
    audioElement.addEventListener('error', (e) => {
        console.error('Audio Element Error:', e);
        let errorMsg = 'Stream error';
        if (audioElement && audioElement.error) {
            switch (audioElement.error.code) {
                case MediaError.MEDIA_ERR_ABORTED: errorMsg = 'Playback aborted.'; break;
                case MediaError.MEDIA_ERR_NETWORK: errorMsg = 'Network error.'; break;
                case MediaError.MEDIA_ERR_DECODE: errorMsg = 'Audio decode error.'; break;
                case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: errorMsg = 'Audio format not supported.'; break;
                default: errorMsg = 'Unknown stream error.';
            }
            console.error(`MediaError code: ${audioElement.error.code}, message: ${audioElement.error.message}`);
        }
        status.textContent = errorMsg;
        playing = false; playBtn.textContent = '▶'; playBtn.disabled = false;
        stopAudio();
    });
     audioElement.addEventListener('stalled', () => {
         console.warn("Audio event: stalled (network).");
         // status.textContent = 'Network stalled'; // Можно показать, но может быть навязчиво
     });
     audioElement.addEventListener('suspend', () => {
         console.log("Audio event: suspend (download finished or stopped).");
     });


    // Устанавливаем источник ПОСЛЕ добавления слушателей
    console.log("Setting audio source and calling load()...");
    audioElement.src = `https://stream.nightride.fm/${currentStyle}.mp3`;
    audioElement.load(); // Начинаем загрузку

    // Запускаем воспроизведение (браузер начнет играть, как только сможет - canplay/canplaythrough)
    console.log("Calling audioElement.play()...");
    const playPromise = audioElement.play();

    if (playPromise !== undefined) {
        playPromise.then(() => {
            console.log("audioElement.play() Promise resolved (playback started or will start soon).");
            // Не меняем статус здесь, ждем события 'playing'
             playBtn.disabled = false; // На всякий случай разблокируем
        }).catch(error => {
            console.error('Error executing audioElement.play():', error);
            // Это частая ошибка на iOS, если play() вызван не в рамках user gesture
            // Или если автоплей заблокирован
            if (error.name === 'NotAllowedError') {
                 status.textContent = 'Tap play to start';
            } else if (error.name === 'NotSupportedError') {
                 status.textContent = 'Format error';
            } else {
                status.textContent = 'Playback error';
            }
            playing = false; playBtn.textContent = '▶'; playBtn.disabled = false;
            stopAudio();
        });
    } else {
         // Старые браузеры могут не возвращать Promise из play()
         playBtn.disabled = false;
    }
}

function pauseAudio() {
    console.log("Pause requested by user.");
    if (audioElement) {
        audioElement.pause();
    }
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
        console.log("Animation frame cancelled due to pause.");
    }
    status.textContent = 'Paused';
    playing = false;
    playBtn.textContent = '▶';
    playBtn.disabled = false; // Разблокируем кнопку
}

function stopAudio(softStop = false) {
    console.log(`Stopping audio. Soft stop: ${softStop}`);
    if (audioElement) {
        console.log("Stopping and cleaning up audio element...");
        // Сначала удаляем слушатели, чтобы избежать их срабатывания при сбросе src
        audioElement.removeEventListener('loadedmetadata', null);
        audioElement.removeEventListener('loadeddata', null);
        audioElement.removeEventListener('canplay', null);
        audioElement.removeEventListener('canplaythrough', null);
        audioElement.removeEventListener('playing', null);
        audioElement.removeEventListener('waiting', null);
        audioElement.removeEventListener('pause', null);
        audioElement.removeEventListener('ended', null);
        audioElement.removeEventListener('error', null);
        audioElement.removeEventListener('stalled', null);
        audioElement.removeEventListener('suspend', null);

        audioElement.pause();
        audioElement.src = ''; // Отвязываем источник
        audioElement.load(); // Прерываем загрузку
        audioElement = null; // Удаляем ссылку на объект
        console.log("Audio element stopped and cleared.");
    } else {
         console.log("No audio element to stop.");
    }


    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
        console.log("Animation frame cancelled.");
    }

     if (sourceNode) {
         sourceNode.disconnect();
         sourceNode = null;
         analyser = null;
         console.log("Source node disconnected and cleared.");
     }

    // Контекст не закрываем, особенно на мобильных
    // if (!softStop && audioContext && audioContext.state !== 'closed') { ... }

    playing = false;
    if (!softStop) { // При мягкой остановке статус может управляться извне
        status.textContent = 'Stopped';
    }
    playBtn.textContent = '▶';
    playBtn.disabled = false; // Убедимся, что кнопка активна
}

function toggleMute() {
    isMuted = !isMuted;
    if (audioElement) {
        audioElement.muted = isMuted;
    }
    muteBtn.textContent = isMuted ? '🔇' : '♫';
    console.log("Mute toggled:", isMuted);
}


// --- Визуализация ---

function updateVisualizers() {
    if (!analyser || !playing || !audioContext || audioContext.state !== 'running') {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
             // Очищаем canvas при остановке анимации
             const freqCtx = frequencyCanvas.getContext('2d');
             freqCtx.clearRect(0, 0, frequencyCanvas.width, frequencyCanvas.height);
             const barsCtx = barsCanvas.getContext('2d');
             barsCtx.clearRect(0, 0, barsCanvas.width, barsCanvas.height);
        }
        return;
    }

    animationId = requestAnimationFrame(updateVisualizers);
    drawFrequency();
    drawBars();
}

function drawFrequency() {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const canvas = frequencyCanvas;
    const ctx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const lineColor = getComputedStyle(document.body).getPropertyValue('color');
    ctx.lineWidth = 1;
    ctx.strokeStyle = lineColor || '#beb6a9';

    ctx.beginPath();
    // Рисуем только верхнюю половину для простоты и производительности
    const sliceWidth = WIDTH * 1.0 / (bufferLength / 4); // Используем четверть данных
    let x = 0;
    for (let i = 0; i < bufferLength / 4; i++) {
        const v = dataArray[i] / 128.0; // Нормализация 0-2
        const y = HEIGHT / 2 - (v * HEIGHT / 3); // Масштабируем от центра вверх

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    // ctx.lineTo(WIDTH, HEIGHT / 2); // Завершение линии справа по центру
    ctx.stroke();
}

function drawBars() {
     if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const canvas = barsCanvas;
    const ctx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const numBars = 48; // Уменьшим количество для производительности
    const barWidth = (WIDTH / numBars) * 0.8;
    const barSpacing = (WIDTH / numBars) * 0.2;
    let x = barSpacing / 2;

    const colorBottom = getComputedStyle(document.body).getPropertyValue('color');
    const colorTop = getComputedStyle(document.querySelector('#currentInfo')).getPropertyValue('color');

    // Кэшируем градиент, если цвета не менялись (не реализовано, но идея)
    const gradient = ctx.createLinearGradient(0, HEIGHT, 0, 0);
    gradient.addColorStop(0, colorBottom || '#a923c2');
    gradient.addColorStop(1, colorTop || '#e02cd2');

    const dataPointsPerBar = Math.floor(bufferLength / numBars);
    if (dataPointsPerBar < 1) return; // Невозможно нарисовать, если данных меньше чем баров

    for (let i = 0; i < numBars; i++) {
        let sum = 0;
        const startIndex = i * dataPointsPerBar;
        const endIndex = Math.min(startIndex + dataPointsPerBar, bufferLength); // Защита от выхода за массив
        for (let j = startIndex; j < endIndex; j++) {
             sum += dataArray[j];
        }
        const average = (endIndex > startIndex) ? sum / (endIndex - startIndex) : 0;
        // Нелинейное масштабирование для лучшего вида (подбирается экспериментально)
        const barHeight = Math.pow(average / 255, 2) * HEIGHT; // Квадратичная шкала

        ctx.fillStyle = gradient;
        ctx.fillRect(x, HEIGHT - barHeight, barWidth, barHeight);
        x += barWidth + barSpacing;
    }
}


function updateVisualColors() {
    // Цвета градиента и линии обновятся автоматически при следующей отрисовке
    // в drawFrequency() и drawBars() через getComputedStyle.
     console.log("Visual colors will update on the next frame.");
}

function updateButtonStyles() {
    styleButtons.forEach(button => {
        const style = button.dataset.style;
        button.classList.toggle('active', style === currentStyle);
    });
}

function resizeCanvas() {
    // Проверяем, что canvas существуют
    if (!frequencyCanvas || !barsCanvas) return;

    const freqWidth = frequencyCanvas.offsetWidth;
    const freqHeight = frequencyCanvas.offsetHeight;
    const barsWidth = barsCanvas.offsetWidth;
    const barsHeight = barsCanvas.offsetHeight;

    // Устанавливаем размер только если он изменился, чтобы избежать лишних перерисовок
    if (frequencyCanvas.width !== freqWidth || frequencyCanvas.height !== freqHeight) {
        frequencyCanvas.width = freqWidth;
        frequencyCanvas.height = freqHeight;
        console.log("Frequency canvas resized to:", freqWidth, freqHeight);
    }
     if (barsCanvas.width !== barsWidth || barsCanvas.height !== barsHeight) {
        barsCanvas.width = barsWidth;
        barsCanvas.height = barsHeight;
        console.log("Bars canvas resized to:", barsWidth, barsHeight);
    }

    // Перерисовываем немедленно, если анимация активна
    if (playing && analyser && animationId) {
        drawFrequency();
        drawBars();
    }
}

// --- Инициализация при загрузке ---
document.addEventListener('DOMContentLoaded', () => {
     console.log("DOM Content Loaded. Initializing...");
     resizeCanvas(); // Устанавливаем начальные размеры canvas
     updateCurrentInfo(); // Устанавливаем начальную информацию о стиле
     updateButtonStyles(); // Устанавливаем начальную активную кнопку стиля
     muteBtn.textContent = isMuted ? '🔇' : '♫'; // Иконка Mute
     status.textContent = 'Ready'; // Начальный статус

     // Запускаем получение метаданных
     startMetadataUpdates();

     // Добавляем слушатель изменения видимости страницы для экономии ресурсов
     document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            // Если страница скрыта и играет музыка, можно остановить анимацию
            if (playing && animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
                console.log("Animation stopped due to page visibility change.");
            }
        } else {
            // Если страница стала видимой и играет музыка, возобновляем анимацию
            if (playing && !animationId && analyser) {
                console.log("Animation resumed due to page visibility change.");
                updateVisualizers();
            }
        }
     });

     // Отложенный вызов resize на случай, если размеры элементов устаканиваются не сразу
     setTimeout(resizeCanvas, 100);

     // Можно добавить обработчик 'resume' для AudioContext для надежности
     if (window.AudioContext) { // Проверка поддержки
         // (Не создаем контекст здесь, просто готовимся к его возможному появлению)
         // Можно добавить обработчик к document, который сработает при первом
         // взаимодействии пользователя и создаст/возобновит контекст заранее.
         // Например: document.body.addEventListener('click', ensureAudioContextOnce, { once: true });
     }
});

// Вызов resize при изменении размера окна
window.addEventListener('resize', resizeCanvas);

let audioElement;
let playing = false;
let audioContext;
let analyser;
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

const { ipcRenderer } = require('electron');

document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('close-window');
});

document.addEventListener('keydown', (event) => {
    // Предотвращаем действие для Tab и Ctrl + Shift + I
    if (event.key === 'Tab' || (event.ctrlKey && event.shiftKey && event.key === 'I') || event.key === ' ' || (event.ctrlKey && event.key === 'R') || (event.ctrlKey && event.shiftKey && event.key === 'R')) {
        event.preventDefault();
    }
});

// Default volume to 50%
let defaultVolume = 0.5;

playBtn.addEventListener('click', togglePlay);
muteBtn.addEventListener('click', toggleMute);

volumeBar.addEventListener('mousedown', startVolumeChange);
document.addEventListener('mousemove', changeVolume);
document.addEventListener('mouseup', stopVolumeChange);

let isChangingVolume = false;

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
    if (audioElement) {
        audioElement.volume = volume;
    }
    defaultVolume = volume;
    volumeControl.style.width = `${volume * 100}%`;
}

styleButtons.forEach(button => {
    button.addEventListener('click', (e) => {
        const newStyle = e.target.dataset.style;
        if (newStyle !== currentStyle) {
            document.body.className = newStyle;
            currentStyle = newStyle;
            styleButtons.forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            updateVisualColors();
            if (playing) {
                stopAudio();
                playAudio();
            }
            updateCurrentInfo();
            updateButtonStyles();
        }
    });
});

const sseUrl = 'https://nightride.fm/meta';
const eventSource = new EventSource(sseUrl);

eventSource.onmessage = (event) => {
    if (event.data !== "keepalive") {
        const data = JSON.parse(event.data);
        data.forEach(item => {
            metaInfo[item.station] = item;
        });
        updateCurrentInfo();
    }
};

function updateCurrentInfo() {
    const currentMeta = metaInfo[currentStyle];
    if (currentMeta) {
        const { artist, title, album } = currentMeta;
        currentInfo.textContent = `${artist} - ${title} (${album})`;
    } else {
        currentInfo.textContent = 'Loading track information...';
    }
}

function togglePlay() {
    if (playing) {
        pauseAudio();
    } else {
        playAudio();
    }
}

function playAudio() {
    stopAudio();

    audioElement = new Audio(`https://stream.nightride.fm/${currentStyle}.mp3`);
    audioElement.crossOrigin = "anonymous";
    audioElement.volume = defaultVolume;

    status.textContent = 'Connecting...';

    audioElement.addEventListener('canplay', () => {
        status.textContent = 'Now playing';
        playing = true;
        playBtn.textContent = '❚❚';
        setupAudioContext();
    });

    audioElement.addEventListener('error', (e) => {
        status.textContent = 'Connecting...';
        playing = false;
        playBtn.textContent = '▶';
    });

    audioElement.play().catch(error => {
        status.textContent = 'Connecting...';
        playing = false;
        playBtn.textContent = '▶';
    });
}

function pauseAudio() {
    if (audioElement) {
        audioElement.pause();
        status.textContent = 'Paused';
        playing = false;
        playBtn.textContent = '▶';
    }
}

function stopAudio() {
    if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
        audioElement.load();
        audioElement = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(error => {
            console.warn('Error closing AudioContext:', error);
        }).finally(() => {
            audioContext = null;
            analyser = null;
        });
    } else {
        audioContext = null;
        analyser = null;
    }
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    playing = false;
    playBtn.textContent = '▶';
}

function toggleMute() {
    if (audioElement) {
        audioElement.muted = !audioElement.muted;
        isMuted = audioElement.muted;
        muteBtn.textContent = isMuted ? '✖' : '♫';
    }
}

function setupAudioContext() {
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(error => {
            console.warn('Error closing existing AudioContext:', error);
        });
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();

    const source = audioContext.createMediaElementSource(audioElement);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    updateVisualizers();
}

function updateVisualizers() {
    drawFrequency();
    drawBars();
    animationId = requestAnimationFrame(updateVisualizers);
}

function drawFrequency() {
    const WIDTH = frequencyCanvas.width;
    const HEIGHT = frequencyCanvas.height;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    analyser.getByteFrequencyData(dataArray);
    const ctx = frequencyCanvas.getContext('2d');
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.lineWidth = 1;
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('color');
    ctx.beginPath();

    const sliceWidth = WIDTH * 1.0 / (bufferLength / 4);
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * HEIGHT / 2;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    ctx.lineTo(WIDTH, HEIGHT / 2);
    ctx.stroke();
}

function drawBars() {
    const WIDTH = barsCanvas.width;
    const HEIGHT = barsCanvas.height;
    const bufferLength = analyser.frequencyBinCount / 8;
    const dataArray = new Uint8Array(bufferLength);

    analyser.getByteFrequencyData(dataArray);
    const ctx = barsCanvas.getContext('2d');
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const barWidth = (WIDTH / bufferLength) * 2.5;
    let x = 0;

    const gradient = ctx.createLinearGradient(0, HEIGHT, 0, 0);
    gradient.addColorStop(0, getComputedStyle(document.body).getPropertyValue('color'));
    gradient.addColorStop(1, getComputedStyle(document.querySelector('#currentInfo')).getPropertyValue('color'));

    for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * HEIGHT;

        ctx.fillStyle = gradient;
        ctx.fillRect(x, HEIGHT - barHeight, barWidth, barHeight);

        x += barWidth + 1;
    }
}

function updateVisualColors() {
    drawFrequency();
    drawBars();
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
    frequencyCanvas.width = frequencyCanvas.offsetWidth;
    frequencyCanvas.height = frequencyCanvas.offsetHeight;
    barsCanvas.width = barsCanvas.offsetWidth;
    barsCanvas.height = barsCanvas.offsetHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
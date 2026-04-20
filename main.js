import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

const DOM = {
    video: document.getElementById('videoElement'),
    canvas: document.getElementById('canvasElement'),
    textInput: document.getElementById('textInput'),
    snapAndSendBtn: document.getElementById('snapAndSendBtn'),
    micBtn: document.getElementById('micBtn'),
    chatHistory: document.getElementById('chatHistory'),
    loading: document.getElementById('loadingIndicator'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    saveApiKeyBtn: document.getElementById('saveApiKeyBtn'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn')
};

let genAI = null;
let model = null;

// Initialization
function init() {
    const key = localStorage.getItem('gemini_api_key');
    if (key) {
        setupGenAI(key);
    } else {
        DOM.settingsModal.classList.remove('hidden');
    }

    startCamera();
    setupSpeech();
    setupEventListeners();
}

function setupGenAI(key) {
    genAI = new GoogleGenerativeAI(key);
    // Using gemini-2.5-flash-lite for better availability and faster response
    model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
}

// Camera Handling
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' }, 
            audio: false 
        });
        DOM.video.srcObject = stream;
    } catch (err) {
        console.error("Error accessing camera:", err);
        addMessage("System: Could not access camera. Please allow permissions.", 'ai');
    }
}

// Speech Recognition and Synthesis
let recognition = null;
let isListening = false;

function setupSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isListening = true;
            DOM.micBtn.classList.add('listening');
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            DOM.textInput.value = transcript;
            // Optionally auto-send if required, but lets wait for user to click send or we can trigger it
            handleSend();
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            stopListening();
        };

        recognition.onend = () => {
            stopListening();
        };
    } else {
        console.warn("Speech Recognition not supported in this browser.");
    }
}

function stopListening() {
    isListening = false;
    DOM.micBtn.classList.remove('listening');
}

function toggleListening() {
    if (!recognition) {
        alert("Speech recognition not supported in your browser.");
        return;
    }
    
    if (isListening) {
        recognition.stop();
    } else {
        recognition.start();
    }
}

function speak(text) {
    if ('speechSynthesis' in window) {
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        // Remove markdown asterisks for better speech output
        utterance.text = text.replace(/[*_~`#]/g, '');
        window.speechSynthesis.speak(utterance);
    }
}

// Picture & Chat Logic
async function handleSend() {
    if (!model) {
        DOM.settingsModal.classList.remove('hidden');
        return;
    }

    const textQuery = DOM.textInput.value.trim() || "What do you see in this picture?";
    DOM.textInput.value = '';

    // Show user message
    addMessage(textQuery, 'user');

    // Show loading
    DOM.loading.classList.remove('hidden');
    scrollToBottom();

    try {
        // Snap image
        const imgDataUrl = captureImage();
        
        // Prepare image for Gemini
        const base64Data = imgDataUrl.split(',')[1];
        const imageParts = [
            {
                inlineData: {
                    data: base64Data,
                    mimeType: "image/jpeg"
                }
            }
        ];

        // Ensure to pause speech out if generating new one
        if('speechSynthesis' in window) window.speechSynthesis.cancel();

        // Call Gemini API with retry logic
        const result = await generateContentWithRetry([textQuery, ...imageParts]);
        const responseText = result.response.text();
        
        // Output response
        addMessage(responseText, 'ai');
        speak(responseText);

    } catch (error) {
        console.error("Gemini Error:", error);
        addMessage(`Error: ${error.message}`, 'ai');
    } finally {
        DOM.loading.classList.add('hidden');
        scrollToBottom();
    }
}

async function generateContentWithRetry(parts, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await model.generateContent(parts);
        } catch (error) {
            if (error.message.includes('503') || error.message.includes('high demand')) {
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
                    console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }
            throw error; // Re-throw if not 503 or max retries reached
        }
    }
}

function captureImage() {
    const context = DOM.canvas.getContext('2d');
    DOM.canvas.width = DOM.video.videoWidth;
    DOM.canvas.height = DOM.video.videoHeight;
    context.drawImage(DOM.video, 0, 0, DOM.canvas.width, DOM.canvas.height);
    return DOM.canvas.toDataURL('image/jpeg', 0.8);
}

function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${sender}`;
    // Simple markdown to HTML for bold (only handles basic text for now)
    div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    DOM.chatHistory.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    DOM.chatHistory.parentElement.scrollTop = DOM.chatHistory.parentElement.scrollHeight;
}

// Event Listeners
function setupEventListeners() {
    DOM.snapAndSendBtn.addEventListener('click', handleSend);
    
    DOM.textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    DOM.micBtn.addEventListener('click', toggleListening);

    DOM.settingsBtn.addEventListener('click', () => {
        DOM.apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
        DOM.settingsModal.classList.remove('hidden');
    });

    DOM.closeSettingsBtn.addEventListener('click', () => {
        DOM.settingsModal.classList.add('hidden');
    });

    DOM.saveApiKeyBtn.addEventListener('click', () => {
        const key = DOM.apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem('gemini_api_key', key);
            setupGenAI(key);
            DOM.settingsModal.classList.add('hidden');
        } else {
            alert("Please enter a valid API key.");
        }
    });
}

// Start
document.addEventListener('DOMContentLoaded', init);

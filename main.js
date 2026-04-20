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

// Conversation history — stores text-only pairs to minimize tokens.
// Images are NOT stored in history (huge token cost); only the current frame is sent.
let conversationHistory = [];

// Max history turns to keep (older turns are dropped to save tokens)
const MAX_HISTORY_TURNS = 10;

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
    model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        systemInstruction: "You are a helpful vision assistant. Keep responses concise (1-3 sentences) unless the user asks for detail. You can see images from a camera feed. Reference previous conversation when relevant."
    });
    // Reset history when API key changes
    conversationHistory = [];
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
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
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
        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: "image/jpeg"
            }
        };

        // Cancel ongoing speech before generating new response
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();

        // Start a chat session with text-only history (no past images — saves tokens)
        const chat = model.startChat({ history: conversationHistory });

        // Send the current image + text as the new user message
        const result = await sendWithRetry(chat, [textQuery, imagePart]);
        const responseText = result.response.text();

        // Store ONLY text in history (images are excluded to minimize tokens)
        conversationHistory.push(
            { role: "user", parts: [{ text: textQuery }] },
            { role: "model", parts: [{ text: responseText }] }
        );

        // Trim history to keep token usage bounded
        if (conversationHistory.length > MAX_HISTORY_TURNS * 2) {
            conversationHistory = conversationHistory.slice(-MAX_HISTORY_TURNS * 2);
        }

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

async function sendWithRetry(chat, parts, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await chat.sendMessage(parts);
        } catch (error) {
            if (error.message.includes('503') || error.message.includes('high demand')) {
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }
            throw error;
        }
    }
}

function captureImage() {
    const context = DOM.canvas.getContext('2d');
    DOM.canvas.width = DOM.video.videoWidth;
    DOM.canvas.height = DOM.video.videoHeight;
    context.drawImage(DOM.video, 0, 0, DOM.canvas.width, DOM.canvas.height);
    // Lower quality to 0.6 to reduce base64 size and token usage
    return DOM.canvas.toDataURL('image/jpeg', 0.6);
}

function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${sender}`;
    // Simple markdown to HTML for bold
    div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    DOM.chatHistory.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    DOM.chatHistory.parentElement.scrollTop = DOM.chatHistory.parentElement.scrollHeight;
}

function clearChat() {
    conversationHistory = [];
    DOM.chatHistory.innerHTML = '';
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

    // Clear chat button
    const clearBtn = document.getElementById('clearChatBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearChat);
}

// Start
document.addEventListener('DOMContentLoaded', init);

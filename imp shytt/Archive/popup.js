document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('closeBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.close();
        });
    }

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessageFromPopup);
    }
});

function parsePhoneNumbers(input) {
    const normalized = input
        .split(',')
        .map((item) => item.replace(/[^0-9]/g, ''))
        .filter((item) => item.length >= 7 && item.length <= 15);
        
    return [...new Set(normalized)];
}

function updateStatus(message, color = 'black') {
    const announcerEl = document.getElementById('status-announcer');
    if (!announcerEl) return;

    // 1. Update visual styling and text
    announcerEl.style.color = color;
    announcerEl.textContent = message;

    // 2. Force Firefox Gecko to dispatch an AT-SPI focus event to Orca
    requestAnimationFrame(() => {
        announcerEl.focus();
    });
}

async function sendMessageFromPopup() {
    // 1. Fetch values
    const phoneInput = document.getElementById('phone');
    const messageInput = document.getElementById('message');

    if (!phoneInput || !messageInput) {
        updateStatus('Error: Inputs missing from popup.', 'red');
        return;
    }

    const phones = parsePhoneNumbers(phoneInput.value);
    const message = messageInput.value.trim();

    // 2. Validate inputs
    if (phones.length === 0 || !message) {
        updateStatus('Please enter at least one valid phone number (7-15 digits) and a message.', 'red');
        return;
    }

    updateStatus(`Sending ${phones.length} message(s)... Please wait.`, 'blue');

    // 3. Safe Chrome API Execution
    try {
        const api = typeof browser !== 'undefined' ? browser : chrome;

        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];

        if (!tab?.url?.includes('web.whatsapp.com')) {
            updateStatus('Please open WhatsApp Web in the active tab first.', 'red');
            return;
        }

        const response = await api.tabs.sendMessage(tab.id, {
            action: 'SEND_MESSAGE_BATCH',
            phones: phones,
            message: message
        });

        if (response && response.sent > 0) {
            const failedText = response.failedNumbers && response.failedNumbers.length > 0
                ? ` | Failed: ${response.failedNumbers.join(', ')}`
                : '';
            const finalColor = response.failedNumbers && response.failedNumbers.length > 0 ? 'orange' : 'green';
            updateStatus(`Sent ${response.sent} of ${phones.length}${failedText}`, finalColor);
        } else {
            updateStatus('Failed to send. Check WhatsApp Web tab.', 'red');
        }
    } catch (error) {
        console.error('Messaging failed:', error);
        updateStatus('Could not connect to WhatsApp tab. Refresh WhatsApp and try again.', 'red');
    }
}
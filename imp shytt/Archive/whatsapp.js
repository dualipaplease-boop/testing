async function openWhatsAppChat(phoneNumber) {
    appendLog(`Starting chat open flow for ${phoneNumber}`);

    // Combined selectors for new chat button from both scripts
    const newChatSelectors = [
        'button[aria-label="New chat"]',
        'button[data-tab="2"][aria-label="New chat"]',
        'span[data-testid="new-chat-outline"]',
        'span[data-icon="new-chat-outline"]',
        'div[title="New chat"]',
        'button span[data-testid="new-chat-outline"]',
        'button span[data-icon="new-chat-outline"]'
    ];

    const newChatElement = await waitForElement(newChatSelectors, 5000);
    const actualButton = newChatElement?.closest('button') || newChatElement;

    if (!actualButton) {
        logError('New chat button not found.', 'Missing button');
        return false;
    }

    await waitRandomDelay(20_000, 30_000);
    actualButton.click();
    appendLog('Clicked new chat button');

    // Combined selectors for search input from both scripts
    const searchSelectors = [
        'input[aria-label="Search name or number"]',
        'input[role="textbox"][aria-label="Search name or number"]',
        'input[aria-label="Search or start a new chat"]',
        'input[placeholder="Search or start a new chat"]',
        'input[role="textbox"][aria-label="Search or start a new chat"]',
        'div[contenteditable="true"][role="textbox"]',
        'input[role="textbox"][aria-label*="Search"]'
    ];

    const searchInput = await waitForElement(searchSelectors, 6000);

    if (!searchInput) {
        logError('Search input missing after waiting.', 'Timeout waiting for search input');
        return false;
    }

    await waitRandomDelay(20_000, 30_000);
    searchInput.focus();

    if (searchInput.tagName === 'INPUT') {
        changeReactInputState(searchInput, phoneNumber);
    } else {
        // Contenteditable search box handling
        document.execCommand('insertText', false, phoneNumber);
        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: phoneNumber }));
    }

    appendLog(`Set phone number in search input: ${phoneNumber}`);

    await waitRandomDelay(20_000, 30_000);
    pressKey(searchInput, 'Enter');
    appendLog('Pressed Enter in the search input');

    return true;
}
async function writeMessage(message) {
    appendLog(`Starting message write for: ${message}`);

    const composeSelectors = [
        'div[data-testid="conversation-compose-box-input"][contenteditable="true"]',
        'div[data-testid="conversation-compose-box-input"]',
        'div[role="textbox"][contenteditable="true"][aria-placeholder="Type a message"]',
        'div[contenteditable="true"][aria-placeholder*="Type a message"]',
        'div[contenteditable="true"][data-tab="10"]'
    ];

    const box = await waitForElement(composeSelectors, 6000);

    if (!box) {
        logError('Message box not found. Chat did not load.', 'Missing compose box');
        return false;
    }

    await waitRandomDelay(20_000, 30_000);
    box.focus();

    // 1. Insert text into DOM
    document.execCommand('insertText', false, message);

    // 2. Notify React/Lexical of the change without passing 'data' (prevents double insertion)
    // box.dispatchEvent(new Event('input', { bubbles: true }));

    appendLog('Inserted message text into compose box');
    return true;
}

async function sendMessage(composeBox) {
    appendLog('Preparing to send the message');

    // Combined selectors for send button from both scripts
    const sendBtnSelectors = [
        'button[aria-label="Send"]',
        'span[data-icon="wds-ic-send-filled"]',
        'span[data-icon="send"]',
        'button span[data-icon="send"]'
    ];

    const sendBtn = await waitForElement(sendBtnSelectors, 4000);
    const actualSendBtn = sendBtn?.closest('button') || sendBtn;

    await waitRandomDelay(20_000, 30_000);

    if (actualSendBtn) {
        actualSendBtn.click();
        appendLog('Clicked send button');
        return true;
    }

    // Fallback submission via KeyboardEvent if Send button is hidden
    if (composeBox) {
        appendLog('Send button not found. Falling back to Enter key press in compose box.');
        pressKey(composeBox, 'Enter');
        return true;
    }

    logError('Send button not found and no compose box provided for fallback.', 'Missing send trigger');
    return false;
}

async function handleWhatsAppBatchMessage({ phones, message }) {
    const results = { sent: 0, failed: 0, failedNumbers: [] };
    let i = 0;

    while (i < phones.length) {
        const phone = phones[i];
        appendLog(`Batch: processing ${i + 1}/${phones.length} -> ${phone}`);

        const result = await handleWhatsAppMessage({ phone, message });

        if (result && result.success) {
            results.sent += 1;
        } else {
            results.failed += 1;
            results.failedNumbers.push(phone);
        }

        i += 1;
    }

    appendLog(`Batch done: sent=${results.sent}, failed=${results.failed}`);
    return results;
}

async function handleWhatsAppMessage({ phone, message }) {
    appendLog(`Popup requested SEND_MESSAGE for ${phone}`);

    try {
        const opened = await openWhatsAppChat(phone);
        if (!opened) {
            appendLog('Chat open flow failed.');
            return { success: false };
        }

        const wrote = await writeMessage(message);
        if (!wrote) {
            appendLog('Write-message step failed.');
            return { success: false };
        }

        // Re-query or pass compose box as fallback trigger for sendMessage
        const composeBox = document.querySelector('div[contenteditable="true"]');
        const sent = await sendMessage(composeBox);
        appendLog(`Final send result = ${sent}`);
        return { success: sent };
    } catch (error) {
        logError('Unexpected send flow error.', error);
        return { success: false };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SEND_MESSAGE_BATCH') {
        handleWhatsAppBatchMessage(request).then((result) => {
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'SEND_MESSAGE') {
        handleWhatsAppMessage(request).then((result) => {
            sendResponse(result);
        });
        return true;
    }
});
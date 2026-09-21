// Alternating live region state for the content script.
// Two regions, alternating which one holds text — forces SR re-announcement
// of identical messages (same pattern as react-aria-live's double announcer).
let contentAnnouncerIndex = 0;

function ensureStatusAnnouncers() {
    let primary = document.getElementById('wab-ext-status-announcer');
    let secondary = document.getElementById('wab-ext-status-announcer-2');
    
    if (!primary) {
        primary = document.createElement('div');
        primary.id = 'wab-ext-status-announcer';
        primary.setAttribute('role', 'status');
        primary.setAttribute('aria-live', 'polite');
        primary.setAttribute('aria-atomic', 'true');
        primary.style.position = 'fixed';
        primary.style.width = '1px';
        primary.style.height = '1px';
        primary.style.padding = '0';
        primary.style.margin = '-1px';
        primary.style.overflow = 'hidden';
        primary.style.clip = 'rect(0 0 0 0)';
        primary.style.whiteSpace = 'nowrap';
        primary.style.border = '0';
        if (document.body) {
            document.body.appendChild(primary);
        } else {
            document.documentElement.appendChild(primary);
        }
    }
    
    if (!secondary) {
        secondary = document.createElement('div');
        secondary.id = 'wab-ext-status-announcer-2';
        secondary.setAttribute('role', 'status');
        secondary.setAttribute('aria-live', 'polite');
        secondary.setAttribute('aria-atomic', 'true');
        secondary.style.position = 'fixed';
        secondary.style.width = '1px';
        secondary.style.height = '1px';
        secondary.style.padding = '0';
        secondary.style.margin = '-1px';
        secondary.style.overflow = 'hidden';
        secondary.style.clip = 'rect(0 0 0 0)';
        secondary.style.whiteSpace = 'nowrap';
        secondary.style.border = '0';
        if (document.body) {
            document.body.appendChild(secondary);
        } else {
            document.documentElement.appendChild(secondary);
        }
    }
    
    return { primary, secondary };
}

let contentLastAnnouncedKey = '';

/**
 * Mirror the status message back to the popup's own live region.
 * This covers the case where the popup is still open and has OS focus,
 * which causes Orca to ignore the WhatsApp tab's live region.
 * Errors are silently swallowed — the popup may already be closed.
 */
function mirrorStatusToPopup(message) {
    // sendMessage returns a Promise. We must .catch() it — try/catch only
    // catches synchronous throws, not async rejections. The popup may be
    // closed, in which case the rejection is expected and should be ignored.
    chrome.runtime.sendMessage({ action: 'WAB_STATUS_UPDATE', message: message })
        .catch(() => {
            // Popup is closed or no listener — expected, not an error.
        });
}

function announceAccessibleStatus(state) {
    const { primary: announcer, secondary: announcer2 } = ensureStatusAnnouncers();
    let message = '';
    
    const isPlural = state.total !== 1;
    const msgWord = isPlural ? 'messages' : 'message';
    
    if (state.state === 'sending') {
        message = `Sending ${state.total} ${msgWord}. Please wait.`;
    } else if (state.state === 'success') {
        message = `All ${state.total} ${msgWord} have been sent successfully.`;
    } else if (state.state === 'partial') {
        message = `Message sending completed. ${state.sent} of ${state.total} messages were sent successfully. ${state.failed} failed.`;
    } else if (state.state === 'error') {
        message = `Message sending failed. 0 of ${state.total} messages were sent.`;
    }

    const dedupKey = `${state.operationId}:${message}`;

    if (message && dedupKey !== contentLastAnnouncedKey) {
        // Determine which region is active this round (alternating pattern)
        const active = contentAnnouncerIndex % 2 === 0 ? announcer : announcer2;
        const inactive = contentAnnouncerIndex % 2 === 0 ? announcer2 : announcer;
        
        active.textContent = '';
        if (inactive) inactive.textContent = '';
        
        setTimeout(() => {
            active.textContent = message;
        }, 100);
        
        contentLastAnnouncedKey = dedupKey;
        contentAnnouncerIndex++;
        mirrorStatusToPopup(message);
        
        appendLog(`Live region announced: "${message}"`);
    } else {
        appendLog(`Skipped duplicate announcement: "${message}"`);
    }
}

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

    // Try once, then retry if not found
    for (let attempt = 0; attempt < 2; attempt++) {
        const newChatElement = await waitForElement(newChatSelectors, 15000);
        const actualButton = newChatElement?.closest('button') || newChatElement;

        if (actualButton) {
            await waitRandomDelay(20_000, 30_000);
            actualButton.click();
            appendLog('Clicked new chat button');
            break; // Continue to the search logic below instead of exiting
        }

        if (attempt === 0) {
            appendLog('New chat button not found, retrying...');
            await waitRandomDelay(5000, 10000);
        } else {
            logError('New chat button not found after retry.', 'Missing button');
            return false;
        }
    }

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

    const box = await waitForElement(composeSelectors, 15000);

    if (!box) {
        logError('Message box not found. Chat did not load.', 'Missing compose box');
        return false;
    }

    await waitRandomDelay(20_000, 30_000);
    box.focus();
    // Insert text into compose box (React/Lexical-compatible approach)
    document.execCommand('insertText', false, message);

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

async function handleWhatsAppBatchMessage({ phones, message, operationId }) {
    // Guard: detect stale extension context (happens when extension is reloaded
    // while a previous content-script operation is still running).
    if (!chrome.runtime?.id) {
        console.error('Extension context invalidated — content script is stale. Refresh WhatsApp Web.');
        return { sent: 0, failed: phones.length, failedNumbers: phones };
    }

    const total = phones.length;
    appendLog(`SEND_MESSAGE_BATCH received`);

    announceAccessibleStatus({ operationId, state: 'sending', total: total });

    const announcer = document.getElementById('wab-ext-status-announcer');
    if (!announcer || !document.body?.contains(announcer)) {
        appendLog('Warning: status announcer element not found or not in body');
    }

    const results = { sent: 0, failed: 0, failedNumbers: [] };
    let i = 0;

    while (i < phones.length) {
        const phone = phones[i];
        if (chrome.runtime?.id) appendLog(`Batch: processing ${i + 1}/${phones.length} -> ${phone}`);

        const result = await handleWhatsAppMessage({ phone, message });

        if (result && result.success) {
            results.sent += 1;
        } else {
            results.failed += 1;
            results.failedNumbers.push(phone);
        }

        i += 1;
    }

    if (chrome.runtime?.id) appendLog(`Batch done: sent=${results.sent}, failed=${results.failed}`);

    const finalState = results.failed === 0 ? 'success' : (results.sent > 0 ? 'partial' : 'error');
    announceAccessibleStatus({
        operationId,
        state: finalState, 
        total: total, 
        sent: results.sent, 
        failed: results.failed 
    });
    // STEP 13: final response will be sent back to popup via sendResponse in the message listener
    if (chrome.runtime?.id) appendLog(`Final status announced: ${finalState}`);

    // Store the batch result for status tracking (guard against invalidated context)
    if (chrome.runtime?.id) {
        try {
            const api = typeof browser !== 'undefined' ? browser : chrome;
            const batchResult = {
                timestamp: new Date().toISOString(),
                sent: results.sent,
                failed: results.failed,
                failedNumbers: results.failedNumbers
            };
            api.storage.local.set({ 'wab_ext_last_batch': batchResult });
        } catch (error) {
            console.error('Failed to store batch result:', error);
        }
    }
    
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

/**
 * Message listener that responds to popup commands
 * Also logs all incoming requests for debugging
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    appendLog(`Message received: action=${request.action}, sender=${sender.url}`);
    
    if (request.action === 'SEND_MESSAGE_BATCH') {
        handleWhatsAppBatchMessage(request).then((result) => {
            appendLog(`Sending batch response: sent=${result.sent}, failed=${result.failed}`);
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'PING') {
        sendResponse({ ready: true });
        return true;
    }

    if (request.action === 'SEND_MESSAGE') {
        handleWhatsAppMessage(request).then((result) => {
            appendLog(`Sending single message response: success=${result.success}`);
            sendResponse(result);
        });
        return true;
    }
    
    if (request.action === 'INJECT_STATUS_ANNOUNCERS') {
        // Status announcers already initialized on script load,
        // but acknowledge the re-injection signal
        appendLog('Status announcers re-initialized via message');
        return true;
    }
    
    // Log unknown actions
    appendLog(`Unknown action received: ${request.action}`);
});

// Log when content script loads
appendLog('WhatsApp content script loaded and ready for messages');

// Create the live regions immediately when the content script initializes
ensureStatusAnnouncers();

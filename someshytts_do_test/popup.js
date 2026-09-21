// Global flag to track if all updates have been processed
let updateCheckComplete = false;

// Alternating live region indices — mirrors the react-aria-live double-region pattern.
// When we have two regions and alternate which one holds the text, screen readers
// are forced to re-announce even when the same message text is set again.
const ALTERNATING_REGIONS = {
    polite: { primary: 'status-announcer', secondary: 'status-announcer-2', index: 0 },
    assertive: { primary: 'update-announcer', secondary: 'update-announcer-2', index: 0 }
};

let currentOperationState = {
    id: null,
    state: 'idle', // 'idle' | 'sending' | 'success' | 'partial' | 'error'
    total: 0,
    sent: 0,
    failed: 0,
    message: ''
};

function announceStatus(state) {
    const region = ALTERNATING_REGIONS.polite;
    const primaryId = region.index % 2 === 0 ? region.primary : region.secondary;
    const secondaryId = region.index % 2 === 0 ? region.secondary : region.primary;
    
    const announcerEl = document.getElementById(primaryId);
    const secondaryEl = document.getElementById(secondaryId);
    if (!announcerEl) return;
    
    let message = '';
    let color = 'black';
    
    if (state.state === 'sending') {
        const total = state.total || 0;
        const word = total === 1 ? 'message' : 'messages';
        message = `Sending ${total} ${word}. Please wait.`;
        color = 'blue';
    } else if (state.state === 'success') {
        const count = state.sent || state.total || 0;
        const word = count === 1 ? 'message was' : 'messages were';
        message = `Sending complete. All ${count} ${word} sent successfully.`;
        color = 'green';
    } else if (state.state === 'partial') {
        const sentWord = state.sent === 1 ? 'message was' : 'messages were';
        message = `Sending complete. ${state.sent} ${sentWord} sent successfully. ${state.failed} failed.`;
        color = 'orange';
    } else if (state.state === 'error') {
        message = state.message || 'Sending failed. No messages were sent.';
        color = 'red';
    } else if (state.state === 'idle') {
        message = state.message || 'Ready.';
        color = 'black';
    } else if (state.state === 'info') {
        message = state.message;
        color = state.color || 'blue';
    }

    // Update visual styling on primary
    announcerEl.style.color = color;
    
    // For aria-live regions, clear first then set after 100ms so the AT
    // registers the change as a distinct event (same pattern as whatsapp.js).
    // Clear BOTH regions to ensure clean state, then set on primary only.
    announcerEl.textContent = '';
    if (secondaryEl) secondaryEl.textContent = '';
    
    setTimeout(() => {
        announcerEl.textContent = message;
        // Flip the alternating index so next call uses the other region.
        // This forces screen readers to re-announce even identical messages.
        region.index++;
    }, 100);

    // Also update the visible #status element for sighted users
    const visibleStatus = document.getElementById('status');
    if (visibleStatus) {
        visibleStatus.textContent = message;
        visibleStatus.style.color = color;
    }
}

/**
 * Check for updates from backend before proceeding with any action
 * This runs on popup load and must complete before extension starts working
 */
async function checkForUpdatesOnLoad() {
    const announcerEl = document.getElementById('status-announcer');
    
    try {
        // No backend — just read the status that background.js wrote to storage.
        // Do not show a transient 'Checking...' message; it causes unnecessary noise
        // and masks the real ready state during the brief storage read.
        const status = await getUpdateStatus();
        
        if (status.hasUpdate) {
            // There is an update available
            currentOperationState = {
                id: Date.now(),
                state: 'info',
                message: `Update available${status.message ? ': ' + status.message : ''}. Please update the extension and restart.`,
                color: 'orange'
            };
            announceStatus(currentOperationState);
            
            // Disable send button until update is handled
            const sendBtn = document.getElementById('sendBtn');
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.setAttribute('aria-disabled', 'true');
            }
            
            appendLog('Extension update available. Send button disabled.');
            return false;
        } else {
            // Default idle state (no need to recover state here since whatsapp.js handles the screen reader native announcement)
            currentOperationState = {
                id: 'idle_' + Date.now(),
                state: 'idle',
                message: 'WhatsApp message sender is ready.'
            };
            announceStatus(currentOperationState);
            
            appendLog('Update check complete. No updates available.');
            return true;
        }
    } catch (error) {
        console.error('Error checking updates:', error);
        appendLog(`Update check error: ${error.message}`);
        // Continue anyway if update check fails
        currentOperationState = { id: Date.now(), state: 'idle', message: 'WhatsApp message sender is ready.' };
        announceStatus(currentOperationState);
        return true;
    }
}

/**
 * Initialize popup and check updates first
 */
async function initializePopup() {
    updateCheckComplete = false;
    
    // First, check for updates
    const canProceed = await checkForUpdatesOnLoad();
    updateCheckComplete = true;

    // Focus the phone input after the ready announcement has been queued,
    // so the screen reader announces the ready message first, then the input.
    if (canProceed) {
        setTimeout(() => {
            const phoneInput = document.getElementById('phone');
            if (phoneInput) phoneInput.focus();
        }, 200);
    }
}


document.addEventListener('DOMContentLoaded', () => {
    // Initialize popup with update check
    initializePopup();
    
    const closeBtn = document.getElementById('closeBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.close();
        });
    }

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', async () => {
            // Only allow sending if update check is complete and no updates pending
            if (!updateCheckComplete) {
                updateStatus('Please wait while the extension initializes.', 'blue');
                return;
            }
            
            // Check one more time before sending
            const status = await getUpdateStatus();
            if (status.hasUpdate) {
                updateStatus('An extension update is required. Please update and restart before sending.', 'red');
                return;
            }
            
            await sendMessageFromPopup();
        });
    }
});

/**
 * Ensure content scripts are injected into the active tab.
 * Uses MV3 scripting.executeScript instead of the deprecated tabs.executeScript.
 */
async function ensureContentScriptInjected(tabId) {
    try {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        
        // Inject utility and content scripts into the tab using MV3 API
        await api.scripting.executeScript({
            target: { tabId: tabId },
            files: ['utils.js']
        });
        
        await api.scripting.executeScript({
            target: { tabId: tabId },
            files: ['whatsapp.js']
        });
        
        return true;
    } catch (err) {
        console.error('Content script injection error:', err);
        return false;
    }
}

function parsePhoneNumbers(input) {
    const normalized = input
        .split(',')
        .map((item) => item.replace(/[^0-9]/g, ''))
        .filter((item) => item.length >= 7 && item.length <= 15);
        
    return [...new Set(normalized)];
}

/**
 * Update status message (wrapper for announceStatus for legacy calls)
 */
function updateStatus(message, color = 'black') {
    currentOperationState = {
        id: Date.now(),
        state: 'info',
        message: message,
        color: color
    };
    announceStatus(currentOperationState);
}

async function sendMessageFromPopup() {
    // 1. Fetch values
    const phoneInput = document.getElementById('phone');
    const messageInput = document.getElementById('message');

    if (!phoneInput || !messageInput) {
        updateStatus('Unable to find the input fields. Please try reopening the extension.', 'red');
        appendLog('Error: Input elements not found in popup');
        return;
    }

    const phones = parsePhoneNumbers(phoneInput.value);
    const message = messageInput.value.trim();

    // 2. Validate inputs
    if (phones.length === 0 || !message) {
        currentOperationState = { id: Date.now(), state: 'error', message: 'Please enter at least one valid phone number and a message.' };
        announceStatus(currentOperationState);
        return;
    }

    const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    currentOperationState = {
        id: operationId,
        state: 'sending',
        total: phones.length,
        sent: 0,
        failed: 0,
        message: ''
    };
    
    announceStatus(currentOperationState);

    // 3. Safe Chrome API Execution
    try {
        const api = typeof browser !== 'undefined' ? browser : chrome;

        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];

        if (!tab?.url?.includes('web.whatsapp.com')) {
            updateStatus('Please open WhatsApp Web in the active tab first.', 'red');
            appendLog('WhatsApp Web tab not found');
            return;
        }

        // Readiness handshake (Ping)
        let isReady = false;
        try {
            const pingResp = await api.tabs.sendMessage(tab.id, { action: 'PING' });
            if (pingResp && pingResp.ready) isReady = true;
        } catch (e) {
            // Expected when content script is not yet injected into the tab.
        }

        // Inject if not ready (handles pre-existing tabs)
        if (!isReady) {
            updateStatus('Connecting to WhatsApp Web...', 'blue');
            const injected = await ensureContentScriptInjected(tab.id);
            if (!injected) {
                currentOperationState = { id: currentOperationState.id, state: 'error', message: 'Unable to connect to WhatsApp Web. Please refresh the tab and try again.' };
                announceStatus(currentOperationState);
                return;
            }
            // Brief wait for script initialization
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const response = await api.tabs.sendMessage(tab.id, {
            action: 'SEND_MESSAGE_BATCH',
            operationId: operationId,
            phones: phones,
            message: message
        });

        if (response && (response.sent > 0 || response.failed > 0)) {
            currentOperationState = {
                id: currentOperationState.id,
                state: response.failedNumbers && response.failedNumbers.length > 0 ? (response.sent > 0 ? 'partial' : 'error') : 'success',
                sent: response.sent,
                failed: response.failed,
                message: ''
            };
            announceStatus(currentOperationState);
            appendLog(`Messages sent successfully: ${response.sent}/${phones.length}`);
        } else {
            currentOperationState = { id: currentOperationState.id, state: 'error', message: 'Unable to send the messages. Please check that WhatsApp Web is open and try again.' };
            announceStatus(currentOperationState);
            appendLog('Message sending failed: No response from content script');
        }
    } catch (error) {
        console.error('Messaging failed:', error);
        appendLog(`Messaging error: ${error.message}`);
        
        currentOperationState = { id: currentOperationState.id, state: 'error', message: 'Unable to reach the WhatsApp tab. Please refresh WhatsApp Web and try again.' };
        announceStatus(currentOperationState);
    }
}

/**
 * Receive status updates mirrored from whatsapp.js.
 * This ensures Orca can announce the status while the popup has OS focus,
 * since Orca ignores live-region events from unfocused windows (the WhatsApp tab).
 */
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'WAB_STATUS_UPDATE' && request.message) {
        // Mirror the status from whatsapp.js content script.
        // Orca ignores live-region events from unfocused windows (the WhatsApp tab),
        // so we mirror to the popup's own live region.
        const region = ALTERNATING_REGIONS.polite;
        const primaryId = region.index % 2 === 0 ? region.primary : region.secondary;
        const secondaryId = region.index % 2 === 0 ? region.secondary : region.primary;
        
        const announcerEl = document.getElementById(primaryId);
        const secondaryEl = document.getElementById(secondaryId);
        
        if (announcerEl) {
            announcerEl.textContent = '';
            if (secondaryEl) secondaryEl.textContent = '';
            setTimeout(() => {
                announcerEl.textContent = request.message;
                region.index++;
            }, 100);
        }

        // Also update the visible #status element for sighted users
        const visibleStatus = document.getElementById('status');
        if (visibleStatus) {
            visibleStatus.textContent = request.message;
        }
    }
});

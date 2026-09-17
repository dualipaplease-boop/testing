// Global flag to track if all updates have been processed
let updateCheckComplete = false;
let pendingMessages = [];

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
let lastAnnouncedMessage = '';

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
        message = `Sending ${total} message(s)... Please wait.`;
        color = 'blue';
    } else if (state.state === 'success') {
        message = `All messages have been sent successfully. Extension is ready to use.`;
        color = 'green';
    } else if (state.state === 'partial') {
        message = `Message sending completed. ${state.sent} sent successfully, ${state.failed} failed.`;
        color = 'orange';
    } else if (state.state === 'error') {
        message = state.message || `Message sending failed. No messages were sent.`;
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
    lastAnnouncedMessage = message;
    console.log(`[Status Update] ${message} (${color})`);
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
                message: `📢 Update Available: ${status.message}. Please update the extension and restart.`,
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
                message: '✓ All messages synced. Extension ready.'
            };
            announceStatus(currentOperationState);
            
            appendLog('Update check complete. No updates available.');
            return true;
        }
    } catch (error) {
        console.error('Error checking updates:', error);
        appendLog(`Update check error: ${error.message}`);
        // Continue anyway if update check fails
        currentOperationState = { id: Date.now(), state: 'info', message: 'Ready (update check skipped)', color: 'blue' };
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
    
    // Process any pending message sends
    if (canProceed && pendingMessages.length > 0) {
        for (const msgData of pendingMessages) {
            await sendMessageFromPopup();
        }
        pendingMessages = [];
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
            // STEP 1: Send button clicked
            console.log('[DIAG] Step 1: Send button clicked');

            // Only allow sending if update check is complete and no updates pending
            if (!updateCheckComplete) {
                updateStatus('Please wait for update check to complete...', 'blue');
                return;
            }
            
            // Check one more time before sending
            const status = await getUpdateStatus();
            if (status.hasUpdate) {
                updateStatus('Cannot send: Extension update required. Please update and restart.', 'red');
                return;
            }
            
            await sendMessageFromPopup();
        });
    }
});

/**
 * Shared screen reader announcement utility.
 * Creates a live region announcement in a consistent way across the extension.
 * 
 * @param {string} text - The message to announce
 * @param {string} [priority='polite'] - 'polite' or 'assertive'
 * 
 * Uses the alternating region pattern from react-aria-live to force
 * re-announcement of identical messages.
 */
function notifySreenReader(text, priority) {
    priority = priority || 'polite';
    const region = priority === 'assertive'
        ? ALTERNATING_REGIONS.assertive
        : ALTERNATING_REGIONS.polite;
    
    const primaryId = region.index % 2 === 0 ? region.primary : region.secondary;
    const secondaryId = region.index % 2 === 0 ? region.secondary : region.primary;
    
    const announcerEl = document.getElementById(primaryId);
    const secondaryEl = document.getElementById(secondaryId);
    
    if (!announcerEl) return;
    
    announcerEl.textContent = '';
    if (secondaryEl) secondaryEl.textContent = '';
    
    setTimeout(() => {
        announcerEl.textContent = text;
        region.index++;
    }, 100);
    console.log(`[SR Announce] (${priority}) ${text}`);
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
        updateStatus('Error: Inputs missing from popup.', 'red');
        appendLog('Error: Input elements not found in popup');
        return;
    }

    const phones = parsePhoneNumbers(phoneInput.value);
    const message = messageInput.value.trim();

    // 2. Validate inputs
    if (phones.length === 0 || !message) {
        currentOperationState = { id: Date.now(), state: 'error', message: 'Please enter at least one valid phone number (7-15 digits) and a message.' };
        announceStatus(currentOperationState);
        return;
    }

    const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    // STEP 1: popup Send handler started
    // STEP 2: operationId created
    console.log('[DIAG] Step 1+2: sendMessageFromPopup starting. operationId =', operationId);

    currentOperationState = {
        id: operationId,
        state: 'sending',
        total: phones.length,
        sent: 0,
        failed: 0,
        message: ''
    };
    
    console.log(`[STATUS DEBUG] operation started. ID: ${operationId}`);
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

        console.log('[STATUS TRACE] popup: preparing SEND_MESSAGE_BATCH', {
            phones,
            message
        });
        // STEP 3: popup sends SEND_MESSAGE_BATCH to content script
        console.log('[DIAG] Step 3: calling tabs.sendMessage SEND_MESSAGE_BATCH to tab', tab.id);
        console.log('[STATUS TRACE] popup: sending SEND_MESSAGE_BATCH');
        const response = await api.tabs.sendMessage(tab.id, {
            action: 'SEND_MESSAGE_BATCH',
            operationId: operationId,
            phones: phones,
            message: message
        });
        console.log('[STATUS TRACE] popup: content script response', response);

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
            currentOperationState = { id: currentOperationState.id, state: 'error', message: 'Failed to send. Check WhatsApp Web tab.' };
            announceStatus(currentOperationState);
            appendLog('Message sending failed: No response from content script');
        }
    } catch (error) {
        console.error('[STATUS TRACE] popup: sendMessage failed', error);
        console.error('Messaging failed:', error);
        appendLog(`Messaging error: ${error.message}`);
        
        // 'Receiving end does not exist' means whatsapp.js is not injected.
        // This happens when WhatsApp Web was open BEFORE the extension was
        // loaded/reloaded. Content scripts only inject into tabs opened after
        // the extension is active. Refreshing WhatsApp Web fixes it.
        const isNotInjected = error.message?.includes('Receiving end does not exist') ||
                              error.message?.includes('Could not establish connection');
        const errMsg = isNotInjected
            ? 'Content script not found. Please refresh the WhatsApp Web tab and try again.'
            : 'Could not connect to WhatsApp tab. Refresh WhatsApp and try again.';
        
        currentOperationState = { id: currentOperationState.id, state: 'error', message: errMsg };
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
    }
});

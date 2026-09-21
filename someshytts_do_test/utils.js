const LOG_KEY = 'wab_ext_logs';
const UPDATE_KEY = 'wab_ext_update_status';
const STORAGE_LIMIT = 5242880; // 5MB limit for storage
const LOG_RETENTION_DAYS = 7; // Keep logs for 7 days

/**
 * Track and manage Chrome storage usage
 * Returns current storage usage in bytes
 */
async function getStorageUsage() {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (allItems) => {
            try {
                const usage = JSON.stringify(allItems).length;
                resolve(usage);
            } catch (error) {
                console.error('Error calculating storage usage:', error);
                resolve(0);
            }
        });
    });
}

/**
 * Clean up old logs based on retention period
 */
function cleanupOldLogs() {
    const api = typeof browser !== 'undefined' ? browser : chrome;
    const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoffTime = new Date(Date.now() - retentionMs).toISOString();

    api.storage.local.get({ [LOG_KEY]: [] }, (result) => {
        const logs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
        const filteredLogs = logs.filter(log => {
            const timestamp = log.split(' | ')[0];
            return timestamp > cutoffTime;
        });

        if (filteredLogs.length < logs.length) {
            api.storage.local.set({ [LOG_KEY]: filteredLogs });
        }
    });
}

/**
 * Set update status - call this when an update is available
 * @param {boolean} hasUpdate - Whether there's an update available
 * @param {string} updateMessage - Message about the update
 */
async function setUpdateStatus(hasUpdate, updateMessage = '') {
    return new Promise((resolve) => {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        const statusData = {
            hasUpdate: hasUpdate,
            message: updateMessage,
            timestamp: new Date().toISOString(),
            extensionVersion: '1.0'
        };

        api.storage.local.set({ [UPDATE_KEY]: statusData }, () => {
            appendLog(`Update status set: hasUpdate=${hasUpdate}, message=${updateMessage}`);
            resolve(statusData);
        });
    });
}

/**
 * Get update status - call this from popup before proceeding
 * @returns {Promise<Object>} Status object with hasUpdate, message, timestamp
 */
async function getUpdateStatus() {
    return new Promise((resolve) => {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        api.storage.local.get({ [UPDATE_KEY]: null }, (result) => {
            const status = result[UPDATE_KEY] || {
                hasUpdate: false,
                message: '',
                timestamp: new Date().toISOString()
            };
            resolve(status);
        });
    });
}

/**
 * Clear update status after user reads it
 */
async function clearUpdateStatus() {
    return new Promise((resolve) => {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        api.storage.local.remove([UPDATE_KEY], () => {
            appendLog('Update status cleared');
            resolve();
        });
    });
}

/**
 * Check storage and warn if approaching limit
 */
async function checkStorageWarning() {
    const usage = await getStorageUsage();
    const percentUsed = (usage / STORAGE_LIMIT) * 100;

    if (percentUsed > 80) {
        appendLog(`WARNING: Storage usage at ${percentUsed.toFixed(2)}%`);
        cleanupOldLogs();
    }

    return {
        usedBytes: usage,
        limitBytes: STORAGE_LIMIT,
        percentUsed: percentUsed
    };
}

function appendLog(message) {
    const entry = `${new Date().toISOString()} | ${message}`;
    console.log(entry);
    try {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        api.storage.local.get({ [LOG_KEY]: [] }, (result) => {
            const logs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
            logs.push(entry);
            
            // Keep only recent logs to avoid storage bloat
            const recentLogs = logs.slice(-1000); // Keep last 1000 entries
            
            api.storage.local.set({ [LOG_KEY]: recentLogs });
        });
    } catch (error) {
        console.error('Unable to persist log entry:', error);
    }
}

function logError(context, error) {
    appendLog(`${context}: ${error?.message || String(error)}`);
    console.error(context, error);
}

function waitRandomDelay(minDelay = 20_000, maxDelay = 30_000) {
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    return new Promise((resolve) => setTimeout(resolve, delay));
}

function waitForElement(selectors, timeout = 15000) {
    const selectorString = Array.isArray(selectors) ? selectors.join(', ') : selectors;

    return new Promise((resolve) => {
        const existing = document.querySelector(selectorString);
        if (existing) return resolve(existing);

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selectorString);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

function changeReactInputState(input, value) {
    if (!input) {
        logError('Target input element is missing.', 'Null input element');
        return false;
    }

    // 1. Native Value Assignment
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
    )?.set;

    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
    } else {
        input.value = value;
    }

    // 2. Dispatch Standard DOM Events (Triggers React 16+ listener delegation)
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // 3. Fallback: Search for React props on the input or its parent container
    const targets = [input, input.parentElement].filter(Boolean);
    let handlerFound = false;

    for (const target of targets) {
        const reactPropsKey = Object.keys(target).find(
            (key) => key.startsWith('__reactProps') || key.startsWith('__reactEvents')
        );
        const reactProps = reactPropsKey ? target[reactPropsKey] : null;

        if (typeof reactProps?.onChange === 'function') {
            reactProps.onChange({ target: input, currentTarget: input, type: 'change' });
            handlerFound = true;
            break;
        }
    }

    // Standard DOM event dispatch (step 2) handles state when prop keys are mangled
    return true;
}

function pressKey(element, key) {
    if (!element) return;
    const keyCode = key === 'Enter' ? 13 : 0;
    const eventOptions = {
        key,
        code: key === 'Enter' ? 'Enter' : key,
        keyCode,
        which: keyCode,
        bubbles: true
    };

    element.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
    element.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
}

// Cleanup on initialization
cleanupOldLogs();

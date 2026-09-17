/**
 * Background Service Worker for WAB Extension
 *
 * Responsibilities:
 * 1. Manage storage cleanup
 * 2. Maintain update status in chrome.storage
 *
 * NOTE: The external backend update-check has been removed.
 * There is no backend server for this extension.
 * The update status is always set to { hasUpdate: false }.
 * To enable real update checks in future, replace checkBackendForUpdates()
 * with a real endpoint and restore the fetch call.
 */

const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Cleanup every 24 hours

/**
 * Returns a static "no update" result.
 * Replaces the placeholder backend fetch that caused:
 * "TypeError: Failed to fetch https://your-backend.com/..."
 */
function checkBackendForUpdates() {
    // No backend exists. Always return hasUpdate: false so the popup
    // proceeds normally without blocking on a network request.
    return Promise.resolve({ hasUpdate: false, message: '', newVersion: '1.0' });
}

/**
 * Set the update status in chrome.storage
 * This status is read by popup.js before proceeding
 */
async function setUpdateStatusInStorage(updateInfo) {
    return new Promise((resolve) => {
        const statusData = {
            hasUpdate: updateInfo.hasUpdate,
            message: updateInfo.message,
            newVersion: updateInfo.newVersion || '1.0',
            timestamp: new Date().toISOString(),
            checkTime: new Date().toLocaleString()
        };

        chrome.storage.local.set({ 'wab_ext_update_status': statusData }, () => {
            console.log('[WAB] Update status stored:', statusData);
            resolve(statusData);
        });
    });
}

/**
 * Main update check function
 * Called on intervals and during extension startup
 */
async function performUpdateCheck() {
    console.log('[WAB] Performing update check...');

    const updateInfo = await checkBackendForUpdates();
    await setUpdateStatusInStorage(updateInfo);

    if (updateInfo.hasUpdate) {
        chrome.action.setBadgeText({ text: 'NEW' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF6B6B' });
        console.log('[WAB] Update available:', updateInfo.message);
    } else {
        chrome.action.setBadgeText({ text: '' });
        console.log('[WAB] No updates available');
    }
}

/**
 * Clean up old logs from storage
 */
async function performStorageCleanup() {
    console.log('[WAB] Performing storage cleanup...');

    return new Promise((resolve) => {
        chrome.storage.local.get('wab_ext_logs', (result) => {
            const logs = result['wab_ext_logs'] || [];
            const retentionDays = 7;
            const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
            const cutoffTime = new Date(Date.now() - retentionMs).toISOString();

            const filteredLogs = logs.filter(log => {
                const timestamp = log.split(' | ')[0];
                return timestamp > cutoffTime;
            });

            if (filteredLogs.length < logs.length) {
                chrome.storage.local.set({ 'wab_ext_logs': filteredLogs }, () => {
                    console.log(`[WAB] Cleaned up ${logs.length - filteredLogs.length} old log entries`);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    });
}

/**
 * Get current storage usage
 */
async function getStorageUsage() {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (allItems) => {
            try {
                const usage = JSON.stringify(allItems).length;
                console.log(`[WAB] Storage usage: ${usage} bytes (${(usage / 1024).toFixed(2)} KB)`);
                resolve(usage);
            } catch (error) {
                console.error('[WAB] Error calculating storage usage:', error);
                resolve(0);
            }
        });
    });
}

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        console.log('[WAB] Extension installed');
        await performUpdateCheck();
    } else if (details.reason === 'update') {
        console.log('[WAB] Extension updated');
        chrome.storage.local.remove('wab_ext_update_status');
    }
});

/**
 * Handle extension startup (when browser/Chrome starts)
 */
chrome.runtime.onStartup.addListener(async () => {
    console.log('[WAB] Extension startup - performing update check');
    await performUpdateCheck();
});

/**
 * Set up periodic storage cleanup only (no update-check alarm needed
 * since there is no backend to poll).
 */
chrome.alarms.create('storageCleanup', { periodInMinutes: CLEANUP_INTERVAL / (60 * 1000) });

/**
 * Handle alarm triggers
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'storageCleanup') {
        await performStorageCleanup();
        await getStorageUsage();
    }
});

/**
 * Message listener for popup/content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_UPDATE_STATUS') {
        chrome.storage.local.get('wab_ext_update_status', (result) => {
            sendResponse(result['wab_ext_update_status'] || { hasUpdate: false });
        });
        return true;
    }

    if (request.action === 'GET_STORAGE_INFO') {
        getStorageUsage().then((usage) => {
            const limitBytes = 5 * 1024 * 1024; // 5MB
            sendResponse({
                usedBytes: usage,
                limitBytes: limitBytes,
                percentUsed: (usage / limitBytes) * 100
            });
        });
        return true;
    }

    if (request.action === 'CLEAR_OLD_LOGS') {
        performStorageCleanup().then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
});

// Perform initial check when background script loads
console.log('[WAB] Background service worker loaded');
performUpdateCheck();

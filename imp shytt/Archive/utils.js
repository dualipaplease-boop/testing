const LOG_KEY = 'wab_ext_logs';

function appendLog(message) {
    const entry = `${new Date().toISOString()} | ${message}`;
    console.log(entry);
    try {
        chrome.storage.local.get({ [LOG_KEY]: [] }, (result) => {
            const logs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
            logs.push(entry);
            chrome.storage.local.set({ [LOG_KEY]: logs });
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

function waitForElement(selectors, timeout = 5000) {
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

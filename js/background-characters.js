// background-characters.js
// 内存中记录每个角色上一次发送尝试的时间（毫秒）
let lastSendAttemptMap = new Map();
let bgInterval = null;
let processing = false;

async function processAllCharacters() {
    if (processing) return;
    processing = true;
    try {
        const charList = CHARACTER_LIST;
        for (const char of charList) {
            if (char.id === CURRENT_CHARACTER_ID) continue;
            // 只保留主动发送和主动写信，移除自动回复
            await maybeSendAutoEnvelopeForCharacter(char);
            await maybeAutoSendMessageForCharacter(char);
        }
    } catch (err) {
        console.error('后台角色处理出错', err);
    } finally {
        processing = false;
    }
}

// 已删除 maybeGenerateReplyForCharacter 函数（自动回复）

async function generateReplyForCharacter(char, messages) {
    let disabledItems = new Set();
    try {
        const raw = localStorage.getItem('disabledReplyItems');
        if (raw) disabledItems = new Set(JSON.parse(raw));
    } catch (e) { }
    let disabledGroupItems = new Set();
    (window.customReplyGroups || []).forEach(g => {
        if (g.disabled && Array.isArray(g.items)) g.items.forEach(item => disabledGroupItems.add(item));
    });
    const availableReplies = customReplies.filter(r => !disabledItems.has(r) && !disabledGroupItems.has(r));
    if (availableReplies.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * availableReplies.length);
    return availableReplies[randomIndex];
}

async function maybeSendAutoEnvelopeForCharacter(char) {
    const charSettings = await localforage.getItem(`${APP_PREFIX}${char.id}_chatSettings`);
    if (!charSettings || !charSettings.autoEnvelopeEnabled) return;

    const lastEnvelopeKey = `${APP_PREFIX}${char.id}_lastEnvelopeTime`;
    const lastTime = (await localforage.getItem(lastEnvelopeKey)) || 0;
    const interval = (charSettings.autoEnvelopeInterval || 5) * 60 * 60 * 1000;
    if (Date.now() - lastTime < interval) return;

    const envelopeData = await localforage.getItem(`${APP_PREFIX}${char.id}_envelopeData`) || { outbox: [], inbox: [] };
    const newLetter = {
        id: 'auto_' + Date.now(),
        content: generateEnvelopeReplyText(),
        receivedTime: Date.now(),
        isNew: true
    };
    envelopeData.inbox.push(newLetter);
    await localforage.setItem(`${APP_PREFIX}${char.id}_envelopeData`, envelopeData);
    await localforage.setItem(lastEnvelopeKey, Date.now());

    if (!char.doNotDisturb) {
        showNotification(`${char.name} 给你寄来一封信`, 'info');
    }
}

window.startBackgroundCharacters = async function () {
    if (bgInterval) clearInterval(bgInterval);
    bgInterval = setInterval(processAllCharacters, 60000);
};

async function maybeAutoSendMessageForCharacter(char) {
    // 1. 获取角色的聊天设置
    let charSettings = await localforage.getItem(`${APP_PREFIX}${char.id}_chatSettings`);
    if (!charSettings) {
        charSettings = JSON.parse(JSON.stringify(settings));
        await localforage.setItem(`${APP_PREFIX}${char.id}_chatSettings`, charSettings);
    }

    // 2. 确保类型正确（防止存成字符串）
    if (typeof charSettings.autoSendEnabled === 'string') {
        charSettings.autoSendEnabled = charSettings.autoSendEnabled === 'true';
    }
    if (typeof charSettings.autoSendInterval === 'string') {
        charSettings.autoSendInterval = Number(charSettings.autoSendInterval);
    }

    // 3. 主动发送未开启 → 直接返回
    if (!charSettings.autoSendEnabled) return;

    const intervalVal = charSettings.autoSendInterval || 5;
    const intervalMs = intervalVal * 60 * 1000;   // 分钟转毫秒
    const now = Date.now();

    // 4. 内存限流：如果距离上一次尝试发送不到间隔的 80%，直接跳过（防止并发）
    const lastMemTime = lastSendAttemptMap.get(char.id) || 0;
    if (now - lastMemTime < intervalMs * 0.8) {
        return;
    }
    // 立即记录本次尝试（先占位）
    lastSendAttemptMap.set(char.id, now);

    // 5. 读取存储的上次发送时间（增加 try-catch 防止读取失败）
    const lastAutoSendKey = `${APP_PREFIX}${char.id}_lastAutoSendTime`;
    let lastTime = 0;
    try {
        lastTime = (await localforage.getItem(lastAutoSendKey)) || 0;
    } catch (err) {
        console.warn(`[主动发送] 读取 ${char.name} 的上次时间失败，本次跳过`, err);
        return;
    }

    // 6. 判断是否达到间隔（如果 lastTime 为 0 或 间隔足够）
    if (now - lastTime < intervalMs) return;

    // 7. 生成回复文本（如果字卡库为空则不发）
    const replyText = await generateReplyForCharacter(char, []);
    if (!replyText) return;

    // 8. 读取该角色的聊天记录并追加新消息
    let charMessages = [];
    try {
        charMessages = (await localforage.getItem(`${APP_PREFIX}${char.id}_chatMessages`)) || [];
    } catch (err) {
        console.warn(`[主动发送] 读取 ${char.name} 的聊天记录失败`, err);
        return;
    }

    const newMsg = {
        id: Date.now(),
        sender: charSettings.partnerName || char.name,
        text: replyText,
        timestamp: new Date(),
        status: 'received',
        type: 'normal'
    };
    charMessages.push(newMsg);

    // 9. 保存消息和上次发送时间（两个操作，确保都成功）
    try {
        await localforage.setItem(`${APP_PREFIX}${char.id}_chatMessages`, charMessages);
        await localforage.setItem(lastAutoSendKey, now);
        // 更新内存 Map 中的成功时间（与存储一致）
        lastSendAttemptMap.set(char.id, now);
    } catch (err) {
        console.error(`[主动发送] 保存 ${char.name} 的数据失败，本次发送作废`, err);
        // 保存失败时从内存 Map 中删除占位，避免永久阻塞
        lastSendAttemptMap.delete(char.id);
        return;
    }

    // 10. 更新角色列表中的最后消息预览（用于角色列表显示）
    char.lastMessage = replyText.slice(0, 50);
    char.lastTimestamp = new Date();
    if (!char.doNotDisturb) {
        char.unreadCount = (char.unreadCount || 0) + 1;
        if (Notification.permission === 'granted') {
            const cleanTitle = cleanNotificationText(`${char.name} 发来新消息`);
            const cleanBody = cleanNotificationText(replyText);
            new Notification(cleanTitle, { body: cleanBody });
        }
        
    } else {
        char.unreadCount = (char.unreadCount || 0) + 1;
    }
    await saveCharacterList();
    if (typeof updateCharacterListUI === 'function') updateCharacterListUI();

    // 可选：播放一个提示音
    if (typeof playSound === 'function') playSound('message');
}
// background-characters.js
let bgInterval = null;
let processing = false;

async function processAllCharacters() {
    if (processing) return;
    processing = true;
    try {
        const charList = CHARACTER_LIST;
        for (const char of charList) {
            if (char.id === CURRENT_CHARACTER_ID) continue;
            await maybeGenerateReplyForCharacter(char);
            await maybeSendAutoEnvelopeForCharacter(char);
            await maybeAutoSendMessageForCharacter(char);
        }
    } catch (err) {
        console.error('后台角色处理出错', err);
    } finally {
        processing = false;
    }
}

async function maybeGenerateReplyForCharacter(char) {
    // ========== 修改点：后台角色不自动回复 ==========
    // 只有当前角色才会自动回复，后台角色直接跳过
    if (char.id !== CURRENT_CHARACTER_ID) return;
    // =============================================

    const charSettings = await localforage.getItem(`${APP_PREFIX}${char.id}_chatSettings`);
    if (!charSettings) return; // 读取失败直接返回，不回复
    if (charSettings.autoReplyEnabled === false) return;

    let charMessages = await localforage.getItem(`${APP_PREFIX}${char.id}_chatMessages`) || [];
    const lastUserMsg = charMessages.filter(m => m.sender === 'user').slice(-1)[0];
    if (!lastUserMsg) return;

    const lastReplyTime = charMessages.filter(m => m.sender !== 'user').slice(-1)[0]?.timestamp;
    const now = Date.now();
    const minDelay = charSettings.replyDelayMin || 3000;
    const maxDelay = charSettings.replyDelayMax || 7000;

    if (lastReplyTime && (now - new Date(lastReplyTime).getTime()) < minDelay) return;

    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    setTimeout(async () => {
        let freshMessages = await localforage.getItem(`${APP_PREFIX}${char.id}_chatMessages`) || [];
        const freshLastReply = freshMessages.filter(m => m.sender !== 'user').slice(-1)[0];
        if (freshLastReply && (now - new Date(freshLastReply.timestamp).getTime()) < minDelay) return;

        const replyText = await generateReplyForCharacter(char, freshMessages);
        if (!replyText) return;

        const newMsg = {
            id: Date.now(),
            sender: charSettings.partnerName || '对方',
            text: replyText,
            timestamp: new Date(),
            status: 'received',
            type: 'normal'
        };
        freshMessages.push(newMsg);
        await localforage.setItem(`${APP_PREFIX}${char.id}_chatMessages`, freshMessages);

        char.lastMessage = replyText.slice(0, 30);
        char.lastTimestamp = new Date();
        if (!char.doNotDisturb) {
            char.unreadCount = (char.unreadCount || 0) + 1;
            if (Notification.permission === 'granted') {
                new Notification(`${char.name} 发来新消息`, { body: replyText });
            }
        } else {
            char.unreadCount = (char.unreadCount || 0) + 1;
        }
        await saveCharacterList();
        updateCharacterListUI();
    }, delay);
}

async function generateReplyForCharacter(char, messages) {
    if (!customReplies.length) return null;
    const randomIndex = Math.floor(Math.random() * customReplies.length);
    return customReplies[randomIndex];
}

async function maybeSendAutoEnvelopeForCharacter(char) {
    const charSettings = await localforage.getItem(`${APP_PREFIX}${char.id}_chatSettings`);
    if (!charSettings) return;
    if (!charSettings.autoEnvelopeEnabled) return;

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
    bgInterval = setInterval(processAllCharacters, 30000);
};

async function maybeAutoSendMessageForCharacter(char) {
    // 1. 读取该角色的聊天设置
    let charSettings = await localforage.getItem(`${APP_PREFIX}${char.id}_chatSettings`);
    if (!charSettings) {
        // 读取失败时不发送，直接返回（不要 fallback 到全局 settings）
        console.warn(`[主动发送] 无法读取 ${char.name} 的设置，跳过`);
        return;
    }
    if (!charSettings.autoSendEnabled) {
        console.log(`[主动发送] ${char.name} 已关闭主动发送`);
        return;
    }

    const lastAutoSendKey = `${APP_PREFIX}${char.id}_lastAutoSendTime`;
    let lastTime = await localforage.getItem(lastAutoSendKey);
    const intervalMs = (charSettings.autoSendInterval || 5) * 60 * 1000;

    // 如果没有上次发送时间记录，则初始化为当前时间并返回（避免立即发送）
    if (lastTime === null || lastTime === undefined) {
        await localforage.setItem(lastAutoSendKey, Date.now());
        console.log(`[主动发送] ${char.name} 初始化 lastAutoSendTime 为当前时间，下次周期再检查`);
        return;
    }

    const now = Date.now();
    if (now - lastTime < intervalMs) {
        console.log(`[主动发送] ${char.name} 距离上次发送不足 ${charSettings.autoSendInterval} 分钟，跳过`);
        return;
    }

    // 生成回复内容（复用现有函数）
    const replyText = await generateReplyForCharacter(char, []);
    if (!replyText) return;

    // 发送消息
    let charMessages = await localforage.getItem(`${APP_PREFIX}${char.id}_chatMessages`) || [];
    const newMsg = {
        id: Date.now(),
        sender: charSettings.partnerName || char.name,
        text: replyText,
        timestamp: new Date(),
        status: 'received',
        type: 'normal'
    };
    charMessages.push(newMsg);
    await localforage.setItem(`${APP_PREFIX}${char.id}_chatMessages`, charMessages);

    // 更新角色列表预览
    char.lastMessage = replyText.slice(0, 50);
    char.lastTimestamp = new Date();
    if (!char.doNotDisturb) {
        char.unreadCount = (char.unreadCount || 0) + 1;
        if (Notification.permission === 'granted') {
            new Notification(`${char.name} 发来新消息`, { body: replyText });
        }
    } else {
        char.unreadCount = (char.unreadCount || 0) + 1;
    }
    await saveCharacterList();
    await localforage.setItem(lastAutoSendKey, Date.now());
    if (typeof updateCharacterListUI === 'function') updateCharacterListUI();
}
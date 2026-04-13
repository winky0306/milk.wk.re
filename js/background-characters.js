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
    if (!customReplies.length) return null;
    const randomIndex = Math.floor(Math.random() * customReplies.length);
    return customReplies[randomIndex];
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
    bgInterval = setInterval(processAllCharacters, 30000);
};

async function maybeAutoSendMessageForCharacter(char) {
    let charSettings = await localforage.getItem(`${APP_PREFIX}${char.id}_chatSettings`);
    if (!charSettings) {
        charSettings = JSON.parse(JSON.stringify(settings));
        await localforage.setItem(`${APP_PREFIX}${char.id}_chatSettings`, charSettings);
    }
    if (!charSettings.autoSendEnabled) return;

    const lastAutoSendKey = `${APP_PREFIX}${char.id}_lastAutoSendTime`;
    let lastTime = await localforage.getItem(lastAutoSendKey) || 0;
    const intervalMs = (charSettings.autoSendInterval || 5) * 60 * 1000;
    if (Date.now() - lastTime < intervalMs) return;

    const replyText = await generateReplyForCharacter(char, []);
    if (!replyText) return;

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
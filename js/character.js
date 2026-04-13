// character.js - 角色管理模块

let isCharacterModalOpen = false;

// 渲染角色列表
function renderCharacterList() {
    const container = document.getElementById('character-list');
    if (!container) return;
    if (!CHARACTER_LIST.length) {
        container.innerHTML = '<div style="text-align:center;padding:30px;">暂无角色，点击下方按钮创建</div>';
        return;
    }
    container.innerHTML = CHARACTER_LIST.map(char => {
        const isActive = (CURRENT_CHARACTER_ID === char.id);
        const unreadBadge = (char.unreadCount && char.unreadCount > 0 && !char.doNotDisturb) ?
            `<span class="unread-badge">${char.unreadCount > 99 ? '99+' : char.unreadCount}</span>` : '';
        const lastMsg = char.lastMessage ? `<div class="last-msg">${escapeHtml(char.lastMessage)}</div>` : '<div class="last-msg">暂无消息</div>';
        const timeStr = char.lastTimestamp ? new Date(char.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return `
        <div class="character-item ${isActive ? 'active' : ''}" data-char-id="${char.id}">
            <div class="character-avatar">${char.avatar ? `<img src="${char.avatar}">` : '<i class="fas fa-user"></i>'}</div>
            <div class="character-info">
                <div class="character-name">${escapeHtml(char.name)}</div>
                ${lastMsg}
            </div>
            <div class="character-meta">
                <span class="time">${timeStr}</span>
                ${unreadBadge}
                <button class="char-edit-btn" data-id="${char.id}" title="编辑"><i class="fas fa-pen"></i></button>
                <button class="char-dnd-btn" data-id="${char.id}" title="免打扰">${char.doNotDisturb ? '<i class="fas fa-bell-slash"></i>' : '<i class="fas fa-bell"></i>'}</button>
                <button class="char-delete-btn" data-id="${char.id}" title="删除角色"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `;
    }).join('');

    // 绑定编辑按钮事件
    document.querySelectorAll('.char-edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            editCharacterInfo(id);
        });
    });
    // 绑定免打扰按钮事件
    document.querySelectorAll('.char-dnd-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const char = CHARACTER_LIST.find(c => c.id === id);
            if (char) {
                char.doNotDisturb = !char.doNotDisturb;
                await localforage.setItem(`${APP_PREFIX}character_list`, CHARACTER_LIST);
                renderCharacterList();
                showNotification(`已${char.doNotDisturb ? '开启' : '关闭'} ${char.name} 的消息免打扰`, 'success');
            }
        });
    });
    // 删除按钮
    document.querySelectorAll('.char-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (CHARACTER_LIST.length <= 1) { showNotification('至少保留一个角色', 'warning'); return; }
            if (confirm('删除角色将同时删除该角色的所有聊天记录等数据，不可恢复。确定吗？')) {
                const keys = await localforage.keys();
                for (const key of keys) {
                    if (key.includes(id)) await localforage.removeItem(key);
                }
                localStorage.removeItem(`groupChatSettings_${id}`);
                CHARACTER_LIST = CHARACTER_LIST.filter(c => c.id !== id);
                await localforage.setItem(`${APP_PREFIX}character_list`, CHARACTER_LIST);
                if (id === CURRENT_CHARACTER_ID) {
                    const newId = CHARACTER_LIST[0].id;
                    await localforage.setItem(`${APP_PREFIX}current_character`, newId);
                    window.location.reload();
                } else {
                    renderCharacterList();
                    showNotification('角色已删除', 'success');
                }
            }
        });
    });
}

// 编辑角色信息（头像和名字）
async function editCharacterInfo(charId) {
    const character = CHARACTER_LIST.find(c => c.id === charId);
    if (!character) return;

    const existingModal = document.getElementById('dynamic-char-edit-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'dynamic-char-edit-modal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 320px;">
            <div class="modal-title"><i class="fas fa-user-edit"></i><span>编辑角色</span></div>
            <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
                <div id="edit-char-avatar-preview" style="width:80px;height:80px;border-radius:50%;background:var(--border-color);overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:pointer;">
                    ${character.avatar ? `<img src="${character.avatar}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fas fa-user" style="font-size:32px;color:var(--text-secondary);"></i>'}
                </div>
                <input type="file" id="edit-char-avatar-input" accept="image/*" style="display:none;">
                <input type="text" id="edit-char-name" class="modal-input" value="${escapeHtml(character.name)}" placeholder="角色名称" style="width:100%;">
            </div>
            <div class="modal-buttons">
                <button class="modal-btn modal-btn-secondary" id="cancel-edit-char">取消</button>
                <button class="modal-btn modal-btn-primary" id="save-edit-char">保存</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const preview = modal.querySelector('#edit-char-avatar-preview');
    const fileInput = modal.querySelector('#edit-char-avatar-input');
    const nameInput = modal.querySelector('#edit-char-name');
    let newAvatar = character.avatar;

    preview.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            showNotification('头像图片不能超过2MB', 'error');
            return;
        }
        try {
            const base64 = await cropImageToSquare(file, 200);
            newAvatar = base64;
            preview.innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover;">`;
        } catch (err) {
            showNotification('图片处理失败', 'error');
        }
        fileInput.value = '';
    });

    const saveBtn = modal.querySelector('#save-edit-char');
    const cancelBtn = modal.querySelector('#cancel-edit-char');

    if (typeof showModal === 'function') showModal(modal);
    else modal.style.display = 'flex';

    saveBtn.onclick = async () => {
        const newName = nameInput.value.trim();
        if (!newName) {
            showNotification('角色名称不能为空', 'warning');
            return;
        }
        character.name = newName;
        character.avatar = newAvatar || null;
        await saveCharacterList();

        if (character.id === CURRENT_CHARACTER_ID) {
            settings.partnerName = newName;
            if (newAvatar) {
                updateAvatar(DOMElements.partner.avatar, newAvatar);
                await localforage.setItem(getStorageKey('partnerAvatar'), newAvatar);
            }
            DOMElements.partner.name.textContent = newName;
            throttledSaveData();
            showNotification('当前角色信息已同步到聊天界面', 'success');
        }

        renderCharacterList();
        if (typeof hideModal === 'function') hideModal(modal);
        else modal.style.display = 'none';
        setTimeout(() => modal.remove(), 300);
        showNotification('角色信息已更新', 'success');
    };

    cancelBtn.onclick = () => {
        if (typeof hideModal === 'function') hideModal(modal);
        else modal.style.display = 'none';
        setTimeout(() => modal.remove(), 300);
    };

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            if (typeof hideModal === 'function') hideModal(modal);
            else modal.style.display = 'none';
            setTimeout(() => modal.remove(), 300);
        }
    });
}

// 切换到指定角色
async function switchToCharacter(charId) {
    if (charId === CURRENT_CHARACTER_ID) {
        closeCharacterModal();
        return;
    }
    if (confirm('切换角色将刷新页面，确定要切换吗？')) {
        await localforage.setItem(`${APP_PREFIX}current_character`, charId);
        window.location.reload();
    }
}

// 修改角色头像
function changeCharacterAvatar(charId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            showNotification('头像图片不能超过2MB', 'error');
            return;
        }
        try {
            const base64 = await cropImageToSquare(file, 200);
            const character = CHARACTER_LIST.find(c => c.id === charId);
            if (character) {
                character.avatar = base64;
                await localforage.setItem(`${APP_PREFIX}character_list`, CHARACTER_LIST);
                renderCharacterList();
                showNotification('头像已更新', 'success');
            }
        } catch (err) {
            showNotification('图片处理失败', 'error');
        }
    };
    input.click();
}

// 删除角色
async function deleteCharacter(charId) {
    if (CHARACTER_LIST.length <= 1) {
        showNotification('至少保留一个角色', 'warning');
        return;
    }
    if (!confirm('删除角色将同时删除该角色的所有聊天记录、群聊设置等数据，不可恢复。确定删除吗？')) return;

    const keys = await localforage.keys();
    for (const key of keys) {
        if (key.includes(charId)) {
            await localforage.removeItem(key);
        }
    }
    localStorage.removeItem(`groupChatSettings_${charId}`);

    CHARACTER_LIST = CHARACTER_LIST.filter(c => c.id !== charId);
    await localforage.setItem(`${APP_PREFIX}character_list`, CHARACTER_LIST);

    if (charId === CURRENT_CHARACTER_ID) {
        const newId = CHARACTER_LIST[0].id;
        await localforage.setItem(`${APP_PREFIX}current_character`, newId);
        window.location.reload();
    } else {
        renderCharacterList();
        showNotification('角色已删除', 'success');
    }
}

// 创建新角色
async function createNewCharacter() {
    const nameInput = document.getElementById('new-character-name');
    const name = nameInput.value.trim();
    if (!name) {
        showNotification('请输入角色名称', 'warning');
        return;
    }

    const newId = 'char_' + Date.now();

    let baseSettings = settings;
    if (CURRENT_CHARACTER_ID) {
        const currentCharSettings = await localforage.getItem(`${APP_PREFIX}${CURRENT_CHARACTER_ID}_chatSettings`);
        if (currentCharSettings) baseSettings = currentCharSettings;
    }
    const newSettings = JSON.parse(JSON.stringify(baseSettings));
    await localforage.setItem(`${APP_PREFIX}${newId}_lastAutoSendTime`, 0);

    await localforage.setItem(`${APP_PREFIX}${newId}_chatMessages`, []);
    await localforage.setItem(`${APP_PREFIX}${newId}_chatSettings`, newSettings);

    CHARACTER_LIST.push({
        id: newId,
        name: name,
        avatar: null,
        createdAt: Date.now(),
        unreadCount: 0,
        lastMessage: '',
        lastTimestamp: null,
        doNotDisturb: false
    });
    await localforage.setItem(`${APP_PREFIX}character_list`, CHARACTER_LIST);
    nameInput.value = '';
    renderCharacterList();
    showNotification(`角色“${name}”已创建`, 'success');
}

// 打开角色管理弹窗
function openCharacterModal() {
    if (isCharacterModalOpen) return;
    renderCharacterList();
    const modal = document.getElementById('character-modal');
    if (modal) {
        showModal(modal);
        isCharacterModalOpen = true;
        modal.addEventListener('click', function onModalClose() {
            isCharacterModalOpen = false;
            modal.removeEventListener('click', onModalClose);
        }, { once: true });
    }
}

function closeCharacterModal() {
    const modal = document.getElementById('character-modal');
    if (modal) hideModal(modal);
    isCharacterModalOpen = false;
}

// 刷新角色列表 UI
function updateCharacterListUI() {
    renderCharacterList();
}

// 保存角色列表到 localforage
async function saveCharacterList() {
    await localforage.setItem(`${APP_PREFIX}character_list`, CHARACTER_LIST);
}

// 导出全局函数供 background-characters 调用
window.updateCharacterListUI = updateCharacterListUI;
window.saveCharacterList = saveCharacterList;

// 辅助函数：转义HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// 更新总未读角标
function updateCharacterTotalBadge() {
    const totalUnread = CHARACTER_LIST.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    const badge = document.getElementById('character-total-badge');
    if (badge) {
        if (totalUnread > 0) {
            badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

// 绑定角色切换
document.addEventListener('DOMContentLoaded', async function () {
    const charBtn = document.getElementById('character-manager-btn');
    if (charBtn) {
        charBtn.addEventListener('click', openCharacterModal);
    }

    const closeBtn = document.getElementById('close-character-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeCharacterModal);
    }

    const createBtn = document.getElementById('create-character-btn');
    if (createBtn) {
        createBtn.addEventListener('click', createNewCharacter);
    }

    const newNameInput = document.getElementById('new-character-name');
    if (newNameInput) {
        newNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') createNewCharacter();
        });
    }

    // ✅ 事件委托：监听角色列表容器上的点击
    const characterListContainer = document.getElementById('character-list');
    if (characterListContainer) {
        characterListContainer.addEventListener('click', async (e) => {
            const item = e.target.closest('.character-item');
            if (!item) return;
            // 避免干扰免打扰和删除按钮
            if (e.target.closest('.char-dnd-btn') || e.target.closest('.char-delete-btn')) return;

            const charId = item.dataset.charId;
            const char = CHARACTER_LIST.find(c => c.id === charId);
            if (char && char.unreadCount) {
                char.unreadCount = 0;
                await localforage.setItem(`${APP_PREFIX}character_list`, CHARACTER_LIST);
                // 立即刷新角色列表UI（如果打开）
                if (document.getElementById('character-modal').style.display !== 'none') {
                    renderCharacterList();
                }
                // 更新总未读角标
                updateCharacterTotalBadge();
            }
            if (charId !== CURRENT_CHARACTER_ID) {
                await localforage.setItem(`${APP_PREFIX}current_character`, charId);
                window.location.reload();
            } else {
                closeCharacterModal();
            }
        });
    }
});
// group-chat.js - 修复后版本（支持角色隔离 + 全局变量）
let groupChatSettings = {
    enabled: false,
    showAvatar: true,
    showName: true,
    members: []
};

function getGroupChatStorageKey() {
    // 如果角色ID存在，使用角色ID作为存储键的一部分
    if (typeof CURRENT_CHARACTER_ID !== 'undefined' && CURRENT_CHARACTER_ID) {
        return `groupChatSettings_${CURRENT_CHARACTER_ID}`;
    }
    // 降级：返回通用键，但会打印警告
    console.warn('[group-chat] 角色ID未初始化，使用临时存储键');
    return 'groupChatSettings_temp';
}

function loadGroupChatSettings() {
    const saved = getGroupChatSettings();
    groupChatSettings.enabled = saved.enabled;
    groupChatSettings.showAvatar = saved.showAvatar;
    groupChatSettings.showName = saved.showName;
    groupChatSettings.members = saved.members || [];

    const storageKey = getGroupChatStorageKey();
    groupChatSettings.members.forEach(m => {
        if (!m.id) {
            m.id = 'gcm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        }
        if (!m.avatarRef) {
            m.avatarRef = storageKey + '_avatar_' + m.id;
        }
    });
}

// group-chat.js 中找到 getGroupChatSettings 函数，替换为：

function getGroupChatSettings() {
    try {
        const key = getGroupChatStorageKey();
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        // 提供完整的默认值，确保 showName 始终为 true
        const defaults = {
            enabled: false,
            showAvatar: true,
            showName: true,
            members: []
        };
        if (!saved) return defaults;
        return {
            enabled: saved.enabled ?? false,
            showAvatar: saved.showAvatar ?? true,
            showName: saved.showName ?? true,
            members: saved.members || []
        };
    } catch (e) {
        return { enabled: false, showAvatar: true, showName: true, members: [] };
    }
}

function setGroupChatSettings(settings) {
    const key = getGroupChatStorageKey();
    localStorage.setItem(key, JSON.stringify(settings));
}

function saveGroupChatSettings() {
    const storageKey = getGroupChatStorageKey();
    const toSave = {
        enabled: groupChatSettings.enabled,
        showAvatar: groupChatSettings.showAvatar,
        showName: groupChatSettings.showName,
        members: groupChatSettings.members.map(m => ({
            name: m.name,
            id: m.id,
            avatarRef: storageKey + '_avatar_' + m.id
        }))
    };
    localStorage.setItem(storageKey, JSON.stringify(toSave));

    if (window.localforage) {
        groupChatSettings.members.forEach(m => {
            const ref = storageKey + '_avatar_' + m.id;
            if (m.avatar) {
                localforage.setItem(ref, m.avatar).catch(e => console.warn('头像保存失败', e));
            }
        });
    }
}

async function migrateOldAvatarKeys() {
    if (window._migratedAvatarKeys) return;
    window._migratedAvatarKeys = true;
    const storageKey = getGroupChatStorageKey();
    const members = groupChatSettings.members || [];
    if (members.length === 0) return;

    let needSave = false;
    for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const oldRef = m.avatarRef;
        if (!oldRef) continue;
        if (oldRef.startsWith(storageKey)) continue;

        const newRef = storageKey + '_avatar_' + (m.id || 'unknown_' + i);
        try {
            const avatarData = await localforage.getItem(oldRef);
            if (avatarData) {
                await localforage.setItem(newRef, avatarData);
                console.log('[迁移] 头像从', oldRef, '迁移至', newRef);
            }
        } catch (e) {
            console.warn('[迁移] 头像迁移失败', oldRef, e);
        }
        m.avatarRef = newRef;
        needSave = true;
    }
    if (needSave) {
        saveGroupChatSettings();
        console.log('[迁移] 已更新群聊成员的头像引用');
    }
}

// 延迟加载，等待角色系统初始化完成
(function loadGroupAvatars() {
    if (!window.localforage) return;
    // 不要立即加载，等待角色系统初始化
    setTimeout(function () {
        if (typeof CURRENT_CHARACTER_ID !== 'undefined' && CURRENT_CHARACTER_ID) {
            loadGroupChatSettings();
            migrateOldAvatarKeys().then(() => {
                const members = groupChatSettings.members || [];
                if (members.length === 0) return;
                const storageKey = getGroupChatStorageKey();
                const promises = members.map((m, i) => {
                    const ref = m.avatarRef || (storageKey + '_avatar_' + (m.id || 'unknown_' + i));
                    return localforage.getItem(ref).then(avatar => {
                        m.avatar = avatar || null;
                    }).catch(() => { });
                });
                Promise.all(promises).then(() => {
                    if (typeof renderGroupMembersList === 'function') renderGroupMembersList();
                });
            });
        } else {
            console.log('[group-chat] 等待角色系统初始化...');
            setTimeout(loadGroupAvatars, 300);
        }
    }, 100);
})();

function renderGroupMembersList() {
    const list = document.getElementById('group-members-list');
    if (!list) return;
    if (!groupChatSettings.members || groupChatSettings.members.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">暂无成员，点击添加按钮添加</div>';
        return;
    }
    list.innerHTML = groupChatSettings.members.map(function (m, i) {
        const avatarHtml = m.avatar
            ? '<img src="' + m.avatar + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">'
            : '<div style="width:36px;height:36px;border-radius:50%;background:rgba(var(--accent-color-rgb),0.15);display:flex;align-items:center;justify-content:center;"><i class="fas fa-user" style="font-size:14px;color:var(--accent-color);"></i></div>';
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--primary-bg);border:1px solid var(--border-color);border-radius:10px;">'
            + avatarHtml
            + '<span style="flex:1;font-size:13px;font-weight:500;">' + (m.name || '成员' + (i + 1)) + '</span>'
            + '<button onclick="openEditGroupMember(' + i + ')" style="background:none;border:none;cursor:pointer;color:var(--accent-color);font-size:14px;padding:4px 8px;"><i class="fas fa-edit"></i></button>'
            + '<button onclick="deleteGroupMember(' + i + ')" style="background:none;border:none;cursor:pointer;color:#ff4757;font-size:14px;padding:4px 8px;"><i class="fas fa-trash-alt"></i></button>'
            + '</div>';
    }).join('');
}

// 初始化当前角色的群聊设置（在角色系统加载完成后调用）
function initGroupChatForCurrentCharacter() {
    if (!CURRENT_CHARACTER_ID) {
        console.warn('[group-chat] 角色ID未初始化，稍后重试');
        setTimeout(initGroupChatForCurrentCharacter, 200);
        return;
    }
    console.log('[group-chat] 初始化群聊设置，当前角色:', CURRENT_CHARACTER_ID);
    loadGroupChatSettings();  // 加载当前角色的设置
    updateGroupModeUI();      // 刷新界面
    // 重新加载成员头像（因为头像存储也依赖于角色ID）
    if (window.localforage) {
        const storageKey = getGroupChatStorageKey();
        const members = groupChatSettings.members || [];
        const promises = members.map((m, i) => {
            const ref = m.avatarRef || (storageKey + '_avatar_' + (m.id || 'unknown_' + i));
            return localforage.getItem(ref).then(avatar => {
                m.avatar = avatar || null;
            }).catch(() => { m.avatar = null; });
        });
        Promise.all(promises).then(() => {
            if (typeof renderGroupMembersList === 'function') renderGroupMembersList();
        });
    }
}

// 导出到全局，供其他模块调用
window.initGroupChatForCurrentCharacter = initGroupChatForCurrentCharacter;

function updateGroupModeUI() {
    var pill = document.getElementById('group-mode-pill');
    var knob = document.getElementById('group-mode-knob');
    var status = document.getElementById('group-mode-status');
    var displaySection = document.getElementById('group-display-section');
    var membersSection = document.getElementById('group-members-section');
    if (!pill) return;
    if (groupChatSettings.enabled) {
        pill.style.background = 'var(--accent-color)';
        knob.style.left = '22px';
        status.textContent = '已开启 — 收到的消息随机显示成员';
        displaySection.style.display = 'block';
        membersSection.style.display = 'block';
    } else {
        pill.style.background = 'var(--border-color)';
        knob.style.left = '3px';
        status.textContent = '已关闭 — 点击开启';
        displaySection.style.display = 'none';
        membersSection.style.display = 'none';
    }
    var avatarPill = document.getElementById('group-show-avatar-pill');
    var avatarKnob = document.getElementById('group-show-avatar-knob');
    if (avatarPill) {
        avatarPill.style.background = groupChatSettings.showAvatar ? 'var(--accent-color)' : 'var(--border-color)';
        avatarKnob.style.right = groupChatSettings.showAvatar ? '3px' : '19px';
    }
    var namePill = document.getElementById('group-show-name-pill');
    var nameKnob = document.getElementById('group-show-name-knob');
    if (namePill) {
        namePill.style.background = groupChatSettings.showName ? 'var(--accent-color)' : 'var(--border-color)';
        nameKnob.style.right = groupChatSettings.showName ? '3px' : '19px';
    }
    renderGroupMembersList();
}

document.addEventListener('DOMContentLoaded', function () {
    loadGroupChatSettings();  // 确保页面加载时设置已就绪
    var groupModeToggle = document.getElementById('group-mode-toggle');
    if (groupModeToggle) {
        groupModeToggle.addEventListener('click', function () {
            groupChatSettings.enabled = !groupChatSettings.enabled;
            saveGroupChatSettings();
            updateGroupModeUI();
        });
    }
    var showAvatarToggle = document.getElementById('group-show-avatar-toggle');
    if (showAvatarToggle) {
        showAvatarToggle.addEventListener('click', function () {
            groupChatSettings.showAvatar = !groupChatSettings.showAvatar;
            saveGroupChatSettings();
            updateGroupModeUI();
        });
    }
    var showNameToggle = document.getElementById('group-show-name-toggle');
    if (showNameToggle) {
        showNameToggle.addEventListener('click', function () {
            groupChatSettings.showName = !groupChatSettings.showName;
            saveGroupChatSettings();
            updateGroupModeUI();
        });
    }
    var closeGroupChat = document.getElementById('close-group-chat');
    if (closeGroupChat) {
        closeGroupChat.addEventListener('click', function () {
            var m = document.getElementById('group-chat-modal');
            if (m && typeof hideModal === 'function') hideModal(m);
        });
    }
    setTimeout(updateGroupModeUI, 200);
});

window.openAddGroupMember = function () {
    _groupMemberAvatarDataUrl = null;
    document.getElementById('group-member-edit-title').textContent = '添加成员';
    document.getElementById('group-member-name-input').value = '';
    document.getElementById('group-member-edit-index').value = '';
    var preview = document.getElementById('group-member-avatar-preview');
    preview.innerHTML = '<i class="fas fa-camera" style="font-size:20px;color:var(--text-secondary);"></i>';
    var m = document.getElementById('group-member-edit-modal');
    if (m && typeof showModal === 'function') showModal(m);
};

window.openEditGroupMember = function (idx) {
    var member = groupChatSettings.members[idx];
    if (!member) return;
    _groupMemberAvatarDataUrl = member.avatar || null;
    document.getElementById('group-member-edit-title').textContent = '编辑成员';
    document.getElementById('group-member-name-input').value = member.name || '';
    document.getElementById('group-member-edit-index').value = idx;
    var preview = document.getElementById('group-member-avatar-preview');
    if (member.avatar) {
        preview.innerHTML = '<img src="' + member.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    } else {
        preview.innerHTML = '<i class="fas fa-camera" style="font-size:20px;color:var(--text-secondary);"></i>';
    }
    var m = document.getElementById('group-member-edit-modal');
    if (m && typeof showModal === 'function') showModal(m);
};

window.closeGroupMemberEdit = function () {
    var m = document.getElementById('group-member-edit-modal');
    if (m && typeof hideModal === 'function') hideModal(m);
};

window.previewGroupMemberAvatar = function (input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        _groupMemberAvatarDataUrl = e.target.result;
        var preview = document.getElementById('group-member-avatar-preview');
        preview.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    };
    reader.readAsDataURL(file);
};

window.saveGroupMember = function () {
    var name = (document.getElementById('group-member-name-input').value || '').trim();
    if (!name) { alert('请输入成员名字'); return; }
    var idxVal = document.getElementById('group-member-edit-index').value;
    var newAvatar = _groupMemberAvatarDataUrl;

    if (idxVal !== '') {
        // 编辑已有成员：直接修改原对象，保留 id 和原有头像存储键
        var existingMember = groupChatSettings.members[parseInt(idxVal)];
        if (existingMember) {
            existingMember.name = name;
            // 仅当头像变化时才更新
            if (newAvatar !== existingMember.avatar) {
                existingMember.avatar = newAvatar;
                // 更新本地存储中的头像数据
                if (newAvatar) {
                    var storageKey = getGroupChatStorageKey();
                    var avatarRef = storageKey + '_avatar_' + existingMember.id;
                    localforage.setItem(avatarRef, newAvatar).catch(e => console.warn('保存头像失败', e));
                } else {
                    // 如果清除了头像，删除旧的头像存储
                    var storageKey = getGroupChatStorageKey();
                    var avatarRef = storageKey + '_avatar_' + existingMember.id;
                    localforage.removeItem(avatarRef).catch(e => console.warn('删除头像失败', e));
                }
            }
        }
    } else {
        // 添加新成员：创建完整对象，包含唯一 id
        var newId = 'gcm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        var newMember = {
            id: newId,
            name: name,
            avatar: newAvatar
        };
        if (!groupChatSettings.members) groupChatSettings.members = [];
        groupChatSettings.members.push(newMember);
        // 保存新头像到本地存储
        if (newAvatar) {
            var storageKey = getGroupChatStorageKey();
            var avatarRef = storageKey + '_avatar_' + newId;
            localforage.setItem(avatarRef, newAvatar).catch(e => console.warn('保存头像失败', e));
        }
    }
    saveGroupChatSettings();
    renderGroupMembersList();
    window.closeGroupMemberEdit();
};

window.deleteGroupMember = function (idx) {
    if (!confirm('确定删除该成员吗？')) return;
    groupChatSettings.members.splice(idx, 1);
    saveGroupChatSettings();
    renderGroupMembersList();
};

window.getGroupMemberForMessage = function (msgId) {
    if (!groupChatSettings.enabled || !groupChatSettings.members || groupChatSettings.members.length === 0) return null;
    var seed = 0;
    var idStr = String(msgId);
    for (var i = 0; i < idStr.length; i++) seed += idStr.charCodeAt(i) * (i + 1);
    return groupChatSettings.members[seed % groupChatSettings.members.length];
};
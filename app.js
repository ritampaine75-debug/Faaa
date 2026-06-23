import { supabase, getCurrentProfile } from './supabase.js';

// --- STATE ---
let currentUser = null;
let activeChatId = null;
let messageChannel = null;

// --- DOM ELEMENTS ---
const screens = {
    splash: document.getElementById('screen-splash'),
    auth: document.getElementById('screen-auth'),
    app: document.getElementById('screen-app')
};

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
    // Simulate splash screen
    setTimeout(() => navigate('auth'), 1500);

    // Check active session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = await getCurrentProfile();
        if (currentUser) navigate('app');
    }

    setupAuthListeners();
    setupUIListeners();
});

// --- NAVIGATION ---
function navigate(screen) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screen].classList.add('active');
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// --- AUTHENTICATION ---
function setupAuthListeners() {
    // Login
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return alert(error.message);
        
        currentUser = await getCurrentProfile();
        navigate('app');
        loadChats();
    });

    // Register
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value;
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;

        const { data, error } = await supabase.auth.signUp({ 
            email, 
            password, 
            options: { data: { name, username } } 
        });
        
        if (error) return alert(error.message);
        alert("Registration successful! Please check your email to verify.");
    });

    // Forgot Password
    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) return alert(error.message);
        alert("Password reset link sent!");
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabase.auth.signOut();
        navigate('auth');
    });

    // Auth Form Toggles
    document.getElementById('show-register').addEventListener('click', () => toggleAuthForm('register'));
    document.getElementById('show-login').addEventListener('click', () => toggleAuthForm('login'));
    document.getElementById('show-forgot').addEventListener('click', () => toggleAuthForm('forgot'));
    document.getElementById('show-login-from-forgot').addEventListener('click', () => toggleAuthForm('login'));
}

function toggleAuthForm(form) {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
    document.getElementById(`${form}-form`).classList.remove('hidden');
}

// --- CHAT LOGIC ---
async function loadChats() {
    const { data: participantRows } = await supabase
        .from('chat_participants')
        .select('chat_id, chats(*)')
        .eq('user_id', currentUser.id);

    // Render UI (Simplified for example)
    const chatList = document.getElementById('chat-list');
    chatList.innerHTML = '';

    if (!participantRows) return;

    for (let row of participantRows) {
        const chat = row.chats;
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.innerHTML = `
            <div class="user-avatar small"></div>
            <div>
                <h4>${chat.is_group ? chat.group_name : 'User Name'}</h4>
                <p>Last message...</p>
            </div>
        `;
        div.onclick = () => openChat(chat.id);
        chatList.appendChild(div);
    }
}

async function openChat(chatId) {
    activeChatId = chatId;
    showView('view-chat');
    subscribeToMessages(chatId);
    fetchMessages(chatId);
}

async function fetchMessages(chatId) {
    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        container.appendChild(createMessageElement(msg));
    });
    
    container.scrollTop = container.scrollHeight;
}

function createMessageElement(msg) {
    const isMe = msg.sender_id === currentUser.id;
    const div = document.createElement('div');
    div.className = `message-bubble ${isMe ? 'out' : 'in'}`;
    div.dataset.id = msg.id;
    
    // Context Menu for actions (Edit, Delete, Reply, etc.)
    div.addEventListener('contextmenu', (e) => showMessageContextMenu(e, msg));

    div.innerHTML = `
        <div>${msg.message}</div>
        <div class="message-meta">
            <span>${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            ${isMe ? getStatusIcon(msg.status) : ''}
        </div>
    `;
    return div;
}

function getStatusIcon(status) {
    const icons = { sending: '🕐', sent: '✓', delivered: '✓✓', seen: '✓✓' };
    return `<span class="${status === 'seen' ? 'seen' : ''}">${icons[status] || ''}</span>`;
}

// --- REALTIME SUBSCRIPTIONS ---
function subscribeToMessages(chatId) {
    if (messageChannel) supabase.removeChannel(messageChannel);

    messageChannel = supabase
        .channel(`chat-${chatId}`)
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, 
            (payload) => {
                const container = document.getElementById('messages-container');
                container.appendChild(createMessageElement(payload.new));
                container.scrollTop = container.scrollHeight;
                
                // Update status to delivered if not me
                if (payload.new.sender_id !== currentUser.id) {
                    updateMessageStatus(payload.new.id, 'delivered');
                }
            }
        )
        .subscribe();
}

async function updateMessageStatus(messageId, status) {
    await supabase.from('messages').update({ status }).eq('id', messageId);
}

// --- SENDING MESSAGES ---
document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;

    // Optimistic UI Update
    const tempId = 'temp-' + Date.now();
    const tempMsg = { id: tempId, message: text, sender_id: currentUser.id, created_at: new Date(), status: 'sending' };
    document.getElementById('messages-container').appendChild(createMessageElement(tempMsg));
    input.value = '';

    // DB Insert
    const { data, error } = await supabase.from('messages').insert([
        { chat_id: activeChatId, sender_id: currentUser.id, message: text, status: 'sent' }
    ]).select();

    // Replace temp message with real one from DB
    if (data) {
        document.querySelector(`[data-id="${tempId}"]`)?.remove();
        document.getElementById('messages-container').appendChild(createMessageElement(data[0]));
    }
});

// --- CONTEXT MENU (Edit, Delete, Reply, Copy) ---
function showMessageContextMenu(e, msg) {
    e.preventDefault();
    const menu = document.getElementById('message-context-menu');
    menu.classList.remove('hidden');
    menu.style.top = `${e.clientY}px`;
    menu.style.left = `${e.clientX}px`;

    const isMe = msg.sender_id === currentUser.id;

    // Show/Hide Edit based on ownership
    menu.querySelector('[data-action="edit"]').style.display = isMe ? 'block' : 'none';

    // Attach Actions
    menu.onclick = (ev) => {
        const action = ev.target.dataset.action;
        if (!action) return;
        
        if (action === 'reply') setupReply(msg);
        if (action === 'copy') navigator.clipboard.writeText(msg.message);
        if (action === 'delete') deleteMessage(msg.id);
        if (action === 'edit') editMessage(msg);
        
        menu.classList.add('hidden');
    };
}

document.addEventListener('click', () => {
    document.getElementById('message-context-menu').classList.add('hidden');
});

async function deleteMessage(msgId) {
    // Soft delete
    await supabase.from('messages').update({ message: 'This message was deleted', deleted_at: new Date() }).eq('id', msgId);
    document.querySelector(`[data-id="${msgId}"] .message-bubble-text`).innerText = "This message was deleted";
}

function setupReply(msg) {
    const preview = document.getElementById('reply-preview');
    preview.classList.remove('hidden');
    document.getElementById('reply-text').innerText = msg.message;
}

document.getElementById('close-reply').addEventListener('click', () => {
    document.getElementById('reply-preview').classList.add('hidden');
});

// --- UI LISTENERS (Menus, Nav, Settings) ---
function setupUIListeners() {
    // Main Menu Toggle
    document.getElementById('btn-menu').addEventListener('click', () => {
        document.getElementById('main-menu').classList.toggle('hidden');
    });

    // Navigation inside app
    document.querySelectorAll('[data-nav]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const view = e.target.dataset.nav;
            if (view === 'profile') showView('view-profile');
            if (view === 'settings') showView('view-settings');
            if (view === 'qr-pair') showView('view-qr');
            document.getElementById('main-menu').classList.add('hidden');
        });
    });

    // Back buttons
    document.querySelectorAll('[data-back="sidebar"]').forEach(btn => {
        btn.addEventListener('click', () => {
            showView('view-empty');
            document.getElementById('sidebar').style.display = 'flex'; // reset mobile view
        });
    });

    // Dark Mode Toggle
    document.getElementById('toggle-dark-mode').addEventListener('change', (e) => {
        document.documentElement.setAttribute('data-theme', e.target.checked ? 'dark' : 'light');
        localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
    });

    // Set initial theme
    if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('toggle-dark-mode').checked = true;
    }
    }

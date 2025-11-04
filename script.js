class AuthManager {
    constructor() {
        this.users = new Map();
        this.currentUser = null;
        this.loadUsers();
    }

    loadUsers() {
        const savedUsers = localStorage.getItem('discordUsers');
        if (savedUsers) {
            const usersArray = JSON.parse(savedUsers);
            usersArray.forEach(user => {
                this.users.set(user.email, user);
            });
        }

        if (this.users.size === 0) {
            this.createTestUser();
        }
    }

    saveUsers() {
        const usersArray = Array.from(this.users.values());
        localStorage.setItem('discordUsers', JSON.stringify(usersArray));
    }

    createTestUser() {
        const testUser = {
            id: '1',
            email: 'test@test.com',
            username: 'TestUser',
            password: '123',
            avatar: 'T',
            status: 'online',
            createdAt: new Date().toISOString()
        };
        this.users.set(testUser.email, testUser);
        this.saveUsers();
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    validatePassword(password) {
        return password && password.length >= 3;
    }

    validateUsername(username) {
        return username && username.length >= 2 && username.length <= 20;
    }

    register(userData) {
        const errors = [];

        if (!this.validateEmail(userData.email)) {
            errors.push('Введите корректный email');
        }

        if (!this.validateUsername(userData.username)) {
            errors.push('Имя пользователя должно быть от 2 до 20 символов');
        }

        if (!this.validatePassword(userData.password)) {
            errors.push('Пароль должен содержать минимум 3 символа');
        }

        if (userData.password !== userData.confirmPassword) {
            errors.push('Пароли не совпадают');
        }

        if (this.users.has(userData.email)) {
            errors.push('Пользователь с таким email уже существует');
        }

        if (errors.length > 0) {
            return { success: false, errors };
        }

        const newUser = {
            id: Date.now().toString(),
            email: userData.email,
            username: userData.username,
            password: userData.password,
            avatar: userData.username.charAt(0).toUpperCase(),
            status: 'online',
            createdAt: new Date().toISOString(),
            friends: [],
            servers: []
        };

        this.users.set(newUser.email, newUser);
        this.saveUsers();

        return { success: true, user: newUser };
    }

    login(email, password) {
        const errors = [];

        if (!email) {
            errors.push('Введите email');
        }

        if (!password) {
            errors.push('Введите пароль');
        }

        if (errors.length > 0) {
            return { success: false, errors };
        }

        const user = this.users.get(email);

        if (!user) {
            errors.push('Пользователь с таким email не найден');
            return { success: false, errors };
        }

        if (user.password !== password) {
            errors.push('Неверный пароль');
            return { success: false, errors };
        }

        this.currentUser = { ...user };
        delete this.currentUser.password;

        localStorage.setItem('currentSession', JSON.stringify(this.currentUser));

        return { success: true, user: this.currentUser };
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('currentSession');
    }

    getCurrentUser() {
        if (!this.currentUser) {
            const savedSession = localStorage.getItem('currentSession');
            if (savedSession) {
                this.currentUser = JSON.parse(savedSession);
            }
        }
        return this.currentUser;
    }

    isLoggedIn() {
        return this.getCurrentUser() !== null;
    }
}

class DiscordApp {
    constructor() {
        this.auth = new AuthManager();
        this.servers = [];
        this.currentServer = null;
        this.currentChannel = null;
        this.friends = [];
        this.directMessages = {};
        this.currentDM = null;
        
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.isInCall = false;
        this.isCaller = false;

        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.initializeApp();
    }

    initializeApp() {
        this.setupEventListeners();
        this.loadAppData();
        this.checkAuthState();
    }

    setupEventListeners() {
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('register-form').addEventListener('submit', (e) => this.handleRegister(e));
        document.getElementById('register-link').addEventListener('click', (e) => {
            e.preventDefault();
            this.showModal('register-modal');
        });
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());

        document.getElementById('create-server-btn').addEventListener('click', () => this.showModal('create-server-modal'));
        document.getElementById('confirm-create-server').addEventListener('click', () => this.createServer());

        document.getElementById('create-channel-btn').addEventListener('click', () => this.showModal('create-channel-modal'));
        document.getElementById('confirm-create-channel').addEventListener('click', () => this.createChannel());

        document.getElementById('add-friend-btn').addEventListener('click', () => this.showModal('add-friend-modal'));
        document.getElementById('add-friend-btn-sidebar').addEventListener('click', () => this.showModal('add-friend-modal'));
        document.getElementById('friends-list-btn').addEventListener('click', () => this.showFriendsList());
        document.getElementById('confirm-add-friend').addEventListener('click', () => this.addFriend());

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        document.getElementById('start-call-btn').addEventListener('click', () => this.startCall());
        document.getElementById('end-call-btn').addEventListener('click', () => this.endCall());
        document.getElementById('toggle-mic-btn').addEventListener('click', () => this.toggleMicrophone());
        document.getElementById('toggle-speaker-btn').addEventListener('click', () => this.toggleSpeaker());
        document.getElementById('screen-share-btn').addEventListener('click', () => this.toggleScreenShare());
        document.getElementById('toggle-camera-btn').addEventListener('click', () => this.toggleCamera());
        
        document.getElementById('accept-call-btn').addEventListener('click', () => this.acceptCall());
        document.getElementById('reject-call-btn').addEventListener('click', () => this.rejectCall());

        document.getElementById('send-message-btn').addEventListener('click', () => this.sendMessage());
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        document.querySelectorAll('.cancel-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.hideModal(modal.id);
                }
            });
        });

        document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
            backdrop.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.hideModal(modal.id);
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
            
            if (e.key === 'F2' && !this.isInCall && this.auth.isLoggedIn()) {
                this.simulateIncomingCall();
            }
        });
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const loginBtn = document.getElementById('login-btn');
        
        this.clearAuthErrors();
        this.showAuthMessage('', '');
        
        let hasErrors = false;
        
        if (!email) {
            this.showInputError('email-error', 'Введите email');
            hasErrors = true;
        } else if (!this.auth.validateEmail(email)) {
            this.showInputError('email-error', 'Введите корректный email');
            hasErrors = true;
        }
        
        if (!password) {
            this.showInputError('password-error', 'Введите пароль');
            hasErrors = true;
        }
        
        if (hasErrors) return;
        
        this.setButtonLoading(loginBtn, true);
        
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const result = this.auth.login(email, password);
            
            if (result.success) {
                this.showAuthMessage('Успешный вход!', 'success');
                
                setTimeout(() => {
                    this.currentUser = result.user;
                    this.showAppPage();
                    this.initializeUserData();
                }, 1000);
                
            } else {
                this.showAuthMessage(result.errors[0], 'error');
                result.errors.forEach(error => {
                    if (error.includes('email')) {
                        this.showInputError('email-error', error);
                    } else if (error.includes('парол')) {
                        this.showInputError('password-error', error);
                    }
                });
            }
        } catch (error) {
            this.showAuthMessage('Произошла ошибка при входе', 'error');
            console.error('Login error:', error);
        } finally {
            this.setButtonLoading(loginBtn, false);
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        
        const formData = {
            username: document.getElementById('register-username').value.trim(),
            email: document.getElementById('register-email').value.trim(),
            password: document.getElementById('register-password').value,
            confirmPassword: document.getElementById('register-confirm-password').value
        };
        
        const registerBtn = document.getElementById('register-btn');
        
        this.clearRegisterErrors();
        
        this.setButtonLoading(registerBtn, true);
        
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const result = this.auth.register(formData);
            
            if (result.success) {
                this.showAuthMessage('Аккаунт успешно создан!', 'success', 'register-modal');
                
                setTimeout(() => {
                    this.hideModal('register-modal');
                    this.clearRegisterForm();
                    
                    this.auth.login(formData.email, formData.password);
                    this.currentUser = this.auth.currentUser;
                    this.showAppPage();
                    this.initializeUserData();
                }, 1500);
                
            } else {
                result.errors.forEach(error => {
                    if (error.includes('email')) {
                        this.showInputError('register-email-error', error);
                    } else if (error.includes('Имя пользователя')) {
                        this.showInputError('username-error', error);
                    } else if (error.includes('Парол')) {
                        this.showInputError('register-password-error', error);
                    } else if (error.includes('совпадают')) {
                        this.showInputError('confirm-password-error', error);
                    } else {
                        this.showInputError('register-email-error', error);
                    }
                });
            }
        } catch (error) {
            this.showInputError('register-email-error', 'Произошла ошибка при регистрации');
        } finally {
            this.setButtonLoading(registerBtn, false);
        }
    }

    handleLogout() {
        this.auth.logout();
        this.currentUser = null;
        this.endCall();
        this.saveAppData();
        this.showAuthPage();
        this.clearLoginForm();
    }

    checkAuthState() {
        const user = this.auth.getCurrentUser();
        if (user) {
            this.currentUser = user;
            this.showAppPage();
            this.initializeUserData();
        } else {
            this.showAuthPage();
        }
    }

    clearAuthErrors() {
        document.querySelectorAll('.input-error').forEach(el => {
            el.textContent = '';
        });
    }

    clearRegisterErrors() {
        document.getElementById('username-error').textContent = '';
        document.getElementById('register-email-error').textContent = '';
        document.getElementById('register-password-error').textContent = '';
        document.getElementById('confirm-password-error').textContent = '';
    }

    showInputError(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
        }
    }

    showAuthMessage(message, type = 'info', context = 'auth') {
        const messageElement = document.getElementById('auth-message');
        if (messageElement) {
            messageElement.textContent = message;
            messageElement.className = `auth-message ${type}`;
            messageElement.style.display = message ? 'block' : 'none';
        }
    }

    setButtonLoading(button, isLoading) {
        const btnText = button.querySelector('.btn-text');
        const btnLoader = button.querySelector('.btn-loader');
        
        if (isLoading) {
            button.disabled = true;
            btnText.style.opacity = '0';
            btnLoader.classList.remove('hidden');
        } else {
            button.disabled = false;
            btnText.style.opacity = '1';
            btnLoader.classList.add('hidden');
        }
    }

    clearLoginForm() {
        document.getElementById('login-form').reset();
        this.clearAuthErrors();
        this.showAuthMessage('', '');
    }

    clearRegisterForm() {
        document.getElementById('register-form').reset();
        this.clearRegisterErrors();
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }

    showAuthPage() {
        document.getElementById('auth-page').classList.add('active');
        document.getElementById('app-page').classList.remove('active');
        this.clearLoginForm();
    }

    showAppPage() {
        document.getElementById('auth-page').classList.remove('active');
        document.getElementById('app-page').classList.add('active');
        
        if (this.currentUser) {
            document.getElementById('username-display').textContent = this.currentUser.username;
            const userAvatar = document.getElementById('user-avatar');
            if (userAvatar) {
                userAvatar.textContent = this.currentUser.avatar;
            }
        }
    }

    initializeUserData() {
        this.loadAppData();
        
        if (this.servers.length === 0) {
            this.createDefaultServer();
        }

        this.currentServer = this.servers[0];
        this.currentChannel = this.currentServer.channels.find(ch => ch.type === 'text') || this.currentServer.channels[0];
        
        this.renderServers();
        this.renderChannels();
        this.renderMessages();
        this.renderFriendsSidebar();
        
        console.log('Данные пользователя инициализированы:', this.currentUser.username);
    }

    createDefaultServer() {
        const defaultServer = {
            id: 'default_server',
            name: 'Мой сервер',
            owner: this.currentUser.id,
            channels: [
                {
                    id: 'general',
                    name: 'general',
                    type: 'text',
                    serverId: 'default_server',
                    adminOnly: false,
                    messages: [
                        {
                            id: '1',
                            author: this.currentUser.username,
                            authorId: this.currentUser.id,
                            content: 'Добро пожаловать на сервер! 🎉',
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            date: new Date().toLocaleDateString()
                        },
                        {
                            id: '2', 
                            author: 'System',
                            authorId: 'system',
                            content: 'Это начало канала #general. Начните общение!',
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            date: new Date().toLocaleDateString()
                        }
                    ]
                },
                {
                    id: 'voice',
                    name: 'Общий',
                    type: 'voice',
                    serverId: 'default_server',
                    adminOnly: false
                }
            ],
            members: [this.currentUser.id],
            roles: {}
        };
        this.servers.push(defaultServer);
        this.saveAppData();
    }

    loadAppData() {
        try {
            if (this.currentUser) {
                const userData = localStorage.getItem(`discordApp_${this.currentUser.id}`);
                if (userData) {
                    const data = JSON.parse(userData);
                    this.servers = data.servers || [];
                    this.friends = data.friends || [];
                    this.directMessages = data.directMessages || {};
                } else {
                    this.initializeTestData();
                }
            }
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            this.servers = [];
            this.friends = [];
            this.directMessages = {};
        }
    }

    saveAppData() {
        if (this.currentUser) {
            const data = {
                servers: this.servers,
                friends: this.friends,
                directMessages: this.directMessages,
                lastSaved: new Date().toISOString()
            };
            localStorage.setItem(`discordApp_${this.currentUser.id}`, JSON.stringify(data));
        }
    }

    initializeTestData() {
        if (this.friends.length === 0) {
            this.friends = [
                {
                    id: 'friend1',
                    email: 'alex@test.com',
                    username: 'Alex',
                    status: 'online',
                    isBlocked: false,
                    lastActive: '12:30',
                    unreadCount: 2,
                    avatar: 'A'
                },
                {
                    id: 'friend2', 
                    email: 'maria@test.com',
                    username: 'Maria',
                    status: 'online',
                    isBlocked: false,
                    lastActive: '11:45',
                    unreadCount: 0,
                    avatar: 'M'
                }
            ];
        }
    }

    // СЕРВЕРЫ И КАНАЛЫ
    createServer() {
        const nameInput = document.getElementById('server-name-input');
        const name = nameInput.value.trim();
        
        if (!name) {
            this.showNotification('Введите название сервера', 'error');
            return;
        }

        const server = {
            id: Date.now().toString(),
            name: name,
            owner: this.currentUser.id,
            channels: [],
            members: [this.currentUser.id],
            roles: {}
        };

        const generalTextChannel = {
            id: Date.now().toString() + '_text',
            name: 'general',
            type: 'text',
            serverId: server.id,
            adminOnly: false,
            messages: []
        };

        const generalVoiceChannel = {
            id: Date.now().toString() + '_voice',
            name: 'Общий',
            type: 'voice',
            serverId: server.id,
            adminOnly: false
        };

        server.channels.push(generalTextChannel, generalVoiceChannel);
        this.servers.push(server);
        this.currentServer = server;
        this.currentChannel = generalTextChannel;
        this.currentDM = null;

        this.hideModal('create-server-modal');
        nameInput.value = '';
        this.renderServers();
        this.renderChannels();
        this.renderMessages();
        this.saveAppData();
        
        this.showNotification(`Сервер "${name}" создан`, 'success');
    }

    createChannel() {
        const nameInput = document.getElementById('channel-name-input');
        const name = nameInput.value.trim();
        const type = document.getElementById('channel-type-select').value;
        const adminOnly = document.getElementById('admin-only-checkbox').checked;

        if (!name || !this.currentServer) {
            this.showNotification('Введите название канала', 'error');
            return;
        }

        const channel = {
            id: Date.now().toString(),
            name: name,
            type: type,
            serverId: this.currentServer.id,
            adminOnly: adminOnly,
            messages: []
        };

        this.currentServer.channels.push(channel);
        this.hideModal('create-channel-modal');
        
        nameInput.value = '';
        document.getElementById('admin-only-checkbox').checked = false;
        
        this.renderChannels();
        this.saveAppData();
        
        this.showNotification(`Канал "${name}" создан`, 'success');
    }

    // ДРУЗЬЯ И ЛИЧНЫЕ СООБЩЕНИЯ
    addFriend() {
        const emailInput = document.getElementById('friend-email-input');
        const email = emailInput.value.trim();
        
        if (!email) {
            this.showNotification('Введите email друга', 'error');
            return;
        }

        if (this.friends.some(f => f.email === email)) {
            this.showNotification('Этот пользователь уже в списке друзей', 'error');
            return;
        }

        if (email === this.currentUser.email) {
            this.showNotification('Нельзя добавить себя в друзья', 'error');
            return;
        }

        const friend = {
            id: Date.now().toString(),
            email: email,
            username: email.split('@')[0],
            status: 'online',
            isBlocked: false,
            lastActive: new Date().toLocaleTimeString(),
            unreadCount: 0,
            lastMessage: null,
            avatar: email.charAt(0).toUpperCase()
        };

        this.friends.push(friend);
        
        const chatId = this.getDMId(friend.id);
        if (!this.directMessages[chatId]) {
            this.directMessages[chatId] = {
                id: chatId,
                participants: [this.currentUser.id, friend.id],
                messages: [],
                lastActivity: new Date()
            };
        }

        this.hideModal('add-friend-modal');
        emailInput.value = '';
        this.renderFriendsSidebar();
        this.renderFriendsList();
        this.saveAppData();

        this.showNotification(`Друг ${friend.username} добавлен`, 'success');
    }

    getDMId(friendId) {
        const ids = [this.currentUser.id, friendId].sort();
        return `dm_${ids.join('_')}`;
    }

    removeFriend(friendId) {
        this.friends = this.friends.filter(f => f.id !== friendId);
        
        const chatId = this.getDMId(friendId);
        delete this.directMessages[chatId];

        if (this.currentDM && this.currentDM.participants.includes(friendId)) {
            this.currentDM = null;
            if (this.currentServer && this.currentServer.channels.length > 0) {
                this.currentChannel = this.currentServer.channels.find(ch => ch.type === 'text');
            }
            this.renderMessages();
        }

        this.renderFriendsSidebar();
        this.renderFriendsList();
        this.saveAppData();
        
        this.showNotification('Друг удален', 'info');
    }

    blockFriend(friendId) {
        const friend = this.friends.find(f => f.id === friendId);
        if (friend) {
            friend.isBlocked = !friend.isBlocked;
            this.renderFriendsSidebar();
            this.renderFriendsList();
            this.saveAppData();
            
            this.showNotification(
                friend.isBlocked ? 'Друг заблокирован' : 'Друг разблокирован', 
                'info'
            );
        }
    }

    openDM(friendId) {
        const friend = this.friends.find(f => f.id === friendId);
        if (!friend || friend.isBlocked) return;

        const chatId = this.getDMId(friendId);
        
        if (!this.directMessages[chatId]) {
            this.directMessages[chatId] = {
                id: chatId,
                participants: [this.currentUser.id, friendId],
                messages: [],
                lastActivity: new Date()
            };
        }

        this.currentDM = this.directMessages[chatId];
        this.currentChannel = null;
        
        friend.unreadCount = 0;

        this.renderFriendsSidebar();
        this.renderMessages();
        this.updateChatHeader();
        this.saveAppData();
    }

    sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (!content) return;

        let message = {
            id: Date.now().toString(),
            author: this.currentUser.username,
            authorId: this.currentUser.id,
            content: content,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            date: new Date().toLocaleDateString()
        };

        if (this.currentDM) {
            message.chatId = this.currentDM.id;
            this.currentDM.messages.push(message);
            this.currentDM.lastActivity = new Date();

            const friendId = this.currentDM.participants.find(id => id !== this.currentUser.id);
            const friend = this.friends.find(f => f.id === friendId);
            if (friend) {
                friend.lastMessage = {
                    content: content.length > 30 ? content.substring(0, 30) + '...' : content,
                    timestamp: message.timestamp
                };
                
                friend.unreadCount += 1;
            }
        } else if (this.currentChannel) {
            message.channelId = this.currentChannel.id;
            if (!this.currentChannel.messages) {
                this.currentChannel.messages = [];
            }
            this.currentChannel.messages.push(message);
        } else {
            return;
        }

        this.renderMessages();
        input.value = '';
        this.saveAppData();

        const messagesContainer = document.getElementById('chat-messages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // РЕНДЕРИНГ
    renderServers() {
        const serverList = document.getElementById('server-list');
        if (!serverList) return;
        
        serverList.innerHTML = '';

        this.servers.forEach(server => {
            const serverElement = document.createElement('div');
            serverElement.className = `server-icon ${server === this.currentServer ? 'active' : ''}`;
            serverElement.textContent = server.name.charAt(0).toUpperCase();
            serverElement.title = server.name;
            serverElement.addEventListener('click', () => this.selectServer(server));
            serverList.appendChild(serverElement);
        });
    }

    renderChannels() {
        if (!this.currentServer) return;

        const textChannels = document.getElementById('text-channels');
        const voiceChannels = document.getElementById('voice-channels');
        
        if (!textChannels || !voiceChannels) return;

        textChannels.innerHTML = '';
        voiceChannels.innerHTML = '';

        document.getElementById('current-server-name').textContent = this.currentServer.name;

        this.currentServer.channels.forEach(channel => {
            const channelElement = document.createElement('div');
            channelElement.className = `channel ${channel === this.currentChannel ? 'active' : ''}`;
            
            const icon = channel.type === 'text' ? '#' : '🔊';
            channelElement.innerHTML = `
                <span class="channel-icon">${icon}</span>
                <span class="channel-name">${channel.name}</span>
            `;
            
            channelElement.addEventListener('click', () => this.selectChannel(channel));

            if (channel.type === 'text') {
                textChannels.appendChild(channelElement);
            } else if (channel.type === 'voice') {
                voiceChannels.appendChild(channelElement);
            }
        });
    }

    renderFriendsSidebar() {
        const friendsList = document.getElementById('friends-sidebar-list');
        if (!friendsList) return;
        
        friendsList.innerHTML = '';

        if (this.friends.length === 0) {
            friendsList.innerHTML = `
                <div class="no-friends">
                    <p>Пока нет друзей</p>
                    <small>Добавьте друзей, чтобы начать общение</small>
                </div>
            `;
            return;
        }

        const sortedFriends = [...this.friends]
            .filter(friend => !friend.isBlocked)
            .sort((a, b) => {
                const aHasMessages = this.directMessages[this.getDMId(a.id)]?.messages.length > 0;
                const bHasMessages = this.directMessages[this.getDMId(b.id)]?.messages.length > 0;
                
                if (aHasMessages && !bHasMessages) return -1;
                if (!aHasMessages && bHasMessages) return 1;
                
                if (aHasMessages && bHasMessages) {
                    const aChat = this.directMessages[this.getDMId(a.id)];
                    const bChat = this.directMessages[this.getDMId(b.id)];
                    return new Date(bChat.lastActivity) - new Date(aChat.lastActivity);
                }
                
                return a.username.localeCompare(b.username);
            });

        sortedFriends.forEach(friend => {
            const chatId = this.getDMId(friend.id);
            const chat = this.directMessages[chatId];
            const lastMessage = chat?.messages[chat.messages.length - 1];
            const isActive = this.currentDM && this.currentDM.participants.includes(friend.id);

            const friendElement = document.createElement('div');
            friendElement.className = `friend-chat-item ${isActive ? 'active' : ''}`;
            friendElement.addEventListener('click', () => this.openDM(friend.id));
            
            friendElement.innerHTML = `
                <div class="friend-avatar">${friend.avatar}</div>
                <div class="friend-info">
                    <div class="friend-name">${friend.username}</div>
                    <div class="last-message">${lastMessage ? lastMessage.content : 'Нет сообщений'}</div>
                </div>
                ${friend.unreadCount > 0 ? `<div class="unread-badge">${friend.unreadCount}</div>` : ''}
            `;

            friendsList.appendChild(friendElement);
        });
    }

    renderMessages() {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return;
        
        messagesContainer.innerHTML = '';

        let messages = [];
        let chatTitle = '';

        if (this.currentDM) {
            messages = this.currentDM.messages || [];
            const friendId = this.currentDM.participants.find(id => id !== this.currentUser.id);
            const friend = this.friends.find(f => f.id === friendId);
            chatTitle = friend ? friend.username : 'Неизвестный пользователь';
            document.getElementById('current-channel-name').innerHTML = `
                <span class="channel-icon">👤</span>
                <span class="channel-text">${chatTitle}</span>
            `;
        } else if (this.currentChannel) {
            messages = this.currentChannel.messages || [];
            chatTitle = this.currentChannel.name;
            document.getElementById('current-channel-name').innerHTML = `
                <span class="channel-icon">#</span>
                <span class="channel-text">${chatTitle}</span>
            `;
        } else {
            messagesContainer.innerHTML = `
                <div class="welcome-message">
                    <div class="welcome-icon">👋</div>
                    <h3>Добро пожаловать в MyDiscord!</h3>
                    <p>Выберите канал или начните общение с другом</p>
                </div>
            `;
            return;
        }

        if (messages.length === 0) {
            messagesContainer.innerHTML = `
                <div class="welcome-message">
                    <div class="welcome-icon">💬</div>
                    <h3>Это начало ${this.currentDM ? 'вашей переписки' : `канала #${chatTitle}`}</h3>
                    <p>Отправьте первое сообщение!</p>
                </div>
            `;
            return;
        }

        const groupedMessages = this.groupMessagesByDate(messages);

        Object.keys(groupedMessages).forEach(date => {
            const dateSeparator = document.createElement('div');
            dateSeparator.className = 'date-separator';
            dateSeparator.textContent = date;
            dateSeparator.style.textAlign = 'center';
            dateSeparator.style.color = '#72767d';
            dateSeparator.style.margin = '1rem 0';
            dateSeparator.style.fontSize = '0.8rem';
            dateSeparator.style.fontWeight = '600';
            messagesContainer.appendChild(dateSeparator);

            groupedMessages[date].forEach(message => {
                const messageElement = document.createElement('div');
                messageElement.className = `message ${this.currentDM ? 'dm-message' : ''}`;
                
                messageElement.innerHTML = `
                    <div class="message-with-avatar">
                        <div class="message-avatar">${message.author.charAt(0).toUpperCase()}</div>
                        <div class="message-content-wrapper">
                            <div class="message-header">
                                <span class="message-author">${message.author}</span>
                                <span class="message-time">${message.timestamp}</span>
                            </div>
                            <div class="message-content">${message.content}</div>
                        </div>
                    </div>
                `;
                
                messagesContainer.appendChild(messageElement);
            });
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    groupMessagesByDate(messages) {
        const groups = {};
        messages.forEach(message => {
            const date = message.date || new Date().toLocaleDateString();
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(message);
        });
        return groups;
    }

    renderFriendsList() {
        const friendsList = document.getElementById('friends-list');
        if (!friendsList) return;
        
        friendsList.innerHTML = '';

        if (this.friends.length === 0) {
            friendsList.innerHTML = '<div class="no-friends">Пока нет друзей</div>';
            return;
        }

        this.friends.forEach(friend => {
            const friendElement = document.createElement('div');
            friendElement.className = 'friend-item';
            friendElement.innerHTML = `
                <div class="friend-info">
                    <div class="friend-name">${friend.username}</div>
                    <div class="friend-status">${friend.isBlocked ? 'Заблокирован' : 'В сети'}</div>
                </div>
                <div class="friend-actions">
                    <button class="remove-friend" onclick="app.removeFriend('${friend.id}')">Удалить</button>
                    <button class="block-friend" onclick="app.blockFriend('${friend.id}')">
                        ${friend.isBlocked ? 'Разблокировать' : 'Заблокировать'}
                    </button>
                </div>
            `;
            friendsList.appendChild(friendElement);
        });
    }

    updateChatHeader() {
        const chatInfo = document.getElementById('chat-info');
        if (!chatInfo) return;
        
        if (this.currentDM) {
            const friendId = this.currentDM.participants.find(id => id !== this.currentUser.id);
            const friend = this.friends.find(f => f.id === friendId);
            if (friend) {
                chatInfo.innerHTML = `
                    <div class="chat-details">
                        <span class="user-status">В сети</span>
                    </div>
                `;
            }
        } else {
            chatInfo.innerHTML = '';
        }
    }

    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    showModal(modalId) {
        if (!this.auth.isLoggedIn() && modalId !== 'register-modal') {
            this.showNotification('Пожалуйста, войдите в систему', 'error');
            return;
        }
        document.getElementById(modalId).classList.add('active');
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');

        if (tabName === 'friends') {
            this.renderFriendsSidebar();
        }
    }

    selectServer(server) {
        this.currentServer = server;
        this.currentChannel = server.channels.find(ch => ch.type === 'text') || server.channels[0];
        this.currentDM = null;
        this.renderServers();
        this.renderChannels();
        this.renderMessages();
        this.updateChatHeader();
    }

    selectChannel(channel) {
        this.currentChannel = channel;
        this.currentDM = null;
        this.renderChannels();
        this.renderMessages();
        this.updateChatHeader();
    }

    showFriendsList() {
        this.renderFriendsList();
        this.showModal('friends-list-modal');
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // ЗВОНКИ
    async startCall() {
        if (!this.currentDM && !this.currentChannel) {
            this.showNotification('Выберите чат для звонка', 'error');
            return;
        }

        if (this.isInCall) {
            this.showNotification('У вас уже есть активный звонок', 'warning');
            return;
        }

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.isCaller = true;
            this.isInCall = true;

            this.createPeerConnection();

            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            this.showCallWindow();
            this.showNotification('Звонок начат', 'success');

            setTimeout(() => {
                if (this.isInCall) {
                    this.simulateIncomingAnswer();
                }
            }, 2000);

        } catch (error) {
            console.error('Ошибка при запуске звонка:', error);
            this.showNotification('Не удалось получить доступ к камере/микрофону', 'error');
            this.isInCall = false;
        }
    }

    async acceptCall() {
        if (!this.localStream) {
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
            } catch (error) {
                console.error('Ошибка доступа к медиаустройствам:', error);
                this.showNotification('Не удалось получить доступ к камере/микрофону', 'error');
                return;
            }
        }

        this.isCaller = false;
        this.isInCall = true;

        this.createPeerConnection();

        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });

        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        this.hideModal('incoming-call-modal');
        this.showCallWindow();
        this.showNotification('Звонок принят', 'success');
    }

    rejectCall() {
        this.hideModal('incoming-call-modal');
        this.cleanupCall();
        this.showNotification('Звонок отклонен', 'info');
    }

    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.rtcConfig);

        this.peerConnection.ontrack = (event) => {
            console.log('Получен удаленный поток');
            this.remoteStream = event.streams[0];
            const remoteVideo = document.getElementById('remote-video');
            if (remoteVideo) {
                remoteVideo.srcObject = this.remoteStream;
            }
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Новый ICE кандидат');
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('Состояние соединения:', this.peerConnection.connectionState);
            
            switch (this.peerConnection.connectionState) {
                case 'connected':
                    this.showNotification('Соединение установлено', 'success');
                    break;
                case 'disconnected':
                case 'failed':
                    this.showNotification('Соединение прервано', 'error');
                    this.endCall();
                    break;
            }
        };

        if (this.isCaller) {
            this.dataChannel = this.peerConnection.createDataChannel('chat');
            this.setupDataChannel();
        } else {
            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };
        }
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log('Data channel открыт');
        };

        this.dataChannel.onmessage = (event) => {
            console.log('Получено сообщение:', event.data);
        };
    }

    async simulateIncomingAnswer() {
        if (this.peerConnection && this.peerConnection.signalingState === 'have-local-offer') {
            const fakePeerConnection = new RTCPeerConnection(this.rtcConfig);
            const answer = await fakePeerConnection.createAnswer();
            
            await this.peerConnection.setRemoteDescription(answer);
            
            fakePeerConnection.close();
        }
    }

    simulateIncomingCall() {
        if (this.isInCall) return;

        const testFriend = this.friends[0];
        if (!testFriend) return;

        document.getElementById('caller-avatar').textContent = testFriend.avatar;
        document.getElementById('caller-name').textContent = testFriend.username;
        document.getElementById('call-type').textContent = 'Видео звонок';

        this.showModal('incoming-call-modal');
    }

    showCallWindow() {
        const localVideo = document.getElementById('local-video');
        if (localVideo && this.localStream) {
            localVideo.srcObject = this.localStream;
        }

        document.getElementById('call-window').classList.remove('hidden');
        document.querySelector('.app-container').classList.add('in-call');
        
        const callBtn = document.getElementById('start-call-btn');
        if (callBtn) {
            callBtn.innerHTML = '<span class="call-icon">📞</span> В звонке';
            callBtn.style.background = 'var(--success)';
        }
    }

    endCall() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        this.isInCall = false;
        this.isCaller = false;
        this.dataChannel = null;

        document.getElementById('call-window').classList.add('hidden');
        document.querySelector('.app-container').classList.remove('in-call');

        const callBtn = document.getElementById('start-call-btn');
        if (callBtn) {
            callBtn.innerHTML = '<span class="call-icon">📞</span> Начать звонок';
            callBtn.style.background = '';
        }

        const localVideo = document.getElementById('local-video');
        const remoteVideo = document.getElementById('remote-video');
        if (localVideo) localVideo.srcObject = null;
        if (remoteVideo) remoteVideo.srcObject = null;

        this.showNotification('Звонок завершен', 'info');
    }

    cleanupCall() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.isInCall = false;
        this.isCaller = false;
    }

    toggleMicrophone() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                const btn = document.getElementById('toggle-mic-btn');
                if (btn) {
                    btn.innerHTML = audioTrack.enabled ? 
                        '<span class="control-icon">🎤</span><span class="control-text">Выкл микрофон</span>' :
                        '<span class="control-icon">🎤</span><span class="control-text">Вкл микрофон</span>';
                    btn.classList.toggle('active', !audioTrack.enabled);
                }
                this.showNotification(
                    audioTrack.enabled ? 'Микрофон включен' : 'Микрофон выключен', 
                    'info'
                );
            }
        }
    }

    toggleSpeaker() {
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) {
            remoteVideo.muted = !remoteVideo.muted;
            const btn = document.getElementById('toggle-speaker-btn');
            if (btn) {
                btn.innerHTML = remoteVideo.muted ? 
                    '<span class="control-icon">🔇</span><span class="control-text">Вкл звук</span>' :
                    '<span class="control-icon">🔊</span><span class="control-text">Выкл звук</span>';
                btn.classList.toggle('active', remoteVideo.muted);
            }
            this.showNotification(
                remoteVideo.muted ? 'Звук выключен' : 'Звук включен', 
                'info'
            );
        }
    }

    async toggleScreenShare() {
        try {
            if (this.localStream) {
                const videoTrack = this.localStream.getVideoTracks()[0];
                if (videoTrack && videoTrack.readyState === 'live' && 
                    videoTrack.label.includes('screen')) {
                    
                    const cameraStream = await navigator.mediaDevices.getUserMedia({ 
                        video: true 
                    });
                    const cameraTrack = cameraStream.getVideoTracks()[0];
                    
                    const sender = this.peerConnection.getSenders().find(s => 
                        s.track && s.track.kind === 'video'
                    );
                    if (sender) {
                        await sender.replaceTrack(cameraTrack);
                    }
                    
                    this.localStream.getVideoTracks().forEach(track => track.stop());
                    this.localStream.addTrack(cameraTrack);
                    
                    const localVideo = document.getElementById('local-video');
                    if (localVideo) {
                        localVideo.srcObject = this.localStream;
                    }
                    
                    this.showNotification('Демонстрация экрана остановлена', 'info');
                } else {
                    const screenStream = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: true
                    });
                    
                    const screenTrack = screenStream.getVideoTracks()[0];
                    
                    const sender = this.peerConnection.getSenders().find(s => 
                        s.track && s.track.kind === 'video'
                    );
                    if (sender) {
                        await sender.replaceTrack(screenTrack);
                    }
                    
                    this.localStream.getVideoTracks().forEach(track => track.stop());
                    this.localStream.addTrack(screenTrack);
                    
                    const localVideo = document.getElementById('local-video');
                    if (localVideo) {
                        localVideo.srcObject = this.localStream;
                    }
                    
                    this.showNotification('Демонстрация экрана начата', 'success');
                    
                    screenTrack.onended = () => {
                        this.toggleScreenShare();
                    };
                }
            }
        } catch (error) {
            console.error('Ошибка демонстрации экрана:', error);
            this.showNotification('Не удалось начать демонстрацию экрана', 'error');
        }
    }

    toggleCamera() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                const btn = document.getElementById('toggle-camera-btn');
                if (btn) {
                    btn.innerHTML = videoTrack.enabled ? 
                        '<span class="control-icon">📹</span><span class="control-text">Выкл камеру</span>' :
                        '<span class="control-icon">📹</span><span class="control-text">Вкл камеру</span>';
                    btn.classList.toggle('active', !videoTrack.enabled);
                }
                this.showNotification(
                    videoTrack.enabled ? 'Камера включена' : 'Камера выключена', 
                    'info'
                );
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new DiscordApp();
    
    console.log('🔐 Тестовые данные:');
    console.log('Email: test@test.com');
    console.log('Пароль: 123');
    console.log('💡 Нажмите F2 для тестирования входящего звонка');
});
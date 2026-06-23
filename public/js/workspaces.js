const WorkspaceManager = {
    workspaces: [],
    currentWorkspaceId: CONFIG.WORKSPACE.DEFAULT_ID,
    elements: {},

    async init() {
        this.cacheElements();
        this.currentWorkspaceId = this.loadSavedWorkspaceId();
        this.bindEvents();
        await this.loadWorkspaces();
        this.applyCurrentWorkspace();
    },

    cacheElements() {
        this.elements = {
            selector: document.getElementById('workspaceSelector'),
            addButton: document.getElementById('workspaceAddButton'),
            activeDot: document.getElementById('workspaceActiveDot'),
        };
    },

    bindEvents() {
        if (this.elements.selector) {
            this.elements.selector.addEventListener('change', async (event) => {
                await this.switchWorkspace(event.target.value);
            });
        }

        if (this.elements.addButton) {
            this.elements.addButton.addEventListener('click', async () => {
                await this.promptCreateWorkspace();
            });
        }
    },

    loadSavedWorkspaceId() {
        try {
            return localStorage.getItem(CONFIG.WORKSPACE.STORAGE_KEY) || CONFIG.WORKSPACE.DEFAULT_ID;
        } catch {
            return CONFIG.WORKSPACE.DEFAULT_ID;
        }
    },

    saveWorkspaceId(workspaceId) {
        try {
            localStorage.setItem(CONFIG.WORKSPACE.STORAGE_KEY, workspaceId);
        } catch {
            // Ignore localStorage failures.
        }
    },

    async loadWorkspaces() {
        try {
            this.workspaces = await API.getWorkspaces();
            if (!this.workspaces.some(workspace => workspace.id === this.currentWorkspaceId)) {
                this.currentWorkspaceId = this.getDefaultWorkspace().id;
                this.saveWorkspaceId(this.currentWorkspaceId);
            }
            this.renderSelector();
        } catch (error) {
            console.error('[WorkspaceManager] 工作区加载失败:', error);
            this.workspaces = [{
                id: CONFIG.WORKSPACE.DEFAULT_ID,
                name: '默认',
                color: '#07c160',
                isDefault: true,
            }];
            this.currentWorkspaceId = CONFIG.WORKSPACE.DEFAULT_ID;
            this.renderSelector();
        }
    },

    getDefaultWorkspace() {
        return this.workspaces.find(workspace => workspace.isDefault) ||
            this.workspaces[0] ||
            { id: CONFIG.WORKSPACE.DEFAULT_ID, name: '默认', color: '#07c160', isDefault: true };
    },

    getCurrentWorkspaceId() {
        return this.currentWorkspaceId || CONFIG.WORKSPACE.DEFAULT_ID;
    },

    getCurrentWorkspace() {
        return this.workspaces.find(workspace => workspace.id === this.getCurrentWorkspaceId()) || this.getDefaultWorkspace();
    },

    renderSelector() {
        const selector = this.elements.selector;
        if (!selector) return;

        selector.innerHTML = '';
        this.workspaces.forEach((workspace) => {
            const option = document.createElement('option');
            option.value = workspace.id;
            option.textContent = workspace.name;
            selector.appendChild(option);
        });
        selector.value = this.getCurrentWorkspaceId();
        this.updateActiveMarker();
    },

    updateActiveMarker() {
        const workspace = this.getCurrentWorkspace();
        if (this.elements.activeDot) {
            this.elements.activeDot.style.background = workspace.color || '#07c160';
        }
        if (this.elements.selector) {
            this.elements.selector.title = `当前工作区：${workspace.name}`;
        }
    },

    applyCurrentWorkspace() {
        this.updateActiveMarker();
        document.dispatchEvent(new CustomEvent('workspace:changed', {
            detail: { workspaceId: this.getCurrentWorkspaceId(), workspace: this.getCurrentWorkspace() }
        }));
    },

    async switchWorkspace(workspaceId) {
        if (!workspaceId || workspaceId === this.currentWorkspaceId) return;

        this.currentWorkspaceId = workspaceId;
        this.saveWorkspaceId(workspaceId);
        this.updateActiveMarker();

        if (typeof API !== 'undefined' && API.clearImageBlobCache) {
            API.clearImageBlobCache();
        }
        if (typeof SearchAPI !== 'undefined' && SearchAPI.clearCache) {
            SearchAPI.clearCache();
        }
        if (typeof MessageHandler !== 'undefined' && MessageHandler.resetForWorkspace) {
            await MessageHandler.resetForWorkspace();
        }

        this.applyCurrentWorkspace();
    },

    async promptCreateWorkspace() {
        const name = await Utils.showInputDialog({
            title: '新建工作区',
            message: '输入一个名称，马上就会创建并切换过去。',
            placeholder: '例如：项目组、测试环境、个人',
            defaultValue: '',
            confirmText: '创建',
            cancelText: '取消',
            helperText: '名称最多 40 个字符。',
            maxLength: 40,
            validate: (value) => value.length > 0 || '工作区名称不能为空',
        });

        if (!name) return;

        try {
            const workspace = await API.createWorkspace({ name });
            await this.loadWorkspaces();
            await this.switchWorkspace(workspace.id);
            UI.showSuccess('工作区已创建');
        } catch (error) {
            UI.showError(error.message || '创建工作区失败');
        }
    },
};

window.WorkspaceManager = WorkspaceManager;

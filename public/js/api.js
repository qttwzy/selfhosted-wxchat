// API 接口封装 - 重构版：加 AbortController 超时，改 getMessages 静默失败为透传

const API = {
    getWorkspaceId(explicitWorkspaceId = null) {
        if (explicitWorkspaceId) return explicitWorkspaceId;
        if (typeof WorkspaceManager !== 'undefined' && WorkspaceManager.getCurrentWorkspaceId) {
            return WorkspaceManager.getCurrentWorkspaceId();
        }
        return CONFIG.WORKSPACE?.DEFAULT_ID || 'default';
    },

    withWorkspaceHeaders(headers = {}, workspaceId = null) {
        return {
            ...headers,
            'X-Workspace-Id': this.getWorkspaceId(workspaceId),
        };
    },

    // 通用请求方法（支持超时）
    async request(url, options = {}) {
        const { timeout = 15000, workspaceId = null, skipWorkspace = false, ...fetchOptions } = options;

        const defaultHeaders = {
            'Content-Type': 'application/json',
        };

        const authHeaders = Auth ? Auth.addAuthHeader(defaultHeaders) : defaultHeaders;
        const workspaceHeaders = skipWorkspace ? authHeaders : this.withWorkspaceHeaders(authHeaders, workspaceId);

        const config = {
            ...fetchOptions,
            headers: {
                ...workspaceHeaders,
                ...(fetchOptions.headers || {}),
            },
        };

        // 支持超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...config,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                throw error;
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }

            return response;
        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error(`请求超时: ${url}`);
            }

            console.error('[API] 请求失败:', url, error.message);
            throw error;
        }
    },
    
    // GET 请求
    async get(url, params = {}, options = {}) {
        const urlParams = new URLSearchParams(params);
        const fullUrl = urlParams.toString() ? `${url}?${urlParams}` : url;
        return this.request(fullUrl, { method: 'GET', ...options });
    },
    
    // POST 请求
    async post(url, data = {}, options = {}) {
        return this.request(url, {
            method: 'POST',
            body: JSON.stringify(data),
            ...options,
        });
    },

    // 按运行时开关附带消息设备信息
    withDeviceInfo(payload, deviceInfo = Utils.getMessageDeviceInfo()) {
        if (deviceInfo) {
            return { ...payload, deviceInfo };
        }
        return payload;
    },
    
    // 文件上传请求
    async upload(url, formData, workspaceId = null) {
        const authHeaders = Auth ? Auth.addAuthHeader({}) : {};
        const headers = this.withWorkspaceHeaders(authHeaders, workspaceId);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 文件上传60秒超时

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: formData,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('文件上传超时');
            }
            throw error;
        }
    },
    
    // 获取消息列表（修复：不再静默返回空数组，让调用方处理错误）
    async getMessages(limit = CONFIG.UI.MESSAGE_LOAD_LIMIT, offset = 0, workspaceId = null) {
        const response = await this.get(CONFIG.API.ENDPOINTS.MESSAGES, { limit, offset }, { workspaceId });

        if (response && response.success) {
            return response.data || [];
        }

        // 不再静默返回空数组，抛出错误让调用方处理
        throw new Error(response?.error || CONFIG.ERRORS.LOAD_MESSAGES_FAILED);
    },
    
    // 发送文本消息
    async sendMessage(content, deviceId, deviceInfo = Utils.getMessageDeviceInfo(), workspaceId = null) {
        const response = await this.post(
            CONFIG.API.ENDPOINTS.MESSAGES,
            this.withDeviceInfo({ content, deviceId }, deviceInfo),
            { workspaceId }
        );

        if (response.success) {
            return response.data;
        }
        throw new Error(response.error || CONFIG.ERRORS.MESSAGE_SEND_FAILED);
    },

    // 发送AI消息
    async sendAIMessage(content, deviceId = 'ai-system', type = 'ai_response', deviceInfo = null, workspaceId = null) {
        const response = await this.post(CONFIG.API.ENDPOINTS.AI_MESSAGE || '/api/ai/message', {
            content,
            deviceId,
            type,
            ...(deviceInfo ? { deviceInfo } : {})
        }, { workspaceId });

        if (response && response.success) {
            return response.data;
        }
        throw new Error(response?.error || 'AI消息发送失败');
    },
    
    // 上传文件
    async uploadFile(file, deviceId, onProgress = null, deviceInfo = Utils.getMessageDeviceInfo(), workspaceId = null) {
        if (!Utils.validateFileSize(file.size)) {
            throw new Error(CONFIG.ERRORS.FILE_TOO_LARGE);
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('deviceId', deviceId);
        if (deviceInfo) {
            formData.append('deviceInfo', JSON.stringify(deviceInfo));
        }

        if (onProgress) {
            return this.uploadWithProgress(CONFIG.API.ENDPOINTS.FILES_UPLOAD, formData, onProgress, workspaceId);
        }

        const response = await this.upload(CONFIG.API.ENDPOINTS.FILES_UPLOAD, formData, workspaceId);

        if (response.success) {
            return response.data;
        }
        throw new Error(response.error || CONFIG.ERRORS.FILE_UPLOAD_FAILED);
    },
    
    // 带进度的文件上传
    uploadWithProgress(url, formData, onProgress, workspaceId = null) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            const timeoutId = setTimeout(() => {
                xhr.abort();
                reject(new Error('文件上传超时'));
            }, 60000);

            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    onProgress((event.loaded / event.total) * 100);
                }
            });

            xhr.addEventListener('load', () => {
                clearTimeout(timeoutId);
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        reject(new Error('响应解析失败'));
                    }
                } else {
                    reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                }
            });

            xhr.addEventListener('error', () => reject(new Error('网络错误')));
            xhr.addEventListener('abort', () => reject(new Error('上传已取消')));

            xhr.open('POST', url);
            if (Auth && Auth.getToken()) {
                xhr.setRequestHeader('Authorization', `Bearer ${Auth.getToken()}`);
            }
            xhr.setRequestHeader('X-Workspace-Id', this.getWorkspaceId(workspaceId));
            xhr.send(formData);
        });
    },
    
    // 下载文件
    async downloadFile(r2Key, fileName, workspaceId = null) {
        try {
            const url = `${CONFIG.API.ENDPOINTS.FILES_DOWNLOAD}/${r2Key}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const headers = this.withWorkspaceHeaders(Auth ? Auth.addAuthHeader({}) : {}, workspaceId);
            const response = await fetch(url, { headers, signal: controller.signal });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`下载失败: ${response.status} ${response.statusText}`);
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);

            return true;
        } catch (error) {
            console.error('[API] 文件下载失败:', error);
            if (error.name === 'AbortError') {
                console.error('下载超时');
            } else if (error.message.includes('401')) {
                if (typeof Auth !== 'undefined' && Auth.logout) {
                    setTimeout(() => { Auth.logout(); window.location.href = '/login.html'; }, 2000);
                }
            }
            return false;
        }
    },

    imageBlobUrlCache: new Map(),

    async getImageBlobUrl(r2Key, workspaceId = null) {
        const currentWorkspaceId = this.getWorkspaceId(workspaceId);
        const cacheKey = `${currentWorkspaceId}:${r2Key}`;
        if (this.imageBlobUrlCache.has(cacheKey)) {
            return this.imageBlobUrlCache.get(cacheKey);
        }

        const url = `${CONFIG.API.ENDPOINTS.FILES_DOWNLOAD}/${r2Key}`;
        const headers = this.withWorkspaceHeaders(Auth ? Auth.addAuthHeader({}) : {}, currentWorkspaceId);
        const response = await fetch(url, { headers });

        if (!response.ok) {
            throw new Error(`图片加载失败: ${response.status} ${response.statusText}`);
        }

        const blobUrl = window.URL.createObjectURL(await response.blob());
        this.imageBlobUrlCache.set(cacheKey, blobUrl);
        return blobUrl;
    },

    revokeImageBlobUrl(r2Key, workspaceId = null) {
        const currentWorkspaceId = this.getWorkspaceId(workspaceId);
        const cacheKey = `${currentWorkspaceId}:${r2Key}`;
        const blobUrl = this.imageBlobUrlCache.get(cacheKey);
        if (blobUrl) {
            window.URL.revokeObjectURL(blobUrl);
            this.imageBlobUrlCache.delete(cacheKey);
        }
    },

    clearImageBlobCache() {
        this.imageBlobUrlCache.forEach((blobUrl) => window.URL.revokeObjectURL(blobUrl));
        this.imageBlobUrlCache.clear();
    },

    async getWorkspaces() {
        const response = await this.get(CONFIG.API.ENDPOINTS.WORKSPACES);
        if (response && response.success) return response.data || [];
        throw new Error(response?.error || '获取工作区失败');
    },

    async createWorkspace(payload) {
        const response = await this.post(CONFIG.API.ENDPOINTS.WORKSPACES, payload);
        if (response && response.success) return response.data;
        throw new Error(response?.error || '创建工作区失败');
    },

    async updateWorkspace(id, payload) {
        const response = await this.request(`${CONFIG.API.ENDPOINTS.WORKSPACES}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });
        if (response && response.success) return response.data;
        throw new Error(response?.error || '更新工作区失败');
    },

    async deleteWorkspace(id) {
        const response = await this.request(`${CONFIG.API.ENDPOINTS.WORKSPACES}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        if (response && response.success) return true;
        throw new Error(response?.error || '删除工作区失败');
    },

    // 设备同步
    async syncDevice(deviceId, deviceName) {
        return this.post(CONFIG.API.ENDPOINTS.SYNC, { deviceId, deviceName });
    },

    // 清空所有数据
    async clearAllData(confirmCode) {
        return this.post(CONFIG.API.ENDPOINTS.CLEAR_ALL || '/api/clear-all', { confirmCode });
    },

    // 检查认证状态
    async checkAuthStatus() {
        try {
            const response = await this.get(CONFIG.API.ENDPOINTS.AUTH_VERIFY, {}, { skipWorkspace: true });
            return response.valid === true;
        } catch (error) {
            console.warn('[API] 认证状态检查失败:', error);
            return false;
        }
    }
};

import { DBService } from './database.js'

export const DEFAULT_WORKSPACE_ID = 'default'

const DEFAULT_WORKSPACE = {
  id: DEFAULT_WORKSPACE_ID,
  name: '默认',
  slug: 'default',
  color: '#07c160',
  sortOrder: 0,
  isDefault: 1,
}

const workspaceSchemaReady = new WeakSet()

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function normalizeId(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  return normalized
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function generateId(name) {
  const base = normalizeId(slugify(name)) || 'workspace'
  return `${base}-${Date.now().toString(36)}`
}

function normalizeColor(value) {
  if (typeof value !== 'string') return null
  const color = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null
}

async function getColumns(db, tableName) {
  const result = await DBService.queryAll(db, `PRAGMA table_info(${tableName})`)
  return result.results || []
}

async function ensureColumn(db, tableName, columnName, definition) {
  const columns = await getColumns(db, tableName)
  if (columns.some(column => column.name === columnName)) return

  try {
    await DBService.execute(db, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  } catch (error) {
    if (!/duplicate column name/i.test(error.message || '')) {
      throw error
    }
  }
}

async function ensureDefaultWorkspace(db) {
  await DBService.execute(db, `
    INSERT OR IGNORE INTO workspaces (id, name, slug, color, sort_order, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    DEFAULT_WORKSPACE.id,
    DEFAULT_WORKSPACE.name,
    DEFAULT_WORKSPACE.slug,
    DEFAULT_WORKSPACE.color,
    DEFAULT_WORKSPACE.sortOrder,
    DEFAULT_WORKSPACE.isDefault,
  ])
}

function mapWorkspace(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    sortOrder: row.sort_order || 0,
    isDefault: row.is_default === 1 || row.is_default === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const WorkspaceService = {
  async ensureSchema(db) {
    if (workspaceSchemaReady.has(db)) return

    await DBService.execute(db, `
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        is_default INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await ensureDefaultWorkspace(db)

    await ensureColumn(db, 'messages', 'workspace_id', `TEXT DEFAULT '${DEFAULT_WORKSPACE_ID}'`)
    await ensureColumn(db, 'files', 'workspace_id', `TEXT DEFAULT '${DEFAULT_WORKSPACE_ID}'`)
    await ensureColumn(db, 'devices', 'workspace_id', `TEXT DEFAULT '${DEFAULT_WORKSPACE_ID}'`)

    await DBService.execute(db, `UPDATE messages SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''`, [DEFAULT_WORKSPACE_ID])
    await DBService.execute(db, `UPDATE files SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''`, [DEFAULT_WORKSPACE_ID])
    await DBService.execute(db, `UPDATE devices SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''`, [DEFAULT_WORKSPACE_ID])

    await DBService.execute(db, `CREATE INDEX IF NOT EXISTS idx_messages_workspace_timestamp ON messages(workspace_id, timestamp DESC)`)
    await DBService.execute(db, `CREATE INDEX IF NOT EXISTS idx_files_workspace_created ON files(workspace_id, created_at DESC)`)
    await DBService.execute(db, `CREATE INDEX IF NOT EXISTS idx_devices_workspace_active ON devices(workspace_id, last_active DESC)`)

    workspaceSchemaReady.add(db)
  },

  async list(db) {
    await this.ensureSchema(db)
    const result = await DBService.queryAll(db, `
      SELECT id, name, slug, color, sort_order, is_default, created_at, updated_at
      FROM workspaces
      ORDER BY is_default DESC, sort_order ASC, created_at ASC
    `)
    return (result.results || []).map(mapWorkspace)
  },

  async getById(db, id) {
    await this.ensureSchema(db)
    const workspaceId = normalizeId(id) || DEFAULT_WORKSPACE_ID
    const row = await DBService.queryFirst(db, `
      SELECT id, name, slug, color, sort_order, is_default, created_at, updated_at
      FROM workspaces
      WHERE id = ?
    `, [workspaceId])
    return row ? mapWorkspace(row) : null
  },

  async resolveId(db, id) {
    await this.ensureSchema(db)
    const workspaceId = normalizeId(id) || DEFAULT_WORKSPACE_ID
    const workspace = await this.getById(db, workspaceId)
    return workspace?.id || DEFAULT_WORKSPACE_ID
  },

  async create(db, { name, slug, color } = {}) {
    await this.ensureSchema(db)

    const workspaceName = String(name || '').trim().slice(0, 40)
    if (!workspaceName) {
      const error = new Error('工作区名称不能为空')
      error.status = 400
      throw error
    }

    const workspaceSlug = slugify(slug || workspaceName) || generateId(workspaceName)
    const id = normalizeId(workspaceSlug) || generateId(workspaceName)
    const maxSort = await DBService.queryFirst(db, `SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM workspaces`)

    try {
      await DBService.execute(db, `
        INSERT INTO workspaces (id, name, slug, color, sort_order, is_default)
        VALUES (?, ?, ?, ?, ?, 0)
      `, [
        id,
        workspaceName,
        workspaceSlug,
        normalizeColor(color),
        (maxSort?.maxSort || 0) + 10,
      ])
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(error.message || '')) {
        const duplicate = new Error('工作区标识已存在，请换一个名称')
        duplicate.status = 409
        throw duplicate
      }
      throw error
    }

    return this.getById(db, id)
  },

  async update(db, id, { name, color, sortOrder } = {}) {
    await this.ensureSchema(db)
    const workspaceId = normalizeId(id)
    if (!workspaceId) {
      const error = new Error('工作区不存在')
      error.status = 404
      throw error
    }

    const workspace = await this.getById(db, workspaceId)
    if (!workspace) {
      const error = new Error('工作区不存在')
      error.status = 404
      throw error
    }

    const nextName = typeof name === 'string' && name.trim()
      ? name.trim().slice(0, 40)
      : workspace.name
    const nextColor = color === undefined ? workspace.color : normalizeColor(color)
    const nextSortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : workspace.sortOrder

    await DBService.execute(db, `
      UPDATE workspaces
      SET name = ?, color = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [nextName, nextColor, nextSortOrder, workspaceId])

    return this.getById(db, workspaceId)
  },

  async delete(db, id) {
    await this.ensureSchema(db)
    const workspaceId = normalizeId(id)
    if (!workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) {
      const error = new Error('默认工作区不能删除')
      error.status = 400
      throw error
    }

    const workspace = await this.getById(db, workspaceId)
    if (!workspace) {
      const error = new Error('工作区不存在')
      error.status = 404
      throw error
    }

    await DBService.execute(db, `DELETE FROM messages WHERE COALESCE(workspace_id, ?) = ?`, [DEFAULT_WORKSPACE_ID, workspaceId])
    await DBService.execute(db, `DELETE FROM files WHERE COALESCE(workspace_id, ?) = ?`, [DEFAULT_WORKSPACE_ID, workspaceId])
    await DBService.execute(db, `DELETE FROM devices WHERE COALESCE(workspace_id, ?) = ?`, [DEFAULT_WORKSPACE_ID, workspaceId])
    await DBService.execute(db, `DELETE FROM workspaces WHERE id = ?`, [workspaceId])

    return { success: true }
  },

  getWorkspaceIdFromRequest(c) {
    return normalizeId(
      c.req.header('X-Workspace-Id') ||
      c.req.query('workspaceId') ||
      DEFAULT_WORKSPACE_ID
    ) || DEFAULT_WORKSPACE_ID
  },

  async resolveRequestWorkspaceId(c) {
    const { DB } = c.env
    return this.resolveId(DB, this.getWorkspaceIdFromRequest(c))
  },
}

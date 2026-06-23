import { Hono } from 'hono'
import { FileService } from '../services/fileService.js'
import { DEFAULT_WORKSPACE_ID, WorkspaceService } from '../services/workspaceService.js'

const workspaces = new Hono()

workspaces.get('/', async (c) => {
  try {
    const { DB } = c.env
    const data = await WorkspaceService.list(DB)
    return c.json({ success: true, data })
  } catch (error) {
    console.error('[Workspaces] 获取工作区失败:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

workspaces.post('/', async (c) => {
  try {
    const { DB } = c.env
    const body = await c.req.json()
    const workspace = await WorkspaceService.create(DB, body)
    return c.json({ success: true, data: workspace }, 201)
  } catch (error) {
    const status = error.status || 500
    console.error('[Workspaces] 创建工作区失败:', error)
    return c.json({ success: false, error: error.message }, status)
  }
})

workspaces.patch('/:id', async (c) => {
  try {
    const { DB } = c.env
    const body = await c.req.json()
    const workspace = await WorkspaceService.update(DB, c.req.param('id'), body)
    return c.json({ success: true, data: workspace })
  } catch (error) {
    const status = error.status || 500
    console.error('[Workspaces] 更新工作区失败:', error)
    return c.json({ success: false, error: error.message }, status)
  }
})

workspaces.delete('/:id', async (c) => {
  try {
    const { DB, R2 } = c.env
    const workspaceId = c.req.param('id')
    const workspace = await WorkspaceService.getById(DB, workspaceId)
    if (!workspace) {
      return c.json({ success: false, error: '工作区不存在' }, 404)
    }
    if (workspace.id === DEFAULT_WORKSPACE_ID || workspace.isDefault) {
      return c.json({ success: false, error: '默认工作区不能删除' }, 400)
    }

    const r2Keys = await FileService.getAllR2Keys(DB, workspaceId)

    if (R2) {
      for (const key of r2Keys) {
        await FileService.deleteFromR2(R2, key)
      }
    }

    await WorkspaceService.delete(DB, workspaceId)
    return c.json({ success: true })
  } catch (error) {
    const status = error.status || 500
    console.error('[Workspaces] 删除工作区失败:', error)
    return c.json({ success: false, error: error.message }, status)
  }
})

export default workspaces

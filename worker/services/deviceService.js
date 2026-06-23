/**
 * 设备服务层 - 设备管理与同步
 */

import { DBService } from './database.js'
import { DEFAULT_WORKSPACE_ID, WorkspaceService } from './workspaceService.js'

export const DeviceService = {
  async ensureSchema(db) {
    await WorkspaceService.ensureSchema(db)
  },

  /**
   * 同步设备信息（注册或更新）
   */
  async syncDevice(db, { deviceId, deviceName, workspaceId = DEFAULT_WORKSPACE_ID }) {
    await this.ensureSchema(db)

    await DBService.execute(db,
      `INSERT OR REPLACE INTO devices (id, workspace_id, name, last_active)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [deviceId, workspaceId || DEFAULT_WORKSPACE_ID, deviceName || '未知设备']
    )
    return { success: true }
  },

  /**
   * 删除所有设备
   */
  async deleteAll(db, workspaceId = DEFAULT_WORKSPACE_ID) {
    await this.ensureSchema(db)

    await DBService.execute(db, `DELETE FROM devices WHERE COALESCE(workspace_id, ?) = ?`, [
      DEFAULT_WORKSPACE_ID,
      workspaceId || DEFAULT_WORKSPACE_ID,
    ])
  }
}

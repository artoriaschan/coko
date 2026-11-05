import { API_ROUTES, StoragePathsResponse } from '@coko/protocol'
import { requestJson } from './api.ts'

/** 启动时解析的存储路径，不读取或修改偏好设置。 */
export const loadStoragePaths = () => requestJson(StoragePathsResponse, 'GET', API_ROUTES.storage)

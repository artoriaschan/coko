import type { Project } from '@coko/protocol'
import { toast } from '@coko/ui'
import * as React from 'react'
import { useChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useWorkbenchNavigation } from '../../app/workbench.tsx'
import { projectApi } from '../../client/api.ts'
import { ProjectFormDialog } from './project-form.tsx'

type CreateRequest = { onComplete?: (project: Project) => void }
const ProjectDialogsContext = React.createContext<((request?: CreateRequest) => void) | null>(null)

export function useCreateProject() {
  return React.useContext(ProjectDialogsContext)
}

/** 弹窗宿主位于 App 层；完成动作由入口指定，Toast 不随表单卸载。 */
export function ProjectDialogsProvider({ pickDirectory, children }: { pickDirectory: () => Promise<string | null>; children: React.ReactNode }) {
  const [request, setRequest] = React.useState<CreateRequest | null>(null)
  const chat = useChatStoreApi()
  const navigation = useWorkbenchNavigation()
  const { t } = useI18n()
  return (
    <ProjectDialogsContext.Provider value={(next = {}) => setRequest(next)}>
      {children}
      {request && (
        <ProjectFormDialog
          mode="create"
          pickDirectory={pickDirectory}
          onSubmit={projectApi.create}
          onClose={() => setRequest(null)}
          onComplete={(result) => {
            chat.lists.getState().upsertProject(result.project)
            setRequest(null)
            if (request.onComplete) request.onComplete(result.project)
            else navigation.newChat(result.project.primaryWorkspaceId)
            if (result.status === 'existing') toast.info(t('projectForm.existing', { name: result.project.name }))
          }}
        />
      )}
    </ProjectDialogsContext.Provider>
  )
}
